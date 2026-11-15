import AppKit
import Lune
import NyteDesign
import NyteKit

/// The inspector column: what is selected, or the chat.
@MainActor
final class PanelViewController: NSViewController {
  private let model: StudioModel
  private let tabs = NSSegmentedControl(labels: ["Design", "Chat"], trackingMode: .selectOne, target: nil, action: nil)
  private let inspector: InspectorViewController
  private let chat: ChatViewController
  private let container = NSView()
  private var observer: Observer?

  init(model: StudioModel) {
    self.model = model
    inspector = InspectorViewController(model: model)
    chat = ChatViewController(model: model)
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  override func loadView() {
    view = NSView()
    tabs.target = self
    tabs.action = #selector(choose(_:))
    tabs.segmentDistribution = .fillEqually
    tabs.translatesAutoresizingMaskIntoConstraints = false
    container.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(tabs)
    view.addSubview(container)
    let safe = view.safeAreaLayoutGuide
    NSLayoutConstraint.activate([
      tabs.topAnchor.constraint(equalTo: safe.topAnchor, constant: 8),
      tabs.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 14),
      tabs.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -14),
      container.topAnchor.constraint(equalTo: tabs.bottomAnchor, constant: 10),
      container.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      container.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      container.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
    for child in [inspector, chat] as [NSViewController] {
      addChild(child)
      container.addSubview(child.view)
      child.view.pin(to: container)
    }
    observer = Observer { [weak self] in self?.show() }
  }

  private func show() {
    let design = model.panel == .design
    tabs.selectedSegment = design ? 0 : 1
    inspector.view.isHidden = !design
    chat.view.isHidden = design
  }

  @objc private func choose(_ sender: Any?) {
    model.panel = tabs.selectedSegment == 0 ? .design : .chat
  }
}

/// A view whose origin is its top-left corner, so a stack inside a scroll view starts at the top.
final class FlippedView: NSView {
  override var isFlipped: Bool { true }
}

// MARK: Inspector

/// The attributes of the selected element, as written in its file. A field writes when you
/// press Return or leave it, never on every keystroke, so a half-typed value doesn't reach the file.
@MainActor
final class InspectorViewController: NSViewController {
  private let model: StudioModel
  private let scroll = NSScrollView()
  private let stack = NSStackView()
  private let placeholder = NSStackView()
  private var fields: [String: InspectorField] = [:]
  private var wells: [String: NSColorWell] = [:]
  private let heading = NSTextField.nyteLabel("", .lg, .semibold)
  private let origin = NSTextField.nyteLabel("", .sm, .regular, .contentTertiary)
  private let source = NSTextField.nyteWrapping("", .sm, .contentSecondary)
  private var shape = ""
  private var observer: Observer?
  private var colorCommit: DispatchWorkItem?

  init(model: StudioModel) {
    self.model = model
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  override func loadView() {
    view = NSView()
    stack.orientation = .vertical
    stack.alignment = .leading
    stack.spacing = 6
    stack.edgeInsets = NSEdgeInsets(top: 2, left: 14, bottom: 20, right: 14)
    stack.translatesAutoresizingMaskIntoConstraints = false
    let document = FlippedView()
    document.translatesAutoresizingMaskIntoConstraints = false
    document.addSubview(stack)
    stack.pin(to: document)
    scroll.documentView = document
    scroll.drawsBackground = false
    scroll.hasVerticalScroller = true
    scroll.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(scroll)
    scroll.pin(to: view)
    document.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor).isActive = true

    placeholder.orientation = .vertical
    placeholder.spacing = 6
    placeholder.translatesAutoresizingMaskIntoConstraints = false
    let symbol = NSImageView(image: NSImage(systemSymbolName: "cursorarrow.rays", accessibilityDescription: nil) ?? NSImage())
    symbol.symbolConfiguration = .init(pointSize: 20, weight: .light)
    symbol.contentTintColor = .nyte(.contentQuaternary)
    placeholder.addArrangedSubview(symbol)
    placeholder.addArrangedSubview(NSTextField.nyteLabel("Select something on the canvas", .base, .regular, .contentTertiary))
    placeholder.addArrangedSubview(NSTextField.nyteLabel("Esc steps out to its parent.", .sm, .regular, .contentQuaternary))
    view.addSubview(placeholder)
    NSLayoutConstraint.activate([
      placeholder.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      placeholder.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -60),
    ])

    source.font = .nyteMono(11)
    source.isSelectable = true
    source.maximumNumberOfLines = 10
    source.lineBreakMode = .byTruncatingTail
    origin.lineBreakMode = .byTruncatingMiddle
    observer = Observer { [weak self] in self?.refresh() }
  }

