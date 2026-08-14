import XCTest
@testable import PrismCore

/// Проверки моста к общему ядру.
///
/// Сама логика разбора и сборки уже покрыта scripts/check-platforms.mjs на стороне
/// JavaScript, и дублировать её здесь незачем. Эти тесты про границу: что бандл
/// поднимается в JavaScriptCore, что аргументы доезжают в нужном виде и что ответ
/// раскладывается в Swift-типы, а ошибки не теряются по дороге.
final class PrismCoreTests: XCTestCase {
    private var core: PrismCore!

    override func setUpWithError() throws {
        core = try PrismCore()
    }

    // MARK: - Загрузка бандла

    func testBundleLoadsAndExposesDefaults() throws {
        let settings = try core.defaultSettings()
        XCTAssertNotNil(settings.objectValue, "DEFAULT_SETTINGS должен быть объектом")
        XCTAssertNotNil(settings["dns"], "в настройках нет секции dns")
        XCTAssertNotNil(settings["tun"], "в настройках нет секции tun")

        XCTAssertFalse(try core.defaultEnabledPresets().isEmpty, "список включённых пресетов пуст")
        XCTAssertNotNil(try core.presets().arrayValue, "PRESETS должен быть массивом")
    }

    // MARK: - Разбор ссылок

    func testParsesLinksByProtocol() throws {
        let cases: [(link: String, type: String, name: String)] = [
            (
                "vless://11111111-2222-3333-4444-555555555555@example.com:443?encryption=none&security=reality&sni=www.microsoft.com&fp=chrome&pbk=VXFVG7CC-NQrdWhsTwvc830w5RpYGbFXb_4tgNTB2Dg&sid=a1b2&type=tcp&flow=xtls-rprx-vision#Reality",
                "vless", "Reality"
            ),
            (
                "trojan://hunter2@example.com:443?security=tls&sni=example.com&type=grpc&serviceName=grpcsvc#Trojan",
                "trojan", "Trojan"
            ),
            ("ss://YWVzLTI1Ni1nY206aHVudGVyMg==@example.com:8388#SS", "shadowsocks", "SS"),
            ("hysteria2://hunter2@example.com:443?sni=example.com#HY2", "hysteria2", "HY2"),
            (
                "tuic://11111111-2222-3333-4444-555555555555:hunter2@example.com:443?sni=example.com&congestion_control=bbr#TUIC",
                "tuic", "TUIC"
            )
        ]

        for c in cases {
            let node = try XCTUnwrap(core.node(fromLink: c.link, id: "n1"), "не разобралось: \(c.link)")
            XCTAssertEqual(node.type, c.type)
            XCTAssertEqual(node.name, c.name)
            XCTAssertEqual(node.server, "example.com")
            XCTAssertEqual(node.id, "n1", "переданный id должен побеждать сгенерированный ядром")
            XCTAssertNotNil(node.outbound.objectValue, "outbound должен быть объектом")
            XCTAssertEqual(node.link, c.link, "исходная ссылка должна сохраняться")
        }
    }

    /// vmess приезжает как base64-json, поэтому разом проверяет полифилы atob
    /// и TextDecoder: без них в JavaScriptCore ссылка не разберётся вовсе.
    func testParsesVmessThroughPolyfills() throws {
        let link = "vmess://eyJ2IjoiMiIsInBzIjoiVk1lc3MgV1MiLCJhZGQiOiJleGFtcGxlLmNvbSIsInBvcnQiOiI0NDMiLCJpZCI6IjExMTExMTExLTIyMjItMzMzMy00NDQ0LTU1NTU1NTU1NTU1NSIsImFpZCI6IjAiLCJzY3kiOiJhdXRvIiwibmV0Ijoid3MiLCJ0eXBlIjoibm9uZSIsImhvc3QiOiJjZG4uZXhhbXBsZS5jb20iLCJwYXRoIjoiL3ZtIiwidGxzIjoidGxzIn0="
        let node = try XCTUnwrap(core.node(fromLink: link))
        XCTAssertEqual(node.type, "vmess")
        XCTAssertEqual(node.name, "VMess WS")
        XCTAssertEqual(node.port, 443)
    }

    /// Ссылка из настоящей подписки: путь «/» перед параметрами, значение spx
    /// в процентном кодировании и параметр pqv длиной больше двух килобайт.
    /// Ключи здесь выдуманные, а форма — как у живого провайдера, и именно она
    /// однажды вызвала подозрение, что разбор ломается на длинных ссылках.
    func testLongRealisticVlessLink() throws {
        let pqv = String(repeating: "LxCZS94qnhXkRc-vWEF5F9F2IOSMCG7fxAZ2jpsuDMG8YsT4lYZSM2BvYab04mQ9_", count: 40)
        let link = "vless://11111111-2222-3333-4444-555555555555@vpn.example.com:14800/"
            + "?type=tcp&security=reality&pbk=DKhJtzO39r6K4v5R075aTNKGaCiuZ9tXK-jMBzxPDwI"
            + "&fp=chrome&sni=google.com&sid=4db5cb5e7278&spx=%2F&pqv=\(pqv)#Длинная"

        XCTAssertGreaterThan(link.count, 2500, "проверка теряет смысл на короткой ссылке")

        let node = try XCTUnwrap(core.node(fromLink: link), "длинная ссылка не разобралась")
        XCTAssertEqual(node.type, "vless")
        XCTAssertEqual(node.server, "vpn.example.com")
        XCTAssertEqual(node.port, 14800)
        XCTAssertEqual(node.name, "Длинная", "имя из фрагмента должно декодироваться")
        XCTAssertEqual(try core.nodes(fromLinks: link).count, 1, "та же ссылка списком")
    }

