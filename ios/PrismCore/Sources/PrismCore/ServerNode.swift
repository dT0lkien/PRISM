import Foundation

/// Узел (сервер) — зеркало интерфейса `ServerNode` из src/shared/types.ts.
///
/// Поля названы ровно так же, как в TypeScript: объект ходит между Swift и общим
/// ядром через JSON без всякой трансляции имён.
public struct ServerNode: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var name: String
    /// vless, vmess, trojan, shadowsocks, hysteria2, tuic, wireguard и прочие.
    /// Намеренно строка, а не перечисление: список протоколов задаёт общее ядро,
    /// и новый протокол не должен требовать правки Swift.
    public var type: String
    public var server: String
    public var port: Int
    /// Готовый outbound sing-box без поля tag. Форму диктует ядро, не мы.
    public var outbound: JSONValue
    /// Исходная ссылка, если узел приехал из URL
    public var link: String?
    public var subscriptionId: String?
    /// Задержка в мс, -1 — недоступен, nil — не проверяли
    public var latency: Double?
    public var latencyCheckedAt: Double?
    public var createdAt: Double

    public init(
        id: String,
        name: String,
        type: String,
        server: String,
        port: Int,
        outbound: JSONValue,
        link: String? = nil,
        subscriptionId: String? = nil,
        latency: Double? = nil,
        latencyCheckedAt: Double? = nil,
        createdAt: Double
    ) {
        self.id = id
        self.name = name
        self.type = type
        self.server = server
        self.port = port
        self.outbound = outbound
        self.link = link
        self.subscriptionId = subscriptionId
        self.latency = latency
        self.latencyCheckedAt = latencyCheckedAt
        self.createdAt = createdAt
    }
}

/// Платформа сборки конфига — зеркало `ConfigPlatform` из src/shared/config-builder.ts.
public enum ConfigPlatform: String, Codable, Sendable {
    case windows
    case ios
}

/// Аргументы сборки конфига — зеркало `BuildContext` из src/shared/config-builder.ts.
public struct BuildContext: Encodable, Sendable {
    public var settings: JSONValue
    /// nil означает поведение по умолчанию, то есть windows
    public var platform: ConfigPlatform?
    public var nodes: [ServerNode]
    public var activeNodeId: String?
    public var appRules: [JSONValue]
    public var customRules: [JSONValue]
    public var enabledPresets: [String]
    /// Каталог с .srs. На iOS правила скачиваются ядром, поэтому путь тут временный —
    /// его вытеснит переход rule_set на type:'remote'.
    public var rulesDir: String
    public var cachePath: String
    public var clashSecret: String

    public init(
        settings: JSONValue,
        platform: ConfigPlatform? = nil,
        nodes: [ServerNode],
        activeNodeId: String? = nil,
        appRules: [JSONValue] = [],
        customRules: [JSONValue] = [],
        enabledPresets: [String],
        rulesDir: String,
        cachePath: String,
        clashSecret: String
    ) {
        self.settings = settings
        self.platform = platform
        self.nodes = nodes
        self.activeNodeId = activeNodeId
        self.appRules = appRules
        self.customRules = customRules
        self.enabledPresets = enabledPresets
        self.rulesDir = rulesDir
        self.cachePath = cachePath
        self.clashSecret = clashSecret
    }
}
