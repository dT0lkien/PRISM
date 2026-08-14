package com.prism.vpn

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Строительные блоки в духе Apple.
 *
 * Главный из них — группа-карточка со вставками: скруглённый прямоугольник на
 * чёрном фоне, внутри строки одинаковой высоты, между ними разделители,
 * начинающиеся не от края экрана, а от начала текста. Именно эта деталь и
 * создаёт узнаваемый ритм списков в iOS.
 */

/** Заголовок над группой: мелкий, приглушённый, с отступом как у текста строк */
@Composable
fun SectionHeader(text: String) {
    Text(
        text = text.uppercase(),
        style = AppleType.Footnote,
        color = Palette.LabelSecondary,
        modifier = Modifier.padding(start = 32.dp, end = 32.dp, top = 24.dp, bottom = 7.dp)
    )
}

/** Пояснение под группой — там, где нужно объяснить последствия выбора */
@Composable
fun SectionFooter(text: String) {
    Text(
        text = text,
        style = AppleType.Footnote,
        color = Palette.LabelSecondary,
        modifier = Modifier.padding(start = 32.dp, end = 32.dp, top = 7.dp)
    )
}

/**
 * Группа строк. Разделители рисует сама: перечислять их в каждом экране —
 * верный способ рано или поздно забыть один.
 */
@Composable
fun InsetGroup(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier
            .padding(horizontal = 16.dp)
            .fillMaxWidth()
            .background(Palette.Grouped, RoundedCornerShape(10.dp))
    ) {
        content()
    }
}

/** Разделитель с отступом слева до начала текста, как в iOS */
@Composable
fun RowSeparator(inset: Dp = 16.dp) {
    Box(
        Modifier
            .padding(start = inset)
            .fillMaxWidth()
            .height(0.5.dp)
            .background(Palette.Separator)
    )
}

/** Строка с переключателем */
@Composable
fun SwitchRow(
    title: String,
    subtitle: String? = null,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 44.dp)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(title, style = AppleType.Body, color = Palette.Label)
            if (subtitle != null) {
                Text(subtitle, style = AppleType.Footnote, color = Palette.LabelSecondary)
            }
        }
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = Color.White,
                checkedTrackColor = Palette.Green,
                checkedBorderColor = Color.Transparent,
                uncheckedThumbColor = Color.White,
                uncheckedTrackColor = Palette.Fill,
                uncheckedBorderColor = Color.Transparent
            )
        )
    }
}

/** Строка-переход: значение справа и шеврон */
@Composable
fun NavigationRow(
    title: String,
    value: String? = null,
    onClick: () -> Unit
) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 44.dp)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(title, style = AppleType.Body, color = Palette.Label, modifier = Modifier.weight(1f))
        if (value != null) {
            Text(value, style = AppleType.Body, color = Palette.LabelSecondary)
            Spacer(Modifier.width(6.dp))
        }
        Icon(
            Icons.Default.ChevronRight,
            contentDescription = null,
            tint = Palette.LabelTertiary,
            modifier = Modifier.size(20.dp)
        )
    }
}

/** Строка выбора: помечается галочкой, как в списках Apple */
@Composable
fun CheckRow(title: String, subtitle: String? = null, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 44.dp)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(title, style = AppleType.Body, color = Palette.Label)
            if (subtitle != null) {
                Text(subtitle, style = AppleType.Footnote, color = Palette.LabelSecondary)
            }
        }
        if (selected) {
            Icon(
                Icons.Default.Check,
                contentDescription = null,
                tint = Palette.Blue,
                modifier = Modifier.size(20.dp)
            )
        }
    }
}

/** Строка «ключ — значение» без действия */
@Composable
fun ValueRow(title: String, value: String) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 44.dp)
            .padding(horizontal = 16.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(title, style = AppleType.Body, color = Palette.Label, modifier = Modifier.weight(1f))
        Text(value, style = AppleType.Body, color = Palette.LabelSecondary)
    }
}