  private func refresh() {
    _ = model.project?.revision
    guard let selection = model.selection, let placed = model.selectedBox else {
      scroll.isHidden = true
      placeholder.isHidden = false
      shape = ""
      return
    }
    scroll.isHidden = false
    placeholder.isHidden = true
    let node = placed.box.node
    let props = node.component.flatMap { model.project?.scope(selection.sheet).components[$0]?.defaults } ?? [:]
    let nextShape = "\(selection.hashValue)|\(node.kind)|\(props.keys.sorted())"
    if nextShape != shape {
      shape = nextShape
      build(selection, node, props: props.keys.sorted())
    }
    fill(selection, placed, props: props)
  }

  /// Lays the sections out for a kind of element. Values are filled in separately, so typing
  /// in one field survives a redraw caused by another.
  private func build(_ selection: CanvasSelection, _ node: Node, props: [String]) {
    for view in stack.arrangedSubviews { view.removeFromSuperview() }
    fields = [:]
    wells = [:]
    let header = NSStackView(views: [heading, origin])
    header.orientation = .vertical
    header.alignment = .leading
    header.spacing = 2
    add(header, gap: 14)

    if node.kind == .text {
      section("Text")
      row([field("content", label: "Content", wide: true) { [model] in model.setText($0) }])
    }
    if let component = node.component, !props.isEmpty {
      section(component)
      for prop in props { row([field(prop, label: prop, wide: true)]) }
    }

    section("Layout")
    if selection.isFrame { row([field("x", label: "X"), field("y", label: "Y")]) }
    row([field("w", label: "W"), field("h", label: "H")])
    if [.frame, .col, .row, .box].contains(node.kind) {
      row([field("gap", label: "Gap"), field("pad", label: "Pad")])
      row([field("align", label: "Align"), field("justify", label: "Justify")])
    }

    section("Appearance")
    if node.kind == .text || node.kind == .icon {
      row([well("color"), field("color", label: "Color", wide: true)])
      row([field("size", label: "Size"), field("weight", label: "Weight")])
      if node.kind == .text { row([field("style", label: "Style", wide: true)]) }
    } else {
      row([well("fill"), field("fill", label: "Fill", wide: true)])
      row([well("stroke"), field("stroke", label: "Stroke", wide: true)])
      row([field("radius", label: "Radius"), field("opacity", label: "Opacity")])
    }

    section("Source")
    let box = SourceBox(source)
    add(box, gap: 6)
    box.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -28).isActive = true
  }

  private func fill(_ selection: CanvasSelection, _ placed: PlacedBox, props: [String: String]) {
    let node = placed.box.node
    let style = placed.box.style
    let tree = model.project?.tree(selection.site.file)
    let element = tree?.element(at: selection.site.path)
    heading.stringValue = node.name
    origin.stringValue = "\(selection.site.file):\(tree?.line(at: selection.site.path) ?? 1)"

    let effective: [String: String] = [
      "w": formatNumber(placed.rect.width), "h": formatNumber(placed.rect.height),
      "gap": formatNumber(style.gap), "pad": padding(style.padding), "align": style.align.rawValue,
      "justify": style.justify.rawValue, "radius": formatNumber(style.radii.topLeft),
      "opacity": formatNumber(style.opacity), "size": formatNumber(style.fontSize),
      "weight": formatNumber(style.fontWeight), "color": style.color.hex,
      "fill": solid(style.fill)?.hex ?? "none", "stroke": style.stroke?.hex ?? "none", "x": "0", "y": "0",
    ]
    for (name, field) in fields {
      if name == "content" {
        field.show(value: node.text ?? "", hint: "")
      } else {
        field.show(value: element?.value(name) ?? "", hint: props[name] ?? effective[name] ?? "")
      }
    }
    let colors: [String: RGBA?] = ["color": style.color, "fill": solid(style.fill), "stroke": style.stroke]
    for (name, well) in wells where !well.isActive {
      let color = colors[name] ?? nil
      well.color = color.map { NSColor(srgbRed: $0.red, green: $0.green, blue: $0.blue, alpha: $0.alpha) } ?? .clear
    }
    source.stringValue = model.selectedMarkup.map(opening) ?? ""
  }

  // MARK: Building blocks

  private func add(_ view: NSView, gap: CGFloat) {
    stack.addArrangedSubview(view)
    stack.setCustomSpacing(gap, after: view)
  }

  private func section(_ name: String) {
    if let last = stack.arrangedSubviews.last { stack.setCustomSpacing(16, after: last) }
    add(NSTextField.nyteLabel(name, .sm, .medium, .contentTertiary), gap: 6)
  }

  private func row(_ views: [NSView]) {
    let row = NSStackView(views: views)
    row.spacing = 6
    row.distribution = views.contains { $0 is NSColorWell } ? .fill : .fillEqually
    add(row, gap: 6)
    row.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -28).isActive = true
  }

  private func field(_ name: String, label: String, wide: Bool = false, commit: ((String) -> Void)? = nil) -> InspectorField {
    let field = InspectorField(label: label, wide: wide)
    field.onCommit = commit ?? { [model] value in model.set([name: value.isEmpty ? nil : value], named: "Change \(label)") }
    fields[name] = field
    return field
  }

  /// The system colour picker. It reports every change while you drag, so the canvas previews
  /// each one and the file is saved once the dragging stops.
  private func well(_ name: String) -> NSColorWell {
    let well = NSColorWell(style: .minimal)
    well.identifier = NSUserInterfaceItemIdentifier(name)
    well.target = self
    well.action = #selector(colorChanged(_:))
    well.translatesAutoresizingMaskIntoConstraints = false
    well.widthAnchor.constraint(equalToConstant: 28).isActive = true
    well.heightAnchor.constraint(equalToConstant: 22).isActive = true
    wells[name] = well
    return well
  }

  @objc private func colorChanged(_ sender: NSColorWell) {
    guard let name = sender.identifier?.rawValue, let color = sender.color.usingColorSpace(.sRGB) else { return }
    let hex = RGBA(red: color.redComponent, green: color.greenComponent, blue: color.blueComponent, alpha: color.alphaComponent).hex
    model.set([name: hex], commit: false)
    colorCommit?.cancel()
    let work = DispatchWorkItem { [model] in model.set([name: hex], commit: true, named: "Change Color") }
    colorCommit = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35, execute: work)
  }

  private func padding(_ insets: Insets) -> String {
    if insets.top == insets.bottom, insets.left == insets.right {
      return insets.top == insets.left
        ? formatNumber(insets.top) : "\(formatNumber(insets.top)) \(formatNumber(insets.left))"
    }
    return [insets.top, insets.right, insets.bottom, insets.left].map(formatNumber).joined(separator: " ")
  }

  private func solid(_ paint: Paint?) -> RGBA? {
    switch paint {
    case .color(let color): return color
    case .linear(_, let stops), .radial(_, let stops): return stops.first?.color
    case nil: return nil
    }
  }

  private func opening(_ markup: String) -> String {
    let lines = markup.split(separator: "\n", omittingEmptySubsequences: false)
    let indent = lines.dropFirst().filter { !$0.allSatisfy(\.isWhitespace) }.map { $0.prefix { $0 == " " }.count }.min() ?? 0
    return ([String(lines[0])] + lines.dropFirst().map { String($0.dropFirst(min(indent, $0.count))) })
      .joined(separator: "\n")
  }
}

