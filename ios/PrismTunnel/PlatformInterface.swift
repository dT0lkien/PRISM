import Foundation
import Libbox
import Network
import NetworkExtension

/// Связка ядра sing-box с NetworkExtension.
///
/// Ядро не знает ничего про iOS: оно просит «дай мне tun» и «скажи, какой интерфейс
/// сейчас основной», а платформенные детали закрывает этот класс. На десктопе ту же
/// роль выполняет операционная система, поэтому у Windows-версии аналога нет.
final class PlatformInterface: NSObject, LibboxPlatformInterfaceProtocol {
    private weak var provider: NEPacketTunnelProvider?
    private var pathMonitor: NWPathMonitor?

    init(provider: NEPacketTunnelProvider) {
        self.provider = provider
        super.init()
    }

    // MARK: - Туннель

    /// Ядро передаёт параметры туннеля, мы превращаем их в настройки
    /// NetworkExtension и возвращаем дескриптор созданного utun.
    func openTun(_ options: LibboxTunOptionsProtocol?, ret0_: UnsafeMutablePointer<Int32>?) throws {
        guard let options, let provider else {
            throw TunnelError.message("туннель запрошен без параметров")
        }

        let settings = try networkSettings(from: options)

        // setTunnelNetworkSettings асинхронный, а ядро ждёт готовый дескриптор,
        // поэтому дожидаемся завершения перед поиском utun
        let semaphore = DispatchSemaphore(value: 0)
        var applyError: Error?
        provider.setTunnelNetworkSettings(settings) { error in
            applyError = error
            semaphore.signal()
        }
        semaphore.wait()
        if let applyError { throw applyError }

        guard let fd = Self.findUtunDescriptor() else {
            throw TunnelError.message("не нашёл дескриптор utun после настройки туннеля")
        }
        ret0_?.pointee = fd
    }

    /// NEPacketTunnelProvider не отдаёт файловый дескриптор напрямую, поэтому его
    /// ищут перебором открытых дескрипторов процесса: у нужного через getsockopt
    /// читается имя интерфейса, начинающееся на utun. Приём общеизвестный и
    /// используется всеми клиентами на базе sing-box и WireGuard.
    /// SYSPROTO_CONTROL из <sys/kern_control.h> и UTUN_OPT_IFNAME из <net/if_utun.h>.
    /// Оба заголовка Swift не импортирует, поэтому значения записаны числами.
    private static let sysprotoControl: Int32 = 2
    private static let utunOptIfname: Int32 = 2

    private static func findUtunDescriptor() -> Int32? {
        var name = [CChar](repeating: 0, count: Int(IFNAMSIZ))
        for fd in 0..<1024 as Range<Int32> {
            var length = socklen_t(IFNAMSIZ)
            let result = getsockopt(fd, sysprotoControl, utunOptIfname, &name, &length)
            guard result == 0 else { continue }
            if String(cString: name).hasPrefix("utun") { return fd }
        }
        return nil
    }

    private func networkSettings(from options: LibboxTunOptionsProtocol) throws -> NEPacketTunnelNetworkSettings {
        // Адрес удалённой стороны формален: весь трафик и так уходит в tun
        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "127.0.0.1")
        settings.mtu = NSNumber(value: options.getMTU())

        let autoRoute = options.getAutoRoute()

        var v4addr: [String] = [], v4mask: [String] = []
        for prefix in prefixes(options.getInet4Address()) {
            v4addr.append(prefix.address())
            v4mask.append(prefix.mask())
        }
        if !v4addr.isEmpty {
            let ipv4 = NEIPv4Settings(addresses: v4addr, subnetMasks: v4mask)
            if autoRoute {
                let included = prefixes(options.getInet4RouteAddress())
                    .map { NEIPv4Route(destinationAddress: $0.address(), subnetMask: $0.mask()) }
                ipv4.includedRoutes = included.isEmpty ? [NEIPv4Route.default()] : included
                ipv4.excludedRoutes = prefixes(options.getInet4RouteExcludeAddress())
                    .map { NEIPv4Route(destinationAddress: $0.address(), subnetMask: $0.mask()) }
            }
            settings.ipv4Settings = ipv4
        }

        var v6addr: [String] = [], v6prefix: [NSNumber] = []
        for prefix in prefixes(options.getInet6Address()) {
            v6addr.append(prefix.address())
            v6prefix.append(NSNumber(value: prefix.prefix()))
        }
        if !v6addr.isEmpty {
            let ipv6 = NEIPv6Settings(addresses: v6addr, networkPrefixLengths: v6prefix)
            if autoRoute {
                let included = prefixes(options.getInet6RouteAddress())
                    .map { NEIPv6Route(destinationAddress: $0.address(), networkPrefixLength: NSNumber(value: $0.prefix())) }
                ipv6.includedRoutes = included.isEmpty ? [NEIPv6Route.default()] : included
                ipv6.excludedRoutes = prefixes(options.getInet6RouteExcludeAddress())
                    .map { NEIPv6Route(destinationAddress: $0.address(), networkPrefixLength: NSNumber(value: $0.prefix())) }
            }
            settings.ipv6Settings = ipv6
        }

