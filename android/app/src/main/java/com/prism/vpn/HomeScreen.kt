package com.prism.vpn

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Power
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/**
 * Главный экран.
 *
 * Устроен по-эппловски: крупный заголовок, одно главное действие в центре и
 * список-группа со вставками внизу. Всё остальное убрано на второй план —
 * серверы и настройки открываются переходом, а не борются за внимание.
 */
@Composable
fun HomeScreen(model: AppViewModel, onConnectRequested: () -> Unit) {
    var screen by remember { mutableStateOf(Screen.Home) }
    var showServers by remember { mutableStateOf(false) }
    var showConfig by remember { mutableStateOf(false) }

    if (screen == Screen.Settings) {
        SettingsScreen(model) { screen = Screen.Home }
        return
    }

    val active = model.nodes.firstOrNull { it.id == model.activeNodeId }

    Scaffold(
        containerColor = Palette.Background,
        bottomBar = { StatusBar(model) }
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
        ) {
            Text(
                "Prism",
                style = AppleType.LargeTitle,
                color = Palette.Label,
                modifier = Modifier.padding(start = 16.dp, top = 8.dp, bottom = 8.dp)
            )

            if (model.coreFailure != null) {
                CoreFailure(model.coreFailure!!)
                return@Column
            }

            Spacer(Modifier.height(40.dp))

            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                ConnectButton(
                    state = model.tunnelState,
                    enabled = active != null,
                    onClick = {
                        when (model.tunnelState) {
                            TunnelState.On -> model.disconnect()
                            TunnelState.Connecting -> Unit
                            else -> onConnectRequested()
                        }
                    }
                )
            }

            Spacer(Modifier.height(24.dp))
            StateLabel(model.tunnelState, active)
            Spacer(Modifier.height(6.dp))
            Uptime(model)
            Spacer(Modifier.height(44.dp))

            InsetGroup {
                NavigationRow(
                    title = "Сервер",
                    value = active?.name ?: "не выбран",
                    onClick = { showServers = true }
                )
                RowSeparator()
                NavigationRow(title = "Настройки", onClick = { screen = Screen.Settings })
                RowSeparator()
                NavigationRow(title = "Конфиг", onClick = { showConfig = true })
            }

            Spacer(Modifier.height(32.dp))
        }
    }

    if (showServers) ServerSheet(model) { showServers = false }
    if (showConfig) ConfigSheet(model) { showConfig = false }
}

private enum class Screen { Home, Settings }

// MARK: - Кнопка подключения

@Composable
private fun ConnectButton(state: TunnelState, enabled: Boolean, onClick: () -> Unit) {
    val transition = rememberInfiniteTransition(label = "ring")
    val spin by transition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(2400, easing = LinearEasing)),
        label = "spin"
    )
    val breathe by transition.animateFloat(
        initialValue = 0.95f,
        targetValue = 1.05f,
        animationSpec = infiniteRepeatable(tween(2400, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "breathe"
    )

    val accent = when (state) {
        TunnelState.On -> Palette.Green
        TunnelState.Failed -> Palette.Red
        TunnelState.Connecting -> Palette.Orange
        else -> Palette.LabelTertiary
    }

    Box(contentAlignment = Alignment.Center, modifier = Modifier.size(248.dp)) {
        // Свечение — радиальный градиент, а не размытие прямоугольника:
        // у размытия остаются видны углы
        Canvas(Modifier.fillMaxSize()) {
            val alpha = if (state == TunnelState.On) 0.22f * breathe else 0.08f
            val radius = size.minDimension / 2 * if (state == TunnelState.On) breathe else 1f
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(accent.copy(alpha = alpha), Color.Transparent),
                    center = center,
                    radius = radius
                ),
                radius = radius
            )
        }

        Canvas(Modifier.size(200.dp)) {
            val stroke = 6.dp.toPx()
            val inset = stroke / 2
            val arc = Size(size.width - stroke, size.height - stroke)
            val corner = androidx.compose.ui.geometry.Offset(inset, inset)

            drawArc(
                color = Palette.Separator,
                startAngle = 0f,
                sweepAngle = 360f,
                useCenter = false,
                topLeft = corner,
                size = arc,
                style = Stroke(width = stroke, cap = StrokeCap.Round)
            )

            // Спектр появляется единственный раз во всём приложении — здесь
            val spectrum = Brush.sweepGradient(Palette.Spectrum + Palette.Spectrum.first())
            when (state) {
                TunnelState.Connecting -> rotate(spin) {
                    drawArc(
                        brush = spectrum,
                        startAngle = 0f,
                        sweepAngle = 90f,
                        useCenter = false,
                        topLeft = corner,
                        size = arc,
                        style = Stroke(width = stroke, cap = StrokeCap.Round)
                    )
                }
                TunnelState.On -> drawArc(
                    brush = spectrum,
                    startAngle = 0f,
                    sweepAngle = 360f,
                    useCenter = false,
                    topLeft = corner,
                    size = arc,
                    style = Stroke(width = stroke, cap = StrokeCap.Round)
                )
                else -> Unit
            }
        }

        Surface(
            onClick = onClick,
            enabled = enabled && state != TunnelState.Connecting,
            shape = CircleShape,
            color = Palette.Grouped,
            modifier = Modifier.size(148.dp)
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    Icons.Default.Power,
                    contentDescription = if (state == TunnelState.On) "Отключить" else "Подключить",
                    tint = if (enabled) accent else Palette.LabelTertiary,
                    modifier = Modifier.size(46.dp)
                )
            }
        }
    }
}

