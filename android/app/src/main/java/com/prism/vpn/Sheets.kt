package com.prism.vpn

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ServerSheet(model: AppViewModel, onDismiss: () -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = Prism.Surface,
        dragHandle = { BottomSheetDefaults.DragHandle(color = Prism.Outline) }
    ) {
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 24.dp)) {
            Text(
                "Серверы",
                color = Prism.TextPrimary,
                style = MaterialTheme.typography.titleMedium
            )
            Spacer(Modifier.height(12.dp))

            if (model.nodes.isEmpty()) {
                Text(
                    "Список пуст. Добавьте подписку или ссылки кнопкой «+» в шапке.",
                    color = Prism.TextSecondary,
                    fontSize = 13.sp,
                    modifier = Modifier.padding(vertical = 24.dp).fillMaxWidth(),
                    textAlign = TextAlign.Center
                )
            } else {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.heightIn(max = 460.dp)
                ) {
                    items(model.nodes, key = { it.id }) { node ->
                        NodeRow(
                            node = node,
                            isActive = node.id == model.activeNodeId,
                            onSelect = {
                                model.activeNodeId = node.id
                                onDismiss()
                            },
                            onDelete = { model.remove(node) }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun NodeRow(node: ServerNode, isActive: Boolean, onSelect: () -> Unit, onDelete: () -> Unit) {
    val accent = Prism.colorFor(node.type)
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = if (isActive) Prism.SurfaceHigh else Prism.Surface,
        border = androidx.compose.foundation.BorderStroke(
            1.dp,
            if (isActive) accent.copy(alpha = 0.5f) else Prism.Outline
        ),
        modifier = Modifier.fillMaxWidth().clickable(onClick = onSelect)
    ) {
        Row(
            Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                Modifier.size(28.dp).background(accent.copy(alpha = 0.18f), CircleShape),
                contentAlignment = Alignment.Center
            ) {
                if (isActive) {
                    Icon(Icons.Default.Check, null, tint = accent, modifier = Modifier.size(16.dp))
                } else {
                    Box(Modifier.size(8.dp).background(accent, CircleShape))
                }
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    node.name,
                    color = Prism.TextPrimary,
                    fontWeight = if (isActive) FontWeight.SemiBold else FontWeight.Normal,
                    maxLines = 1
                )
                Text(
                    "${node.server}:${node.port}",
                    color = Prism.TextSecondary,
                    fontSize = 12.sp,
                    maxLines = 1
                )
            }
            Text(
                node.type,
                color = accent,
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier
                    .background(accent.copy(alpha = 0.12f), RoundedCornerShape(50))
                    .padding(horizontal = 8.dp, vertical = 3.dp)
            )
            IconButton(onClick = onDelete) {
                Icon(
                    Icons.Default.DeleteOutline,
                    "Удалить",
                    tint = Prism.TextSecondary,
                    modifier = Modifier.size(20.dp)
                )
            }
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
        containerColor = Prism.Surface,
        dragHandle = { BottomSheetDefaults.DragHandle(color = Prism.Outline) }
    ) {
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 24.dp)) {
            Text(
                "Добавить серверы",
                color = Prism.TextPrimary,
                style = MaterialTheme.typography.titleMedium
            )
            Spacer(Modifier.height(4.dp))
            Text(
                "Адрес подписки или ссылки — по одной на строку",
                color = Prism.TextSecondary,
                fontSize = 13.sp
            )
            Spacer(Modifier.height(14.dp))

            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                modifier = Modifier.fillMaxWidth().height(150.dp),
                placeholder = {
                    Text("https://…\nvless://…", color = Prism.TextSecondary.copy(alpha = 0.6f), fontSize = 13.sp)
                },
                textStyle = androidx.compose.ui.text.TextStyle(
                    fontFamily = FontFamily.Monospace,
                    fontSize = 13.sp,
                    color = Prism.TextPrimary
                ),
                shape = RoundedCornerShape(14.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Prism.Accent,
                    unfocusedBorderColor = Prism.Outline,
                    focusedContainerColor = Prism.SurfaceHigh,
                    unfocusedContainerColor = Prism.SurfaceHigh
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
                    shape = RoundedCornerShape(14.dp),
                    border = androidx.compose.foundation.BorderStroke(1.dp, Prism.Outline)
                ) {
                    Icon(Icons.Default.ContentPaste, null, tint = Prism.TextSecondary, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Вставить", color = Prism.TextPrimary)
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
                    shape = RoundedCornerShape(14.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Prism.Accent,
                        disabledContainerColor = Prism.Outline
                    ),
                    modifier = Modifier.weight(1f)
                ) {
                    Text("Добавить", color = Color.White)
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
        containerColor = Prism.Surface,
        dragHandle = { BottomSheetDefaults.DragHandle(color = Prism.Outline) }
    ) {
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 24.dp)) {
            Text(
                "Конфиг sing-box",
                color = Prism.TextPrimary,
                style = MaterialTheme.typography.titleMedium
            )
            Spacer(Modifier.height(4.dp))
            Text(
                "Собран общим ядром — тем же, что на Windows и iPhone",
                color = Prism.TextSecondary,
                fontSize = 13.sp
            )
            Spacer(Modifier.height(12.dp))
            SelectionContainer {
                Text(
                    text,
                    color = Prism.TextSecondary,
                    fontSize = 10.sp,
                    fontFamily = FontFamily.Monospace,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 440.dp)
                        .background(Prism.SurfaceHigh, RoundedCornerShape(14.dp))
                        .padding(12.dp)
                        .verticalScroll(rememberScrollState())
                        .horizontalScroll(rememberScrollState())
                )
            }
        }
    }
}
