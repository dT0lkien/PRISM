package com.prism.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.PowerManager
import androidx.core.content.ContextCompat
import io.nekohasekai.libbox.CommandServer
import io.nekohasekai.libbox.CommandServerHandler
import io.nekohasekai.libbox.InterfaceUpdateListener
import io.nekohasekai.libbox.Libbox
import io.nekohasekai.libbox.LocalDNSTransport
import io.nekohasekai.libbox.NetworkInterfaceIterator
import io.nekohasekai.libbox.OverrideOptions
import io.nekohasekai.libbox.PlatformInterface
import io.nekohasekai.libbox.StringIterator
import io.nekohasekai.libbox.SystemProxyStatus
import io.nekohasekai.libbox.TunOptions
import io.nekohasekai.libbox.WIFIState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** Что сейчас с туннелем. Служба живёт дольше экрана, поэтому состояние — её. */
enum class TunnelPhase {
    Off,
    Connecting,
    /** Связь есть, трафик идёт */
    On,
    /** Связи нет, но интерфейс поднят и служба пытается вернуть её */
    Recovering,
    /** Связи нет долго; VPN-интерфейс остаётся открытым для восстановления */
    Blocked
}

/**
 * Туннель: поднимает ядро sing-box внутри VpnService.
 *
 * На десктопе Prism запускает sing-box отдельным процессом и общается с ним по
 * Clash API. На Android посторонний бинарник запустить нельзя, поэтому ядро
 * слинковано в приложение и работает как библиотека, а пакеты ему отдаёт система
 * через VpnService.
 *
 * В отличие от iOS никаких особых прав от Apple или Google не требуется:
 * разрешение на туннель выдаёт сам пользователь системным диалогом.
 */
class TunnelService : VpnService(), PlatformInterface, CommandServerHandler {

    companion object {
        const val ACTION_CACHED_START = "com.prism.vpn.CACHED_START"
        const val ACTION_START = "com.prism.vpn.START"
        const val ACTION_STOP = "com.prism.vpn.STOP"

        // Флаги интерфейса из <net/if.h>: ConnectivityManager их не отдаёт,
        // а ядру они нужны, чтобы считать интерфейс живым
        private const val IFF_UP = 0x1
        private const val IFF_BROADCAST = 0x2
        private const val IFF_RUNNING = 0x40
        private const val IFF_MULTICAST = 0x1000

        // Тип интерфейса в терминах libbox
        private const val INTERFACE_WIFI = 0
        private const val INTERFACE_CELLULAR = 1
        private const val INTERFACE_ETHERNET = 2
        private const val INTERFACE_OTHER = 3

        /**
         * Два адреса, а не один: любой из них может лежать сам по себе, и тогда
         * приложение решило бы, что сервер молчит, и заблокировало трафик на
         * ровном месте. Неудачей считается только молчание обоих.
         *
         * Обязательно https. Обычный http Android приложениям запрещает с
         * девятой версии, и проверка проваливалась всегда — при совершенно
         * живом туннеле. Ошибку глотал runCatching, так что снаружи это
         * выглядело как «сервер не отвечает» ровно через две минуты после
         * каждого подключения.
         */
        private val HEALTH_URLS = listOf(
            "https://www.gstatic.com/generate_204",
            "https://cp.cloudflare.com/generate_204"
        )
        private const val PROBE_INTERVAL_MS = 30_000L
        private const val PROBE_TIMEOUT_MS = 8_000

        /** Одна неудача ничего не значит: сеть моргает постоянно */
        private const val FAILURES_BEFORE_RESET = 2
        private const val FAILURES_BEFORE_RELOAD = 4
        /** Дальше — уже не «моргнуло»: около четырёх минут тишины */
        private const val FAILURES_BEFORE_BLOCK = 8

        private const val RELOAD_BACKOFF_START_MS = 30_000L
        private const val RELOAD_BACKOFF_MAX_MS = 300_000L

        private const val CHANNEL = "prism.tunnel"
        private const val NOTIFICATION_ID = 1

        /** Состояние для интерфейса. Служба живёт своей жизнью, экран лишь читает. */
        private val mutablePhase = MutableStateFlow(TunnelPhase.Off)
        val phases = mutablePhase.asStateFlow()
        var phase: TunnelPhase
            get() = mutablePhase.value
            private set(value) { mutablePhase.value = value }

        /**
         * Туннель поднят, пока существует интерфейс, — в том числе когда связь
         * ищется заново. Экран при этом показывает не «подключено», а что
         * именно происходит, но кнопка остаётся кнопкой выключения.
         */
        val isRunning: Boolean get() = phase != TunnelPhase.Off && phase != TunnelPhase.Connecting

        @Volatile
        var lastError: String? = null
            private set
    }

