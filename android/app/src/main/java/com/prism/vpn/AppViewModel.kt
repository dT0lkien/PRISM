package com.prism.vpn

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import java.net.HttpURLConnection
import java.net.URL
import android.content.Intent
import io.nekohasekai.libbox.Libbox
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject

/** Состояние туннеля для интерфейса */
enum class TunnelState { Off, Connecting, On, Recovering, Blocked, Disconnecting, Failed }

/**
 * Состояние приложения: список узлов, выбранный узел, доступ к общему ядру.
 *
 * Вся содержательная работа — разбор ссылок и сборка конфига — уходит в PrismCore,
 * то есть в тот же TypeScript, на котором работают Windows-версия и iOS.
 */
class AppViewModel(app: Application) : AndroidViewModel(app) {

    companion object {
        /** Выбран не узел, а группа автовыбора: ядро само держится живого сервера */
        const val AUTO = "auto"
    }


    var nodes by mutableStateOf<List<ServerNode>>(emptyList())
        private set
    var activeNodeId by mutableStateOf<String?>(null)
        private set
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

    /**
     * Настройки хранятся тем же JSON, что понимает общее ядро, а не отдельным
     * набором полей. Так добавление новой настройки в src/shared не требует
     * править ни хранилище, ни мост — только экран.
     */
    var settings by mutableStateOf<JSONObject?>(null)
        private set
    var enabledPresets by mutableStateOf<List<String>>(emptyList())
        private set

    var routingJson by mutableStateOf(prefs.getString("routingJson", "").orEmpty())
        private set

    init {
        TunnelLog.attach(app)
        load()
        viewModelScope.launch {
            try {
                val core = PrismCore.create(getApplication())
                loadSettings(core)
                refreshFromLinks(core)
                this@AppViewModel.core = core
            } catch (e: Throwable) {
                coreFailure = e.message ?: "Общее ядро не загрузилось"
            }
        }
    }

    /**
     * Пересобирает сохранённые узлы из их же ссылок.
     *
     * Узел хранится разобранным, и при исправлении парсера старая запись сама
     * не обновится — приложение обновится, а ошибка останется лежать в
     * хранилище. Исходная ссылка при этом сохраняется рядом, так что честнее
     * считать источником правды её. Имя и признак выбранного оставляем: их
     * пользователь мог поменять сам.
     */
    private suspend fun refreshFromLinks(core: PrismCore) {
        if (nodes.isEmpty()) return
        val rebuilt: List<ServerNode> = nodes.map { node ->
            val link = node.json.optString("link").takeIf { it.isNotBlank() } ?: return@map node
            val fresh = runCatching { core.nodesFromLinks(link).firstOrNull() }.getOrNull() ?: return@map node
            // Идентификатор и имя оставляем прежние: на первый ссылается выбранный
            // узел, второе пользователь мог поменять сам
            ServerNode(fresh.json.put("id", node.id).put("name", node.name))
        }
        if (rebuilt.map { it.json.toString() } != nodes.map { it.json.toString() }) {
            nodes = rebuilt
            save()
        }
    }

    // MARK: - Настройки

    private suspend fun loadSettings(core: PrismCore) {
        val stored = prefs.getString("settings", null)
        val loaded = stored?.let { runCatching { JSONObject(it) }.getOrNull() } ?: core.defaultSettings()
        val previousMode = loaded.optString("routingMode")
        val mode = if (!prefs.getBoolean("routingModesMigrated", false) && routingJson.isNotBlank()) {
            "config"
        } else if (previousMode in setOf("smart", "config", "global")) {
            previousMode
        } else {
            "smart"
        }
        loaded.put("routingMode", mode)
        if (!prefs.getBoolean("routingModesMigrated", false) || previousMode != mode) {
            prefs.edit().putString("settings", loaded.toString()).putBoolean("routingModesMigrated", true).apply()
        }
        settings = loaded
        val presets = prefs.getString("presets", null)
        enabledPresets = presets
            ?.let { runCatching { JSONArray(it) }.getOrNull() }
            ?.let { array -> (0 until array.length()).map { array.optString(it) } }
            ?: core.defaultEnabledPresets()
    }

