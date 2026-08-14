package com.prism.vpn

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.outlined.Circle
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
fun ServerListScreen(model: AppViewModel) {
    var showAdd by remember { mutableStateOf(false) }
    var showConfig by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Prism", fontWeight = FontWeight.Bold) },
                actions = {
                    if (model.nodes.isNotEmpty()) {
                        IconButton(onClick = { showConfig = true }) {
                            Icon(Icons.Default.Description, contentDescription = "Конфиг")
                        }
                        IconButton(onClick = { showAdd = true }) {
                            Icon(Icons.Default.Add, contentDescription = "Добавить")
                        }
                    }
                }
            )
        },
        bottomBar = { StatusBar(model) }
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            when {
                model.coreFailure != null -> CoreFailure(model.coreFailure!!)
                model.nodes.isEmpty() -> EmptyState(
                    onPaste = { showAdd = true },
                    onSample = { model.addSamples() }
                )
                else -> NodeList(model)
            }
        }
    }

    if (showAdd) AddSheet(model) { showAdd = false }
    if (showConfig) ConfigSheet(model) { showConfig = false }
}

@Composable
private fun NodeList(model: AppViewModel) {
    LazyColumn(
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        item {
            Text(
                "Туннель появится следующим шагом. Сейчас проверяются разбор ссылок и сборка конфига.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 6.dp)
            )
        }
        items(model.nodes, key = { it.id }) { node ->
            NodeRow(
                node = node,
                isActive = node.id == model.activeNodeId,
                onSelect = { model.activeNodeId = node.id },
                onDelete = { model.remove(node) }
            )
        }
    }
}

@Composable
private fun NodeRow(node: ServerNode, isActive: Boolean, onSelect: () -> Unit, onDelete: () -> Unit) {
    Card(Modifier.fillMaxWidth().clickable(onClick = onSelect)) {
        Row(
            Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = if (isActive) Icons.Default.CheckCircle else Icons.Outlined.Circle,
                contentDescription = null,
                tint = if (isActive) MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
            )
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    node.name,
                    fontWeight = if (isActive) FontWeight.SemiBold else FontWeight.Normal,
                    maxLines = 1
                )
                Text(
                    "${node.server}:${node.port}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1
                )
            }
            TypeBadge(node.type)
            IconButton(onClick = onDelete) {
                Icon(
                    Icons.Default.Delete,
                    contentDescription = "Удалить",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

/** Цвет по протоколу — чтобы список читался с одного взгляда */
@Composable
private fun TypeBadge(type: String) {
    val color = when (type) {
        "vless" -> Color(0xFF9C27B0)
        "vmess" -> Color(0xFF2196F3)
        "trojan" -> Color(0xFFF44336)
        "shadowsocks" -> Color(0xFF4CAF50)
        "hysteria2", "hysteria" -> Color(0xFFFF9800)
        "tuic" -> Color(0xFF009688)
        "wireguard" -> Color(0xFFE91E63)
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Text(
        text = type,
        fontSize = 11.sp,
        fontWeight = FontWeight.Medium,
        color = color,
        modifier = Modifier
            .background(color.copy(alpha = 0.15f), RoundedCornerShape(50))
            .padding(horizontal = 8.dp, vertical = 3.dp)
    )
}

@Composable
private fun EmptyState(onPaste: () -> Unit, onSample: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text("Пока нет серверов", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        Text(
            "Вставь адрес подписки или ссылки — по одной на строку.\n" +
                "Поддерживаются vless, vmess, trojan, shadowsocks, hysteria2 и tuic.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center
        )
        Spacer(Modifier.height(20.dp))
        Button(onClick = onPaste, modifier = Modifier.fillMaxWidth(0.7f)) {
            Text("Вставить ссылки")
        }
        Spacer(Modifier.height(8.dp))
        OutlinedButton(onClick = onSample, modifier = Modifier.fillMaxWidth(0.7f)) {
            Text("Добавить примеры")
        }
    }
}

@Composable
private fun CoreFailure(message: String) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text("Общее ядро не загрузилось", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        Text(
            message,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center
        )
    }
}

/**
 * Полоса состояния показывается на любом экране, включая пустой: именно там
 * добавляется первая подписка, и там же должен быть виден её исход.
 */
@Composable
private fun StatusBar(model: AppViewModel) {
    val status = model.status
    if (!model.isBusy && status == null) return

    Surface(tonalElevation = 3.dp) {
        Row(
            Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (model.isBusy) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(12.dp))
                Text("Загружаю…", style = MaterialTheme.typography.bodySmall)
            } else if (status != null) {
                Text(status, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                TextButton(onClick = { model.status = null }) { Text("Скрыть") }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddSheet(model: AppViewModel, onDismiss: () -> Unit) {
    var text by remember { mutableStateOf("") }
    val clipboard = LocalClipboardManager.current

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 24.dp)) {
            Text("Добавить серверы", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(12.dp))

            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                modifier = Modifier.fillMaxWidth().height(160.dp),
                placeholder = { Text("https://… — адрес подписки\nлибо vless://…, по одной на строку") },
                textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace)
            )

            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                // Кнопка вставки убирает целый класс промахов: попасть в поле,
                // вызвать меню и выбрать «Вставить» — три шанса промахнуться,
                // после чего кнопка добавления остаётся неактивной и кажется,
                // будто приложение не делает ничего
                OutlinedButton(onClick = {
                    val clip = clipboard.getText()?.text
                    if (clip.isNullOrBlank()) model.status = "В буфере обмена пусто" else text = clip
                }) {
                    Icon(Icons.Default.ContentPaste, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Вставить")
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
                    modifier = Modifier.weight(1f)
                ) {
                    Text("Добавить")
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ConfigSheet(model: AppViewModel, onDismiss: () -> Unit) {
    var text by remember { mutableStateOf("Собираю…") }
    LaunchedEffect(Unit) {
        text = runCatching { model.configJson() }.getOrElse { "Ошибка: ${it.message}" }
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 24.dp)) {
            Text("Конфиг sing-box", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(12.dp))
            SelectionContainer {
                Text(
                    text,
                    fontSize = 10.sp,
                    fontFamily = FontFamily.Monospace,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 480.dp)
                        .verticalScroll(rememberScrollState())
                        .horizontalScroll(rememberScrollState())
                )
            }
        }
    }
}
