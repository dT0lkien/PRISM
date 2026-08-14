package com.prism.vpn

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject

/**
 * Состояние приложения: список узлов, выбранный узел, доступ к общему ядру.
 *
 * Вся содержательная работа — разбор ссылок и сборка конфига — уходит в PrismCore,
 * то есть в тот же TypeScript, на котором работают Windows-версия и iOS.
 */
class AppViewModel(app: Application) : AndroidViewModel(app) {

    var nodes by mutableStateOf<List<ServerNode>>(emptyList())
        private set
    var activeNodeId by mutableStateOf<String?>(null)
    /** Сообщение пользователю: и об ошибке, и об удачном итоге */
    var status by mutableStateOf<String?>(null)
    var isBusy by mutableStateOf(false)
        private set
    /** null означает, что ядро не поднялось: тогда делать нечего */
    var core by mutableStateOf<PrismCore?>(null)
        private set
    var coreFailure by mutableStateOf<String?>(null)
        private set

    private val prefs = app.getSharedPreferences("prism", Context.MODE_PRIVATE)

    init {
        load()
        viewModelScope.launch {
            try {
                core = PrismCore.create(getApplication())
            } catch (e: Throwable) {
                coreFailure = e.message ?: "Общее ядро не загрузилось"
            }
        }
    }

    // MARK: - Добавление узлов

    fun addFromLinks(text: String) = viewModelScope.launch {
        val core = core ?: return@launch
        isBusy = true
        try {
            val parsed = core.nodesFromLinks(text)
            if (parsed.isEmpty()) {
                status = "Не нашёл ни одной подходящей ссылки"
                return@launch
            }
            merge(parsed, core)
        } catch (e: Throwable) {
            status = e.message
        } finally {
            isBusy = false
        }
    }

    /**
     * Скачивает подписку. User-Agent имитирует sing-box: многие провайдеры
     * отдают по нему готовый конфиг вместо страницы для браузера.
     */
    fun addFromSubscription(raw: String) = viewModelScope.launch {
        val core = core ?: return@launch
        val trimmed = raw.trim()
        if (trimmed.startsWith("http://")) {
            // Android с targetSdk 28 и выше запрещает незашифрованные соединения.
            // Сказать об этом заранее понятнее, чем показать сетевую ошибку.
            status = "Android блокирует незашифрованный http. Нужен адрес по https."
            return@launch
        }

        isBusy = true
        status = null
        try {
            val body = withContext(Dispatchers.IO) { fetch(trimmed) }
            val parsed = core.nodesFromSubscription(body, trimmed)
            if (parsed.isEmpty()) {
                status = "В подписке не нашлось серверов. Формат Clash YAML пока не поддерживается."
                return@launch
            }
            merge(parsed, core)
        } catch (e: Throwable) {
            status = e.message ?: "Не удалось загрузить подписку"
        } finally {
            isBusy = false
        }
    }

    private fun fetch(url: String): String {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            setRequestProperty("User-Agent", "sing-box/1.13.15 (Prism)")
            connectTimeout = 30_000
            readTimeout = 30_000
        }
        try {
            val code = connection.responseCode
            if (code !in 200..299) throw IllegalStateException("Сервер ответил $code")
            return connection.inputStream.bufferedReader().use { it.readText() }
        } finally {
            connection.disconnect()
        }
    }

    /**
     * Добавляет только новые узлы. Сравнение идёт по ключу, а не по имени:
     * при обновлении подписки сервер часто приезжает переименованным, и
     * сравнение по имени плодило бы дубликаты.
     */
    private suspend fun merge(parsed: List<ServerNode>, core: PrismCore) {
        val known = nodes.map { core.nodeKey(it) }.toMutableSet()
        val added = parsed.filter { known.add(core.nodeKey(it)) }
        nodes = nodes + added
        if (activeNodeId == null) activeNodeId = nodes.firstOrNull()?.id
        save()
        status = when {
            added.isEmpty() -> "Все ${parsed.size} серверов уже добавлены"
            added.size < parsed.size -> "Добавлено: ${added.size}. Уже были: ${parsed.size - added.size}"
            else -> "Добавлено серверов: ${added.size}"
        }
    }

    fun remove(node: ServerNode) {
        nodes = nodes.filterNot { it.id == node.id }
        if (activeNodeId == node.id) activeNodeId = nodes.firstOrNull()?.id
        save()
    }

    /** Пример для быстрой проверки: адреса заведомо нерабочие */
    fun addSamples() = addFromLinks(
        """
        vless://11111111-2222-3333-4444-555555555555@example.com:443?encryption=none&security=reality&sni=www.microsoft.com&fp=chrome&pbk=VXFVG7CC-NQrdWhsTwvc830w5RpYGbFXb_4tgNTB2Dg&sid=a1b2&type=tcp&flow=xtls-rprx-vision#Reality TCP
        trojan://hunter2@example.com:443?security=tls&sni=example.com&type=grpc&serviceName=grpcsvc#Trojan gRPC
        ss://YWVzLTI1Ni1nY206aHVudGVyMg==@example.com:8388#Shadowsocks
        hysteria2://hunter2@example.com:443?sni=example.com#Hysteria2
        tuic://11111111-2222-3333-4444-555555555555:hunter2@example.com:443?sni=example.com&congestion_control=bbr#TUIC
        """.trimIndent()
    )

    // MARK: - Конфиг

    suspend fun configJson(): String {
        val core = core ?: throw IllegalStateException("Общее ядро не загружено")
        val cache = getApplication<Application>().filesDir.resolve("cache.db").absolutePath
        return core.configJson(nodes, activeNodeId, cache)
    }

    // MARK: - Хранение

    private fun save() {
        val array = JSONArray().apply { nodes.forEach { put(it.json) } }
        prefs.edit()
            .putString("nodes", array.toString())
            .putString("activeNodeId", activeNodeId)
            .apply()
    }

    private fun load() {
        val stored = prefs.getString("nodes", null) ?: return
        val array = runCatching { JSONArray(stored) }.getOrNull() ?: return
        nodes = (0 until array.length()).mapNotNull { index ->
            array.optJSONObject(index)?.let(::ServerNode)
        }
        activeNodeId = prefs.getString("activeNodeId", null) ?: nodes.firstOrNull()?.id
    }
}
