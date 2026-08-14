import Foundation
import JavaScriptCore

/// Мост к общему ядру Prism.
///
/// Разбор ссылок и сборка конфига sing-box живут в src/shared/*.ts и исполняются
/// здесь через JavaScriptCore — тот же код, что и в Windows-версии. Дублировать
/// эту логику на Swift означало бы гарантированный расхождение платформ.
///
/// Обмен идёт строками JSON: JSValue умеет мостить объекты напрямую, но на границе
/// начинаются сюрпризы с числами, `undefined` и словарями, а через JSON поведение
/// предсказуемо и одинаково на iOS и macOS.
///
/// Не потокобезопасен: `JSContext` рассчитан на работу из одного потока.
/// Держите один экземпляр на актор либо синхронизируйте доступ снаружи.
public final class PrismCore {
    public enum Failure: Error, LocalizedError {
        case bundleMissing
        case javascript(String)
        case decoding(String)

        public var errorDescription: String? {
            switch self {
            case .bundleMissing:
                return "shared.js не найден в ресурсах PrismCore — собери его: node scripts/build-shared-js.mjs"
            case .javascript(let message):
                return "ошибка в общем ядре: \(message)"
            case .decoding(let message):
                return "не удалось разобрать ответ общего ядра: \(message)"
            }
        }
    }

    private let context: JSContext
    private let callFunction: JSValue
    private let readConstant: JSValue
    /// Последнее исключение JS: JSContext сообщает о них колбэком, а не возвратом.
    private var lastException: String?

    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init() throws {
        guard let url = Bundle.module.url(forResource: "shared", withExtension: "js"),
              let source = try? String(contentsOf: url, encoding: .utf8)
        else {
            throw Failure.bundleMissing
        }

        guard let context = JSContext() else {
            throw Failure.javascript("не удалось создать JSContext")
        }
        self.context = context

        // Ссылку на self в обработчике брать нельзя — он ставится до полной
        // инициализации, поэтому исключение складывается в отдельную коробку.
        let trap = ExceptionTrap()
        context.exceptionHandler = { _, value in
            trap.message = value?.toString() ?? "неизвестная ошибка JS"
        }

        context.evaluateScript(source, withSourceURL: url)
        if let message = trap.message {
            throw Failure.javascript("загрузка shared.js: \(message)")
        }
        guard context.objectForKeyedSubscript("PrismShared")?.isObject == true else {
            throw Failure.javascript("shared.js загрузился, но не определил PrismShared")
        }

        // Результат всегда заворачивается в массив: JSON верхнего уровня обязан быть
        // массивом или объектом, иначе строковый ответ вроде nodeKey не разберётся.
        let caller = context.evaluateScript(
            """
            (function (name, argsJSON) {
              var fn = PrismShared[name];
              if (typeof fn !== 'function') throw new Error('в общем ядре нет функции ' + name);
              var out = fn.apply(null, JSON.parse(argsJSON));
              return JSON.stringify([out === undefined ? null : out]);
            })
            """
        )
        let reader = context.evaluateScript(
            """
            (function (name) {
              var v = PrismShared[name];
              return JSON.stringify([v === undefined ? null : v]);
            })
            """
        )
        guard let caller, let reader, caller.isObject, reader.isObject else {
            throw Failure.javascript("не удалось подготовить точки входа в общее ядро")
        }
        self.callFunction = caller
        self.readConstant = reader

        self.trap = trap
    }

    private let trap: ExceptionTrap

    /// Коробка под сообщение об исключении — нужна, чтобы обработчик не удерживал self.
    private final class ExceptionTrap {
        var message: String?
    }

    // MARK: - Вызовы общего ядра

    private func invoke(_ expression: () -> JSValue?) throws -> Data {
        trap.message = nil
        guard let result = expression(), trap.message == nil else {
            throw Failure.javascript(trap.message ?? "вызов не вернул значения")
        }
        guard let text = result.toString(), let data = text.data(using: .utf8) else {
            throw Failure.decoding("ответ не является строкой UTF-8")
        }
        return data
    }

    private func unwrap<T: Decodable>(_ data: Data, as type: T.Type) throws -> T {
        do {
            let boxed = try decoder.decode([T].self, from: data)
            guard let value = boxed.first else {
                throw Failure.decoding("пустой ответ")
            }
            return value
        } catch let error as Failure {
            throw error
        } catch {
            throw Failure.decoding(String(describing: error))
        }
    }

