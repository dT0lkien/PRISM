package com.prism.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import io.nekohasekai.libbox.CommandServer
import io.nekohasekai.libbox.CommandServerHandler
import io.nekohasekai.libbox.InterfaceUpdateListener
import io.nekohasekai.libbox.Libbox
import io.nekohasekai.libbox.LocalDNSTransport
import io.nekohasekai.libbox.NetworkInterfaceIterator
import io.nekohasekai.libbox.OverrideOptions
import io.nekohasekai.libbox.PlatformInterface
import io.nekohasekai.libbox.SetupOptions
import io.nekohasekai.libbox.StringIterator
import io.nekohasekai.libbox.SystemProxyStatus
import io.nekohasekai.libbox.TunOptions
import io.nekohasekai.libbox.WIFIState
import java.io.File

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
        const val ACTION_START = "com.prism.vpn.START"
        const val ACTION_STOP = "com.prism.vpn.STOP"

        private const val CHANNEL = "prism.tunnel"
        private const val NOTIFICATION_ID = 1

        /** Состояние для интерфейса. Служба живёт своей жизнью, экран лишь читает. */
        @Volatile
        var isRunning: Boolean = false
            private set

        @Volatile
        var lastError: String? = null
            private set
    }

    private var server: CommandServer? = null
    private var tunnel: ParcelFileDescriptor? = null
    private var monitorCallback: ConnectivityManager.NetworkCallback? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopTunnel()
                return START_NOT_STICKY
            }
            else -> startTunnel()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        stopTunnel()
        super.onDestroy()
    }

    /** Система убивает туннель, когда пользователь отзывает разрешение */
    override fun onRevoke() {
        stopTunnel()
        super.onRevoke()
    }

    // MARK: - Жизненный цикл

    private fun startTunnel() {
        if (isRunning) return
        lastError = null

        val config = TunnelStore.readConfig(this)
        if (config == null) {
            fail("Конфиг не найден: сначала добавьте сервер")
            return
        }

        startForeground(NOTIFICATION_ID, notification("Подключение…"))

        try {
            val base = filesDir.absolutePath
            Libbox.setup(SetupOptions().apply {
                basePath = base
                workingPath = File(filesDir, "core").apply { mkdirs() }.absolutePath
                tempPath = cacheDir.absolutePath
            })

            val server = Libbox.newCommandServer(this, this)
            this.server = server
            server.start()
            // Конфиг уже проверялся при сборке, но ядро проверяет ещё раз:
            // между сборкой и запуском файл мог устареть
            server.startOrReloadService(config, OverrideOptions())

            isRunning = true
            notify("Подключено")
        } catch (e: Throwable) {
            fail(e.message ?: "Не удалось запустить ядро")
            stopTunnel()
        }
    }

    private fun stopTunnel() {
        isRunning = false
        runCatching { server?.closeService() }
        runCatching { server?.close() }
        server = null
        runCatching { tunnel?.close() }
        tunnel = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun fail(message: String) {
        lastError = message
        isRunning = false
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
        android.util.Log.d("prism-tunnel", "интерфейс по умолчанию: $name index=$index")
        listener.updateDefaultInterface(name, index, metered, constrained)
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
                mtu = properties.mtu.takeIf { it > 0 } ?: 1500
                metered = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == false
                addresses = StringArray(
                    properties.linkAddresses.mapNotNull { link ->
                        val host = link.address?.hostAddress ?: return@mapNotNull null
                        "${host.substringBefore('%')}/${link.prefixLength}"
                    }
                )
            }
        }
        android.util.Log.d(
            "prism-tunnel",
            "интерфейсов ядру: ${items.size} — " + items.joinToString { "${it.name}#${it.index}" }
        )
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

    override fun serviceStop() {
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
        return Notification.Builder(this, CHANNEL)
            .setContentTitle("Prism")
            .setContentText(text)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(open)
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
