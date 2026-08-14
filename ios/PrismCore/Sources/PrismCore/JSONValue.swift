import Foundation

/// Произвольное значение JSON.
///
/// Нужно там, где форма данных задана не нами, а sing-box: поле `outbound` у узла
/// и целиком собранный конфиг. Описывать их структурами бессмысленно — набор полей
/// зависит от протокола и меняется вместе с версией ядра.
public enum JSONValue: Codable, Hashable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() {
            self = .null
        } else if let v = try? c.decode(Bool.self) {
            self = .bool(v)
        } else if let v = try? c.decode(Double.self) {
            self = .number(v)
        } else if let v = try? c.decode(String.self) {
            self = .string(v)
        } else if let v = try? c.decode([JSONValue].self) {
            self = .array(v)
        } else if let v = try? c.decode([String: JSONValue].self) {
            self = .object(v)
        } else {
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "значение не является JSON")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        }
    }

    // MARK: - Чтение

    public subscript(key: String) -> JSONValue? {
        if case .object(let o) = self { return o[key] }
        return nil
    }

    public subscript(index: Int) -> JSONValue? {
        guard case .array(let a) = self, a.indices.contains(index) else { return nil }
        return a[index]
    }

    public var stringValue: String? {
        if case .string(let v) = self { return v }
        return nil
    }

    public var doubleValue: Double? {
        if case .number(let v) = self { return v }
        return nil
    }

    public var intValue: Int? {
        if case .number(let v) = self { return Int(v) }
        return nil
    }

    public var boolValue: Bool? {
        if case .bool(let v) = self { return v }
        return nil
    }

    public var arrayValue: [JSONValue]? {
        if case .array(let v) = self { return v }
        return nil
    }

    public var objectValue: [String: JSONValue]? {
        if case .object(let v) = self { return v }
        return nil
    }

    /// Возвращает копию, в которой значение по ключу заменено. Для точечной правки
    /// настроек, полная структура которых живёт в TypeScript и сюда не переносится.
    public func setting(_ key: String, to value: JSONValue) -> JSONValue {
        guard case .object(var o) = self else { return self }
        o[key] = value
        return .object(o)
    }
}