    /**
     * Правит настройку по пути вида "dns.blockAds". Путь, а не отдельный метод
     * на каждое поле: настроек в ядре несколько десятков, и заводить под каждую
     * свой сеттер значит переписывать модель при любом их пополнении.
     */
    fun setSetting(path: String, value: Any) {
        val root = settings ?: return
        val copy = JSONObject(root.toString())
        val parts = path.split('.')
        var node = copy
        for (part in parts.dropLast(1)) {
            node = node.optJSONObject(part) ?: return
        }
        node.put(parts.last(), value)
        settings = copy
        prefs.edit().putString("settings", copy.toString()).apply()
        noteRestartNeeded()
    }

    fun booleanSetting(path: String, fallback: Boolean = false): Boolean {
        var node = settings ?: return fallback
        val parts = path.split('.')
        for (part in parts.dropLast(1)) node = node.optJSONObject(part) ?: return fallback
        return node.optBoolean(parts.last(), fallback)
    }

    fun stringSetting(path: String, fallback: String = ""): String {
        var node = settings ?: return fallback
        val parts = path.split('.')
        for (part in parts.dropLast(1)) node = node.optJSONObject(part) ?: return fallback
        return node.optString(parts.last(), fallback)
    }

    fun togglePreset(id: String) {
        enabledPresets = if (id in enabledPresets) enabledPresets - id else enabledPresets + id
        prefs.edit().putString("presets", JSONArray(enabledPresets).toString()).apply()
        noteRestartNeeded()
    }

    /** Ядро читает конфиг при запуске, поэтому правки применятся не сразу */
    private fun noteRestartNeeded() {
        if (tunnelState == TunnelState.On) {
            status = "Настройки применятся после переподключения"
        }
    }

    // MARK: - Добавление узлов

