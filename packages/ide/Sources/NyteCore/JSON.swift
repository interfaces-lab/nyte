import Foundation
public enum JSON: Sendable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSON])
    case object([String: JSON])

    public static func parse(_ data: Data) -> JSON? {
        guard let any = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else { return nil }
        return JSON(any)
    }

    private init(_ any: Any) {
        switch any {
        case let value as String: self = .string(value)
        case let value as NSNumber:
            self = CFGetTypeID(value) == CFBooleanGetTypeID() ? .bool(value.boolValue) : .number(value.doubleValue)
        case let value as [Any]: self = .array(value.map(JSON.init))
        case let value as [String: Any]: self = .object(value.mapValues(JSON.init))
        default: self = .null
        }
    }
    public func encoded() -> Data {
        (try? JSONSerialization.data(withJSONObject: foundation, options: [.fragmentsAllowed, .withoutEscapingSlashes]))
            ?? Data("null".utf8)
    }

    private var foundation: Any {
        switch self {
        case .null: NSNull()
        case let .bool(value): value
        case let .number(value):
            value.rounded() == value && abs(value) < 9_007_199_254_740_992 ? NSNumber(value: Int64(value)) : NSNumber(value: value)
        case let .string(value): value
        case let .array(values): values.map(\.foundation)
        case let .object(values): values.mapValues(\.foundation)
        }
    }

    public subscript(key: String) -> JSON? {
        guard case let .object(values) = self else { return nil }
        return values[key]
    }

    public var string: String? { if case let .string(value) = self { value } else { nil } }
    public var number: Double? { if case let .number(value) = self { value } else { nil } }
    public var int: Int? { number.map { Int($0) } }
    public var bool: Bool? { if case let .bool(value) = self { value } else { nil } }
    public var array: [JSON]? { if case let .array(values) = self { values } else { nil } }
    public var object: [String: JSON]? { if case let .object(values) = self { values } else { nil } }
    public var isNull: Bool { self == .null }
    public var kind: String? { self["kind"]?.string }
}

extension JSON: ExpressibleByStringLiteral, ExpressibleByIntegerLiteral, ExpressibleByBooleanLiteral,
    ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral
{
    public init(stringLiteral value: String) { self = .string(value) }
    public init(integerLiteral value: Int) { self = .number(Double(value)) }
    public init(booleanLiteral value: Bool) { self = .bool(value) }
    public init(arrayLiteral elements: JSON...) { self = .array(elements) }
    public init(dictionaryLiteral elements: (String, JSON)...) {
        self = .object(Dictionary(elements, uniquingKeysWith: { _, last in last }))
    }
}
