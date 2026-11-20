package com.prism.vpn

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Заголовок над группой */
@Composable
fun SectionHeader(text: String) {
    val skin = Palette
    Text(
        text = text.uppercase(),
        style = Fonts.footnote,
        color = skin.muted,
        modifier = Modifier.padding(start = 32.dp, end = 32.dp, top = 24.dp, bottom = 7.dp)
    )
}

/** Пояснение под группой — там, где нужно объяснить последствия выбора */
@Composable
fun SectionFooter(text: String) {
    Text(
        text = text,
        style = Fonts.footnote,
        color = Palette.muted,
        modifier = Modifier.padding(start = 32.dp, end = 32.dp, top = 7.dp)
    )
}

/**
 * Группа строк. Разделители рисует сама: перечислять их в каждом экране —
 * верный способ рано или поздно забыть один.
 */
@Composable
fun InsetGroup(content: @Composable ColumnScope.() -> Unit) {
    val skin = Palette
    val shape = RoundedCornerShape(skin.corner)
    Column(
        Modifier.padding(horizontal = 16.dp).fillMaxWidth()
            .background(skin.surface, shape).border(1.dp, skin.line.copy(alpha = .48f), shape),
        content = content
    )
}

/** Разделитель с отступом слева до начала текста */
@Composable
fun RowSeparator(inset: Dp = 16.dp) {
    val skin = Palette
    Box(
        Modifier
            .padding(start = inset)
            .fillMaxWidth()
            .height(0.5.dp)
            .background(skin.line)
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
    val skin = Palette
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 44.dp)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(title, style = Fonts.body, color = skin.text)
            if (subtitle != null) {
                Text(subtitle, style = Fonts.footnote, color = skin.muted)
            }
        }
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = Color.White,
                checkedTrackColor = skin.ok,
                checkedBorderColor = Color.Transparent,
                uncheckedThumbColor = Color.White,
                uncheckedTrackColor = skin.dim.copy(alpha = 0.5f),
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
    icon: ImageVector? = null,
    tint: Color = Color.Unspecified,
    onClick: () -> Unit
) {
    val skin = Palette
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 44.dp)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (icon != null) {
            val badgeColor = if (tint == Color.Unspecified) skin.accent else tint
            val badgeShape = RoundedCornerShape(9.dp)
            Box(
                Modifier.size(32.dp).background(badgeColor.copy(alpha = .15f), badgeShape)
                    .border(1.dp, badgeColor.copy(alpha = .24f), badgeShape),
                contentAlignment = Alignment.Center
            ) {
                Icon(icon, null, Modifier.size(17.dp), tint = badgeColor)
            }
            Spacer(Modifier.width(11.dp))
        }
        Text(title, style = Fonts.body, color = skin.text, modifier = Modifier.weight(1f))
        if (value != null) {
            Text(
                value,
                modifier = Modifier.widthIn(max = 146.dp),
                style = Fonts.body,
                color = skin.muted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Spacer(Modifier.width(6.dp))
        }
        Icon(
            Icons.Default.ChevronRight,
            contentDescription = null,
            tint = skin.dim,
            modifier = Modifier.size(20.dp)
        )
    }
}

/** Строка выбора: помечается галочкой */
@Composable
fun CheckRow(title: String, subtitle: String? = null, selected: Boolean, onClick: () -> Unit) {
    val skin = Palette
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 44.dp)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(title, style = Fonts.body, color = skin.text)
            if (subtitle != null) {
                Text(
                    subtitle,
                    style = Fonts.footnote,
                    color = skin.muted
                )
            }
        }
        if (selected) {
            Icon(Icons.Default.Check, null, tint = skin.accent, modifier = Modifier.size(20.dp))
        }
    }
}

/** Строка «ключ — значение» без действия */
@Composable
fun ValueRow(title: String, value: String) {
    val skin = Palette
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 44.dp)
            .padding(horizontal = 16.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(title, style = Fonts.body, color = skin.text, modifier = Modifier.weight(1f))
        Text(value, style = Fonts.body, color = skin.muted)
    }
}
