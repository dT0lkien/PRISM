package com.prism.vpn

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * Оформление Prism.
 *
 * Название приложения — про призму, разлагающую белый свет в спектр, и это же
 * положено в основу вида: тёмная база как фон логотипа, спектральный градиент
 * как единственный яркий акцент. Светлой темы нет намеренно — приложение
 * состоит из одного главного экрана, который должен читаться как прибор,
 * а не как список настроек.
 */
object Prism {
    val Background = Color(0xFF080B14)
    val Surface = Color(0xFF10151F)
    val SurfaceHigh = Color(0xFF161C29)
    val Outline = Color(0xFF232B3D)

    val TextPrimary = Color(0xFFF2F5FA)
    val TextSecondary = Color(0xFF8A93A8)

    val Accent = Color(0xFF6B8CFF)
    val Success = Color(0xFF3FD68C)
    val Warning = Color(0xFFFFB454)
    val Danger = Color(0xFFFF5A6E)

    /** Спектр из логотипа: используется в градиенте кольца и метках протоколов */
    val Spectrum = listOf(
        Color(0xFFFF5A6E),
        Color(0xFFFFA24B),
        Color(0xFFFFD84B),
        Color(0xFF3FD68C),
        Color(0xFF4BD6E5),
        Color(0xFF6B8CFF),
        Color(0xFFA56BFF)
    )

    /** Цвет метки по протоколу — список должен читаться с одного взгляда */
    fun colorFor(type: String): Color = when (type) {
        "vless" -> Color(0xFFA56BFF)
        "vmess" -> Color(0xFF6B8CFF)
        "trojan" -> Color(0xFFFF5A6E)
        "shadowsocks" -> Color(0xFF3FD68C)
        "hysteria2", "hysteria" -> Color(0xFFFFA24B)
        "tuic" -> Color(0xFF4BD6E5)
        "wireguard" -> Color(0xFFFF8FB1)
        else -> TextSecondary
    }
}

private val PrismTypography = Typography(
    displayLarge = TextStyle(fontSize = 44.sp, fontWeight = FontWeight.Bold, letterSpacing = (-1).sp),
    titleLarge = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = TextStyle(fontSize = 17.sp, fontWeight = FontWeight.SemiBold),
    bodyMedium = TextStyle(fontSize = 15.sp),
    bodySmall = TextStyle(fontSize = 13.sp),
    labelSmall = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.5.sp)
)

@Composable
fun PrismTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Prism.Accent,
            onPrimary = Color.White,
            background = Prism.Background,
            onBackground = Prism.TextPrimary,
            surface = Prism.Surface,
            onSurface = Prism.TextPrimary,
            surfaceVariant = Prism.SurfaceHigh,
            onSurfaceVariant = Prism.TextSecondary,
            outline = Prism.Outline,
            error = Prism.Danger
        ),
        typography = PrismTypography,
        content = content
    )
}
