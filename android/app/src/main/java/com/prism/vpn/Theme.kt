package com.prism.vpn

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object Palette {
    val background = Color(0xFF0D0D0F)
    val surface = Color(0xFF202022)
    val surfaceAlt = Color(0xFF29292D)
    val line = Color(0xFF3A3A3D)
    val controlTrack = Color(0xFF48484C)
    val text = Color(0xFFF5F5F7)
    val muted = Color(0xFFA5A5AD)
    val dim = Color(0xFF84848C)
    val accent = Color(0xFF6AAEFF)
    val ok = Color(0xFF34C759)
    val err = Color(0xFFFF696C)
    val corner = 23.dp

    fun protocol(type: String): Color = when (type) {
        "vless" -> Color(0xFFC293F8)
        "vmess" -> accent
        "trojan" -> err
        "shadowsocks" -> ok
        "hysteria2", "hysteria" -> Color(0xFFFFC05D)
        "tuic" -> Color(0xFF5BD4E4)
        else -> muted
    }
}

object Fonts {
    val largeTitle = TextStyle(fontSize = 34.sp, lineHeight = 41.sp, fontWeight = FontWeight.Bold)
    val title2 = TextStyle(fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.Bold)
    val headline = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold)
    val body = TextStyle(fontSize = 17.sp, lineHeight = 22.sp)
    val subheadline = TextStyle(fontSize = 15.sp, lineHeight = 20.sp)
    val footnote = TextStyle(fontSize = 13.sp, lineHeight = 18.sp)
    val caption = TextStyle(fontSize = 12.sp, lineHeight = 16.sp)
}

private val PrismColors = darkColorScheme(
    primary = Palette.accent,
    onPrimary = Color(0xFF071A30),
    background = Palette.background,
    surface = Palette.surface,
    onSurface = Palette.text,
    outline = Palette.line,
    error = Palette.err
)

@Composable
fun PrismTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = PrismColors, content = content)
}
