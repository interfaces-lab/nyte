import Foundation

/// A half-open range of UTF-8 byte offsets in a file's source.
public struct Span: Hashable, Sendable {
  public var lower: Int
  public var upper: Int

  public init(_ lower: Int, _ upper: Int) {
    self.lower = lower
    self.upper = upper
  }
}

public struct SyntaxAttribute: Sendable {
  public let name: String
  /// The decoded value, or nil for a bare attribute such as `clip`.
  public let value: String?
  /// From the first byte of the name through the closing quote.
  public let span: Span
  /// The bytes between the quotes.
  public let valueSpan: Span?
}

public enum SyntaxNode: Sendable {
  case element(SyntaxElement)
  case text(String, Span)
}

public final class SyntaxElement: Sendable {
  public let tag: String
  public let attributes: [SyntaxAttribute]
  public let children: [SyntaxNode]
  /// From `<` of the opening tag through `>` of the closing one.
  public let span: Span
  /// Where a new attribute is inserted: just after the last attribute, or after the tag name.
  public let attributeInsert: Int
  /// The offset of the `>` or `/>` that ends the opening tag.
  public let openEnd: Int
  /// The offset of `</`, or nil when the element closes itself.
  public let closeStart: Int?

  init(
    tag: String,
    attributes: [SyntaxAttribute],
    children: [SyntaxNode],
    span: Span,
    attributeInsert: Int,
    openEnd: Int,
    closeStart: Int?
  ) {
    self.tag = tag
    self.attributes = attributes
    self.children = children
    self.span = span
    self.attributeInsert = attributeInsert
    self.openEnd = openEnd
    self.closeStart = closeStart
  }

  public var elements: [SyntaxElement] {
    children.compactMap { node in
      if case .element(let element) = node { return element }
      return nil
    }
  }

  public func attribute(_ name: String) -> SyntaxAttribute? {
    attributes.first { $0.name == name }
  }

  public func value(_ name: String) -> String? {
    attribute(name)?.value
  }

  /// The element's text: its text children joined, with `<br/>` as a line break.
  public var text: String {
    var out = ""
    for child in children {
      switch child {
      case .text(let string, _): out += string
      case .element(let element): if element.tag == "br" { out += "\n" }
      }
    }
    return out
  }

  /// The span of the first text child, where an edit of the text lands.
  public var textSpan: Span? {
    for child in children {
      if case .text(_, let span) = child { return span }
    }
    return nil
  }
}

public struct Diagnostic: Error, Sendable, CustomStringConvertible {
  public let message: String
  public let offset: Int
  public let line: Int
  public let column: Int

  public var description: String { "\(line):\(column) \(message)" }
}

public struct SyntaxTree: Sendable {
  public let bytes: [UInt8]
  public let roots: [SyntaxElement]

  public var source: String { String(decoding: bytes, as: UTF8.self) }

  /// The element at an index path that counts element children only.
  public func element(at path: [Int]) -> SyntaxElement? {
    guard let first = path.first, roots.indices.contains(first) else { return nil }
    var current = roots[first]
    for index in path.dropFirst() {
      let elements = current.elements
      guard elements.indices.contains(index) else { return nil }
      current = elements[index]
    }
    return current
  }
}

/// Parses Lune markup. The grammar is the tag-and-attribute subset of XML: elements, quoted
/// attributes, bare attributes, text, comments and the five named entities.
public func parseLune(_ source: String) throws -> SyntaxTree {
  var parser = Parser(bytes: Array(source.utf8))
  let roots = try parser.parseDocument()
  return SyntaxTree(bytes: parser.bytes, roots: roots)
}

private struct Parser {
  let bytes: [UInt8]
  var index = 0

  init(bytes: [UInt8]) {
    self.bytes = bytes
  }

  mutating func parseDocument() throws -> [SyntaxElement] {
    var roots: [SyntaxElement] = []
    while true {
      try skipTrivia()
      guard index < bytes.count else { return roots }
      guard bytes[index] == UInt8(ascii: "<") else {
        throw fail("Text can't sit outside an element. Wrap it in <text>.")
      }
      roots.append(try parseElement())
    }
  }

  private mutating func parseElement() throws -> SyntaxElement {
    let start = index
    index += 1
    let tag = try parseName(what: "a tag name")
    var attributes: [SyntaxAttribute] = []
    var insert = index

    while true {
      skipWhitespace()
      guard index < bytes.count else { throw fail("<\(tag)> is never closed.", at: start) }
      let byte = bytes[index]

      if byte == UInt8(ascii: "/") {
        guard peek(1) == UInt8(ascii: ">") else { throw fail("Expected /> to close <\(tag)>.") }
        let openEnd = index
        index += 2
        return SyntaxElement(
          tag: tag, attributes: attributes, children: [], span: Span(start, index),
          attributeInsert: insert, openEnd: openEnd, closeStart: nil)
      }

      if byte == UInt8(ascii: ">") {
        let openEnd = index
        index += 1
        let children = try parseChildren(of: tag, openedAt: start)
        let closeStart = index
        index += 2
        let closing = try parseName(what: "a closing tag name")
        guard closing == tag else {
          throw fail("</\(closing)> closes nothing. <\(tag)> is still open.", at: closeStart)
        }
        skipWhitespace()
        guard index < bytes.count, bytes[index] == UInt8(ascii: ">") else {
          throw fail("Expected > after </\(tag).")
        }
        index += 1
        return SyntaxElement(
          tag: tag, attributes: attributes, children: children, span: Span(start, index),
          attributeInsert: insert, openEnd: openEnd, closeStart: closeStart)
      }

      let attribute = try parseAttribute()
      guard !attributes.contains(where: { $0.name == attribute.name }) else {
        throw fail("<\(tag)> sets \(attribute.name) twice.", at: attribute.span.lower)
      }
      attributes.append(attribute)
      insert = index
    }
  }