    func testUnparseableLinkReturnsNil() throws {
        XCTAssertNil(try core.node(fromLink: "просто текст"))
        XCTAssertNil(try core.node(fromLink: ""))
    }

    func testLinkListSkipsGarbage() throws {
        let text = """
            trojan://hunter2@example.com:443?security=tls&sni=example.com#Один
            это не ссылка

            ss://YWVzLTI1Ni1nY206aHVudGVyMg==@example.com:8388#Два
            """
        XCTAssertEqual(try core.nodes(fromLinks: text).map(\.name), ["Один", "Два"])
    }

    func testNodeKeyIgnoresName() throws {
        let a = try XCTUnwrap(core.node(fromLink: "trojan://hunter2@example.com:443?security=tls#Первое"))
        var b = a
        b.name = "Переименовали"
        b.id = "другой-идентификатор"
        XCTAssertEqual(
            try core.key(for: a), try core.key(for: b),
            "ключ должен зависеть от адреса и секрета, иначе переименование узла в подписке создаст дубль"
        )
    }

    // MARK: - Сборка конфига

    private func context(platform: ConfigPlatform?, nodes: [ServerNode]) throws -> BuildContext {
        BuildContext(
            settings: try core.defaultSettings(),
            platform: platform,
            nodes: nodes,
            activeNodeId: nodes.first?.id,
            enabledPresets: try core.defaultEnabledPresets(),
            rulesDir: "/tmp/rules",
            cachePath: "/tmp/cache.db",
            clashSecret: "secret"
        )
    }

    private func sampleNode() throws -> ServerNode {
        try XCTUnwrap(core.node(
            fromLink: "trojan://hunter2@example.com:443?security=tls&sni=example.com#Узел",
            id: "n0"
        ))
    }

    func testBuildsUsableConfig() throws {
        let config = try core.buildConfig(context(platform: nil, nodes: [try sampleNode()]))

        XCTAssertNotNil(config["dns"])
        XCTAssertNotNil(config["route"])
        let outbounds = try XCTUnwrap(config["outbounds"]?.arrayValue)
        XCTAssertTrue(outbounds.contains { $0["tag"]?.stringValue == "proxy" }, "нет селектора proxy")
        XCTAssertTrue(outbounds.contains { $0["tag"]?.stringValue == "Узел" }, "узел не попал в outbounds")
    }

    /// Платформа доезжает до общего ядра — то есть enum действительно
    /// сериализуется в строку, которую ждёт TypeScript.
    func testIosBranchDiffersAsExpected() throws {
        let node = try sampleNode()
        let win = try core.buildConfig(context(platform: .windows, nodes: [node]))
        let ios = try core.buildConfig(context(platform: .ios, nodes: [node]))

        let winTun = try XCTUnwrap(win["inbounds"]?.arrayValue?.first { $0["type"]?.stringValue == "tun" })
        let iosTun = try XCTUnwrap(ios["inbounds"]?.arrayValue?.first { $0["type"]?.stringValue == "tun" })
        XCTAssertNotNil(winTun["strict_route"], "на Windows strict_route должен остаться")
        XCTAssertNil(iosTun["strict_route"], "на iOS strict_route должен исчезнуть")

        let winSets = try XCTUnwrap(win["route"]?["rule_set"]?.arrayValue)
        let iosSets = try XCTUnwrap(ios["route"]?["rule_set"]?.arrayValue)
        XCTAssertFalse(iosSets.isEmpty, "правила маршрутизации потерялись")
        XCTAssertTrue(winSets.allSatisfy { $0["type"]?.stringValue == "local" })
        XCTAssertTrue(iosSets.allSatisfy { $0["type"]?.stringValue == "remote" })
        XCTAssertTrue(
            iosSets.allSatisfy { $0["url"]?.stringValue?.hasPrefix("https://") == true },
            "у удалённого правила должен быть адрес"
        )
        XCTAssertEqual(
            winSets.compactMap { $0["tag"]?.stringValue },
            iosSets.compactMap { $0["tag"]?.stringValue },
            "набор правил на платформах должен совпадать — меняется только способ подключения"
        )
    }

    func testConfigSerializesToJSON() throws {
        let text = try core.configJSON(context(platform: .ios, nodes: [try sampleNode()]), pretty: true)
        XCTAssertFalse(text.isEmpty)

        // Ядро sing-box принимает именно текст, поэтому важно, что он читается обратно
        let data = try XCTUnwrap(text.data(using: .utf8))
        let back = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertNotNil(back?["outbounds"])
        XCTAssertFalse(text.contains("\\/"), "слэши не должны экранироваться — адреса правил читают глазами")
    }

    // MARK: - Ошибки

    func testCoreErrorBecomesSwiftError() throws {
        // nodeKey читает поля outbound; null вместо объекта роняет ядро с TypeError,
        // и эта ошибка обязана долететь до Swift, а не превратиться в пустой ключ
        let broken = ServerNode(
            id: "x", name: "x", type: "vless", server: "a", port: 1,
            outbound: .null, createdAt: 0
        )
        XCTAssertThrowsError(try core.key(for: broken)) { error in
            XCTAssertTrue(error is PrismCore.Failure, "ожидалась PrismCore.Failure, получено \(error)")
        }
    }
}
