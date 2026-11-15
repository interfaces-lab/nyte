import Foundation

/// Names one element in one file by its index path among element children.
public struct ElementRef: Hashable, Sendable {
  public var file: String
  public var path: [Int]

  public init(file: String, path: [Int]) {
    self.file = file
    self.path = path
  }
}

public enum ThemeMode: String, Sendable {
  case light
  case dark
}

public struct ComponentDeclaration: Sendable {
  public let name: String
  public let file: String
  public let path: [Int]
  public let element: SyntaxElement

  /// The declared props and their defaults: every attribute of `<component>` except `name`.
  public var defaults: [String: String] {
    var out: [String: String] = [:]
    for attribute in element.attributes where attribute.name != "name" {
      out[attribute.name] = attribute.value ?? ""
    }
    return out
  }
}

/// What a file can name: its own tokens and components, and those of every file it uses.
public struct Scope: Sendable {
  public var colors: [String: (light: String, dark: String?)] = [:]
  public var numbers: [String: String] = [:]
  public var types: [String: [String: String]] = [:]
  public var components: [String: ComponentDeclaration] = [:]

  mutating func merge(_ other: Scope) {
    colors.merge(other.colors) { _, new in new }
    numbers.merge(other.numbers) { _, new in new }
    types.merge(other.types) { _, new in new }
    components.merge(other.components) { _, new in new }
  }

  /// Replaces every `$token` in a value with what it stands for in a theme mode.
  public func substitute(_ value: String, mode: ThemeMode, depth: Int = 0) -> String {
    guard depth < 8, value.contains("$") else { return value }
    var out = ""
    var rest = Substring(value)
    while let dollar = rest.firstIndex(of: "$") {
      out += rest[..<dollar]
      var end = rest.index(after: dollar)
      var lastValid = end
      while end < rest.endIndex {
        let character = rest[end]
        if character.isLetter || character.isNumber || character == "_" || character == "-" {
          end = rest.index(after: end)
          lastValid = end
        } else if character == ".", rest.index(after: end) < rest.endIndex,
          rest[rest.index(after: end)].isLetter
        {
          end = rest.index(after: end)
        } else {
          break
        }
      }
      let name = String(rest[rest.index(after: dollar)..<lastValid])
      if let color = colors[name] {
        let raw = mode == .dark ? (color.dark ?? color.light) : color.light
        out += substitute(raw, mode: mode, depth: depth + 1)
      } else if let number = numbers[name] {
        out += substitute(number, mode: mode, depth: depth + 1)
      } else {
        out += "$" + name
      }
      rest = rest[lastValid...]
    }
    out += rest
    return out
  }
}

public struct ProjectFile: Sendable {
  public let path: String
  public let source: String
  public let tree: SyntaxTree?
  public let error: Diagnostic?
}

/// A set of Lune files that use each other, keyed by path relative to the project root.
public struct Project: Sendable {
  public private(set) var files: [String: ProjectFile] = [:]

  public init() {}

  public mutating func set(_ path: String, source: String) {
    do {
      files[path] = ProjectFile(path: path, source: source, tree: try parseLune(source), error: nil)
    } catch let diagnostic as Diagnostic {
      files[path] = ProjectFile(path: path, source: source, tree: nil, error: diagnostic)
    } catch {
      files[path] = ProjectFile(path: path, source: source, tree: nil, error: nil)
    }
  }

  public mutating func remove(_ path: String) {
    files[path] = nil
  }

  /// The files a file uses, directly or through another file, nearest last.
  public func dependencies(of path: String) -> [String] {
    var seen: Set<String> = [path]
    var order: [String] = []
    collect(path, into: &order, seen: &seen)
    return order
  }

  private func collect(_ path: String, into order: inout [String], seen: inout Set<String>) {
    guard let tree = files[path]?.tree else { return }
    for root in tree.roots where root.tag == "use" {
      guard let source = root.value("src") else { continue }
      let target = resolvePath(source, from: path)
      guard seen.insert(target).inserted else { continue }
      collect(target, into: &order, seen: &seen)
      order.append(target)
    }
  }

  public func scope(of path: String) -> Scope {
    var scope = Scope()
    for dependency in dependencies(of: path) { scope.merge(declarations(in: dependency)) }
    scope.merge(declarations(in: path))
    return scope
  }

  private func declarations(in path: String) -> Scope {
    var scope = Scope()
    guard let tree = files[path]?.tree else { return scope }
    for (index, root) in tree.roots.enumerated() {
      switch root.tag {
      case "tokens":
        for token in root.elements {
          guard let name = token.value("name") else { continue }
          switch token.tag {
          case "color":
            scope.colors[name] = (token.value("value") ?? "none", token.value("dark"))
          case "number":
            scope.numbers[name] = token.value("value") ?? "0"
          case "type":
            var style: [String: String] = [:]
            for attribute in token.attributes where attribute.name != "name" {
              style[attribute.name] = attribute.value ?? ""
            }
            scope.types[name] = style
          default:
            continue
          }
        }
      case "component":
        guard let name = root.value("name") else { continue }
        scope.components[name] = ComponentDeclaration(
          name: name, file: path, path: [index], element: root)
      default:
        continue
      }
    }
    return scope
  }
}

/// Resolves a `src` against the folder of the file that names it.
public func resolvePath(_ source: String, from file: String) -> String {
  var parts = source.hasPrefix("/") ? [] : file.split(separator: "/").dropLast().map(String.init)
  for part in source.split(separator: "/") {
    switch part {
    case ".": continue
    case "..": if !parts.isEmpty { parts.removeLast() }
    default: parts.append(String(part))
    }
  }
  return parts.joined(separator: "/")
}
