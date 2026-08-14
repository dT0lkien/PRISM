import Foundation
import NetworkExtension
import PrismCore

/// Управление VPN-профилем и туннелем.
///
/// На iOS приложение не поднимает туннель само: оно регистрирует в системе профиль
/// с указанием на расширение, а дальше просит систему его запустить. Расширение
/// поднимается отдельным процессом — и только у него есть доступ к пакетам.
@MainActor
final class TunnelController: ObservableObject {
    @Published private(set) var status: NEVPNStatus = .invalid
    @Published var failure: String?

    private var manager: NETunnelProviderManager?
    private var observer: NSObjectProtocol?

    /// Идентификатор расширения — должен совпадать с PRODUCT_BUNDLE_IDENTIFIER
    /// таргета PrismTunnel в ios/project.yml
    private let providerBundleIdentifier = "com.prism.vpn.tunnel"

    init() {
        observer = NotificationCenter.default.addObserver(
            forName: .NEVPNStatusDidChange,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let session = notification.object as? NEVPNConnection else { return }
            MainActor.assumeIsolated { self?.status = session.status }
        }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    var isConnected: Bool { status == .connected }
    var isBusy: Bool { status == .connecting || status == .disconnecting || status == .reasserting }

    var statusText: String {
        switch status {
        case .connected: "Подключено"
        case .connecting: "Подключение…"
        case .disconnecting: "Отключение…"
        case .reasserting: "Переподключение…"
        case .disconnected: "Отключено"
        case .invalid: "Профиль не создан"
        @unknown default: "Неизвестно"
        }
    }

    /// Читает существующий профиль, если он уже заведён в системе
    func load() async {
        do {
            let managers = try await NETunnelProviderManager.loadAllFromPreferences()
            manager = managers.first { ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == providerBundleIdentifier }
            status = manager?.connection.status ?? .invalid
        } catch {
            failure = describe(error)
        }
    }

    /// Записывает конфиг в общую группу и просит систему поднять туннель.
    func connect(configJSON: String) async {
        failure = nil
        do {
            try PrismGroup.writeConfig(configJSON)

            let manager = self.manager ?? NETunnelProviderManager()
            let proto = NETunnelProviderProtocol()
            proto.providerBundleIdentifier = providerBundleIdentifier
            // Адрес формальный: настоящие серверы заданы в конфиге sing-box
            proto.serverAddress = "Prism"
            manager.protocolConfiguration = proto
            manager.localizedDescription = "Prism"
            manager.isEnabled = true

            // Сохранять приходится дважды: после первого сохранения профиль
            // получает системный идентификатор, и без перечитывания запуск
            // упирается в «configuration is stale»
            try await manager.saveToPreferences()
            try await manager.loadFromPreferences()
            self.manager = manager

            try manager.connection.startVPNTunnel()
        } catch {
            failure = describe(error)
        }
    }

    func disconnect() {
        manager?.connection.stopVPNTunnel()
    }

    /// Системные сообщения об отказе невнятные («IPC failed»), а причин ровно две
    /// и обе известны заранее. Называем их прямо, чтобы не гадать по коду ошибки.
    private func describe(_ error: Error) -> String {
        #if targetEnvironment(simulator)
        return "В симуляторе NetworkExtension не работает — система отказывает в доступе к VPN-профилю. Проверить туннель можно только на устройстве.\n\nСистемное сообщение: \(error.localizedDescription)"
        #else
        return "\(error.localizedDescription)\n\nVPN-профиль требует энтайтлмента Network Extensions: он выдаётся только платному аккаунту Apple Developer."
        #endif
    }
}
