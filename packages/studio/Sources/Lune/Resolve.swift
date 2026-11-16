import Foundation

public enum NodeKind: String, Sendable {
  case frame, col, row, box, text, image, icon, ellipse
}

public final class Node: Sendable {
  public let kind: NodeKind
  public let attributes: [String: String]
  public let text: String?
  public let children: [Node]
  public let site: ElementRef
  public let definition: ElementRef
  public let origin: ElementRef
  public let trail: [ElementRef]
  public let scopeFile: String
  public let component: String?
  public let missing: Bool

  init(
    kind: NodeKind, attributes: [String: String], text: String?, children: [Node],
    site: ElementRef, definition: ElementRef, origin: ElementRef, trail: [ElementRef], scopeFile: String,
    component: String?, missing: Bool = false
  ) {
    self.kind = kind
    self.attributes = attributes
    self.text = text
    self.children = children
    self.site = site
    self.definition = definition
    self.origin = origin
    self.trail = trail
    self.scopeFile = scopeFile
    self.component = component
    self.missing = missing
  }

  public var occurrence: Occurrence { Occurrence(element: origin, trail: trail) }

  public var componentRoot: Occurrence? {
    component == nil ? nil : Occurrence(element: definition, trail: trail + [origin])
  }

  public func isAt(_ occurrence: Occurrence) -> Bool {
    self.occurrence == occurrence || componentRoot == occurrence
  }

  public var name: String {
    if let name = attributes["name"] { return name }
    if let component { return component }
    if kind == .text, let text { return text }
    return kind.rawValue
  }
}

public struct Occurrence: Hashable, Sendable {
  public var element: ElementRef
  public var trail: [ElementRef]

  public init(element: ElementRef, trail: [ElementRef] = []) {
    self.element = element
    self.trail = trail
  }
}

public struct SheetWarning: Sendable, Hashable {
  public let message: String
  public let site: ElementRef
  public var missingImport: String? = nil
}

public struct Sheet: Sendable {
  public let file: String
  public let frames: [Node]
  public let warnings: [SheetWarning]
  public let error: Diagnostic?
}

extension Project {
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
    let missing = tree.roots.enumerated().compactMap { index, root -> SheetWarning? in
      guard root.tag == "use", let source = root.value("src") else { return nil }
      let target = resolvePath(source, from: path)
      guard files[target] == nil else { return nil }
      return SheetWarning(
        message: "It uses \(source), which isn't here.", site: ElementRef(file: path, path: [index]),
        missingImport: target)
    }
    return Sheet(file: path, frames: frames, warnings: missing + expander.warnings, error: nil)
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

  mutating func expand(
    _ element: SyntaxElement, ref: ElementRef, site: ElementRef?, props: [String: String],
    file: String, depth: Int, level: Int = 0, trail: [ElementRef] = []
  ) -> Node? {
    let owner = site ?? ref
    guard level < maxLuneDepth else {
      warnings.append(
        SheetWarning(message: "Elements are nested more than \(maxLuneDepth) deep once components are expanded.", site: owner))
      return nil
    }

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
            child, ref: childRef, site: site, props: props, file: file, depth: depth, level: level + 1,
            trail: trail)
          {
            children.append(node)
          }
        }
      }
      return Node(
        kind: kind, attributes: attributes, text: kind == .text ? fill(element.text, props) : nil,
        children: children, site: owner, definition: ref, origin: ref, trail: trail, scopeFile: file,
        component: nil)
    }

    guard let first = element.tag.first, first.isUppercase else {
      warnings.append(SheetWarning(message: "<\(element.tag)> is not a Lune element.", site: owner))
      return nil
    }
    guard let declaration = scope(file).components[element.tag] else {
      warnings.append(
        SheetWarning(message: "No component named \(element.tag) is in scope.", site: owner))
      return placeholder(for: element.tag, element, ref: ref, owner: owner, props: props, file: file, trail: trail)
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
        body, ref: bodyRef, site: owner, props: inner, file: declaration.file, depth: depth + 1, level: level,
        trail: trail + [ref])
    else { return nil }

    return Node(
      kind: root.kind, attributes: root.attributes.merging(overrides) { _, new in new },
      text: root.text, children: root.children, site: owner, definition: root.definition, origin: ref,
      trail: trail, scopeFile: root.scopeFile, component: declaration.name)
  }
}

extension Expander {
  func placeholder(
    for name: String, _ element: SyntaxElement, ref: ElementRef, owner: ElementRef, props: [String: String],
    file: String, trail: [ElementRef]
  ) -> Node {
    var attributes = [
      "w": "160", "h": "48", "radius": "8", "align": "center", "fill": "#8e8b8614", "stroke": "#8e8b8699",
    ]
    for size in ["w", "h", "x", "y", "self"] {
      if let value = element.value(size) { attributes[size] = fill(value, props) }
    }
    let label = Node(
      kind: .text, attributes: ["size": "12", "weight": "500", "color": "#8e8b86", "lines": "1"],
      text: name, children: [], site: owner, definition: ref, origin: ref, trail: trail, scopeFile: file,
      component: nil)
    return Node(
      kind: .box, attributes: attributes, text: nil, children: [label], site: owner, definition: ref, origin: ref,
      trail: trail, scopeFile: file, component: name, missing: true)
  }
}

private let knownAttributes: Set<String> = [
  "name", "x", "y", "w", "h", "min-w", "max-w", "min-h", "max-h", "pad", "gap", "wrap", "align", "justify",
  "self", "layout", "theme", "fill",
  "stroke", "stroke-w", "radius", "shadow", "opacity", "clip", "hidden", "style", "font", "size",
  "weight", "color", "leading", "tracking", "lines", "italic", "src", "fit",
]

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
