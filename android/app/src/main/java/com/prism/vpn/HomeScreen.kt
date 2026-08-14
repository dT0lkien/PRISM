package com.prism.vpn

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Power
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/**
 * Главный экран.
 *
 * Устроен вокруг одного действия — подключиться. Всё остальное убрано на второй
 * план: список серверов открывается снизу, конфиг и добавление живут в шапке.
 * Спектральное кольцо вокруг кнопки — не украшение, а индикатор: оно неподвижно
 * в покое, вращается при подключении и светится ровным цветом в работе.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(model: AppViewModel, onConnectRequested: () -> Unit) {
    var showServers by remember { mutableStateOf(false) }
    var showAdd by remember { mutableStateOf(false) }
    var showConfig by remember { mutableStateOf(false) }

    val active = model.nodes.firstOrNull { it.id == model.activeNodeId }

    Scaffold(
        containerColor = Prism.Background,
        topBar = {
            TopAppBar(
                title = {
                    Text("Prism", style = MaterialTheme.typography.titleLarge)
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color.Transparent,
                    titleContentColor = Prism.TextPrimary
                ),
                actions = {
                    if (model.nodes.isNotEmpty()) {
                        IconButton(onClick = { showConfig = true }) {
                            Icon(Icons.Default.Description, "Конфиг", tint = Prism.TextSecondary)
                        }
                    }
                    IconButton(onClick = { showAdd = true }) {
                        Icon(Icons.Default.Add, "Добавить", tint = Prism.TextSecondary)
                    }
                }
            )
        },
        bottomBar = { StatusBar(model) }
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .padding(horizontal = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            if (model.coreFailure != null) {
                CoreFailure(model.coreFailure!!)
                return@Column
            }

            Spacer(Modifier.weight(1f))

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

            Spacer(Modifier.height(28.dp))
            StateLabel(model.tunnelState, active)
            Spacer(Modifier.height(20.dp))
            Uptime(model)

            Spacer(Modifier.weight(1f))

            ServerCard(active, model.nodes.size) { showServers = true }
            Spacer(Modifier.height(20.dp))
        }
    }

    if (showServers) ServerSheet(model) { showServers = false }
    if (showAdd) AddSheet(model) { showAdd = false }
    if (showConfig) ConfigSheet(model) { showConfig = false }
}

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
        initialValue = 0.94f,
        targetValue = 1.06f,
        animationSpec = infiniteRepeatable(tween(2200, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "breathe"
    )

    val glow = when (state) {
        TunnelState.On -> Prism.Success
        TunnelState.Failed -> Prism.Danger
        else -> Prism.Accent
    }

    Box(contentAlignment = Alignment.Center, modifier = Modifier.size(260.dp)) {
        // Свечение рисуется радиальным градиентом, а не модификатором blur:
        // blur размывает прямоугольник, и его углы остаются видны квадратом
        Canvas(Modifier.fillMaxSize()) {
            val haloAlpha = if (state == TunnelState.On) 0.30f * breathe else 0.12f
            val haloRadius = size.minDimension / 2 * if (state == TunnelState.On) breathe else 1f
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(glow.copy(alpha = haloAlpha), Color.Transparent),
                    center = center,
                    radius = haloRadius
                ),
                radius = haloRadius
            )
        }

        Canvas(Modifier.size(212.dp)) {
            val stroke = 10.dp.toPx()
            val inset = stroke / 2
            val arcSize = Size(size.width - stroke, size.height - stroke)

            // Дорожка кольца
            drawArc(
                color = Prism.Outline,
                startAngle = 0f,
                sweepAngle = 360f,
                useCenter = false,
                topLeft = Offset(inset, inset),
                size = arcSize,
                style = Stroke(width = stroke, cap = StrokeCap.Round)
            )

            // Спектр — фирменный элемент: призма разлагает свет именно так
            val spectrum = Brush.sweepGradient(Prism.Spectrum + Prism.Spectrum.first())
            when (state) {
                TunnelState.Connecting -> rotate(spin) {
                    drawArc(
                        brush = spectrum,
                        startAngle = 0f,
                        sweepAngle = 110f,
                        useCenter = false,
                        topLeft = Offset(inset, inset),
                        size = arcSize,
                        style = Stroke(width = stroke, cap = StrokeCap.Round)
                    )
                }
                TunnelState.On -> drawArc(
                    brush = spectrum,
                    startAngle = 0f,
                    sweepAngle = 360f,
                    useCenter = false,
                    topLeft = Offset(inset, inset),
                    size = arcSize,
                    style = Stroke(width = stroke, cap = StrokeCap.Round)
                )
                else -> Unit
            }
        }

        Surface(
            onClick = onClick,
            enabled = enabled && state != TunnelState.Connecting,
            shape = CircleShape,
            color = Prism.SurfaceHigh,
            border = androidx.compose.foundation.BorderStroke(1.dp, Prism.Outline),
            modifier = Modifier.size(152.dp)
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    Icons.Default.Power,
                    contentDescription = if (state == TunnelState.On) "Отключить" else "Подключить",
                    tint = if (enabled) glow else Prism.TextSecondary.copy(alpha = 0.4f),
                    modifier = Modifier.size(52.dp)
                )
            }
        }
    }
}

// MARK: - Подписи состояния

@Composable
private fun StateLabel(state: TunnelState, active: ServerNode?) {
    val (text, color) = when {
        active == null -> "Сервер не выбран" to Prism.TextSecondary
        state == TunnelState.On -> "Подключено" to Prism.Success
        state == TunnelState.Connecting -> "Подключение…" to Prism.Warning
        state == TunnelState.Failed -> "Не удалось подключиться" to Prism.Danger
        else -> "Отключено" to Prism.TextSecondary
    }
    Text(text, color = color, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
}

/** Время в эфире считается от момента подключения и обновляется раз в секунду */
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
    } else "—:—:—"

    Text(
        text,
        color = if (model.tunnelState == TunnelState.On) Prism.TextPrimary else Prism.TextSecondary.copy(alpha = 0.5f),
        fontSize = 15.sp,
        fontWeight = FontWeight.Medium
    )
}