/// A labelled native text field.
private final class InspectorField: NSView, NSTextFieldDelegate {
  var onCommit: ((String) -> Void)?
  private let field = NSTextField()
  private var shown = ""

  init(label: String, wide: Bool) {
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false
    let caption = NSTextField.nyteLabel(label, .sm, .regular, .contentTertiary)
    caption.setContentHuggingPriority(.required, for: .horizontal)
    caption.setContentCompressionResistancePriority(.required, for: .horizontal)
    field.controlSize = .small
    field.font = .nyte(.sm)
    field.bezelStyle = .roundedBezel
    field.delegate = self
    field.lineBreakMode = .byTruncatingTail
    field.cell?.sendsActionOnEndEditing = true
    field.target = self
    field.action = #selector(commit(_:))
    field.setAccessibilityLabel(label)
    field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    let stack = NSStackView(views: [caption, field])
    stack.spacing = 6
    addSubview(stack)
    stack.pin(to: self)
    if wide { caption.widthAnchor.constraint(equalToConstant: 52).isActive = true }
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  /// Shows the value as written and, when nothing is written, what the element resolves to.
  func show(value: String, hint: String) {
    field.placeholderString = hint
    guard field.currentEditor() == nil || shown == field.stringValue else { return }
    shown = value
    field.stringValue = value
  }

  @objc private func commit(_ sender: Any?) {
    let next = field.stringValue.trimmingCharacters(in: .whitespaces)
    guard next != shown else { return }
    shown = next
    onCommit?(next)
  }
}

/// The selected element's markup in a quiet box.
private final class SourceBox: AppearanceView {
  init(_ label: NSTextField) {
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false
    layer?.cornerRadius = NyteRadius.md
    layer?.cornerCurve = .continuous
    addSubview(label)
    label.pin(to: self, insets: NSEdgeInsets(top: 8, left: 9, bottom: 8, right: 9))
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  override func applyColors() {
    layer?.backgroundColor = NyteRole.fillTertiary.cgColor(dark: isDark)
  }
}
