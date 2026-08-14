package com.prism.vpn

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ServerSheet(model: AppViewModel, onDismiss: () -> Unit) {
    var showAdd by remember { mutableStateOf(false) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = Palette.Background,
        dragHandle = { BottomSheetDefaults.DragHandle(color = Palette.Separator) }
    ) {
        Column(Modifier.padding(bottom = 24.dp)) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Серверы", style = AppleType.Title2, color = Palette.Label, modifier = Modifier.weight(1f))
                TextButton(onClick = { showAdd = true }) {
                    Text("Добавить", style = AppleType.Body, color = Palette.Blue)
                }
            }
            Spacer(Modifier.height(8.dp))

            if (model.nodes.isEmpty()) {
                Text(
                    "Список пуст. Вставьте адрес подписки или ссылки кнопкой «Добавить».",
                    style = AppleType.Footnote,
                    color = Palette.LabelSecondary,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 32.dp)
                )
            } else {
                Column(Modifier.heightIn(max = 460.dp).verticalScroll(rememberScrollState())) {
                    InsetGroup {
                        model.nodes.forEachIndexed { index, node ->
                            NodeRow(
                                node = node,
                                isActive = node.id == model.activeNodeId,
                                onSelect = {
                                    model.activeNodeId = node.id
                                    onDismiss()
                                },
                                onDelete = { model.remove(node) }
                            )
                            if (index != model.nodes.lastIndex) RowSeparator(inset = 52.dp)
                        }
                    }
                }
            }
        }
    }

    if (showAdd) AddSheet(model) { showAdd = false }
}

@Composable
private fun NodeRow(node: ServerNode, isActive: Boolean, onSelect: () -> Unit, onDelete: () -> Unit) {
    val accent = Palette.protocol(node.type)
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clickable(onClick = onSelect)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            Modifier.size(24.dp).background(accent.copy(alpha = 0.18f), CircleShape),
            contentAlignment = Alignment.Center
        ) {
            if (isActive) {
                Icon(Icons.Default.Check, null, tint = accent, modifier = Modifier.size(15.dp))
            } else {
                Box(Modifier.size(7.dp).background(accent, CircleShape))
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(node.name, style = AppleType.Body, color = Palette.Label, maxLines = 1)
            Text(
                "${node.server}:${node.port} · ${node.type}",
                style = AppleType.Footnote,
                color = Palette.LabelSecondary,
                maxLines = 1
            )
        }
        IconButton(onClick = onDelete) {
            Icon(Icons.Default.DeleteOutline, "Удалить", tint = Palette.LabelTertiary, modifier = Modifier.size(20.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddSheet(model: AppViewModel, onDismiss: () -> Unit) {
    var text by remember { mutableStateOf("") }
    val clipboard = LocalClipboardManager.current

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = Palette.Background,
        dragHandle = { BottomSheetDefaults.DragHandle(color = Palette.Separator) }
    ) {
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 32.dp)) {
            Text("Добавить серверы", style = AppleType.Title2, color = Palette.Label)
            Spacer(Modifier.height(4.dp))
            Text(
                "Адрес подписки или ссылки — по одной на строку",
                style = AppleType.Footnote,
                color = Palette.LabelSecondary
            )
            Spacer(Modifier.height(16.dp))

            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                modifier = Modifier.fillMaxWidth().height(140.dp),
                placeholder = {
                    Text("https://…\nvless://…", style = AppleType.Footnote, color = Palette.LabelTertiary)
                },
                textStyle = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 13.sp, color = Palette.Label),
                shape = RoundedCornerShape(10.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Palette.Blue,
                    unfocusedBorderColor = Palette.Separator,
                    focusedContainerColor = Palette.Grouped,
                    unfocusedContainerColor = Palette.Grouped
                )
            )

            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                // Вставка вынесена в кнопку: попасть в поле, вызвать меню и
                // выбрать «Вставить» — три шанса промахнуться, после чего кнопка
                // добавления остаётся серой и кажется, будто ничего не работает
                OutlinedButton(
                    onClick = {
                        val clip = clipboard.getText()?.text
                        if (clip.isNullOrBlank()) model.status = "В буфере обмена пусто" else text = clip
                    },
                    shape = RoundedCornerShape(10.dp),
                    border = androidx.compose.foundation.BorderStroke(1.dp, Palette.Separator),
                    modifier = Modifier.height(50.dp)
                ) {
                    Icon(Icons.Default.ContentPaste, null, tint = Palette.Blue, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Вставить", style = AppleType.Body, color = Palette.Blue)
                }
                Button(
                    onClick = {
                        val trimmed = text.trim()
                        // Одинокий http-адрес — это подписка, её надо скачать.
                        // Всё остальное разбираем как список ссылок.
                        if (trimmed.startsWith("http", ignoreCase = true) && !trimmed.contains("\n")) {
                            model.addFromSubscription(trimmed)
                        } else {
                            model.addFromLinks(text)
                        }
                        onDismiss()
                    },
                    enabled = text.isNotBlank(),
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Palette.Blue,
                        disabledContainerColor = Palette.Grouped
                    ),
                    modifier = Modifier.weight(1f).height(50.dp)
                ) {
                    Text("Добавить", style = AppleType.Body, color = Color.White)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConfigSheet(model: AppViewModel, onDismiss: () -> Unit) {
    var text by remember { mutableStateOf("Собираю…") }
    LaunchedEffect(Unit) {
        text = runCatching { model.configJson() }.getOrElse { "Ошибка: ${it.message}" }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = Palette.Background,
        dragHandle = { BottomSheetDefaults.DragHandle(color = Palette.Separator) }
    ) {
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 32.dp)) {
            Text("Конфиг sing-box", style = AppleType.Title2, color = Palette.Label)
            Spacer(Modifier.height(4.dp))
            Text(
                "Собран общим ядром — тем же, что на Windows и iPhone",
                style = AppleType.Footnote,
                color = Palette.LabelSecondary
            )
            Spacer(Modifier.height(16.dp))
            SelectionContainer {
                Text(
                    text,
                    fontSize = 10.sp,
                    fontFamily = FontFamily.Monospace,
                    color = Palette.LabelSecondary,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 420.dp)
                        .background(Palette.Grouped, RoundedCornerShape(10.dp))
                        .padding(12.dp)
                        .verticalScroll(rememberScrollState())
                        .horizontalScroll(rememberScrollState())
                )
            }
        }
    }
}