    fun addFromLinks(text: String) = viewModelScope.launch {
        if (isBusy) return@launch
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
        if (isBusy) return@launch
        val core = core ?: return@launch
        val trimmed = raw.trim()
        if (!trimmed.startsWith("https://", ignoreCase = true)) {
            // Android с targetSdk 28 и выше запрещает незашифрованные соединения.
            // Сказать об этом заранее понятнее, чем показать сетевую ошибку.
            status = "Для подписки нужен адрес HTTPS."
            return@launch
        }

        isBusy = true
        status = null
        try {
            val body = withContext(Dispatchers.IO) { fetch(trimmed) }
            val parsed = core.nodesFromSubscription(body, trimmed)
            if (parsed.isEmpty()) {
                status = "В подписке не нашлось поддерживаемых серверов."
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
            return connection.inputStream.bufferedReader().use { reader ->
                val body = StringBuilder()
                val buffer = CharArray(8192)
                while (true) {
                    val count = reader.read(buffer)
                    if (count < 0) break
                    check(body.length + count <= 512 * 1024) { "Слишком большой ответ подписки" }
                    body.append(buffer, 0, count)
                }
                body.toString()
            }
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

    fun selectServer(id: String) {
        activeNodeId = id
        prefs.edit().putString("activeNodeId", id).apply()
        noteRestartNeeded()
    }

    fun remove(node: ServerNode) {
        nodes = nodes.filterNot { it.id == node.id }
        serverPings = serverPings - node.id
        if (nodes.isEmpty() || activeNodeId == node.id) activeNodeId = nodes.firstOrNull()?.id
        save()
    }

    internal var pingMethod by mutableStateOf(
        if (prefs.getString("pingMethod", null) == PingMethod.URL.name) PingMethod.URL else PingMethod.TCP
    )
        private set
    internal var serverPings by mutableStateOf<Map<String, PingResult>>(emptyMap())
        private set
    private val pingDispatcher = Dispatchers.IO.limitedParallelism(3)
    private var pingJob: Job? = null

    internal fun setPingMethod(method: PingMethod) {
        if (method == pingMethod) return
        pingJob?.cancel()
        pingMethod = method
        serverPings = emptyMap()
        prefs.edit().putString("pingMethod", method.name).apply()
    }

    fun pingServers() {
        val targets = nodes
        if (targets.isEmpty() || pingJob?.isActive == true) return
        val method = pingMethod
        val context = getApplication<Application>()
        serverPings = targets.associate { it.id to PingResult.Pending }
        pingJob = viewModelScope.launch {
            for (node in targets) {
                launch {
                    val result = withContext(pingDispatcher) { measureServer(context, node, method) }
                    if (isActive && nodes.any { it.id == node.id }) {
                        serverPings = serverPings + (node.id to result)
                    }
                }
            }
        }
    }

    // MARK: - Туннель

    var tunnelState by mutableStateOf(TunnelState.Off)
        private set

    /**
     * Готовит конфиг и запускает службу.
     *
     * Разрешение на туннель спрашивает система, и делает это только у Activity,
     * поэтому запрос приходит снаружи: экран показывает системный диалог и
     * вызывает этот метод, когда пользователь согласился.
     */
    fun connect() = viewModelScope.launch {
        if (TunnelService.phase != TunnelPhase.Off ||
            tunnelState !in listOf(TunnelState.Off, TunnelState.Failed)
        ) return@launch
        if (nodes.isEmpty()) {
            status = "Сначала добавьте сервер"
            return@launch
        }
        tunnelState = TunnelState.Connecting
        status = null
        try {
            val context = getApplication<Application>()
            val profileKey = TunnelStore.profileKey(context)
            val patch = routingJson
            val mode = stringSetting("routingMode", "smart")
            val config = configJson(patch, mode)
            withContext(Dispatchers.IO) {
                if (mode == "config" && patch.isNotBlank()) {
                    TunnelStore.setupCore(context)
                    Libbox.checkConfig(config)
                }
                TunnelStore.writeConfig(context, config, profileKey)
            }
        } catch (e: Throwable) {
            tunnelState = TunnelState.Failed
            status = e.message ?: "Не удалось собрать конфиг"
            return@launch
        }

        TunnelLog.add("подключение по кнопке")
        val context = getApplication<Application>()
        try {
            context.startForegroundService(
                Intent(context, TunnelService::class.java).setAction(TunnelService.ACTION_START)
            )
        } catch (e: IllegalStateException) {
            tunnelState = TunnelState.Failed
            status = "Откройте Prism и повторите подключение"
            return@launch
        } catch (e: SecurityException) {
            tunnelState = TunnelState.Failed
            status = "Android не разрешил запустить VPN"
            return@launch
        }

        // Служба поднимается не мгновенно: ядру нужно прочитать конфиг и открыть
        // туннель. Ждём результата, а не показываем «подключено» авансом.
        repeat(40) {
            delay(250)
            if (TunnelService.isRunning) {
                tunnelState = TunnelState.On
                return@launch
            }
            TunnelService.lastError?.let {
                tunnelState = TunnelState.Failed
                status = it
                return@launch
            }
        }
        tunnelState = TunnelState.Failed
        status = "Туннель не поднялся за 10 секунд"
    }

    fun disconnect() = viewModelScope.launch {
        // Состояние меняем сразу, до всякого ожидания: иначе экран ещё секунды
        // показывает «Подключено», и нажатие выглядит непринятым
        tunnelState = TunnelState.Disconnecting
        TunnelLog.add("отключение по кнопке")

        val context = getApplication<Application>()
        context.startService(
            Intent(context, TunnelService::class.java).setAction(TunnelService.ACTION_STOP)
        )

        // Цикл именно с выходом наружу: return@repeat переходит к следующей
        // итерации, а не прерывает — из-за этого выключение всегда ждало полные
        // три секунды, даже когда туннель останавливался мгновенно
        for (attempt in 1..40) {
            if (!TunnelService.isRunning) break
            delay(50)
        }
        tunnelState = TunnelState.Off
    }

    /**
     * Сверяет экран со службой.
     *
     * Служба живёт дольше экрана и меняет состояние сама: связь может пропасть,
     * вернуться, а туннель — остановиться совсем. Раньше сверка была разовой,
     * при открытии окна, и кнопка часами показывала «Подключено» у давно
     * упавшего туннеля.
     */
    fun syncTunnelState() {
        // Пока идёт нажатое пользователем действие, его циклы ведут состояние
        // сами — вмешиваться значит показать промежуточную ложь
        if (tunnelState == TunnelState.Connecting || tunnelState == TunnelState.Disconnecting) return

        when (TunnelService.phase) {
            TunnelPhase.On -> {
                tunnelState = TunnelState.On
            }
            TunnelPhase.Recovering -> tunnelState = TunnelState.Recovering
            TunnelPhase.Blocked -> tunnelState = TunnelState.Blocked
            TunnelPhase.Connecting -> Unit
            TunnelPhase.Off -> {
                val wasOn = tunnelState == TunnelState.On ||
                    tunnelState == TunnelState.Recovering ||
                    tunnelState == TunnelState.Blocked
                if (wasOn) {
                            // Туннель упал не по нажатию — причина известна службе,
                    // и без неё выключение выглядит беспричинным
                    val reason = TunnelService.lastError
                    tunnelState = if (reason != null) TunnelState.Failed else TunnelState.Off
                    status = reason
                }
            }
        }
    }

    private var watching = false

    /** Следит за службой всё время, пока приложение живо */
    fun watchTunnel() {
        // Окно пересоздаётся при повороте и смене темы, а модель переживает
        // это — второй наблюдатель был бы лишним
        if (watching) return
        watching = true
        viewModelScope.launch {
            TunnelService.phases.collect { syncTunnelState() }
        }
    }

    /** Записи журнала туннеля, свежие сверху */
    fun logLines(): List<String> = TunnelLog.lines()

    fun clearLog() = TunnelLog.clear()

    // MARK: - Конфиг

    suspend fun validateRouting(text: String): String {
        val patch = withContext(Dispatchers.Default) { RoutingJson.format(text) }
        val config = configJson(patch, mode = "config")
        val context = getApplication<Application>()
        withContext(Dispatchers.IO) {
            TunnelStore.setupCore(context)
            Libbox.checkConfig(config)
        }
        return patch
    }

    suspend fun saveRouting(text: String): String {
        val patch = validateRouting(text)
        routingJson = patch.takeUnless { JSONObject(it).getJSONObject("route").length() == 0 }.orEmpty()
        val edit = prefs.edit().putString("routingJson", routingJson)
        if (routingJson.isNotBlank()) {
            val updated = JSONObject(checkNotNull(settings).toString()).put("routingMode", "config")
            settings = updated
            edit.putString("settings", updated.toString())
        }
        edit.apply()
        noteRestartNeeded()
        return patch
    }

    suspend fun routingPreview(text: String): String {
        val config = configJson(text, mode = "config")
        return JSONObject().put("route", JSONObject(config).getJSONObject("route")).toString(2)
    }

    private suspend fun configJson(
        patch: String = routingJson,
        mode: String = stringSetting("routingMode", "smart")
    ): String {
        val core = core ?: throw IllegalStateException("Общее ядро не загружено")
        val context = getApplication<Application>()
        val selected = activeNodeId
        val savedNodes = nodes
        val savedSettings = JSONObject((settings ?: core.defaultSettings()).toString())
        val smart = mode == "smart"
        val presets = if (smart) enabledPresets else emptyList()
        savedSettings.put("routingMode", if (smart) "smart" else "global")
        if (!smart) savedSettings.put("bypassPrivate", false)
        if (mode == "config") savedSettings.put("blockQuic", false)
        val cache = context.filesDir.resolve("cache.db").absolutePath
        // Правила распаковываются из ресурсов: ядру нужны файлы на диске
        val rules = withContext(Dispatchers.IO) { TunnelStore.rulesDir(context) }
        val generated = core.configJson(
            nodes = savedNodes,
            activeNodeId = selected,
            cachePath = cache,
            rulesDir = rules,
            settings = savedSettings,
            enabledPresets = presets
        )
        return if (mode == "config") {
            withContext(Dispatchers.Default) { RoutingJson.apply(generated, patch) }
        } else generated
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
        val storedId = prefs.getString("activeNodeId", null)
        activeNodeId = if (nodes.isNotEmpty() && (storedId == AUTO || nodes.any { it.id == storedId })) {
            storedId
        } else nodes.firstOrNull()?.id
        if (storedId != activeNodeId) prefs.edit().putString("activeNodeId", activeNodeId).apply()
    }
}
