package com.prism.vpn

import android.content.Context
import java.io.File

/**
 * Конфиг, который приложение передаёт туннелю.
 *
 * На iOS для этого нужна группа приложений: расширение живёт отдельным процессом
 * и до песочницы приложения не дотягивается. На Android служба работает в том же
 * процессе, поэтому достаточно обычного файла во внутреннем хранилище.
 */
object TunnelStore {
    private const val NAME = "config.json"

    private fun file(context: Context) = File(context.filesDir, NAME)

    fun writeConfig(context: Context, json: String) {
        file(context).writeText(json)
    }

    /** null означает, что конфиг ещё не собирали — туннелю нечего поднимать */
    fun readConfig(context: Context): String? {
        val file = file(context)
        return if (file.exists()) file.readText().takeIf { it.isNotBlank() } else null
    }

    /**
     * Распаковывает правила маршрутизации из ресурсов приложения и возвращает
     * путь к ним.
     *
     * Ядро умеет и скачивать правила само, но делает это при старте, все сразу
     * и обязательно: без сети туннель тогда не поднимется вовсе. Файлы весят
     * 350 КБ вместе, так что проще положить их в APK.
     */
    fun rulesDir(context: Context): String {
        val dir = File(context.filesDir, "rules")
        dir.mkdirs()
        val names = context.assets.list("rules").orEmpty()
        for (name in names) {
            val target = File(dir, name)
            if (target.exists()) continue
            context.assets.open("rules/$name").use { source ->
                target.outputStream().use { source.copyTo(it) }
            }
        }
        return dir.absolutePath
    }
}
