package com.prism.vpn

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBackIosNew
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RoutingScreen(model: AppViewModel, onBack: () -> Unit) {
    val skin = Palette
    val saved = model.routingJson.ifBlank { RoutingJson.EMPTY }
    var draft by rememberSaveable { mutableStateOf(saved) }
    var preview by remember { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var failed by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var confirmExit by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    fun report(text: String, error: Boolean = false) {
        failed = error
        message = text
    }

    fun perform(action: suspend () -> Unit) {
        if (busy) return
        busy = true
        scope.launch {
            try {
                action()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                report(error.localizedMessage ?: "Не удалось обработать маршруты", true)
            } finally {
                busy = false
            }
        }
    }

    fun back() {
        when {
            busy -> Unit
            preview != null -> preview = null
            draft != saved -> confirmExit = true
            else -> onBack()
        }
    }

    val importFile = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) perform {
            draft = withContext(Dispatchers.IO) {
                val input = context.contentResolver.openInputStream(uri) ?: error("Не удалось открыть файл")
                val text = input.bufferedReader().use { reader ->
                    val result = StringBuilder()
                    val buffer = CharArray(4096)
                    while (true) {
                        val count = reader.read(buffer)
                        if (count < 0) break
                        require(result.length + count <= RoutingJson.MAX_LENGTH) { "Файл маршрутов слишком большой" }
                        result.append(buffer, 0, count)
                    }
                    result.toString().removePrefix("\uFEFF")
                }
                RoutingJson.format(text, extractRoute = true)
            }
            preview = null
            report("Секция route загружена в редактор")
        }
    }

    val exportFile = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null) perform {
            val json = RoutingJson.format(draft)
            withContext(Dispatchers.IO) {
                val output = context.contentResolver.openOutputStream(uri) ?: error("Не удалось создать файл")
                output.bufferedWriter().use { it.write(json) }
            }
            report("Файл маршрутов сохранён")
        }
    }

    BackHandler { back() }
    Scaffold(
        containerColor = skin.background,
        topBar = {
            TopAppBar(
                title = { Text("Маршрутизация", style = Fonts.headline) },
                navigationIcon = {
                    IconButton(onClick = { back() }) {
                        Icon(Icons.Default.ArrowBackIosNew, "Назад", tint = skin.accent)
                    }
                },
                actions = {
                    Box {
                        IconButton(onClick = { menu = true }, enabled = !busy && preview == null) {
                            Icon(Icons.Default.MoreHoriz, "Действия с JSON", tint = skin.accent)
                        }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text("Открыть JSON…") }, onClick = {
                                menu = false
                                importFile.launch(arrayOf("application/json", "text/*", "application/octet-stream"))
                            })
                            DropdownMenuItem(text = { Text("Экспортировать JSON…") }, onClick = {
                                menu = false
                                perform {
                                    RoutingJson.format(draft)
                                    exportFile.launch("prism-routes.json")
                                }
                            })
                            DropdownMenuItem(text = { Text("Вставить пример") }, onClick = {
                                menu = false
                                if (draft == RoutingJson.EMPTY) {
                                    draft = RoutingJson.EXAMPLE
                                    report("Пример добавлен в редактор")
                                } else {
                                    report("Чтобы вставить пример, сначала очистите редактор")
                                }
                            })
                            DropdownMenuItem(text = { Text("Очистить редактор") }, onClick = {
                                menu = false
                                draft = RoutingJson.EMPTY
                                report("Сохраните пустую секцию, чтобы удалить свои правила")
                            })
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = skin.background, titleContentColor = skin.text)
            )
        }
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).imePadding()
                .padding(horizontal = 18.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text(if (preview == null) "Правила JSON" else "Итоговая секция", style = Fonts.title2, color = skin.text)
            Text(
                if (preview == null) "Свои правила работают в режиме «Из конфига». Изменения применяются после переподключения."
                else "Порядок правил, которые sing-box получит в режиме «Из конфига».",
                style = Fonts.footnote,
                color = skin.muted
            )
            val rendered = preview
            val codeStyle = Fonts.footnote.copy(fontFamily = FontFamily.Monospace, color = skin.text)
            if (rendered == null) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = {
                        if (it.length <= RoutingJson.MAX_LENGTH) {
                            draft = it
                            message = null
                        } else report("Достигнут предел размера файла маршрутов", true)
                    },
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    textStyle = codeStyle,
                    label = { Text("route.json") },
                    enabled = !busy,
                    keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, keyboardType = KeyboardType.Ascii),
                    shape = RoundedCornerShape(18.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedContainerColor = skin.surface,
                        unfocusedContainerColor = skin.surface,
                        unfocusedBorderColor = skin.line
                    )
                )
            } else {
                Surface(
                    Modifier.weight(1f).fillMaxWidth(),
                    shape = RoundedCornerShape(18.dp),
                    color = skin.surface
                ) {
                    SelectionContainer {
                        Text(
                            rendered,
                            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp),
                            style = codeStyle
                        )
                    }
                }
            }
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            message?.let {
                Text(
                    it, Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    style = Fonts.footnote,
                    color = if (failed) skin.err else skin.text,
                    maxLines = 4
                )
            }
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                if (rendered == null) {
                    OutlinedButton(
                        onClick = { perform { preview = model.routingPreview(draft); message = null } },
                        enabled = !busy && model.core != null,
                        modifier = Modifier.weight(1f)
                    ) { Text("Итог") }
                    Button(
                        onClick = { perform {
                            draft = model.saveRouting(draft)
                            report("Сохранено. Применится при следующем подключении")
                        } },
                        enabled = !busy && model.core != null,
                        modifier = Modifier.weight(1.4f)
                    ) { Text("Проверить и сохранить") }
                } else {
                    Button(onClick = { preview = null }, modifier = Modifier.fillMaxWidth()) {
                        Text("К редактору")
                    }
                }
            }
        }
    }
    if (confirmExit) {
        AlertDialog(
            onDismissRequest = { confirmExit = false },
            title = { Text("Выйти без сохранения?") },
            text = { Text("Сохранённые маршруты останутся в силе.") },
            confirmButton = { TextButton(onClick = onBack) { Text("Выйти") } },
            dismissButton = { TextButton(onClick = { confirmExit = false }) { Text("Продолжить") } }
        )
    }
}
