package com.prism.vpn

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.AltRoute
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.roundToInt
import kotlin.math.sin

private enum class Page { Vpn, Settings, Routing }

@Composable
fun HomeScreen(model: AppViewModel, onConnectRequested: () -> Unit) {
    var page by rememberSaveable { mutableStateOf(Page.Vpn) }
    var showAdd by rememberSaveable { mutableStateOf(false) }
    val pager = rememberPagerState { 2 }
    val scope = rememberCoroutineScope()
    val bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    val contentPadding = bottom + 88.dp

    BackHandler(page == Page.Settings) { page = Page.Vpn }
    Box(Modifier.fillMaxSize().background(Palette.background)) {
        AnimatedContent(
            targetState = page,
            modifier = Modifier.fillMaxSize(),
            transitionSpec = {
                val direction = if (targetState.ordinal > initialState.ordinal) 1 else -1
                (fadeIn(tween(200, delayMillis = 30)) + slideInHorizontally(tween(260)) { direction * it / 18 })
                    .togetherWith(fadeOut(tween(140)) + slideOutHorizontally(tween(230)) { -direction * it / 20 })
            },
            label = "Navigation"
        ) { target ->
            when (target) {
                Page.Vpn -> Column(
                    Modifier.fillMaxSize().statusBarsPadding().padding(top = 42.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    val state = model.tunnelState
                    val active = state == TunnelState.On || state == TunnelState.Recovering || state == TunnelState.Blocked
                    val switching = state == TunnelState.Connecting || state == TunnelState.Disconnecting
                    val ready = model.core != null
                    if (model.nodes.isNotEmpty() || active || switching) {
                        VpnSwitch(active, switching, ready || active) {
                            if (active) model.disconnect() else onConnectRequested()
                        }
                    } else {
                        Button(
                            onClick = { showAdd = true },
                            enabled = ready,
                            modifier = Modifier.heightIn(min = 48.dp)
                        ) {
                            Icon(Icons.Default.Add, null, Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Добавить сервер", style = Fonts.subheadline.copy(fontWeight = FontWeight.SemiBold))
                        }
                        model.coreFailure?.let { Text(it, Modifier.padding(12.dp), color = Palette.err, style = Fonts.footnote) }
                    }
                    Spacer(Modifier.height(16.dp))
                    GlassSelector(
                        modifier = Modifier.widthIn(max = 520.dp).fillMaxWidth().padding(horizontal = 18.dp),
                        index = { pager.currentPage + pager.currentPageOffsetFraction }
                    ) {
                        SegmentText("Серверы", pager.currentPage == 0, Modifier.weight(1f)) {
                            scope.launch { pager.animateScrollToPage(0) }
                        }
                        SegmentText("Маршруты", pager.currentPage == 1, Modifier.weight(1f)) {
                            scope.launch { pager.animateScrollToPage(1) }
                        }
                    }
                    HorizontalPager(state = pager, modifier = Modifier.weight(1f).fillMaxWidth()) { item ->
                        if (item == 0) {
                            ServerPanel(model, contentPadding) { showAdd = true }
                        } else {
                            RoutesPanel(model, contentPadding) { page = Page.Routing }
                        }
                    }
                }
                Page.Settings -> SettingsScreen(model, contentPadding) { page = Page.Vpn }
                Page.Routing -> RoutingScreen(model) { page = Page.Vpn }
            }
        }
        if (page != Page.Routing) {
            Column(
                Modifier.align(Alignment.BottomCenter).navigationBarsPadding()
                    .padding(horizontal = 18.dp, vertical = 8.dp).widthIn(max = 360.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                if (model.isBusy) LinearProgressIndicator(Modifier.fillMaxWidth().padding(bottom = 4.dp))
                model.status?.let { message ->
                    Surface(
                        modifier = Modifier.padding(bottom = 8.dp),
                        shape = MaterialTheme.shapes.large,
                        color = Palette.surfaceAlt,
                        border = androidx.compose.foundation.BorderStroke(1.dp, Palette.line)
                    ) {
                        Row(
                            Modifier.padding(start = 14.dp, end = 3.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(message, Modifier.weight(1f), color = Palette.text, style = Fonts.footnote)
                            TextButton(onClick = { model.status = null }) { Text("Скрыть") }
                        }
                    }
                }
                val dockPosition = animateFloatAsState(
                    if (page == Page.Settings) 1f else 0f,
                    spring(dampingRatio = .82f, stiffness = Spring.StiffnessMediumLow),
                    label = "Dock selection"
                )
                GlassSelector(
                    modifier = Modifier.widthIn(max = 280.dp).fillMaxWidth(),
                    index = { dockPosition.value },
                    floating = true
                ) {
                    DockItem("VPN", Icons.Default.Shield, page == Page.Vpn, Modifier.weight(1f)) { page = Page.Vpn }
                    DockItem("Настройки", Icons.Default.Settings, page == Page.Settings, Modifier.weight(1f)) { page = Page.Settings }
                }
            }
        }
    }
    if (showAdd && model.core != null) AddSheet(model) { showAdd = false }
}

@Composable
private fun VpnSwitch(checked: Boolean, switching: Boolean, enabled: Boolean, onToggle: () -> Unit) {
    val track by animateColorAsState(
        if (checked) Palette.ok else Palette.controlTrack,
        animationSpec = tween(210),
        label = "VPN track"
    )
    val thumb = animateDpAsState(
        if (checked) 41.dp else 5.dp,
        spring(dampingRatio = .78f, stiffness = Spring.StiffnessMediumLow),
        label = "VPN thumb"
    )
    Column(
        Modifier.widthIn(min = 128.dp).clip(CircleShape)
            .toggleable(checked, enabled = enabled && !switching, role = Role.Switch) { onToggle() }
            .semantics { contentDescription = "VPN" }
            .padding(horizontal = 12.dp, vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(7.dp)
    ) {
        Box(
            Modifier.size(width = 84.dp, height = 48.dp)
                .background(track, CircleShape)
                .border(1.dp, Color.White.copy(alpha = .10f), CircleShape),
            contentAlignment = Alignment.CenterStart
        ) {
            Box(
                Modifier.offset { IntOffset(thumb.value.roundToPx(), 0) }.size(38.dp)
                    .background(Color.White, CircleShape),
                contentAlignment = Alignment.Center
            ) {
                if (switching) {
                    CircularProgressIndicator(Modifier.size(15.dp), strokeWidth = 2.dp, color = Palette.dim)
                }
            }
        }
        Text(
            if (checked) "Отключиться" else "Подключиться",
            style = Fonts.footnote,
            color = Palette.muted
        )
    }
}

@Composable
internal fun GlassSelector(
    modifier: Modifier,
    index: () -> Float,
    floating: Boolean = false,
    inset: Dp = 4.dp,
    content: @Composable RowScope.() -> Unit
) {
    val face = if (floating) {
        listOf(Color(0x4D85858C), Color(0x592C2C33), Color(0x7035353C))
    } else listOf(Color(0x403F3F46), Color(0x66313137))
    BoxWithConstraints(
        modifier.clip(CircleShape).background(Brush.verticalGradient(face))
            .border(
                1.dp, Brush.verticalGradient(
                    listOf(Color.White.copy(alpha = .29f), Color.White.copy(alpha = .08f), Color.White.copy(alpha = .16f))
                ), CircleShape
            )
            .padding(inset)
    ) {
        val cell = maxWidth / 2
        Box(Modifier.matchParentSize()) {
            Box(
                Modifier.fillMaxHeight().width(cell)
                    .offset { IntOffset((cell.toPx() * index().coerceIn(0f, 1f)).roundToInt(), 0) }
                    .graphicsLayer {
                        val lift = sin(index().coerceIn(0f, 1f) * PI).toFloat() * .055f
                        scaleX = 1f + lift
                        scaleY = 1f + lift * .5f
                    }
                    .background(
                        Brush.verticalGradient(listOf(Color(0x55767682), Color(0x385F5F69))), CircleShape
                    )
                    .border(1.dp, Color.White.copy(alpha = .11f), CircleShape)
            )
        }
        Row(content = content)
    }
}

@Composable
internal fun SegmentText(
    label: String,
    isSelected: Boolean,
    modifier: Modifier,
    compact: Boolean = false,
    onClick: () -> Unit
) {
    val color by animateColorAsState(if (isSelected) Palette.text else Palette.muted, label = "Segment label")
    Box(
        modifier.heightIn(min = if (compact) 26.dp else 42.dp).clip(CircleShape)
            .clickable(role = Role.Tab, onClick = onClick).semantics { selected = isSelected }
            .padding(horizontal = if (compact) 3.dp else 8.dp, vertical = 4.dp),
        contentAlignment = Alignment.Center
    ) {
        val style = if (compact) Fonts.caption else Fonts.subheadline
        Text(label, color = color, style = style.copy(fontWeight = FontWeight.SemiBold))
    }
}

@Composable
private fun DockItem(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    isSelected: Boolean,
    modifier: Modifier,
    onClick: () -> Unit
) {
    val tint by animateColorAsState(if (isSelected) Palette.accent else Palette.text, label = "Dock label")
    Column(
        modifier.clip(CircleShape).clickable(role = Role.Tab, onClick = onClick)
            .semantics { selected = isSelected }.heightIn(min = 54.dp).padding(vertical = 5.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically)
    ) {
        Icon(icon, null, Modifier.size(23.dp), tint = tint)
        Text(label, style = Fonts.caption.copy(fontWeight = FontWeight.Medium), color = tint)
    }
}

@Composable
private fun RoutesPanel(model: AppViewModel, bottomPadding: Dp, onEdit: () -> Unit) {
    val modes = listOf(
        Triple("smart", "Умный", "Маршрутизация по встроенным правилам Prism"),
        Triple("config", "Из конфига", "Правила из вашей секции route"),
        Triple("global", "Всё через туннель", "Весь трафик через выбранный сервер")
    )
    val current = model.stringSetting("routingMode", "smart")
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier.widthIn(max = 520.dp).fillMaxWidth().verticalScroll(rememberScrollState())
                .padding(top = 17.dp, bottom = bottomPadding)
        ) {
            InsetGroup {
                modes.forEachIndexed { index, (id, name, description) ->
                    if (index != 0) RowSeparator()
                    CheckRow(name, description, current == id) { model.setSetting("routingMode", id) }
                }
            }
            Spacer(Modifier.height(12.dp))
            InsetGroup {
                NavigationRow(
                    "Редактор JSON",
                    if (model.routingJson.isBlank()) null else "Настроен",
                    icon = Icons.AutoMirrored.Filled.AltRoute,
                    onClick = onEdit
                )
            }
        }
    }
}