    private var server: CommandServer? = null
    private var tunnel: ParcelFileDescriptor? = null
    private var monitorCallback: ConnectivityManager.NetworkCallback? = null
    private var lastInterface: String? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var healthJob: Job? = null
    /** Телефон спит: ядро приостановлено, проверять связь бессмысленно */
    @Volatile private var dozing = false
    private var idleReceiver: BroadcastReceiver? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                TunnelLog.add("остановка по кнопке")
                lastError = null
                stopTunnel()
                return START_NOT_STICKY
            }
            ACTION_START -> startTunnel()
            ACTION_CACHED_START -> startTunnel(requireCurrentProfile = true)
            else -> {
                // Пустое намерение означает, что службу воскресила система.
                // Для VPN это недопустимо: туннель поднялся бы сам, без ведома
                // пользователя, и весь трафик ушёл бы в него молча.
                TunnelLog.add("служба запущена системой без намерения — останавливаюсь")
                stopTunnel()
                return START_NOT_STICKY
            }
        }
        // Не STICKY намеренно: туннель должен подниматься только по нажатию
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        if (phase != TunnelPhase.Off) TunnelLog.add("службу уничтожает система")
        stopTunnel()
        super.onDestroy()
    }

    /** Система убивает туннель, когда пользователь отзывает разрешение */
    override fun onRevoke() {
        // Разрешение отзывается и тогда, когда туннель забирает себе другое
        // приложение: VPN на Android один на всю систему. Без этой записи всё
        // выглядит так, будто Prism выключился сам по себе.
        lastError = "Туннель забрало другое VPN-приложение"
        TunnelLog.add("разрешение отозвано: туннель перехватило другое приложение")
        stopTunnel()
        super.onRevoke()
    }

    // MARK: - Жизненный цикл

    private fun startTunnel(requireCurrentProfile: Boolean = false) {
        if (phase != TunnelPhase.Off) return
        lastError = null
        TunnelLog.attach(this)

        phase = TunnelPhase.Connecting
        startForeground(NOTIFICATION_ID, notification("Подключение…"))

        try {
            val config = TunnelStore.readConfig(this, requireCurrentProfile)
                ?: error("Откройте Prism, чтобы подготовить настройки подключения")
            TunnelStore.setupCore(this)

            val server = Libbox.newCommandServer(this, this)
            this.server = server
            server.start()
            // Конфиг уже проверялся при сборке, но ядро проверяет ещё раз:
            // между сборкой и запуском файл мог устареть
            server.startOrReloadService(config, OverrideOptions())

            phase = TunnelPhase.On
            TunnelLog.add("туннель поднят")
            notify("Подключено")
            watchDoze()
            startSupervisor(localProxyPort(config))
        } catch (e: Throwable) {
            TunnelLog.add("ядро не запустилось: ${e.message}")
            lastError = e.message ?: "Не удалось запустить ядро"
            stopTunnel()
        }
    }

    /**
     * Останавливает туннель совсем: закрывает ядро, убирает интерфейс, снимает
     * уведомление. Трафик после этого идёт напрямую.
     *
     * Обрыв связи сюда больше не приводит — им занимается наблюдатель, который
     * держит интерфейс поднятым и возвращает связь сам. Вызывается только по
     * воле пользователя, при отзыве разрешения и когда «замок» выключен, а
     * сервер молчит слишком долго.
     */
    private fun stopTunnel() {
        healthJob?.cancel()
        healthJob = null

        // Дескриптор закрываем раньше ядра: иначе ядро закроет его само, а мы
        // следом закроем номер, который система успела отдать другому файлу
        runCatching { tunnel?.close() }
        tunnel = null

        runCatching { server?.closeService() }
        runCatching { server?.close() }
        server = null

        idleReceiver?.let { runCatching { unregisterReceiver(it) } }
        idleReceiver = null

        stopForeground(STOP_FOREGROUND_REMOVE)
        phase = TunnelPhase.Off
        stopSelf()
    }

    /**
     * Настройка читается из хранилища приложения, а не из конфига ядра: своё
     * поле в конфиге заводить нельзя, sing-box отвергает незнакомые ключи.
     * Служба и приложение живут в одном процессе, так что хранилище общее.
     */
    private fun killSwitchEnabled(): Boolean = runCatching {
        val raw = getSharedPreferences("prism", Context.MODE_PRIVATE)
            .getString("settings", null) ?: return false
        org.json.JSONObject(raw).optBoolean("killSwitch", false)
    }.getOrDefault(false)

    // MARK: - Наблюдатель за связью

    /**
     * Проверка живости и восстановление.
     *
     * Ходит на пробный адрес через локальный прокси ядра, поэтому запрос идёт
     * тем же путём, что и обычный трафик — до сервера и обратно. Само приложение
     * исключено из туннеля, поэтому прямой запрос ничего бы не доказал.
     *
     * Раньше несколько неудач подряд просто выключали туннель. Это оказалось
     * худшим из возможных решений: любая двухминутная яма — метро, лифт, лифт
     * между этажами, переход с Wi-Fi на сотовую — навсегда роняла VPN, и человек
     * обнаруживал это много позже и без объяснений. Теперь неудача запускает
     * лестницу восстановления, а туннель остаётся поднятым.
     */
    private fun startSupervisor(port: Int) {
        healthJob = scope.launch {
            var failures = 0
            var backoff = RELOAD_BACKOFF_START_MS
            var lastReload = 0L

            while (isActive) {
                delay(PROBE_INTERVAL_MS)
                if (phase == TunnelPhase.Off) return@launch

                // Спящий телефон: ядро приостановлено самим Android, проверять
                // нечего. Считать это обрывом — значит будить и ронять туннель
                // каждую ночь.
                if (dozing) continue

                // Сети нет вовсе — сервер тут ни при чём. Как только сеть
                // вернётся, ядро переподключится само.
                if (!hasNetwork()) {
                    if (failures > 0) TunnelLog.add("сети нет — проверку откладываю")
                    continue
                }

                if (probe(port)) {
                    if (failures > 0) {
                        TunnelLog.add("связь вернулась после $failures неудачных проверок")
                        phase = TunnelPhase.On
                        notify("Подключено")
                    }
                    failures = 0
                    backoff = RELOAD_BACKOFF_START_MS
                    continue
                }

                failures++
                TunnelLog.add(
                    "проверка связи не прошла (подряд $failures)" +
                        probeFailure?.let { " — $it" }.orEmpty()
                )

                if (failures == FAILURES_BEFORE_RESET) {
                    phase = TunnelPhase.Recovering
                    notify("Связь потеряна — восстанавливаю")
                    TunnelLog.add("пересобираю соединения")
                    runCatching { server?.resetNetwork() }
                }

                val now = System.currentTimeMillis()
                if (failures >= FAILURES_BEFORE_RELOAD && now - lastReload >= backoff) {
                    lastReload = now
                    backoff = (backoff * 2).coerceAtMost(RELOAD_BACKOFF_MAX_MS)
                    reloadCore()
                }

                if (failures >= FAILURES_BEFORE_BLOCK && phase != TunnelPhase.Blocked) {
                    if (killSwitchEnabled()) {
                        // Интерфейс остаётся поднятым, ядро — живым. Наружу
                        // ничего не уходит, потому что уходить некуда, а мимо
                        // туннеля трафик не пойдёт: маршруты ведут в него.
                        phase = TunnelPhase.Blocked
                        lastError = "Сервер не отвечает"
                        notify("Сервер не отвечает. Восстанавливаем связь")
                        TunnelLog.add("туннель оставлен включённым, попытки восстановления продолжаются")
                    } else {
                        lastError = "Сервер не отвечает"
                        TunnelLog.add("замок выключен: останавливаю туннель, трафик пойдёт напрямую")
                        stopTunnel()
                        return@launch
                    }
                }
            }
        }
    }

    /** Перезапуск ядра на месте: интерфейс при этом не пропадает */
    private fun reloadCore() {
        val config = TunnelStore.readConfig(this)
        if (config == null) {
            TunnelLog.add("перезапуск невозможен: конфиг пропал")
            return
        }
        TunnelLog.add("перезапускаю ядро")
        runCatching { server?.startOrReloadService(config, OverrideOptions()) }
            .onFailure { TunnelLog.add("перезапуск не удался: ${it.message}") }
    }

    /** Есть ли у телефона сеть вообще — не считая нашего же туннеля */
    private fun hasNetwork(): Boolean = runCatching {
        val manager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        underlyingNetwork(manager) != null
    }.getOrDefault(true)

    private fun probe(port: Int): Boolean {
        var reason: Throwable? = null
        for (url in HEALTH_URLS) {
            when (val result = reachable(url, port)) {
                is Result.Success -> return true
                is Result.Failure -> reason = result.cause
            }
        }
        // Причину пишем всегда: молчаливая проверка однажды уже месяц уверяла,
        // что сервер мёртв, хотя мёртвой была она сама
        probeFailure = reason?.let { "${it::class.simpleName}: ${it.message}" } ?: "пустой ответ"
        return false
    }

    /** Последняя причина неудачной проверки — для журнала */
    @Volatile private var probeFailure: String? = null

    private sealed interface Result {
        object Success : Result
        class Failure(val cause: Throwable?) : Result
    }

    private fun reachable(url: String, port: Int): Result = runCatching {
        val proxy = java.net.Proxy(
            java.net.Proxy.Type.HTTP,
            java.net.InetSocketAddress("127.0.0.1", port)
        )
        val connection = (java.net.URL(url).openConnection(proxy) as java.net.HttpURLConnection)
            .apply {
                connectTimeout = PROBE_TIMEOUT_MS
                readTimeout = PROBE_TIMEOUT_MS
                useCaches = false
            }
        try {
            if (connection.responseCode in 200..399) {
                Result.Success
            } else {
                Result.Failure(IllegalStateException("ответ ${connection.responseCode}"))
            }
        } finally {
            connection.disconnect()
        }
    }.getOrElse { Result.Failure(it) }

    /** Порт локального прокси берётся из самого конфига, а не угадывается */
    private fun localProxyPort(config: String): Int = runCatching {
        val inbounds = org.json.JSONObject(config).optJSONArray("inbounds") ?: return 2080
        for (i in 0 until inbounds.length()) {
            val item = inbounds.optJSONObject(i) ?: continue
            if (item.optString("type") == "mixed") return item.optInt("listen_port", 2080)
        }
        2080
    }.getOrDefault(2080)

    /**
     * Глубокий сон Android.
     *
     * В нём система замораживает таймеры и рвёт соединения, а ядро продолжает
     * считать их живыми. Официальный клиент sing-box поступает так же: на входе
     * в сон ядро приостанавливается, на выходе — будится и пересобирает связь.
     * Без этого туннель после ночи выглядит поднятым, но не работает.
     */
    private fun watchDoze() {
        val power = getSystemService(PowerManager::class.java)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (power.isDeviceIdleMode) {
                    dozing = true
                    TunnelLog.add("телефон уснул — ядро приостановлено")
                    runCatching { server?.pause() }
                } else {
                    dozing = false
                    TunnelLog.add("телефон проснулся — пересобираю соединения")
                    runCatching { server?.wake() }
                    runCatching { server?.resetNetwork() }
                }
            }
        }
        // Подключиться можно и на уже спящем телефоне — из автозапуска после
        // перезагрузки, например
        dozing = power.isDeviceIdleMode
        idleReceiver = receiver
        ContextCompat.registerReceiver(
            this,
            receiver,
            IntentFilter(PowerManager.ACTION_DEVICE_IDLE_MODE_CHANGED),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
    }

    // MARK: - PlatformInterface: туннель

    /**
     * Ядро передаёт параметры туннеля, мы превращаем их в VpnService.Builder
     * и возвращаем файловый дескриптор.
     *
     * На iOS этот же дескриптор приходится искать перебором открытых файлов —
     * NetworkExtension его не отдаёт. Здесь система возвращает его честно.
     */
    override fun openTun(options: TunOptions): Int {
        val builder = Builder()
            .setSession("Prism")
            .setMtu(options.mtu)

        options.inet4Address.forEach { builder.addAddress(it.address(), it.prefix()) }
        options.inet6Address.forEach { builder.addAddress(it.address(), it.prefix()) }

        if (options.autoRoute) {
            val v4 = options.inet4RouteAddress.toList()
            val v6 = options.inet6RouteAddress.toList()
            if (v4.isEmpty() && v6.isEmpty()) {
                // Ядро не сузило маршруты — заворачиваем всё
                builder.addRoute("0.0.0.0", 0)
                builder.addRoute("::", 0)
            } else {
                v4.forEach { builder.addRoute(it.address(), it.prefix()) }
                v6.forEach { builder.addRoute(it.address(), it.prefix()) }
            }

            // Само приложение мимо туннеля: иначе обновление подписки пойдёт
            // через ещё не поднятый прокси и повиснет
            runCatching { builder.addDisallowedApplication(packageName) }
        }

        runCatching { options.dnsServerAddress?.value?.let(builder::addDnsServer) }

        val descriptor = builder.establish()
            ?: throw IllegalStateException("Система не выдала туннель: разрешение отозвано?")

        // Прежний дескриптор закрываем сами. Ядро работает не с ним, а с его
        // копией (внутри оно делает dup), так что закрыть его больше некому:
        // при перезапуске ядра интерфейс оставался висеть выключенным, и за
        // час перебоев их набирался десяток.
        tunnel?.let { runCatching { it.close() } }
        tunnel = descriptor
        return descriptor.fd
    }

    // MARK: - PlatformInterface: наблюдение за сетью

    override fun startDefaultInterfaceMonitor(listener: InterfaceUpdateListener) {
        val manager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = update(manager, network, listener)
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) =
                update(manager, network, listener)
            override fun onLost(network: Network) {
                listener.updateDefaultInterface("", -1, false, false)
            }
        }
        monitorCallback = callback
        manager.registerNetworkCallback(
            NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                // NOT_VPN обязателен. Ядру нужен интерфейс, через который оно
                // само выходит наружу, а после поднятия туннеля активной сетью
                // становится сам туннель — и ядро начинает слать собственный
                // трафик в свой же туннель, получая «no available network
                // interface» на любой запрос, включая DNS.
                .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
                .build(),
            callback
        )
        // Первое состояние отдаём сразу: ядру нужен интерфейс до первого запроса
        underlyingNetwork(manager)?.let { update(manager, it, listener) }
    }

    /** Первая сеть с интернетом, которая не является туннелем */
    private fun underlyingNetwork(manager: ConnectivityManager): Network? =
        manager.allNetworks.firstOrNull { network ->
            val caps = manager.getNetworkCapabilities(network) ?: return@firstOrNull false
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
        }

    private fun update(manager: ConnectivityManager, network: Network, listener: InterfaceUpdateListener) {
        val name = manager.getLinkProperties(network)?.interfaceName ?: return
        val caps = manager.getNetworkCapabilities(network)
        val metered = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == false
        val constrained = if (Build.VERSION.SDK_INT >= 34) {
            caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_CONGESTED) == false
        } else false
        // Индекс берём системным вызовом: java.net.NetworkInterface с Android 11
        // приложениям перечислять интерфейсы не даёт, и там молча выходит ноль,
        // от которого ядро остаётся без интерфейса вовсе
        val index = runCatching { android.system.Os.if_nametoindex(name) }.getOrDefault(0)
        listener.updateDefaultInterface(name, index, metered, constrained)

        /* Смена интерфейса — это переход между Wi-Fi и сотовой сетью. Старые
           соединения при этом остаются висеть на исчезнувшем маршруте и молча
           отваливаются: снаружи выглядит как «VPN включён, но интернета нет».
           Просим ядро пересобрать их заново.

           Сравниваем именно имя: события о смене свойств сети приходят пачками,
           и без этой проверки сброс случался бы по нескольку раз подряд. */
        if (name != lastInterface) {
            if (lastInterface != null) TunnelLog.add("сеть сменилась: $lastInterface → $name")
            lastInterface = name
            runCatching { server?.resetNetwork() }
        }
    }

    override fun closeDefaultInterfaceMonitor(listener: InterfaceUpdateListener) {
        val manager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        monitorCallback?.let { runCatching { manager.unregisterNetworkCallback(it) } }
        monitorCallback = null
    }

    /**
     * Список интерфейсов строится через ConnectivityManager, а не через
     * java.net.NetworkInterface: перечислять интерфейсы напрямую Android с 11-й
     * версии приложениям не разрешает, и список выходил пустым. Ядро при этом
     * отвечало «no available network interface» на любой запрос, включая DNS,
     * хотя интерфейс по умолчанию ему сообщался исправно.
     */
    override fun getInterfaces(): NetworkInterfaceIterator {
        val manager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val items = manager.allNetworks.mapNotNull { network ->
            val properties = manager.getLinkProperties(network) ?: return@mapNotNull null
            val interfaceName = properties.interfaceName ?: return@mapNotNull null
            val caps = manager.getNetworkCapabilities(network)
            io.nekohasekai.libbox.NetworkInterface().apply {
                name = interfaceName
                index = runCatching { android.system.Os.if_nametoindex(interfaceName) }.getOrDefault(0)
                mtu = if (Build.VERSION.SDK_INT >= 29 && properties.mtu > 0) {
                    properties.mtu
                } else {
                    1500
                }
                metered = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == false
                // Флаги обязательны: интерфейс без IFF_UP и IFF_RUNNING ядро
                // считает выключенным и отвечает «no available network interface»
                // на любой исходящий запрос, включая DNS. ConnectivityManager их
                // не отдаёт, но раз сеть в списке — она поднята и работает.
                flags = IFF_UP or IFF_BROADCAST or IFF_RUNNING or IFF_MULTICAST
                type = when {
                    caps == null -> INTERFACE_OTHER
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> INTERFACE_WIFI
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> INTERFACE_CELLULAR
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> INTERFACE_ETHERNET
                    else -> INTERFACE_OTHER
                }
                addresses = StringArray(
                    properties.linkAddresses.mapNotNull { link ->
                        val host = link.address?.hostAddress ?: return@mapNotNull null
                        "${host.substringBefore('%')}/${link.prefixLength}"
                    }
                )
            }
        }
        return InterfaceArray(items)
    }


    // MARK: - PlatformInterface: возможности платформы

    /** Нет: это не расширение iOS, а обычная служба Android */
    override fun underNetworkExtension(): Boolean = false

    /** Нет: /proc для определения владельца соединения на новых Android закрыт */
    override fun useProcFS(): Boolean = false

    /** Да: привязать сокет к интерфейсу умеет только система */
    override fun usePlatformAutoDetectInterfaceControl(): Boolean = true

    /** Защищённый сокет идёт мимо туннеля — иначе ядро зациклит само на себя */
    override fun autoDetectInterfaceControl(fd: Int) {
        if (!protect(fd)) throw IllegalStateException("не удалось защитить сокет $fd")
    }

    override fun includeAllNetworks(): Boolean = false

    /**
     * Владельца соединения ядру не сообщаем. Начиная с Android 10 система не
     * выдаёт это сопоставление, а маршрутизация по приложениям делается иначе —
     * методами addAllowedApplication и addDisallowedApplication у VpnService.
     */
    override fun findConnectionOwner(
        ipProtocol: Int,
        sourceAddress: String,
        sourcePort: Int,
        destinationAddress: String,
        destinationPort: Int
    ): io.nekohasekai.libbox.ConnectionOwner {
        throw UnsupportedOperationException("владелец соединения на Android недоступен")
    }

    override fun clearDNSCache() {}
    override fun readWIFIState(): WIFIState? = null
    override fun systemCertificates(): StringIterator? = null
    override fun localDNSTransport(): LocalDNSTransport? = null
    override fun sendNotification(notification: io.nekohasekai.libbox.Notification) {}

    // MARK: - CommandServerHandler

    override fun serviceReload() {
        val config = TunnelStore.readConfig(this) ?: return
        server?.startOrReloadService(config, OverrideOptions())
    }

    /** Остановку просит само ядро — считаем её равной нажатию пользователя */
    override fun serviceStop() {
        TunnelLog.add("остановку запросило ядро")
        stopTunnel()
    }

    /** Системного прокси у Android-туннеля нет: весь трафик и так идёт в tun */
    override fun getSystemProxyStatus(): SystemProxyStatus =
        SystemProxyStatus().apply {
            available = false
            enabled = false
        }

    override fun setSystemProxyEnabled(enabled: Boolean) {}

    override fun writeDebugMessage(message: String) {
        android.util.Log.d("prism-tunnel", message)
    }

    // MARK: - Уведомление

    private fun notification(text: String): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL) == null) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, "Туннель", NotificationManager.IMPORTANCE_LOW)
            )
        }
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        // Отключение прямо из уведомления. Без него туннель нечем остановить,
        // если экран приложения почему-то не открывается: служба переживает
        // закрытие приложения, и значок VPN остаётся висеть.
        val stop = PendingIntent.getService(
            this, 1,
            Intent(this, TunnelService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE
        )
        return Notification.Builder(this, CHANNEL)
            .setContentTitle("Prism")
            .setContentText(text)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(open)
            .addAction(
                Notification.Action.Builder(null as android.graphics.drawable.Icon?, "Отключить", stop).build()
            )
            .setOngoing(true)
            .build()
    }

    private fun notify(text: String) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, notification(text))
    }
}

// MARK: - Переходники к итераторам ядра

private class StringArray(private val items: List<String>) : StringIterator {
    private var index = 0
    override fun len(): Int = items.size
    override fun hasNext(): Boolean = index < items.size
    override fun next(): String = items[index++]
}

private class InterfaceArray(
    private val items: List<io.nekohasekai.libbox.NetworkInterface>
) : NetworkInterfaceIterator {
    private var index = 0
    override fun hasNext(): Boolean = index < items.size
    override fun next(): io.nekohasekai.libbox.NetworkInterface = items[index++]
}

/** Перебор RoutePrefixIterator в обычный список */
private fun io.nekohasekai.libbox.RoutePrefixIterator.toList(): List<io.nekohasekai.libbox.RoutePrefix> {
    val out = mutableListOf<io.nekohasekai.libbox.RoutePrefix>()
    while (hasNext()) out.add(next())
    return out
}

private inline fun io.nekohasekai.libbox.RoutePrefixIterator.forEach(
    action: (io.nekohasekai.libbox.RoutePrefix) -> Unit
) {
    while (hasNext()) action(next())
}
