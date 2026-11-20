package com.prism.vpn

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun ServerPanel(model: AppViewModel, bottomPadding: Dp, onAdd: () -> Unit) {
    val skin = Palette
    val checking = model.serverPings.values.any { it == PingResult.Pending }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        LazyColumn(
            Modifier.widthIn(max = 520.dp).fillMaxWidth(),
            contentPadding = PaddingValues(top = 12.dp, bottom = bottomPadding)
        ) {
            if (model.nodes.isEmpty()) {
                item {
                    InsetGroup {
                        Text(
                            "Добавьте ссылку на сервер или адрес подписки.",
                            Modifier.padding(18.dp),
                            style = Fonts.subheadline,
                            color = skin.muted
                        )
                    }
                }
            } else {
                item {
                    Row(
                        Modifier.fillMaxWidth().padding(start = 20.dp, end = 16.dp, bottom = 7.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Пинг", Modifier.weight(1f), style = Fonts.headline, color = skin.text)
                        val method = model.pingMethod
                        val position = animateFloatAsState(
                            if (method == PingMethod.URL) 1f else 0f,
                            spring(dampingRatio = .86f),
                            label = "Ping method"
                        )
                        GlassSelector(Modifier.width(72.dp), index = { position.value }, inset = 2.dp) {
                            SegmentText("TCP", method == PingMethod.TCP, Modifier.weight(1f), compact = true) {
                                model.setPingMethod(PingMethod.TCP)
                            }
                            SegmentText("URL", method == PingMethod.URL, Modifier.weight(1f), compact = true) {
                                model.setPingMethod(PingMethod.URL)
                            }
                        }
                        Spacer(Modifier.width(5.dp))
                        ServerAction(
                            Icons.Default.Bolt, "Измерить пинг",
                            enabled = !checking && model.core != null,
                            pending = checking,
                            onClick = model::pingServers
                        )
                        ServerAction(Icons.Default.Add, "Добавить сервер", enabled = model.core != null, onClick = onAdd)
                    }
                    InsetGroup {
                        CheckRow(
                            title = "Автовыбор",
                            subtitle = "Prism выбирает сервер по доступности и задержке",
                            selected = model.activeNodeId == AppViewModel.AUTO,
                            onClick = { model.selectServer(AppViewModel.AUTO) }
                        )
                    }
                    Spacer(Modifier.height(12.dp))
                }
            }
            items(model.nodes, key = { it.id }) { node ->
                InsetGroup {
                    NodeRow(
                        node = node,
                        isActive = node.id == model.activeNodeId,
                        ping = model.serverPings[node.id],
                        onSelect = { model.selectServer(node.id) },
                        onDelete = { model.remove(node) }
                    )
                }
                Spacer(Modifier.height(5.dp))
            }
        }
    }
}

@Composable
private fun ServerAction(
    icon: ImageVector,
    label: String,
    enabled: Boolean,
    pending: Boolean = false,
    onClick: () -> Unit
) {
    IconButton(onClick = onClick, enabled = enabled) {
        Box(
            Modifier.size(34.dp).background(Palette.controlTrack, CircleShape)
                .border(1.dp, Color.White.copy(alpha = .10f), CircleShape),
            contentAlignment = Alignment.Center
        ) {
            if (pending) {
                CircularProgressIndicator(Modifier.size(15.dp), strokeWidth = 2.dp, color = Palette.text)
            } else {
                Icon(icon, label, Modifier.size(18.dp), tint = if (enabled) Palette.text else Palette.dim)
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun NodeRow(
    node: ServerNode,
    isActive: Boolean,
    ping: PingResult?,
    onSelect: () -> Unit,
    onDelete: () -> Unit
) {
    val skin = Palette
    val accent = skin.protocol(node.type)
    var menuOpen by remember(node.id) { mutableStateOf(false) }
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.TopEnd) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp)
                .combinedClickable(
                    role = Role.RadioButton,
                    onClick = onSelect,
                    onLongClickLabel = "Действия с сервером",
                    onLongClick = { menuOpen = true }
                )
                .semantics { selected = isActive }
                .padding(horizontal = 16.dp, vertical = 8.dp),
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
                Text(node.name, style = Fonts.body, color = skin.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    "${node.server}:${node.port} · ${node.type}",
                    style = Fonts.footnote,
                    color = skin.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            val delay = when (ping) {
                is PingResult.Delay -> "${ping.milliseconds} мс"
                PingResult.Pending -> "…"
                PingResult.Unavailable -> "Нет ответа"
                null -> "—"
            }
            Text(
                delay,
                Modifier.padding(start = 8.dp),
                style = Fonts.footnote.copy(fontFamily = FontFamily.Monospace),
                color = when (ping) {
                    is PingResult.Delay -> skin.ok
                    PingResult.Unavailable -> skin.err
                    else -> skin.muted
                }
            )
        }
        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
            DropdownMenuItem(
                text = { Text("Удалить сервер", color = skin.err) },
                leadingIcon = { Icon(Icons.Default.DeleteOutline, null, tint = skin.err) },
                onClick = {
                    menuOpen = false
                    onDelete()
                }
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddSheet(model: AppViewModel, onDismiss: () -> Unit) {
    val skin = Palette
    var text by remember { mutableStateOf("") }
    val clipboard = LocalClipboardManager.current

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = skin.background,
        dragHandle = { BottomSheetDefaults.DragHandle(color = skin.line) }
    ) {
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 32.dp)) {
            Text("Добавить серверы", style = Fonts.title2, color = skin.text)
            Spacer(Modifier.height(4.dp))
            Text(
                "Адрес подписки или ссылки — по одной на строку",
                style = Fonts.footnote,
                color = skin.muted
            )
            Spacer(Modifier.height(16.dp))

            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                modifier = Modifier.fillMaxWidth().height(140.dp),
                placeholder = {
                    Text("https://…\nvless://…", style = Fonts.footnote, color = skin.dim)
                },
                textStyle = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 13.sp, color = skin.text),
                shape = RoundedCornerShape(10.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = skin.accent,
                    unfocusedBorderColor = skin.line,
                    focusedContainerColor = skin.surface,
                    unfocusedContainerColor = skin.surface
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
                    border = androidx.compose.foundation.BorderStroke(1.dp, skin.line),
                    modifier = Modifier.height(50.dp)
                ) {
                    Icon(Icons.Default.ContentPaste, null, tint = skin.accent, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Вставить", style = Fonts.body, color = skin.accent)
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
                        containerColor = skin.accent,
                        disabledContainerColor = skin.surface
                    ),
                    modifier = Modifier.weight(1f).height(50.dp)
                ) {
                    Text("Добавить", style = Fonts.body, color = Color.White)
                }
            }
        }
    }
}
