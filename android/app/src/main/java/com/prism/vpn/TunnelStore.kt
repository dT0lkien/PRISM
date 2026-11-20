package com.prism.vpn

import android.content.Context
import android.util.AtomicFile
import io.nekohasekai.libbox.Libbox
import io.nekohasekai.libbox.SetupOptions
import java.io.File
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject

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

    private var coreReady = false

    @Synchronized
    fun setupCore(context: Context) {
        if (coreReady) return
        Libbox.setup(SetupOptions().apply {
            basePath = context.filesDir.absolutePath
            workingPath = context.filesDir.resolve("core").absolutePath
            tempPath = context.cacheDir.absolutePath
        })
        coreReady = true
    }

    fun profileKey(context: Context): String {
        val prefs = context.getSharedPreferences("prism", Context.MODE_PRIVATE).all
        val snapshot = JSONArray().put(BuildConfig.VERSION_CODE)
        for (key in listOf("nodes", "activeNodeId", "settings", "presets", "routingJson")) {
            snapshot.put(prefs[key] ?: JSONObject.NULL)
        }
        return MessageDigest.getInstance("SHA-256").digest(snapshot.toString().toByteArray())
            .joinToString("") { "%02x".format(it) }
    }

    @Synchronized
    fun writeConfig(context: Context, json: String, profileKey: String) {
        val saved = JSONObject().put("profileKey", profileKey).put("config", json).toString()
        val atomic = AtomicFile(file(context))
        val stream = atomic.startWrite()
        try {
            stream.write(saved.toByteArray(Charsets.UTF_8))
            atomic.finishWrite(stream)
        } catch (error: Throwable) {
            atomic.failWrite(stream)
            throw error
        }
    }

    /** null означает, что конфиг ещё не собирали — туннелю нечего поднимать */
    @Synchronized
    fun readConfig(context: Context, requireCurrentProfile: Boolean = false): String? {
        val saved = try {
            AtomicFile(file(context)).readFully().toString(Charsets.UTF_8)
        } catch (_: java.io.IOException) {
            return null
        }
        val document = runCatching { JSONObject(saved) }.getOrNull() ?: return null
        if (!document.has("profileKey")) return saved.takeUnless { requireCurrentProfile }
        if (requireCurrentProfile && document.optString("profileKey") != profileKey(context)) return null
        return document.optString("config").takeIf { it.isNotBlank() }
    }

    /**
     * Распаковывает правила маршрутизации из ресурсов приложения и возвращает
     * путь к ним.
     *
     * Ядро умеет и скачивать правила само, но делает это при старте, все сразу
     * и обязательно: без сети туннель тогда не поднимется вовсе. Файлы весят
     * 350 КБ вместе, так что проще положить их в APK.
     */
    @Synchronized
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
