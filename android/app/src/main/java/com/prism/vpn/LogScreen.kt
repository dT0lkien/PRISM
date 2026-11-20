package com.prism.vpn

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBackIosNew
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/**
 * Журнал туннеля.
 *
 * Отвечает на единственный вопрос: почему выключилось. Туннель работает в
 * фоне и падает тогда, когда в приложение никто не смотрит, — значит причину
 * нужно уметь прочитать потом.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LogScreen(model: AppViewModel, onBack: () -> Unit) {
    val skin = Palette
    var lines by remember { mutableStateOf(model.logLines()) }

    // Журнал пополняется, пока экран открыт: туннель может упасть прямо сейчас
    LaunchedEffect(Unit) {
        while (true) {
            lines = model.logLines()
            delay(1000)
        }
    }

    Scaffold(
        containerColor = skin.background,
        topBar = {
            TopAppBar(
                title = { Text("Журнал", style = Fonts.headline, color = skin.text) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.Default.ArrowBackIosNew,
                            "Назад",
                            tint = skin.accent,
                            modifier = Modifier.size(20.dp)
                        )
                    }
                },
                actions = {
                    TextButton(onClick = {
                        model.clearLog()
                        lines = emptyList()
                    }) {
                        Text("Очистить", style = Fonts.body, color = skin.accent)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = skin.background,
                    titleContentColor = skin.text
                )
            )
        }
    ) { padding ->
        if (lines.isEmpty()) {
            Box(Modifier.padding(padding).fillMaxSize(), contentAlignment = androidx.compose.ui.Alignment.Center) {
                Text(
                    "Пока пусто. Записи появятся после первого подключения.",
                    style = Fonts.footnote,
                    color = skin.muted,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 32.dp)
                )
            }
            return@Scaffold
        }

        SelectionContainer {
            LazyColumn(
                Modifier.padding(padding).fillMaxSize().padding(horizontal = 16.dp),
                contentPadding = PaddingValues(vertical = 12.dp)
            ) {
                items(lines) { line ->
                    Text(
                        line,
                        fontSize = 12.sp,
                        lineHeight = 17.sp,
                        fontFamily = FontFamily.Monospace,
                        color = skin.text,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(bottom = 4.dp)
                            .background(skin.surface, RoundedCornerShape(skin.corner))
                            .padding(horizontal = 10.dp, vertical = 7.dp)
                    )
                }
            }
        }
    }
}
