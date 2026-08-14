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
 * Оформление Prism в системе координат Apple.
 *
 * Взяты именно те решения, которые делают интерфейсы Apple узнаваемыми:
 * чёрный фон и группы-карточки поверх него, разделители с отступом слева до
 * начала текста, шкала шрифтов с фиксированными ступенями и один акцентный
 * цвет на всё приложение. Ничего лишнего: цветом выделяется только то, что
 * несёт смысл, — состояние подключения и активные переключатели.
 *
 * От себя оставлен спектр из логотипа: он появляется единственный раз, в кольце
 * вокруг кнопки подключения, и служит подписью приложения.
 */
object Palette {
    /** Фон под группами — у Apple в тёмной теме он именно чёрный */
    val Background = Color(0xFF000000)
    /** Карточка группы */
    val Grouped = Color(0xFF1C1C1E)
    /** Нажатая строка */
    val GroupedPressed = Color(0xFF2C2C2E)
    /** Разделитель внутри группы */
    val Separator = Color(0xFF38383A)

    val Label = Color(0xFFFFFFFF)
    val LabelSecondary = Color(0xFFEBEBF5).copy(alpha = 0.6f)
    val LabelTertiary = Color(0xFFEBEBF5).copy(alpha = 0.3f)

    val Blue = Color(0xFF0A84FF)
    val Green = Color(0xFF30D158)
    val Red = Color(0xFFFF453A)
    val Orange = Color(0xFFFF9F0A)
    val Fill = Color(0xFF787880).copy(alpha = 0.36f)

    /** Спектр из логотипа: только кольцо подключения */
    val Spectrum = listOf(
        Color(0xFFFF453A),
        Color(0xFFFF9F0A),
        Color(0xFFFFD60A),
        Color(0xFF30D158),
        Color(0xFF40C8E0),
        Color(0xFF0A84FF),
        Color(0xFFBF5AF2)
    )

    /** Цвет метки по протоколу */
    fun protocol(type: String): Color = when (type) {
        "vless" -> Color(0xFFBF5AF2)
        "vmess" -> Blue
        "trojan" -> Red
        "shadowsocks" -> Green
        "hysteria2", "hysteria" -> Orange
        "tuic" -> Color(0xFF40C8E0)
        "wireguard" -> Color(0xFFFF6482)
        else -> LabelSecondary
    }
}

/** Шкала шрифтов iOS: ступени фиксированы, промежуточных значений не бывает */
object AppleType {
    val LargeTitle = TextStyle(fontSize = 34.sp, lineHeight = 41.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.37.sp)
    val Title2 = TextStyle(fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.Bold)
    val Title3 = TextStyle(fontSize = 20.sp, lineHeight = 25.sp, fontWeight = FontWeight.SemiBold)
    val Headline = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold)
    val Body = TextStyle(fontSize = 17.sp, lineHeight = 22.sp)
    val Callout = TextStyle(fontSize = 16.sp, lineHeight = 21.sp)
    val Subheadline = TextStyle(fontSize = 15.sp, lineHeight = 20.sp)
    val Footnote = TextStyle(fontSize = 13.sp, lineHeight = 18.sp)
    val Caption = TextStyle(fontSize = 12.sp, lineHeight = 16.sp)
}

private val PrismTypography = Typography(
    displayLarge = AppleType.LargeTitle,
    titleLarge = AppleType.Title2,
    titleMedium = AppleType.Headline,
    bodyLarge = AppleType.Body,
    bodyMedium = AppleType.Callout,
    bodySmall = AppleType.Footnote,
    labelSmall = AppleType.Caption
)

@Composable
fun PrismTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Palette.Blue,
            onPrimary = Color.White,
            background = Palette.Background,
            onBackground = Palette.Label,
            surface = Palette.Grouped,
            onSurface = Palette.Label,
            surfaceVariant = Palette.GroupedPressed,
            onSurfaceVariant = Palette.LabelSecondary,
            outline = Palette.Separator,
            error = Palette.Red
        ),
        typography = PrismTypography,
        content = content
    )
}
