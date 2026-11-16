import CoreGraphics
import Foundation

public enum Dimension: Equatable, Sendable {
  case hug
  case fill
  case points(CGFloat)
  case percent(CGFloat)
}

public enum Offset: Equatable, Sendable {
  case points(CGFloat)
  case percent(CGFloat)

  func resolve(_ extent: CGFloat?) -> CGFloat {
    switch self {
    case .points(let value): return value
    case .percent(let value): return (extent ?? 0) * value / 100
    }
  }
}

public enum Alignment: String, Sendable {
  case start, center, end, stretch
}

public enum Justify: String, Sendable {
  case start, center, end, between
}

public struct Insets: Equatable, Sendable {
  public var top: CGFloat = 0
  public var right: CGFloat = 0
  public var bottom: CGFloat = 0
  public var left: CGFloat = 0

  public var horizontal: CGFloat { left + right }
  public var vertical: CGFloat { top + bottom }
}

public struct Radii: Equatable, Sendable {
  public var topLeft: CGFloat = 0
  public var topRight: CGFloat = 0
  public var bottomRight: CGFloat = 0
  public var bottomLeft: CGFloat = 0

  public var isZero: Bool { topLeft == 0 && topRight == 0 && bottomRight == 0 && bottomLeft == 0 }
  public var isUniform: Bool {
    topLeft == topRight && topRight == bottomRight && bottomRight == bottomLeft
  }

  func inset(_ by: CGFloat) -> Radii {
    Radii(
      topLeft: max(0, topLeft - by), topRight: max(0, topRight - by),
      bottomRight: max(0, bottomRight - by), bottomLeft: max(0, bottomLeft - by))
  }
}

public struct RGBA: Equatable, Sendable {
  public var red: CGFloat
  public var green: CGFloat
  public var blue: CGFloat
  public var alpha: CGFloat

  public init(red: CGFloat, green: CGFloat, blue: CGFloat, alpha: CGFloat) {
    self.red = red
    self.green = green
    self.blue = blue
    self.alpha = alpha
  }

  public var cgColor: CGColor {
    CGColor(srgbRed: red, green: green, blue: blue, alpha: alpha)
  }

  public var hex: String {
    func byte(_ value: CGFloat) -> Int { Int((min(max(value, 0), 1) * 255).rounded()) }
    let rgb = String(format: "#%02x%02x%02x", byte(red), byte(green), byte(blue))
    return alpha >= 0.999 ? rgb : rgb + String(format: "%02x", byte(alpha))
  }
}

public struct GradientStop: Equatable, Sendable {
  public var color: RGBA
  public var location: CGFloat
}

public enum Paint: Equatable, Sendable {
  case color(RGBA)
  case linear(angle: CGFloat, stops: [GradientStop])
  case radial(center: CGPoint, stops: [GradientStop])
}

extension Paint {
  var isOpaque: Bool {
    switch self {
    case .color(let color): return color.alpha >= 1
    case .linear(_, let stops), .radial(_, let stops): return stops.allSatisfy { $0.color.alpha >= 1 }
    }
  }
}

public struct Shadow: Equatable, Sendable {
  public var x: CGFloat
  public var y: CGFloat
  public var blur: CGFloat
  public var color: RGBA
}

public enum TextAlign: String, Sendable {
  case start, center, end
}

public enum ImageFit: String, Sendable {
  case cover, contain, fill
}

public struct Style: Sendable {
  public var x: Offset?
  public var y: Offset?
  public var width: Dimension = .hug
  public var height: Dimension = .hug
  public var padding = Insets()
  public var gap: CGFloat = 0
  public var align: Alignment = .start
  public var alignVertical: Alignment = .start
  public var justify: Justify = .start
  public var selfAlign: Alignment?
  public var fill: Paint?
  public var stroke: RGBA?
  public var strokeWidth: CGFloat = 1
  public var radii = Radii()
  public var shadows: [Shadow] = []
  public var opacity: CGFloat = 1
  public var clip = false
  public var hidden = false

  public var fontFamily: String?
  public var fontSize: CGFloat = 13
  public var fontWeight: CGFloat = 400
  public var italic = false
  public var color = RGBA(red: 0.17, green: 0.17, blue: 0.17, alpha: 1)
  public var leading: CGFloat?
  public var tracking: CGFloat = 0
  public var textAlign: TextAlign = .start
  public var maxLines: Int?

