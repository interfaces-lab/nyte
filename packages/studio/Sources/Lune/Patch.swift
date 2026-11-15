import Foundation

/// One replacement of a byte range in a file's source.
public struct TextEdit: Sendable {
  public let span: Span
  public let replacement: String

  public init(span: Span, replacement: String) {
    self.span = span
    self.replacement = replacement
  }
}

extension SyntaxTree {
  /// Sets an attribute by rewriting only its value, or adds it after the last attribute. A nil
  /// value removes the attribute along with the space before it.
  public func setAttribute(_ name: String, to value: String?, at path: [Int]) -> TextEdit? {
    guard let element = element(at: path) else { return nil }
    if let attribute = element.attribute(name) {
      guard let value else {
        var lower = attribute.span.lower
        while lower > 0, bytes[lower - 1] == 0x20 || bytes[lower - 1] == 0x09 { lower -= 1 }
        return TextEdit(span: Span(lower, attribute.span.upper), replacement: "")
      }
      guard let span = attribute.valueSpan else {
        return TextEdit(span: attribute.span, replacement: "\(name)=\"\(encodeLune(value))\"")
      }
      return TextEdit(span: span, replacement: encodeLune(value))
    }
    guard let value else { return nil }
    return TextEdit(
      span: Span(element.attributeInsert, element.attributeInsert),
      replacement: " \(name)=\"\(encodeLune(value))\"")
  }

  /// Replaces an element's text.
  public func setText(_ text: String, at path: [Int]) -> TextEdit? {
    guard let element = element(at: path) else { return nil }
    if let span = element.textSpan { return TextEdit(span: span, replacement: encodeLune(text)) }
    guard let close = element.closeStart else { return nil }
    return TextEdit(span: Span(element.openEnd + 1, close), replacement: encodeLune(text))
  }

  /// Removes an element and the line it leaves empty.
  public func remove(at path: [Int]) -> TextEdit? {
    guard let element = element(at: path) else { return nil }
    var lower = element.span.lower
    var upper = element.span.upper
    while lower > 0, bytes[lower - 1] == 0x20 || bytes[lower - 1] == 0x09 { lower -= 1 }
    if upper < bytes.count, bytes[upper] == 0x0A, lower == 0 || bytes[lower - 1] == 0x0A {
      upper += 1
    } else {
      lower = element.span.lower
    }
    return TextEdit(span: Span(lower, upper), replacement: "")
  }

  /// Appends markup as the last child of an element, indented one step deeper than it.
  public func append(_ markup: String, to path: [Int]) -> TextEdit? {
    guard let element = element(at: path), let close = element.closeStart else { return nil }
    let indent = indentation(before: element.span.lower)
    let lines = markup.split(separator: "\n", omittingEmptySubsequences: false)
      .map { indent + "  " + $0 }.joined(separator: "\n")
    var insert = close
    while insert > 0, bytes[insert - 1] == 0x20 || bytes[insert - 1] == 0x09 { insert -= 1 }
    let onOwnLine = insert > 0 && bytes[insert - 1] == 0x0A
    return TextEdit(
      span: Span(insert, close),
      replacement: (onOwnLine ? "" : "\n") + lines + "\n" + indent)
  }

  /// Appends markup at the end of the file, as a new top-level element.
  public func appendRoot(_ markup: String) -> TextEdit {
    var end = bytes.count
    while end > 0, bytes[end - 1] == 0x0A || bytes[end - 1] == 0x20 { end -= 1 }
    return TextEdit(span: Span(end, bytes.count), replacement: "\n\n" + markup + "\n")
  }

  /// The source text of an element, as written.
  public func markup(at path: [Int]) -> String? {
    guard let element = element(at: path) else { return nil }
    return String(decoding: bytes[element.span.lower..<element.span.upper], as: UTF8.self)
  }

  /// The one-based line an element starts on.
  public func line(at path: [Int]) -> Int? {
    guard let element = element(at: path) else { return nil }
    return bytes[0..<element.span.lower].reduce(1) { $1 == 0x0A ? $0 + 1 : $0 }
  }

  /// Applies edits that don't overlap and returns the new source.
  public func applying(_ edits: [TextEdit]) -> String {
    var out = bytes
    for edit in edits.sorted(by: { $0.span.lower > $1.span.lower }) {
      out.replaceSubrange(edit.span.lower..<edit.span.upper, with: Array(edit.replacement.utf8))
    }
    return String(decoding: out, as: UTF8.self)
  }

  private func indentation(before offset: Int) -> String {
    var start = offset
    while start > 0, bytes[start - 1] != 0x0A { start -= 1 }
    var end = start
    while end < offset, bytes[end] == 0x20 || bytes[end] == 0x09 { end += 1 }
    return String(decoding: bytes[start..<end], as: UTF8.self)
  }
}