// MARK: - Состояние

@Composable
private fun StateLabel(state: TunnelState, active: ServerNode?) {
    val (text, color) = when {
        active == null -> "Сервер не выбран" to Palette.LabelSecondary
        state == TunnelState.On -> "Подключено" to Palette.Green
        state == TunnelState.Connecting -> "Подключение…" to Palette.Orange
        state == TunnelState.Failed -> "Не удалось подключиться" to Palette.Red
        else -> "Отключено" to Palette.LabelSecondary
    }
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Text(text, style = AppleType.Title3, color = color)
    }
}

/** Время в эфире: моноширинный, чтобы цифры не прыгали при смене секунды */
@Composable
private fun Uptime(model: AppViewModel) {
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(model.tunnelState) {
        while (model.tunnelState == TunnelState.On) {
            now = System.currentTimeMillis()
            delay(1000)
        }
    }
    val since = model.connectedAt
    val text = if (model.tunnelState == TunnelState.On && since != null) {
        val seconds = ((now - since) / 1000).coerceAtLeast(0)
        "%02d:%02d:%02d".format(seconds / 3600, (seconds % 3600) / 60, seconds % 60)
    } else "––:––:––"

    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Text(
            text,
            style = AppleType.Subheadline.copy(fontFamily = FontFamily.Monospace),
            color = if (model.tunnelState == TunnelState.On) Palette.LabelSecondary else Palette.LabelTertiary
        )
    }
}

// MARK: - Полоса состояния

/**
 * Показывается на любом экране, включая пустой: именно там добавляется первая
 * подписка, и там же должен быть виден её исход.
 */
@Composable
private fun StatusBar(model: AppViewModel) {
    val status = model.status
    if (!model.isBusy && status == null) return

    Surface(color = Palette.Grouped) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (model.isBusy) {
                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = Palette.Blue)
                Spacer(Modifier.width(12.dp))
                Text("Загружаю…", style = AppleType.Footnote, color = Palette.LabelSecondary)
            } else if (status != null) {
                Text(status, style = AppleType.Footnote, color = Palette.Label, modifier = Modifier.weight(1f))
                TextButton(onClick = { model.status = null }) {
                    Text("Скрыть", style = AppleType.Footnote, color = Palette.Blue)
                }
            }
        }
    }
}

@Composable
private fun CoreFailure(message: String) {
    Column(
        Modifier.fillMaxWidth().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(Modifier.height(80.dp))
        Text("Общее ядро не загрузилось", style = AppleType.Headline, color = Palette.Label)
        Spacer(Modifier.height(8.dp))
        Text(message, style = AppleType.Footnote, color = Palette.LabelSecondary)
    }
}
