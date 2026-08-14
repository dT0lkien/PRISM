import Foundation
import PrismCore
import SwiftUI

/// Состояние приложения: список узлов, выбранный узел и доступ к общему ядру.
///
/// Вся содержательная работа — разбор ссылок и сборка конфига — уходит в PrismCore,
/// то есть в тот же TypeScript, на котором работает Windows-версия. Здесь только
/// хранение и представление.
@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var nodes: [ServerNode] = []
    @Published var activeNodeId: String?
    /// Последнее сообщение пользователю: и ошибка, и удачный итог
    @Published var failure: String?
    /// Идёт загрузка подписки. Без этого флага скачивание выглядит как бездействие.
    @Published private(set) var isBusy = false

    /// nil означает, что общее ядро не поднялось — в этом случае приложение
    /// показывает ошибку вместо списка, потому что без ядра делать нечего.
    private let core: PrismCore?

    private let storeKey = "prism.nodes"
    private let activeKey = "prism.activeNodeId"

    init() {
        do {
            core = try PrismCore()
        } catch {
            core = nil
            failure = error.localizedDescription
        }
        load()
    }

    var coreIsReady: Bool { core != nil }

    // MARK: - Узлы

    /// Разбирает вставленный текст: одна ссылка на строку, мусор пропускается.
    /// Возвращает, сколько узлов добавилось.
    @discardableResult
    func addNodes(fromLinks text: String) -> Int {
        guard let core else { return 0 }
        do {
            let parsed = try core.nodes(fromLinks: text)
            guard !parsed.isEmpty else {
                failure = "Не нашёл ни одной подходящей ссылки"
                return 0
            }

            // Дубли отсекаем по ключу узла, а не по имени: в подписках один и тот же
            // сервер часто приезжает под разными названиями
            var known = Set(try nodes.map { try core.key(for: $0) })
            var added: [ServerNode] = []
            for node in parsed {
                let key = try core.key(for: node)
                if known.insert(key).inserted { added.append(node) }
            }

            nodes.append(contentsOf: added)
            if activeNodeId == nil { activeNodeId = nodes.first?.id }
            save()
            // Сообщаем и об удаче тоже: молчание в ответ на действие читается
            // как поломка, даже когда всё сработало
            failure = added.count < parsed.count
                ? "Добавлено: \(added.count). Уже были: \(parsed.count - added.count)"
                : "Добавлено серверов: \(added.count)"
            return added.count
        } catch {
            failure = error.localizedDescription
            return 0
        }
    }

    /// Скачивает подписку и добавляет из неё серверы.
    ///
    /// Заголовок User-Agent имитирует sing-box: многие провайдеры отдают по нему
    /// готовый конфиг вместо HTML-страницы.
    func addSubscription(url raw: String) async {
        guard let core else { return }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), url.scheme?.hasPrefix("http") == true else {
            failure = "Это не похоже на адрес подписки"
            return
        }
        // iOS запрещает незашифрованные соединения, и провайдер по http просто
        // не ответит. Сказать об этом заранее понятнее, чем показать сетевую ошибку.
        if url.scheme?.lowercased() == "http" {
            failure = "iOS блокирует незашифрованный http. Нужен адрес по https."
            return
        }

        isBusy = true
        failure = nil
        defer { isBusy = false }

        do {
            var request = URLRequest(url: url)
            request.setValue("sing-box/1.13.15 (Prism)", forHTTPHeaderField: "User-Agent")
            request.timeoutInterval = 30

            let (data, response) = try await URLSession.shared.data(for: request)
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                failure = "Сервер ответил \(http.statusCode)"
                return
            }
            guard let body = String(data: data, encoding: .utf8) else {
                failure = "Ответ не читается как текст"
                return
            }

            let parsed = try core.nodes(fromSubscription: body, subscriptionId: trimmed)
            guard !parsed.isEmpty else {
                failure = "В подписке не нашлось серверов. Формат Clash YAML на iOS не поддерживается."
                return
            }
            merge(parsed, core: core)
        } catch {
            failure = error.localizedDescription
        }
    }

    /// Добавляет только новые узлы: при обновлении подписки один и тот же сервер
    /// часто приезжает под новым именем, и сравнение по имени плодило бы дубли.
    private func merge(_ parsed: [ServerNode], core: PrismCore) {
        do {
            var known = Set(try nodes.map { try core.key(for: $0) })
            var added: [ServerNode] = []
            for node in parsed where known.insert(try core.key(for: node)).inserted {
                added.append(node)
            }
            nodes.append(contentsOf: added)
            if activeNodeId == nil { activeNodeId = nodes.first?.id }
            save()
            failure = added.isEmpty
                ? "Все \(parsed.count) серверов уже добавлены"
                : "Добавлено серверов: \(added.count)"
        } catch {
            failure = error.localizedDescription
        }
    }

    func remove(at offsets: IndexSet) {
        let removed = offsets.map { nodes[$0].id }
        nodes.remove(atOffsets: offsets)
        if let active = activeNodeId, removed.contains(active) {
            activeNodeId = nodes.first?.id
        }
        save()
    }

    /// Пример для быстрой проверки: адреса заведомо нерабочие, это демонстрация
    /// разбора, а не готовые серверы.
    func addSampleNodes() {
        addNodes(fromLinks: """
            vless://11111111-2222-3333-4444-555555555555@example.com:443?encryption=none&security=reality&sni=www.microsoft.com&fp=chrome&pbk=VXFVG7CC-NQrdWhsTwvc830w5RpYGbFXb_4tgNTB2Dg&sid=a1b2&type=tcp&flow=xtls-rprx-vision#Reality TCP
            vmess://eyJ2IjoiMiIsInBzIjoiVk1lc3MgV1MiLCJhZGQiOiJleGFtcGxlLmNvbSIsInBvcnQiOiI0NDMiLCJpZCI6IjExMTExMTExLTIyMjItMzMzMy00NDQ0LTU1NTU1NTU1NTU1NSIsImFpZCI6IjAiLCJzY3kiOiJhdXRvIiwibmV0Ijoid3MiLCJ0eXBlIjoibm9uZSIsImhvc3QiOiJjZG4uZXhhbXBsZS5jb20iLCJwYXRoIjoiL3ZtIiwidGxzIjoidGxzIn0=
            trojan://hunter2@example.com:443?security=tls&sni=example.com&type=grpc&serviceName=grpcsvc#Trojan gRPC
            ss://YWVzLTI1Ni1nY206aHVudGVyMg==@example.com:8388#Shadowsocks
            hysteria2://hunter2@example.com:443?sni=example.com#Hysteria2
            tuic://11111111-2222-3333-4444-555555555555:hunter2@example.com:443?sni=example.com&congestion_control=bbr#TUIC
            """)
    }

    // MARK: - Конфиг

    /// Собирает конфиг sing-box в том виде, в каком его получит NetworkExtension.
    func configJSON() throws -> String {
        guard let core else { throw PrismCore.Failure.bundleMissing }
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return try core.configJSON(
            BuildContext(
                settings: core.defaultSettings(),
                platform: .ios,
                nodes: nodes,
                activeNodeId: activeNodeId,
                enabledPresets: core.defaultEnabledPresets(),
                // На iOS не используется: правила подключаются как remote
                rulesDir: "",
                cachePath: support.appendingPathComponent("cache.db").path,
                clashSecret: "prism"
            ),
            pretty: true
        )
    }

    // MARK: - Хранение

    private func save() {
        guard let data = try? JSONEncoder().encode(nodes) else { return }
        UserDefaults.standard.set(data, forKey: storeKey)
        UserDefaults.standard.set(activeNodeId, forKey: activeKey)
    }

    private func load() {
        guard let data = UserDefaults.standard.data(forKey: storeKey),
              let saved = try? JSONDecoder().decode([ServerNode].self, from: data)
        else { return }
        nodes = saved
        activeNodeId = UserDefaults.standard.string(forKey: activeKey) ?? saved.first?.id
    }
}