  private mutating func parseChildren(of tag: String, openedAt start: Int) throws -> [SyntaxNode] {
    var children: [SyntaxNode] = []
    while true {
      guard index < bytes.count else { throw fail("<\(tag)> is never closed.", at: start) }

      if bytes[index] == UInt8(ascii: "<") {
        if peek(1) == UInt8(ascii: "/") { return children }
        if try skipComment() { continue }
        children.append(.element(try parseElement()))
        continue
      }

      let textStart = index
      while index < bytes.count, bytes[index] != UInt8(ascii: "<") { index += 1 }
      var lower = textStart
      var upper = index
      while lower < upper, isWhitespace(bytes[lower]) { lower += 1 }
      while upper > lower, isWhitespace(bytes[upper - 1]) { upper -= 1 }
      guard lower < upper else { continue }
      children.append(.text(collapse(decode(Array(bytes[lower..<upper]))), Span(lower, upper)))
    }
  }

  private mutating func parseAttribute() throws -> SyntaxAttribute {
    let start = index
    let name = try parseName(what: "an attribute name")
    let afterName = index
    skipWhitespace()
    guard index < bytes.count, bytes[index] == UInt8(ascii: "=") else {
      index = afterName
      return SyntaxAttribute(name: name, value: nil, span: Span(start, afterName), valueSpan: nil)
    }
    index += 1
    skipWhitespace()
    guard index < bytes.count else { throw fail("\(name)= has no value.") }
    let quote = bytes[index]
    guard quote == UInt8(ascii: "\"") || quote == UInt8(ascii: "'") else {
      throw fail("Put the value of \(name) in quotes.")
    }
    index += 1
    let valueStart = index
    while index < bytes.count, bytes[index] != quote {
      guard bytes[index] != UInt8(ascii: "<") else {
        throw fail("The value of \(name) is missing its closing quote.", at: valueStart - 1)
      }
      index += 1
    }
    guard index < bytes.count else {
      throw fail("The value of \(name) is missing its closing quote.", at: valueStart - 1)
    }
    let valueEnd = index
    index += 1
    return SyntaxAttribute(
      name: name, value: decode(Array(bytes[valueStart..<valueEnd])), span: Span(start, index),
      valueSpan: Span(valueStart, valueEnd))
  }

  private mutating func parseName(what: String) throws -> String {
    let start = index
    while index < bytes.count, isNameByte(bytes[index], first: index == start) { index += 1 }
    guard index > start else { throw fail("Expected \(what).") }
    return String(decoding: bytes[start..<index], as: UTF8.self)
  }

  private mutating func skipTrivia() throws {
    while true {
      skipWhitespace()
      guard try skipComment() else { return }
    }
  }

  private mutating func skipComment() throws -> Bool {
    guard matches("<!--") else { return false }
    let start = index
    index += 4
    while index < bytes.count, !matches("-->") { index += 1 }
    guard index < bytes.count else { throw fail("This comment is never closed.", at: start) }
    index += 3
    return true
  }

  private mutating func skipWhitespace() {
    while index < bytes.count, isWhitespace(bytes[index]) { index += 1 }
  }

  private func matches(_ literal: StaticString) -> Bool {
    let count = literal.utf8CodeUnitCount
    guard index + count <= bytes.count else { return false }
    return literal.withUTF8Buffer { buffer in
      for offset in 0..<count where bytes[index + offset] != buffer[offset] { return false }
      return true
    }
  }

  private func peek(_ ahead: Int) -> UInt8? {
    index + ahead < bytes.count ? bytes[index + ahead] : nil
  }

  private func fail(_ message: String, at offset: Int? = nil) -> Diagnostic {
    let position = min(offset ?? index, bytes.count)
    var line = 1
    var column = 1
    for byte in bytes[0..<position] {
      if byte == UInt8(ascii: "\n") {
        line += 1
        column = 1
      } else {
        column += 1
      }
    }
    return Diagnostic(message: message, offset: position, line: line, column: column)
  }
}

private func isWhitespace(_ byte: UInt8) -> Bool {
  byte == 0x20 || byte == 0x0A || byte == 0x0D || byte == 0x09
}

private func isNameByte(_ byte: UInt8, first: Bool) -> Bool {
  switch byte {
  case UInt8(ascii: "a")...UInt8(ascii: "z"), UInt8(ascii: "A")...UInt8(ascii: "Z"), UInt8(ascii: "_"):
    return true
  case UInt8(ascii: "0")...UInt8(ascii: "9"), UInt8(ascii: "-"), UInt8(ascii: "."):
    return !first
  default:
    return false
  }
}

private let entities: [(String, String)] = [
  ("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&apos;", "'"), ("&amp;", "&"),
]

private func decode(_ bytes: [UInt8]) -> String {
  var string = String(decoding: bytes, as: UTF8.self)
  guard string.contains("&") else { return string }
  for (entity, character) in entities {
    string = string.replacingOccurrences(of: entity, with: character)
  }
  return string
}

/// Encodes text for an attribute value or element content.
public func encodeLune(_ string: String) -> String {
  var out = string.replacingOccurrences(of: "&", with: "&amp;")
  out = out.replacingOccurrences(of: "<", with: "&lt;")
  out = out.replacingOccurrences(of: "\"", with: "&quot;")
  return out
}

private func collapse(_ string: String) -> String {
  string.split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\t" || $0 == "\r" })
    .joined(separator: " ")
}