        // DNS ядро обслуживает само, поэтому системе отдаём его собственный адрес
        if let dns = try? options.getDNSServerAddress() {
            let servers = NEDNSSettings(servers: [dns.value])
            servers.matchDomains = [""] // перехватываем все запросы
            settings.dnsSettings = servers
        }

        return settings
    }

    private func prefixes(_ iterator: LibboxRoutePrefixIteratorProtocol?) -> [LibboxRoutePrefix] {
        guard let iterator else { return [] }
        var out: [LibboxRoutePrefix] = []
        while iterator.hasNext() {
            if let next = iterator.next() { out.append(next) }
        }
        return out
    }

    // MARK: - Наблюдение за сетью

    func startDefaultInterfaceMonitor(_ listener: LibboxInterfaceUpdateListenerProtocol?) throws {
        guard let listener else { return }
        let monitor = NWPathMonitor()
        pathMonitor = monitor
        // Первое событие приходит асинхронно, а ядру нужно знать интерфейс до старта,
        // поэтому дожидаемся его — иначе первые соединения уйдут мимо маршрута
        let ready = DispatchSemaphore(value: 0)
        var delivered = false
        monitor.pathUpdateHandler = { path in
            Self.notify(listener, path: path)
            if !delivered {
                delivered = true
                ready.signal()
            }
        }
        monitor.start(queue: DispatchQueue(label: "prism.path-monitor"))
        _ = ready.wait(timeout: .now() + 2)
    }

    func closeDefaultInterfaceMonitor(_ listener: LibboxInterfaceUpdateListenerProtocol?) throws {
        pathMonitor?.cancel()
        pathMonitor = nil
    }

    private static func notify(_ listener: LibboxInterfaceUpdateListenerProtocol, path: Network.NWPath) {
        let name = path.availableInterfaces.first?.name ?? ""
        let index = path.availableInterfaces.first.map { Int32(if_nametoindex($0.name)) } ?? 0
        listener.updateDefaultInterface(
            name,
            interfaceIndex: index,
            isExpensive: path.isExpensive,
            isConstrained: path.isConstrained
        )
    }

    func getInterfaces() throws -> LibboxNetworkInterfaceIteratorProtocol {
        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0, let first = head else {
            throw TunnelError.message("не удалось перечислить сетевые интерфейсы")
        }
        defer { freeifaddrs(head) }

        var byName: [String: LibboxNetworkInterface] = [:]
        var pointer: UnsafeMutablePointer<ifaddrs>? = first
        while let current = pointer {
            let address = current.pointee
            let name = String(cString: address.ifa_name)
            if byName[name] == nil {
                let item = LibboxNetworkInterface()
                item.name = name
                item.index = Int32(if_nametoindex(name))
                item.flags = Int32(address.ifa_flags)
                byName[name] = item
            }
            pointer = address.ifa_next
        }
        return InterfaceIterator(items: Array(byName.values))
    }

    private final class InterfaceIterator: NSObject, LibboxNetworkInterfaceIteratorProtocol {
        private var items: [LibboxNetworkInterface]
        private var index = 0

        init(items: [LibboxNetworkInterface]) {
            self.items = items
        }

        func hasNext() -> Bool { index < items.count }

        func next() -> LibboxNetworkInterface? {
            guard index < items.count else { return nil }
            defer { index += 1 }
            return items[index]
        }
    }

    // MARK: - Возможности платформы

    /// Да: код исполняется внутри NetworkExtension, а не в отдельном процессе-демоне
    func underNetworkExtension() -> Bool { true }

    /// Нет: /proc есть только на Linux и Android
    func useProcFS() -> Bool { false }

    /// Нет: привязку сокета к интерфейсу ядро делает само
    func usePlatformAutoDetectControl() -> Bool { false }

    func autoDetectControl(_ fd: Int32) throws {}

    /// Нет: includeAllNetworks ломает связь с локальной сетью и требует
    /// отдельного согласования с Apple
    func includeAllNetworks() -> Bool { false }

    /// На iOS определить владельца соединения нельзя — система не выдаёт
    /// сопоставление порта и процесса. Маршрутизация по приложениям поэтому
    /// и вырезана из конфига в общем ядре.
    func findConnectionOwner(
        _ ipProtocol: Int32,
        sourceAddress: String?,
        sourcePort: Int32,
        destinationAddress: String?,
        destinationPort: Int32
    ) throws -> LibboxConnectionOwner {
        throw TunnelError.message("на iOS владелец соединения недоступен")
    }

    func clearDNSCache() {}

    func readWIFIState() -> LibboxWIFIState? { nil }

    func systemCertificates() -> LibboxStringIteratorProtocol? { nil }

    func localDNSTransport() -> LibboxLocalDNSTransportProtocol? { nil }

    func send(_ notification: LibboxNotification?) throws {}
}

enum TunnelError: LocalizedError {
    case message(String)

    var errorDescription: String? {
        switch self {
        case .message(let text): text
        }
    }
}
