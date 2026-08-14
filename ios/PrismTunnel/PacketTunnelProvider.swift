import Foundation
import Libbox
import NetworkExtension
import PrismCore

/// Провайдер туннеля: поднимает ядро sing-box внутри NetworkExtension.
///
/// Ключевое отличие от Windows-версии. Там приложение запускает sing-box отдельным
/// процессом и общается с ним по Clash API. На iOS исполнять сторонние бинарники
/// запрещено, поэтому ядро слинковано в этот же процесс и работает как библиотека,
/// а конфиг приезжает файлом через группу приложений — приложение его собирает,
/// расширение читает.
class PacketTunnelProvider: NEPacketTunnelProvider {
    private var server: LibboxCommandServer?
    private var platform: PlatformInterface?

    override func startTunnel(options: [String: NSObject]?) async throws {
        let config = try PrismGroup.readConfig()

        guard let working = PrismGroup.workingURL else {
            throw TunnelError.message("нет доступа к общей группе — туннель поднять невозможно")
        }

        let setup = LibboxSetupOptions()
        setup.basePath = working.path
        setup.workingPath = working.path
        setup.tempPath = NSTemporaryDirectory()

        var setupError: NSError?
        guard LibboxSetup(setup, &setupError) else {
            throw setupError ?? TunnelError.message("LibboxSetup не выполнился")
        }

        let platform = PlatformInterface(provider: self)
        self.platform = platform

        guard let server = LibboxCommandServer(Handler(provider: self), platformInterface: platform) else {
            throw TunnelError.message("не удалось создать командный сервер ядра")
        }
        self.server = server

        try server.start()
        // Конфиг уже проверен на стороне приложения, но ядро проверяет ещё раз:
        // между сборкой и запуском файл мог устареть
        try server.startOrReloadService(config, options: nil)
    }

    override func stopTunnel(with reason: NEProviderStopReason) async {
        try? server?.closeService()
        server?.close()
        server = nil
        platform = nil
    }

    /// Система будит расширение при смене сети — ядру нужно пересобрать соединения
    override func wake() {
        server?.wake()
    }

    override func sleep() async {
        server?.pause()
    }

    /// Обратные вызовы ядра. Системного прокси на iOS нет, поэтому относящиеся
    /// к нему методы намеренно пустые.
    private final class Handler: NSObject, LibboxCommandServerHandlerProtocol {
        private weak var provider: PacketTunnelProvider?

        init(provider: PacketTunnelProvider) {
            self.provider = provider
        }

        func serviceReload() throws {
            guard let provider, let server = provider.server else { return }
            try server.startOrReloadService(try PrismGroup.readConfig(), options: nil)
        }

        func serviceStop() throws {
            provider?.cancelTunnelWithError(nil)
        }

        func getSystemProxyStatus() throws -> LibboxSystemProxyStatus {
            let status = LibboxSystemProxyStatus()
            status.available = false
            status.enabled = false
            return status
        }

        func setSystemProxyEnabled(_ enabled: Bool) throws {}

        func writeDebugMessage(_ message: String?) {
            guard let message else { return }
            NSLog("[prism-tunnel] %@", message)
        }
    }
}