    /// Вызывает функцию общего ядра. Аргументы сериализуются в JSON-массив.
    private func call<T: Decodable>(_ name: String, arguments: [AnyEncodable], as type: T.Type) throws -> T {
        let argsJSON: String
        do {
            argsJSON = String(decoding: try encoder.encode(arguments), as: UTF8.self)
        } catch {
            throw Failure.decoding("не удалось сериализовать аргументы \(name): \(error)")
        }
        let data = try invoke { callFunction.call(withArguments: [name, argsJSON]) }
        return try unwrap(data, as: type)
    }

    /// Читает константу общего ядра — DEFAULT_SETTINGS, PRESETS и подобные.
    private func constant<T: Decodable>(_ name: String, as type: T.Type) throws -> T {
        let data = try invoke { readConstant.call(withArguments: [name]) }
        return try unwrap(data, as: type)
    }

    // MARK: - Публичный API

    /// Разбирает ссылку подписки в узел. `nil` — формат не распознан.
    ///
    /// `id` и `createdAt` задаются явно, чтобы результат был воспроизводимым:
    /// само ядро подставляет случайный идентификатор и текущее время.
    public func node(fromLink link: String, id: String? = nil, createdAt: Date? = nil) throws -> ServerNode? {
        let parsed = try call("parseLink", arguments: [AnyEncodable(link)], as: JSONValue.self)
        if case .null = parsed { return nil }

        var extra: [String: JSONValue] = ["link": .string(link)]
        if let id { extra["id"] = .string(id) }
        if let createdAt { extra["createdAt"] = .number(createdAt.timeIntervalSince1970 * 1000) }

        return try call(
            "parsedToNode",
            arguments: [AnyEncodable(parsed), AnyEncodable(JSONValue.object(extra))],
            as: ServerNode.self
        )
    }

    /// Разбирает многострочный список ссылок, пропуская нераспознанные.
    public func nodes(fromLinks text: String) throws -> [ServerNode] {
        try text
            .split(whereSeparator: \.isNewline)
            .map(String.init)
            .compactMap { try node(fromLink: $0.trimmingCharacters(in: .whitespaces)) }
    }

    /// Разбирает тело подписки. Понимает список ссылок, его же в base64 и конфиг
    /// sing-box — тем же кодом, что и Windows-версия.
    ///
    /// Clash YAML на iOS пропускается: разбор YAML требует стороннего пакета,
    /// которого в JavaScriptCore нет. Такая подписка вернёт пустой список.
    public func nodes(fromSubscription body: String, subscriptionId: String? = nil) throws -> [ServerNode] {
        try call(
            "parseSubscriptionBody",
            arguments: [AnyEncodable(body), AnyEncodable(subscriptionId)],
            as: [ServerNode].self
        )
    }

    /// Ключ узла для отсева дублей при обновлении подписки.
    public func key(for node: ServerNode) throws -> String {
        try call("nodeKey", arguments: [AnyEncodable(node)], as: String.self)
    }

    /// Настройки по умолчанию. Структура остаётся на стороне общего ядра —
    /// так добавление настройки не требует правки Swift.
    public func defaultSettings() throws -> JSONValue {
        try constant("DEFAULT_SETTINGS", as: JSONValue.self)
    }

    /// Идентификаторы пресетов маршрутизации, включённых по умолчанию.
    public func defaultEnabledPresets() throws -> [String] {
        try constant("DEFAULT_ENABLED_PRESETS", as: [String].self)
    }

    /// Полный список пресетов маршрутизации — для экрана настроек.
    public func presets() throws -> JSONValue {
        try constant("PRESETS", as: JSONValue.self)
    }

    /// Собирает конфиг sing-box.
    public func buildConfig(_ context: BuildContext) throws -> JSONValue {
        try call("buildConfig", arguments: [AnyEncodable(context)], as: JSONValue.self)
    }

    /// Конфиг в виде JSON-текста — в таком виде его принимает ядро sing-box.
    public func configJSON(_ context: BuildContext, pretty: Bool = false) throws -> String {
        let config = try buildConfig(context)
        let encoder = JSONEncoder()
        encoder.outputFormatting = pretty ? [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes] : [.withoutEscapingSlashes]
        guard let data = try? encoder.encode(config) else {
            throw Failure.decoding("конфиг не сериализуется обратно в JSON")
        }
        return String(decoding: data, as: UTF8.self)
    }
}

/// Стирание типа для разнородных аргументов одного вызова.
struct AnyEncodable: Encodable {
    private let encodeValue: (Encoder) throws -> Void

    init<T: Encodable>(_ value: T) {
        encodeValue = { encoder in try value.encode(to: encoder) }
    }

    func encode(to encoder: Encoder) throws {
        try encodeValue(encoder)
    }
}
