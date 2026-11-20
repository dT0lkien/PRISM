package com.prism.vpn

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBackIosNew
import androidx.compose.material.icons.automirrored.filled.ReceiptLong
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material3.*
import androidx.compose.runtime.*
import android.app.StatusBarManager
import android.content.ComponentName
import android.content.Intent
import android.graphics.drawable.Icon as AndroidIcon
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import org.json.JSONObject

/**
 * Настройки.
 *
 * Показывается только то, что имеет смысл на телефоне: десктопные пункты вроде
 * лотка, автозапуска и повышения прав из общего ядра сюда не выносятся.
 * Названия и описания правил берутся из самого ядра, а не дублируются здесь, —
 * иначе они разъедутся с Windows-версией при первой же правке.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(model: AppViewModel, bottomPadding: Dp, onBack: () -> Unit) {
    val skin = Palette
    val context = LocalContext.current
    var presets by remember { mutableStateOf<List<PresetInfo>>(emptyList()) }
    var editing by remember { mutableStateOf<Pair<String, String>?>(null) }
    var showLog by remember { mutableStateOf(false) }

    if (showLog) {
        BackHandler { showLog = false }
        LogScreen(model) { showLog = false }
        return
    }

    LaunchedEffect(model.core) {
        val core = model.core ?: return@LaunchedEffect
        presets = runCatching { core.presetList() }.getOrDefault(emptyList())
    }

    Scaffold(
        containerColor = skin.background,
        topBar = {
            TopAppBar(
                title = {},
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBackIosNew, "Назад", tint = skin.accent, modifier = Modifier.size(20.dp))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = skin.background,
                    titleContentColor = skin.text
                )
            )
        }
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
        ) {
            Text(
                "Настройки",
                Modifier.padding(start = 20.dp, end = 20.dp),
                style = Fonts.largeTitle,
                color = skin.text
            )
            SectionHeader("Инструменты")
            InsetGroup {
                NavigationRow("Журнал", icon = Icons.AutoMirrored.Filled.ReceiptLong, onClick = { showLog = true })
                if (Build.VERSION.SDK_INT >= 33) {
                    RowSeparator(inset = 59.dp)
                    NavigationRow("Добавить плитку VPN", icon = Icons.Default.Shield) {
                        context.getSystemService(StatusBarManager::class.java).requestAddTileService(
                            ComponentName(context, PrismTileService::class.java),
                            context.getString(R.string.prism_tile_label),
                            AndroidIcon.createWithResource(context, R.drawable.ic_vpn_tile),
                            context.mainExecutor
                        ) { result ->
                            if (result == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED) {
                                model.status = "Плитка Prism VPN уже добавлена в шторку"
                            }
                        }
                    }
                }
            }
            ReliabilitySection(model)
            if (model.stringSetting("routingMode", "smart") == "smart") RulesSection(model, presets)
            NetworkSection(model)
            DnsSection(model) { path, title -> editing = path to title }
            AboutSection()
            Spacer(Modifier.height(bottomPadding))
        }
    }

    editing?.let { (path, title) ->
        TextFieldSheet(
            title = title,
            initial = model.stringSetting(path),
            onDismiss = { editing = null },
            onSave = {
                model.setSetting(path, it)
                editing = null
            }
        )
    }
}

// MARK: - Разделы

@Composable
private fun ReliabilitySection(model: AppViewModel) {
    val skin = Palette
    val context = LocalContext.current
    val power = context.getSystemService(PowerManager::class.java)
    var unrestricted by remember {
        mutableStateOf(power.isIgnoringBatteryOptimizations(context.packageName))
    }
    // Разрешение выдаётся в системном окне, за пределами приложения: узнать об
    // этом можно только переспросив
    LaunchedEffect(Unit) {
        while (true) {
            unrestricted = power.isIgnoringBatteryOptimizations(context.packageName)
            delay(1500)
        }
    }

    SectionHeader("Надёжность")
    InsetGroup {
        SwitchRow(
            title = "Удерживать туннель при обрыве",
            subtitle = "Оставлять VPN включённым, пока Prism пытается восстановить связь",
            checked = model.booleanSetting("killSwitch", false),
            onCheckedChange = { model.setSetting("killSwitch", it) }
        )
        RowSeparator()
        SwitchRow(
            title = "Подключаться при включении телефона",
            subtitle = "Только если сервер выбран и разрешение уже выдано",
            checked = model.booleanSetting("autoConnect", false),
            onCheckedChange = { model.setSetting("autoConnect", it) }
        )
        RowSeparator()
        NavigationRow(
            title = "Работа в фоне",
            value = if (unrestricted) "Без ограничений" else "Ограничена",
            onClick = {
                context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            }
        )
    }
    SectionFooter(
        "Prism проверяет доступность соединения через локальный прокси ядра. " +
            "При сбое приложение пробует восстановить связь. Подробности доступны в журнале."
    )
}

@Composable
private fun RulesSection(model: AppViewModel, presets: List<PresetInfo>) {
    val skin = Palette
    if (presets.isEmpty()) return
    SectionHeader("Правила")
    InsetGroup {
        presets.forEachIndexed { index, preset ->
            SwitchRow(
                title = preset.name,
                subtitle = preset.description,
                checked = preset.id in model.enabledPresets,
                onCheckedChange = { model.togglePreset(preset.id) }
            )
            if (index != presets.lastIndex) RowSeparator()
        }
    }
    SectionFooter("Правила решают, что идёт через сервер, а что напрямую или отбрасывается.")
}

@Composable
private fun NetworkSection(model: AppViewModel) {
    val mode = model.stringSetting("routingMode", "smart")
    SectionHeader("Сеть")
    InsetGroup {
        if (mode != "config") {
            SwitchRow(
                title = "Блокировать QUIC",
                subtitle = "Браузеры откатятся на TCP",
                checked = model.booleanSetting("blockQuic", true),
                onCheckedChange = { model.setSetting("blockQuic", it) }
            )
            RowSeparator()
        }
        if (mode == "smart") {
            SwitchRow(
                title = "Локальная сеть мимо туннеля",
                subtitle = "Прямой доступ к принтерам, телевизору и роутеру",
                checked = model.booleanSetting("bypassPrivate", true),
                onCheckedChange = { model.setSetting("bypassPrivate", it) }
            )
            RowSeparator()
        }
        SwitchRow(
            title = "IPv6",
            checked = model.booleanSetting("tun.ipv6", false),
            onCheckedChange = { model.setSetting("tun.ipv6", it) }
        )
    }
}

@Composable
private fun DnsSection(model: AppViewModel, onEdit: (String, String) -> Unit) {
    val skin = Palette
    SectionHeader("DNS")
    InsetGroup {
        NavigationRow(
            title = "Основной",
            value = model.stringSetting("dns.remote").shortened(),
            onClick = { onEdit("dns.remote", "Основной DNS") }
        )
        RowSeparator()
        NavigationRow(
            title = "Прямой",
            value = model.stringSetting("dns.local").shortened(),
            onClick = { onEdit("dns.local", "Прямой DNS") }
        )
        RowSeparator()
        SwitchRow(
            title = "Резать рекламу в DNS",
            checked = model.booleanSetting("dns.blockAds", false),
            onCheckedChange = { model.setSetting("dns.blockAds", it) }
        )
        if (model.stringSetting("routingMode", "smart") == "smart") {
            RowSeparator()
            SwitchRow(
                title = "Российские домены — прямым DNS",
                checked = model.booleanSetting("dns.splitDns", true),
                onCheckedChange = { model.setSetting("dns.splitDns", it) }
            )
        }
    }
    SectionFooter("Основной DNS работает через сервер, прямой — в обход туннеля.")
}

@Composable
private fun AboutSection() {
    val skin = Palette
    SectionHeader("О программе")
    InsetGroup {
        ValueRow("Версия", BuildConfig.VERSION_NAME)
        RowSeparator()
        ValueRow("Ядро", "sing-box 1.13.15")
    }
    SectionFooter("Разбор ссылок и сборка конфига — тот же код, что в версии для Windows.")
}

// MARK: - Ввод значения

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TextFieldSheet(
    title: String,
    initial: String,
    onDismiss: () -> Unit,
    onSave: (String) -> Unit
) {
    val skin = Palette
    var text by remember { mutableStateOf(initial) }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = skin.surface,
        dragHandle = { BottomSheetDefaults.DragHandle(color = skin.line) }
    ) {
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 32.dp)) {
            Text(title, style = Fonts.headline, color = skin.text)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                textStyle = Fonts.body.copy(fontFamily = FontFamily.Monospace, color = skin.text),
                shape = RoundedCornerShape(10.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = skin.accent,
                    unfocusedBorderColor = skin.line,
                    focusedContainerColor = skin.surfaceAlt,
                    unfocusedContainerColor = skin.surfaceAlt
                )
            )
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = { onSave(text.trim()) },
                enabled = text.isNotBlank(),
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(containerColor = skin.accent),
                modifier = Modifier.fillMaxWidth().height(50.dp)
            ) {
                Text("Сохранить", style = Fonts.body, color = Color.White)
            }
        }
    }
}

/**
 * Адрес DNS для показа в строке. Схема отбрасывается: она занимает треть
 * ширины и ничего не сообщает, а обрезка с начала превращала https://1.1.1.1
 * в нечитаемое «…s://1.1.1.1».
 */
private fun String.shortened(limit: Int = 24): String {
    val withoutScheme = substringAfter("://", this)
    return if (withoutScheme.length <= limit) withoutScheme
    else withoutScheme.take(limit - 1) + "…"
}

/** Пресет в том виде, в каком он нужен экрану */
data class PresetInfo(val id: String, val name: String, val description: String)

/** Разбор списка пресетов из общего ядра */
suspend fun PrismCore.presetList(): List<PresetInfo> {
    val array = presets()
    return (0 until array.length()).mapNotNull { index ->
        val item: JSONObject = array.optJSONObject(index) ?: return@mapNotNull null
        PresetInfo(
            id = item.optString("id"),
            name = item.optString("name"),
            description = item.optString("description")
        )
    }
}
