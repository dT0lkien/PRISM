import Foundation

/// Общий контейнер приложения и расширения.
///
/// Расширение живёт отдельным процессом и до песочницы приложения не дотягивается,
/// поэтому конфиг передаётся через группу приложений: приложение собирает JSON и
/// кладёт файл, расширение читает его при подъёме туннеля.
///
/// Группа требует энтайтлмента, который выдаётся только платному аккаунту Apple.
/// Поэтому все методы допускают отсутствие контейнера и возвращают nil, а не падают:
/// в симуляторе без подписи приложение обязано оставаться работоспособным.
public enum PrismGroup {
    public static let identifier = "group.com.prism.vpn"

    public static var containerURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: identifier)
    }

    /// Конфиг sing-box, который расширение передаёт ядру
    public static var configURL: URL? {
        containerURL?.appendingPathComponent("config.json")
    }

    /// Рабочий каталог ядра: кэш fakeip, результаты замеров задержки, скачанные
    /// правила маршрутизации. Внутри группы, чтобы переживал перезапуск туннеля.
    public static var workingURL: URL? {
        guard let base = containerURL?.appendingPathComponent("core", isDirectory: true) else { return nil }
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    public static func writeConfig(_ json: String) throws {
        guard let url = configURL else {
            throw CocoaError(.fileNoSuchFile, userInfo: [
                NSLocalizedDescriptionKey: "Нет доступа к группе \(identifier) — нужен платный аккаунт Apple Developer"
            ])
        }
        try json.write(to: url, atomically: true, encoding: .utf8)
    }

    public static func readConfig() throws -> String {
        guard let url = configURL else {
            throw CocoaError(.fileNoSuchFile, userInfo: [
                NSLocalizedDescriptionKey: "Нет доступа к группе \(identifier)"
            ])
        }
        return try String(contentsOf: url, encoding: .utf8)
    }
}