  public var source: String?
  public var fit: ImageFit = .cover
  public var symbol: String?
  public var symbolSize: CGFloat = 16

  public var isAbsolute: Bool { x != nil || y != nil }
}

extension Style {
  public init(node: Node, scope: Scope, mode: ThemeMode) {
    func raw(_ name: String) -> String? {
      guard let value = node.attributes[name] else { return nil }
      return scope.substitute(value, mode: mode).trimmingCharacters(in: .whitespaces)
    }
    func number(_ name: String) -> CGFloat? {
      raw(name).flatMap(parseNumber)
    }

    if node.kind == .text, let reference = node.attributes["style"], reference.hasPrefix("$"),
      let type = scope.types[String(reference.dropFirst())]
    {
      func typed(_ name: String) -> String? {
        type[name].map { scope.substitute($0, mode: mode) }
      }
      if let family = typed("font") { fontFamily = family }
      if let size = typed("size").flatMap(parseNumber) { fontSize = size }
      if let weight = typed("weight").flatMap(parseNumber) { fontWeight = weight }
      if let value = typed("leading").flatMap(parseNumber) { leading = value }
      if let value = typed("tracking").flatMap(parseNumber) { tracking = value }
      if let value = typed("color").flatMap(parseColor) { color = value }
    }

    x = raw("x").flatMap(parseOffset)
    y = raw("y").flatMap(parseOffset)
    if let value = raw("w").flatMap(parseDimension) { width = value }
    if let value = raw("h").flatMap(parseDimension) { height = value }
    if let value = raw("pad") { padding = parseInsets(value) }
    if let value = number("gap") { gap = value }
    if let value = raw("justify").flatMap(Justify.init(rawValue:)) { justify = value }
    selfAlign = raw("self").flatMap(Alignment.init(rawValue:))

    if let value = raw("align") {
      let parts = value.split(separator: " ").compactMap { Alignment(rawValue: String($0)) }
      if let first = parts.first {
        align = first
        alignVertical = parts.count > 1 ? parts[1] : first
      }
      if node.kind == .text, let text = TextAlign(rawValue: value) { textAlign = text }
    }

    if let value = raw("fill") { fill = parsePaint(value) }
    if let value = raw("stroke") { stroke = parseColor(value) }
    if let value = number("stroke-w") { strokeWidth = value }
    if let value = raw("radius") { radii = parseRadii(value) }
    if let value = raw("shadow") { shadows = parseShadows(value) }
    if let value = number("opacity") { opacity = min(max(value, 0), 1) }
    clip = node.attributes["clip"] != nil && node.attributes["clip"] != "false"
    hidden = node.attributes["hidden"] != nil && node.attributes["hidden"] != "false"

    if let value = raw("font") { fontFamily = value }
    if let value = number("size") {
      fontSize = value
      symbolSize = value
    }
    if let value = number("weight") { fontWeight = value }
    if let value = raw("color").flatMap(parseColor) { color = value }
    if let value = number("leading") { leading = value }
    if let value = number("tracking") { tracking = value }
    if let value = number("lines") { maxLines = max(1, Int(value)) }
    italic = node.attributes["italic"] != nil && node.attributes["italic"] != "false"

    source = raw("src")
    if let value = raw("fit").flatMap(ImageFit.init(rawValue:)) { fit = value }
    symbol = raw("name")
  }
}

private let widestNumber = 100_000.0

func parseNumber(_ value: String) -> CGFloat? {
  guard let number = Double(value.trimmingCharacters(in: .whitespaces)), number.isFinite, abs(number) <= widestNumber
  else { return nil }
  return CGFloat(number)
}

func parseDimension(_ value: String) -> Dimension? {
  switch value {
  case "fill": return .fill
  case "hug": return .hug
  default:
    if value.hasSuffix("%"), let number = parseNumber(String(value.dropLast())) {
      return .percent(number)
    }
    return parseNumber(value).map { .points($0) }
  }
}

func parseOffset(_ value: String) -> Offset? {
  if value.hasSuffix("%"), let number = parseNumber(String(value.dropLast())) {
    return .percent(number)
  }
  return parseNumber(value).map { .points($0) }
}