// MARK: - Карточка сервера

@Composable
private fun ServerCard(active: ServerNode?, total: Int, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(20.dp),
        color = Prism.Surface,
        border = androidx.compose.foundation.BorderStroke(1.dp, Prism.Outline),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                Modifier
                    .size(40.dp)
                    .background(
                        Brush.linearGradient(Prism.Spectrum.take(4)),
                        RoundedCornerShape(12.dp)
                    )
            )
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    active?.name ?: "Выбрать сервер",
                    color = Prism.TextPrimary,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1
                )
                Text(
                    if (active != null) "${active.server}:${active.port}" else "Список пуст",
                    color = Prism.TextSecondary,
                    fontSize = 13.sp,
                    maxLines = 1
                )
            }
            if (total > 0) {
                Text("$total", color = Prism.TextSecondary, fontSize = 13.sp)
                Spacer(Modifier.width(6.dp))
            }
            Icon(Icons.Default.KeyboardArrowRight, null, tint = Prism.TextSecondary)
        }
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

    Surface(color = Prism.SurfaceHigh) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (model.isBusy) {
                CircularProgressIndicator(
                    Modifier.size(16.dp),
                    strokeWidth = 2.dp,
                    color = Prism.Accent
                )
                Spacer(Modifier.width(12.dp))
                Text("Загружаю…", color = Prism.TextSecondary, fontSize = 13.sp)
            } else if (status != null) {
                Text(status, color = Prism.TextPrimary, fontSize = 13.sp, modifier = Modifier.weight(1f))
                TextButton(onClick = { model.status = null }) {
                    Text("Скрыть", color = Prism.Accent, fontSize = 13.sp)
                }
            }
        }
    }
}

@Composable
private fun CoreFailure(message: String) {
    Column(
        Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text("Общее ядро не загрузилось", color = Prism.TextPrimary, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(8.dp))
        Text(
            message,
            color = Prism.TextSecondary,
            fontSize = 13.sp,
            textAlign = TextAlign.Center
        )
    }
}
