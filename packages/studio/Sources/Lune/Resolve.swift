import Foundation

public enum NodeKind: String, Sendable {
  case frame, col, row, box, text, image, icon, ellipse
}

/// One drawable node of a sheet, after components are expanded and props filled in.
public final class Node: Sendable {
  public let kind: NodeKind
  /// Attribute values with props filled in. Tokens stay as written, since a theme resolves them.
  public let attributes: [String: String]
  public let text: String?
  public let children: [Node]
  /// The element in the sheet's own file that puts this node on the sheet. Inside an expanded
  /// component, that is the instance.
  public let site: ElementRef
  /// The element that literally declares this node, wherever it lives.
  public let definition: ElementRef
  /// The file whose scope resolves this node's tokens.
  public let scopeFile: String
  /// The component this node is the root of, when it is an instance's root.
  public let component: String?

  init(
    kind: NodeKind, attributes: [String: String], text: String?, children: [Node],
    site: ElementRef, definition: ElementRef, scopeFile: String, component: String?
  ) {
    self.kind = kind
    self.attributes = attributes
    self.text = text
    self.children = children
    self.site = site
    self.definition = definition
    self.scopeFile = scopeFile
    self.component = component
  }

  public var name: String {
    if let name = attributes["name"] { return name }
    if let component { return component }
    if kind == .text, let text { return text }
    return kind.rawValue
  }
}

public struct SheetWarning: Sendable, Hashable {
  public let message: String
  public let site: ElementRef
}

/// One file's frames, ready to lay out.
public struct Sheet: Sendable {
  public let file: String
  public let frames: [Node]
  public let warnings: [SheetWarning]
  public let error: Diagnostic?
}

extension Project {
  /// Expands a file's top-level frames. A file that fails to parse yields no frames and its error.
  public func sheet(_ path: String) -> Sheet {
    guard let file = files[path] else {
      return Sheet(file: path, frames: [], warnings: [], error: nil)
    }
    guard let tree = file.tree else {
      return Sheet(file: path, frames: [], warnings: [], error: file.error)
    }
    var expander = Expander(project: self, sheet: path)
    var frames: [Node] = []
    for (index, root) in tree.roots.enumerated() where root.tag == "frame" {
      let ref = ElementRef(file: path, path: [index])
      if let node = expander.expand(root, ref: ref, site: nil, props: [:], file: path, depth: 0) {
        frames.append(node)
      }
    }
    return Sheet(file: path, frames: frames, warnings: expander.warnings, error: nil)
  }
}

private struct Expander {
  let project: Project
  let sheet: String
  var warnings: [SheetWarning] = []
  var scopes: [String: Scope] = [:]

  init(project: Project, sheet: String) {
    self.project = project
    self.sheet = sheet
  }

  mutating func scope(_ file: String) -> Scope {
    if let cached = scopes[file] { return cached }
    let scope = project.scope(of: file)
    scopes[file] = scope
    return scope
  }

  /// `site` is nil while expanding the sheet's own elements, and the instance once inside a
  /// component body.
  mutating func expand(
    _ element: SyntaxElement, ref: ElementRef, site: ElementRef?, props: [String: String],
    file: String, depth: Int
  ) -> Node? {
    let owner = site ?? ref

    if let kind = NodeKind(rawValue: element.tag) {
      var attributes: [String: String] = [:]
      for attribute in element.attributes {
        attributes[attribute.name] = fill(attribute.value ?? "true", props)
        if !knownAttributes.contains(attribute.name) {
          warnings.append(
            SheetWarning(message: "<\(element.tag)> has no attribute named \(attribute.name).", site: owner))
        }
      }
      var children: [Node] = []
      if kind != .text {
        for (index, child) in element.elements.enumerated() {
          let childRef = ElementRef(file: ref.file, path: ref.path + [index])
          if let node = expand(
            child, ref: childRef, site: site, props: props, file: file, depth: depth)
          {
            children.append(node)
          }
        }
      }
      return Node(
        kind: kind, attributes: attributes, text: kind == .text ? fill(element.text, props) : nil,
        children: children, site: owner, definition: ref, scopeFile: file, component: nil)
    }

    guard let first = element.tag.first, first.isUppercase else {
      warnings.append(SheetWarning(message: "<\(element.tag)> is not a Lune element.", site: owner))
      return nil
    }
    guard let declaration = scope(file).components[element.tag] else {
      warnings.append(
        SheetWarning(message: "No component named \(element.tag) is in scope.", site: owner))
      return nil
    }
    guard depth < 24 else {
      warnings.append(SheetWarning(message: "\(element.tag) contains itself.", site: owner))
      return nil
    }
    guard let body = declaration.element.elements.first else {
      warnings.append(SheetWarning(message: "\(element.tag) has no body.", site: owner))
      return nil
    }

    var inner = declaration.defaults
    var overrides: [String: String] = [:]
    for attribute in element.attributes {
      let value = fill(attribute.value ?? "true", props)
      if inner[attribute.name] != nil {
        inner[attribute.name] = value
      } else if knownAttributes.contains(attribute.name) {
        overrides[attribute.name] = value
      } else {
        warnings.append(
          SheetWarning(
            message: "\(attribute.name) is neither a prop of \(element.tag) nor an attribute its root takes.",
            site: owner))
      }
    }

    let bodyRef = ElementRef(file: declaration.file, path: declaration.path + [0])
    guard
      let root = expand(
        body, ref: bodyRef, site: owner, props: inner, file: declaration.file, depth: depth + 1)
    else { return nil }

    return Node(
      kind: root.kind, attributes: root.attributes.merging(overrides) { _, new in new },
      text: root.text, children: root.children, site: owner, definition: root.definition,
      scopeFile: root.scopeFile, component: declaration.name)
  }
}

/// Every attribute an element can take. A name outside it is a typo worth reporting, since it
/// would otherwise change nothing and say nothing.
private let knownAttributes: Set<String> = [
  "name", "x", "y", "w", "h", "pad", "gap", "align", "justify", "self", "layout", "theme", "fill",
  "stroke", "stroke-w", "radius", "shadow", "opacity", "clip", "hidden", "style", "font", "size",
  "weight", "color", "leading", "tracking", "lines", "italic", "src", "fit",
]

/// Fills `{prop}` placeholders. A placeholder that names no prop stays as written.
private func fill(_ value: String, _ props: [String: String]) -> String {
  guard !props.isEmpty, value.contains("{") else { return value }
  var out = ""
  var rest = Substring(value)
  while let open = rest.firstIndex(of: "{") {
    out += rest[..<open]
    guard let close = rest[open...].firstIndex(of: "}") else {
      out += rest[open...]
      rest = ""
      break
    }
    let name = String(rest[rest.index(after: open)..<close])
    out += props[name] ?? "{\(name)}"
    rest = rest[rest.index(after: close)...]
  }
  out += rest
  return out
}