func parseInsets(_ value: String) -> Insets {
  let parts = value.split(separator: " ").compactMap { parseNumber(String($0)) }
  switch parts.count {
  case 1: return Insets(top: parts[0], right: parts[0], bottom: parts[0], left: parts[0])
  case 2: return Insets(top: parts[0], right: parts[1], bottom: parts[0], left: parts[1])
  case 3: return Insets(top: parts[0], right: parts[1], bottom: parts[2], left: parts[1])
  case 4: return Insets(top: parts[0], right: parts[1], bottom: parts[2], left: parts[3])
  default: return Insets()
  }
}

func parseRadii(_ value: String) -> Radii {
  let parts = value.split(separator: " ").compactMap { parseNumber(String($0)) }
  switch parts.count {
  case 1:
    return Radii(topLeft: parts[0], topRight: parts[0], bottomRight: parts[0], bottomLeft: parts[0])
  case 4:
    return Radii(topLeft: parts[0], topRight: parts[1], bottomRight: parts[2], bottomLeft: parts[3])
  default:
    return Radii()
  }
}

public func parseColor(_ value: String) -> RGBA? {
  let trimmed = value.trimmingCharacters(in: .whitespaces).lowercased()
  switch trimmed {
  case "none", "transparent": return nil
  case "white": return RGBA(red: 1, green: 1, blue: 1, alpha: 1)
  case "black": return RGBA(red: 0, green: 0, blue: 0, alpha: 1)
  default: break
  }
  guard trimmed.hasPrefix("#") else { return nil }
  var hex = String(trimmed.dropFirst())
  if hex.count == 3 || hex.count == 4 { hex = hex.map { "\($0)\($0)" }.joined() }
  guard hex.count == 6 || hex.count == 8, let number = UInt64(hex, radix: 16) else { return nil }
  let hasAlpha = hex.count == 8
  let red = CGFloat((number >> (hasAlpha ? 24 : 16)) & 0xff) / 255
  let green = CGFloat((number >> (hasAlpha ? 16 : 8)) & 0xff) / 255
  let blue = CGFloat((number >> (hasAlpha ? 8 : 0)) & 0xff) / 255
  let alpha = hasAlpha ? CGFloat(number & 0xff) / 255 : 1
  return RGBA(red: red, green: green, blue: blue, alpha: alpha)
}

func parsePaint(_ value: String) -> Paint? {
  if let color = parseColor(value) { return .color(color) }
  guard let open = value.firstIndex(of: "("), value.hasSuffix(")") else { return nil }
  let function = value[..<open].trimmingCharacters(in: .whitespaces)
  let arguments = value[value.index(after: open)..<value.index(before: value.endIndex)]
    .split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }

  var angle: CGFloat = 180
  var center = CGPoint(x: 0.5, y: 0.5)
  var colors: [(RGBA, CGFloat?)] = []
  for argument in arguments {
    if function == "linear", colors.isEmpty, let number = parseNumber(argument) {
      angle = number
      continue
    }
    let words = argument.split(separator: " ").map(String.init)
    if function == "radial", words.first == "at", words.count == 3,
      let x = parseNumber(words[1]), let y = parseNumber(words[2])
    {
      center = CGPoint(x: x, y: y)
      continue
    }
    guard let first = words.first, let color = parseColor(first) else { continue }
    let location = words.count > 1 && words[1].hasSuffix("%")
      ? parseNumber(String(words[1].dropLast())).map { $0 / 100 } : nil
    colors.append((color, location))
  }
  guard colors.count >= 2 else { return colors.first.map { .color($0.0) } }

  let stops = colors.enumerated().map { index, entry in
    GradientStop(
      color: entry.0, location: entry.1 ?? CGFloat(index) / CGFloat(colors.count - 1))
  }
  switch function {
  case "linear": return .linear(angle: angle, stops: stops)
  case "radial": return .radial(center: center, stops: stops)
  default: return nil
  }
}

func parseShadows(_ value: String) -> [Shadow] {
  value.split(separator: ",").compactMap { part in
    let words = part.split(separator: " ").map(String.init)
    guard words.count >= 4, let x = parseNumber(words[0]), let y = parseNumber(words[1]),
      let blur = parseNumber(words[2]), let color = parseColor(words[words.count - 1])
    else { return nil }
    return Shadow(x: x, y: y, blur: blur, color: color)
  }
}

public func formatNumber(_ value: CGFloat) -> String {
  let rounded = (value * 100).rounded() / 100
  if rounded == rounded.rounded() { return String(Int(rounded)) }
  var text = String(format: "%.2f", Double(rounded))
  while text.hasSuffix("0") { text.removeLast() }
  return text
}
