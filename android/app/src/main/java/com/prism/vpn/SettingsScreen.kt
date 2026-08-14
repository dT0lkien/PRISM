package com.prism.vpn

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBackIosNew
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
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
fun SettingsScreen(model: AppViewModel, onBack: () -> Unit) {
    var presets by remember { mutableStateOf<List<PresetInfo>>(emptyList()) }
    var editing by remember { mutableStateOf<Pair<String, String>?>(null) }

    LaunchedEffect(model.core) {
        val core = model.core ?: return@LaunchedEffect
        presets = runCatching { core.presetList() }.getOrDefault(emptyList())
    }

    Scaffold(
        containerColor = Palette.Background,
        topBar = {
            TopAppBar(
                title = { Text("Настройки", style = AppleType.Headline) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBackIosNew, "Назад", tint = Palette.Blue, modifier = Modifier.size(20.dp))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Palette.Background,
                    titleContentColor = Palette.Label
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
            RoutingSection(model)
            RulesSection(model, presets)
            NetworkSection(model)
            DnsSection(model) { path, title -> editing = path to title }
            AboutSection()
            Spacer(Modifier.height(32.dp))
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
private fun RoutingSection(model: AppViewModel) {
    val modes = listOf(
        Triple("smart", "Умный", "Российские сайты напрямую, остальное через сервер"),
        Triple("global", "Всё через сервер", "Весь трафик идёт в туннель"),
        Triple("whitelist", "Только по списку", "Через сервер идут лишь выбранные правилами сайты"),
        Triple("direct", "Напрямую", "Туннель поднят, но трафик идёт мимо него")
    )
    val current = model.stringSetting("routingMode", "smart")

    SectionHeader("Маршрутизация")
    InsetGroup {
        modes.forEachIndexed { index, (id, name, description) ->
            CheckRow(
                title = name,
                subtitle = description,
                selected = current == id,
                onClick = { model.setSetting("routingMode", id) }
            )
            if (index != modes.lastIndex) RowSeparator()
        }
    }
}

@Composable
private fun RulesSection(model: AppViewModel, presets: List<PresetInfo>) {
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
    SectionHeader("Сеть")
    InsetGroup {
        SwitchRow(
            title = "Блокировать QUIC",
            subtitle = "Браузеры откатятся на TCP — он проксируется надёжнее",
            checked = model.booleanSetting("blockQuic", true),
            onCheckedChange = { model.setSetting("blockQuic", it) }
        )
        RowSeparator()
        SwitchRow(
            title = "Локальная сеть мимо туннеля",
            subtitle = "Иначе отвалятся принтеры, телевизор и роутер",
            checked = model.booleanSetting("bypassPrivate", true),
            onCheckedChange = { model.setSetting("bypassPrivate", it) }
        )
        RowSeparator()
        SwitchRow(
            title = "IPv6",
            checked = model.booleanSetting("tun.ipv6", false),
            onCheckedChange = { model.setSetting("tun.ipv6", it) }
        )
    }
}

@Composable
private fun DnsSection(model: AppViewModel, onEdit: (String, String) -> Unit) {
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
        RowSeparator()
        SwitchRow(
            title = "Российские домены — прямым DNS",
            checked = model.booleanSetting("dns.splitDns", true),
            onCheckedChange = { model.setSetting("dns.splitDns", it) }
        )
    }
    SectionFooter("Основной DNS работает через сервер, прямой — в обход туннеля.")
}

@Composable
private fun AboutSection() {
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
    var text by remember { mutableStateOf(initial) }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = Palette.Grouped,
        dragHandle = { BottomSheetDefaults.DragHandle(color = Palette.Separator) }
    ) {
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 32.dp)) {
            Text(title, style = AppleType.Headline, color = Palette.Label)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                textStyle = AppleType.Body.copy(fontFamily = FontFamily.Monospace, color = Palette.Label),
                shape = RoundedCornerShape(10.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Palette.Blue,
                    unfocusedBorderColor = Palette.Separator,
                    focusedContainerColor = Palette.GroupedPressed,
                    unfocusedContainerColor = Palette.GroupedPressed
                )
            )
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = { onSave(text.trim()) },
                enabled = text.isNotBlank(),
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Palette.Blue),
                modifier = Modifier.fillMaxWidth().height(50.dp)
            ) {
                Text("Сохранить", style = AppleType.Body, color = Color.White)
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
