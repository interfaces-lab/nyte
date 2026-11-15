import Foundation

/// A JSON value. The host's rows are open-ended (plugins add part kinds, releases add fields), so
/// a client reads what it needs by key and carries the rest untouched.
public enum JSON: Sendable, Hashable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSON])
  case object([String: JSON])

  public subscript(key: String) -> JSON {
    if case .object(let object) = self { return object[key] ?? .null }
    return .null
  }

  public subscript(index: Int) -> JSON {
    if case .array(let array) = self, array.indices.contains(index) { return array[index] }
    return .null
  }

  public var string: String? {
    if case .string(let value) = self { return value }
    return nil
  }

  public var double: Double? {
    if case .number(let value) = self { return value }
    return nil
  }

  public var int: Int? { double.map { Int($0) } }

  public var bool: Bool? {
    if case .bool(let value) = self { return value }
    return nil
  }

  public var array: [JSON] {
    if case .array(let value) = self { return value }
    return []
  }

  public var object: [String: JSON] {
    if case .object(let value) = self { return value }
    return [:]
  }

  public var isNull: Bool { self == .null }

  public static func parse(_ data: Data) throws -> JSON {
    JSON(any: try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]))
  }

  public func data() -> Data {
    (try? JSONSerialization.data(withJSONObject: any, options: [.fragmentsAllowed, .withoutEscapingSlashes]))
      ?? Data("null".utf8)
  }

  private init(any: Any) {
    switch any {
    case let value as NSNumber:
      self = CFGetTypeID(value) == CFBooleanGetTypeID() ? .bool(value.boolValue) : .number(value.doubleValue)
    case let value as String:
      self = .string(value)
    case let value as [Any]:
      self = .array(value.map(JSON.init(any:)))
    case let value as [String: Any]:
      self = .object(value.mapValues(JSON.init(any:)))
    default:
      self = .null
    }
  }

  private var any: Any {
    switch self {
    case .null: return NSNull()
    case .bool(let value): return value
    case .number(let value):
      return value == value.rounded() && abs(value) < 1e15 ? NSNumber(value: Int64(value)) : NSNumber(value: value)
    case .string(let value): return value
    case .array(let value): return value.map(\.any)
    case .object(let value): return value.mapValues(\.any)
    }
  }
}

extension JSON: ExpressibleByNilLiteral, ExpressibleByBooleanLiteral, ExpressibleByIntegerLiteral,
  ExpressibleByFloatLiteral, ExpressibleByStringLiteral, ExpressibleByArrayLiteral,
  ExpressibleByDictionaryLiteral
{
  public init(nilLiteral: ()) { self = .null }
  public init(booleanLiteral value: Bool) { self = .bool(value) }
  public init(integerLiteral value: Int) { self = .number(Double(value)) }
  public init(floatLiteral value: Double) { self = .number(value) }
  public init(stringLiteral value: String) { self = .string(value) }
  public init(arrayLiteral elements: JSON...) { self = .array(elements) }
  public init(dictionaryLiteral elements: (String, JSON)...) {
    self = .object(Dictionary(elements, uniquingKeysWith: { _, new in new }))
  }
}
