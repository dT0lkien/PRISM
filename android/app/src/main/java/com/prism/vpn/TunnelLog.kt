package com.prism.vpn

import android.content.Context
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Журнал туннеля.
 *
 * Заведён ровно затем, чтобы на вопрос «почему выключилось» был ответ. Служба
 * работает в фоне часами, и когда туннель падает, узнать причину постфактум
 * больше неоткуда: системный журнал с телефона без провода не достать, а окно
 * приложения в этот момент закрыто.
 *
 * Пишется и в память, и в файл: процесс могут убить, а причина нужна как раз
 * после этого. Файл переписывается целиком — так он не растёт без предела.
 */
object TunnelLog {
    private const val LIMIT = 400
    private const val NAME = "tunnel.log"
    private val stamp = SimpleDateFormat("dd.MM HH:mm:ss", Locale.getDefault())

    private val entries = ArrayDeque<String>()
    private var file: File? = null

    @Synchronized
    fun attach(context: Context) {
        if (file != null) return
        val target = File(context.filesDir, NAME)
        file = target
        if (entries.isEmpty() && target.exists()) {
            runCatching { target.readLines() }.getOrNull()?.takeLast(LIMIT)?.forEach(entries::addLast)
        }
    }

    @Synchronized
    fun add(text: String) {
        entries.addLast("${stamp.format(Date())}  $text")
        while (entries.size > LIMIT) entries.removeFirst()
        android.util.Log.i("prism-tunnel", text)
        file?.let { target -> runCatching { target.writeText(entries.joinToString("\n")) } }
    }

    /** Свежие записи сверху: интересует всегда последнее, а не первое */
    @Synchronized
    fun lines(): List<String> = entries.toList().asReversed()

    @Synchronized
    fun clear() {
        entries.clear()
        file?.let { runCatching { it.delete() } }
    }
}
