import AppKit
import Lune
import NyteDesign

@MainActor
final class InspectorViewController: NSViewController {
  private let model: StudioModel
  private let scroll = NSScrollView()
  private let stack = NSStackView.column(gap: .s2)
  private let placeholder = NSStackView.column(gap: .s2, align: .centerX)
  private let heading = NSTextField.nyteLabel("", .lg, .semibold)
  private let origin = NSTextField.nyteLabel("", .sm, .regular, .contentSecondary)
  private let source = NSTextField.nyteWrapping("", .sm, .contentSecondary)
  private var fields: [String: NyteField] = [:]
  private var wells: [String: NSColorWell] = [:]
  private var pickers: [String: (picker: SegmentedPicker, values: [String])] = [:]
  private var menus: [String: (button: MenuButton, options: [(title: String, value: String?)])] = [:]
  private var switches: [String: NSSwitch] = [:]
  private var eachSide = false
  private var shape = ""
  private var textEdits = 0
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
    let inset = PanelViewController.inset
    stack.pad(NyteInsets(top: .s1, leading: inset, bottom: .s5, trailing: inset))
    let document = FlippedView()
    document.translatesAutoresizingMaskIntoConstraints = false
    document.addSubview(stack)
    stack.pin(to: document)
    scroll.documentView = document
    scroll.drawsBackground = false
    scroll.hasVerticalScroller = true
    view.addSubview(scroll)
    scroll.pin(to: view)
    document.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor).isActive = true

    let symbol = NSImageView(image: NSImage(systemSymbolName: "cursorarrow.rays", accessibilityDescription: nil) ?? NSImage())
    symbol.symbolConfiguration = .init(pointSize: NyteGlyph.lg.pointSize, weight: .light)
    symbol.contentTintColor = .nyte(.contentTertiary)
    placeholder.addArrangedSubview(symbol)
    placeholder.addArrangedSubview(NSTextField.nyteLabel("Select something on the canvas", .base, .regular, .contentSecondary))
    let how = NSTextField.nyteWrapping(
      "Double-click goes into a component. Esc steps back out.", .sm, .contentSecondary)
    how.alignment = .center
    placeholder.addArrangedSubview(how)
    view.addSubview(placeholder)
    placeholder.fitWidth(in: view, margin: inset)
    NSLayoutConstraint.activate([
      placeholder.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      placeholder.centerYAnchor.above(view.centerYAnchor, .s8),
    ])

    source.font = .nyteCode
    source.isSelectable = true
    source.maximumNumberOfLines = 0
    source.lineBreakMode = .byWordWrapping
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
    let tag = model.project?.tree(selection.site.file)?.element(at: selection.site.path)?.tag ?? ""
    let isInstance = NodeKind(rawValue: tag) == nil
    let props = isInstance
      ? model.project?.scope(selection.site.file).components[tag]?.defaults ?? [:] : [:]
    let padding = placed.box.style.padding
    if padding.top != padding.bottom || padding.left != padding.right { eachSide = true }
    let shadowed = !placed.box.style.shadows.isEmpty
    let nextShape = "\(selection.hashValue)|\(node.kind)|\(tag)|\(props.keys.sorted())|\(eachSide)|\(shadowed)"
    if nextShape != shape {
      shape = nextShape
      build(selection, node, tag: tag, props: props.keys.sorted())
    }
    fill(selection, placed, props: props)

    if textEdits != model.textEdits {
      textEdits = model.textEdits
      DispatchQueue.main.async { [weak self] in self?.fields["content"]?.focus() }
    }
  }

  // MARK: Sections

  private func build(_ selection: CanvasSelection, _ node: Node, tag: String, props: [String]) {
    for view in stack.arrangedSubviews { view.removeFromSuperview() }
    fields = [:]
    wells = [:]
    pickers = [:]
    menus = [:]
    switches = [:]
    let header = NSStackView.column(gap: .s1, [heading, origin])
    stack.add(header)
    fill(header)
    stack.gapAfterLast(.s3)
    row("Name", [text("name", "Name")])

    let isInstance = NodeKind(rawValue: tag) == nil
    let stacks = [.frame, .col, .row, .box].contains(node.kind)

    if isInstance, !props.isEmpty {
      section(tag)
      for prop in props { row(prop, [text(prop, prop)]) }
    }

    if node.kind == .text {
      section("Text")
      row("Content", [text("content", "Content") { [model] in model.setText($0) }])
      row("Style", [menu("style", "Type style", typeStyles(selection))])
      row("Size", [number("size", "Text size", symbol: "textformat.size", least: 1)])
      row("Weight", [menu("weight", "Weight", weights)])
      row(
        "Spacing",
        [
          number("leading", "Line height", symbol: "arrow.up.and.down", least: 0),
          number("tracking", "Letter spacing", symbol: "arrow.left.and.right", step: 0.1),
        ])
      row(
        "Align",
        [
          choice(
            "align", "Text alignment",
            [
              ("start", .symbol("text.alignleft", "Start")), ("center", .symbol("text.aligncenter", "Center")),
              ("end", .symbol("text.alignright", "End")),
            ])
        ])
      row("Lines", [number("lines", "Most lines", symbol: "line.3.horizontal", least: 1)])
      color("color", "Color")
    }
    if node.kind == .icon {
      section("Icon")
      row("Symbol", [text("name", "Symbol")])
      row("Size", [number("size", "Symbol size", symbol: "textformat.size", least: 1)])
      color("color", "Color")
    }
    if node.kind == .image {
      section("Image")
      row("Source", [text("src", "Source")])
      row(
        "Fit",
        [
          choice(
            "fit", "Fit",
            [("cover", .title("Cover")), ("contain", .title("Contain")), ("fill", .title("Fill"))])
        ])
    }

    section("Size")
    if selection.isFrame {
      row("Position", [number("x", "X", prefix: "X"), number("y", "Y", prefix: "Y")])
    }
    row("Width", [number("w", "Width", prefix: "W", least: 0), menu("w.mode", "Width sizing", sizings)])
    row("Height", [number("h", "Height", prefix: "H", least: 0), menu("h.mode", "Height sizing", sizings)])

    if stacks {
      section("Layout")
      let direction = isInstance ? node.kind.rawValue : tag == "frame" ? node.attributes["layout"] ?? "col" : tag
      if !isInstance {
        let picker = SegmentedPicker(
          label: "Direction",
          [
            .symbol("arrow.down", "Top to bottom"), .symbol("arrow.right", "Side by side"),
            .symbol("square.on.square", "Layered"),
          ])
        let values = ["col", "row", "box"]
        picker.onChoose = { [model] index in
          if tag == "frame" {
            model.set(["layout": index == 0 ? nil : values[index]], named: "Change Direction")
          } else {
            model.retag(values[index])
          }
        }
        pickers["direction"] = (picker, values)
        row("Direction", [picker])
      }
      if direction == "box" {
        row("Align", [text("align", "Alignment")])
      } else {
        let across = direction == "row"
        row(
          "Align",
          [
            choice(
              "align", "Alignment across the stack",
              [
                ("start", .symbol(across ? "align.vertical.top" : "align.horizontal.left", "Start")),
                ("center", .symbol(across ? "align.vertical.center" : "align.horizontal.center", "Center")),
                ("end", .symbol(across ? "align.vertical.bottom" : "align.horizontal.right", "End")),
                ("stretch", .symbol(across ? "arrow.up.and.down" : "arrow.left.and.right", "Stretch")),
              ])
          ])
        row(
          "Justify",
          [
            choice(
              "justify", "Placement along the stack",
              [
                ("start", .symbol(across ? "align.horizontal.left" : "align.vertical.top", "Start")),
                ("center", .symbol(across ? "align.horizontal.center" : "align.vertical.center", "Center")),
                ("end", .symbol(across ? "align.horizontal.right" : "align.vertical.bottom", "End")),
                ("between", .symbol(across ? "distribute.horizontal" : "distribute.vertical", "Space between")),
              ])
          ])
        row("Gap", [number("gap", "Gap", symbol: across ? "arrow.left.and.right" : "arrow.up.and.down", least: 0)])
      }
      let sides = GhostButton(
        symbol: "square.dashed", label: "A value for each side", size: .sm, target: self,
        action: #selector(toggleSides(_:)))
      sides.isOn = eachSide
      if eachSide {
        row("Padding", [side("top", "T"), side("right", "R"), sides])
        let under = NSView()
        under.translatesAutoresizingMaskIntoConstraints = false
        under.square(NyteControl.sm)
        under.identifier = InspectorViewController.fixed
        row("", [side("bottom", "B"), side("left", "L"), under])
      } else {
        row("Padding", [side("horizontal", "H"), side("vertical", "V"), sides])
      }
      if direction == "row" { row("Wrap", [toggle("wrap", "Wrap")]) }
      row("Clip", [toggle("clip", "Clip contents")])
    }

    if node.kind != .text, node.kind != .icon {
      section("Appearance")
      color("fill", "Fill")
      color("stroke", "Stroke")
      row("Thickness", [number("stroke-w", "Stroke thickness", symbol: "lineweight", least: 0)])
      if node.kind != .ellipse { row("Radius", [number("radius", "Corner radius", symbol: "app", least: 0)]) }
    } else {
      section("Appearance")
    }
    let percent = number("opacity", "Opacity", symbol: "circle.lefthalf.filled", suffix: "%", least: 0, most: 100) {
      [model] shown in
      let value = (Double(shown) ?? 100) / 100
      return model.set(["opacity": value >= 1 ? nil : formatNumber(CGFloat(value))], named: "Change Opacity")
    }
    percent.onScrub = { [model] shown in
      model.set(["opacity": formatNumber(CGFloat((Double(shown) ?? 100) / 100))], commit: false)
    }
    row("Opacity", [percent])

    if node.kind != .text, node.kind != .icon {
      let shadowed = model.selectedBox?.box.style.shadows.isEmpty == false
      section(
        "Shadow",
        GhostButton(
          symbol: shadowed ? "minus" : "plus", label: shadowed ? "Remove the Shadow" : "Add a Shadow", size: .sm,
          target: self, action: #selector(toggleShadow(_:))))
      if shadowed { row("Shadow", [text("shadow", "Shadow")]) }
    }

    section("Source")
    let box = SourceBox(source)
    stack.add(box)
    fill(box)
  }

  private static let fixed = NSUserInterfaceItemIdentifier("fixed")

  private let sizings: [(title: String, value: String?)] = [("Fixed", "fixed"), ("Hug", "hug"), ("Fill", "fill")]

  private let weights: [(title: String, value: String?)] = [
    ("Light", "300"), ("Regular", "400"), ("Medium", "500"), ("Semibold", "600"), ("Bold", "700"),
    ("Heavy", "800"),
  ]

  private func typeStyles(_ selection: CanvasSelection) -> [(title: String, value: String?)] {
    let names = model.project?.scope(selection.site.file).types.keys.sorted() ?? []
    return [("None", nil)] + names.map { ($0, "$" + $0) }
  }

  // MARK: Values

  private func fill(_ selection: CanvasSelection, _ placed: PlacedBox, props: [String: String]) {
    let node = placed.box.node
    let style = placed.box.style
    let tree = model.project?.tree(selection.site.file)
    let element = tree?.element(at: selection.site.path)
    heading.stringValue = node.name
    origin.stringValue = "\(selection.site.file):\(tree?.line(at: selection.site.path) ?? 1)"
    func written(_ name: String) -> String { element?.value(name) ?? "" }

    let effective: [String: String] = [
      "w": formatNumber(placed.rect.width), "h": formatNumber(placed.rect.height),
      "gap": formatNumber(style.gap), "radius": formatNumber(style.radii.topLeft),
      "size": formatNumber(node.kind == .icon ? style.symbolSize : style.fontSize),
      "weight": formatNumber(style.fontWeight), "color": style.color.hex,
      "fill": solid(style.fill)?.hex ?? "none", "stroke": style.stroke?.hex ?? "none",
      "stroke-w": formatNumber(style.strokeWidth), "x": "0", "y": "0",
      "leading": style.leading.map(formatNumber) ?? "auto", "tracking": formatNumber(style.tracking),
      "lines": style.maxLines.map(String.init) ?? "all", "align": style.align.rawValue,
      "name": node.kind == .icon ? style.symbol ?? "" : node.name, "src": style.source ?? "",
      "shadow": "x y blur color",
    ]
    let sides = [
      "top": style.padding.top, "right": style.padding.right, "bottom": style.padding.bottom,
      "left": style.padding.left, "horizontal": style.padding.left, "vertical": style.padding.top,
    ]
    for (name, field) in fields {
      switch name {
      case "content":
        field.show(value: element?.text ?? node.text ?? "", hint: node.text ?? "")
      case "opacity":
        field.show(
          value: written(name).isEmpty ? "" : formatNumber((style.opacity * 100).rounded()),
          hint: formatNumber((style.opacity * 100).rounded()))
      case "w", "h":
        let value = written(name)
        field.show(value: Double(value) == nil && !value.hasPrefix("$") && !value.hasSuffix("%") ? "" : value, hint: effective[name] ?? "")
      default:
        if let side = sides[name] {
          field.show(value: written("pad").isEmpty ? "" : formatNumber(side), hint: formatNumber(side))
        } else {
          field.show(value: written(name), hint: props[name] ?? effective[name] ?? "")
        }
      }
    }

    let chosen: [String: String] = [
      "direction": element?.tag == "frame" ? written("layout").isEmpty ? "col" : written("layout") : element?.tag ?? "",
      "align": node.kind == .text ? style.textAlign.rawValue : style.align.rawValue,
      "justify": style.justify.rawValue, "fit": style.fit.rawValue,
    ]
    for (name, entry) in pickers { entry.picker.selected = entry.values.firstIndex(of: chosen[name] ?? "") }

    for (name, entry) in menus {
      let value: String?
      switch name {
      case "w.mode", "h.mode":
        let dimension = name == "w.mode" ? style.width : style.height
        switch dimension {
        case .hug: value = "hug"
        case .fill: value = "fill"
        case .points, .percent: value = "fixed"
        }
      case "weight":
        value = formatNumber(style.fontWeight)
      default:
        value = written(name).isEmpty ? nil : written(name)
      }
      entry.button.title = entry.options.first { $0.value == value }?.title ?? value ?? "None"
    }

    for (name, toggle) in switches {
      let on = name == "clip" ? style.clip : node.attributes[name].map { $0 != "false" } ?? false
      toggle.state = on ? .on : .off
    }

    let colors: [String: RGBA?] = ["color": style.color, "fill": solid(style.fill), "stroke": style.stroke]
    for (name, well) in wells where !well.isActive {
      let color = colors[name] ?? nil
      well.color = color.map { NSColor(srgbRed: $0.red, green: $0.green, blue: $0.blue, alpha: $0.alpha) } ?? .clear
    }
    source.stringValue = model.selectedMarkup.map(opening) ?? ""
  }

  // MARK: Rows

  private func fill(_ view: NSView) {
    view.matchWidth(of: stack, inset: PanelViewController.inset)
  }

  private func section(_ name: String, _ action: NSView? = nil) {
    stack.gapAfterLast(.s5)
    let title = NSTextField.nyteLabel(name, .sm, .semibold, .contentPrimary)
    guard let action else {
      stack.add(title)
      return
    }
    let row = NSStackView.row(gap: .s2, [title, NSView.spacer(), action])
    stack.add(row)
    fill(row)
  }

  private func row(_ caption: String, _ controls: [NSView]) {
    let label = NSTextField.nyteLabel(caption, .sm, .regular, .contentSecondary)
    label.toolTip = caption
    label.setContentCompressionResistancePriority(.defaultHigh, for: .horizontal)
    for control in controls {
      control.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
      control.setContentHuggingPriority(.defaultHigh, for: .horizontal)
      guard let field = control as? NyteField else { continue }
      if field.step != nil {
        field.width(.valueChip)
      } else {
        field.hugContent()
        field.widthAnchor.constraint(greaterThanOrEqualToConstant: NyteMetric.valueChip.rawValue).isActive = true
      }
    }
    let group = NSStackView.row(gap: .s1_5, controls)
    let row = NSStackView.row(gap: .s2, [label, NSView.spacer(), group])
    stack.add(row)
    fill(row)
  }

  private func text(_ name: String, _ label: String, commit: ((String) -> Void)? = nil) -> NyteField {
    let field = NyteField(label: label)
    field.onCommit = commit ?? { [model] value in model.set([name: value.isEmpty ? nil : value], named: "Change \(label)") }
    fields[name] = field
    return field
  }

  private func number(
    _ name: String, _ label: String, prefix: String? = nil, symbol: String? = nil, suffix: String? = nil,
    step: CGFloat = 1, least: CGFloat? = nil, most: CGFloat? = nil, commit: ((String) -> Void)? = nil
  ) -> NyteField {
    let field = NyteField(prefix: prefix, symbol: symbol, suffix: suffix, label: label)
    field.step = step
    if let least { field.range = least...(most ?? 100_000) }
    field.onCommit = commit ?? { [model] value in model.set([name: value.isEmpty ? nil : value], named: "Change \(label)") }
    field.onScrub = { [model] value in model.set([name: value], commit: false) }
    fields[name] = field
    return field
  }

  private func side(_ name: String, _ prefix: String) -> NyteField {
    let field = NyteField(prefix: prefix, label: "Padding, \(name)")
    field.step = 1
    field.range = 0...100_000
    func write(_ shown: String, commit: Bool) {
      guard var insets = model.selectedBox?.box.style.padding, let value = Double(shown).map({ CGFloat($0) }) else { return }
      switch name {
      case "top": insets.top = value
      case "right": insets.right = value
      case "bottom": insets.bottom = value
      case "left": insets.left = value
      case "horizontal":
        insets.left = value
        insets.right = value
      default:
        insets.top = value
        insets.bottom = value
      }
      model.set(["pad": padding(insets)], commit: commit, named: "Change Padding")
    }
    field.onCommit = { write($0, commit: true) }
    field.onScrub = { write($0, commit: false) }
    fields[name] = field
    return field
  }

  private func choice(_ name: String, _ label: String, _ options: [(String, PickerSegment)]) -> SegmentedPicker {
    let picker = SegmentedPicker(label: label, options.map(\.1))
    let values = options.map(\.0)
    picker.onChoose = { [model] index in model.set([name: values[index]], named: "Change \(label)") }
    pickers[name] = (picker, values)
    return picker
  }

  private func menu(_ name: String, _ label: String, _ options: [(title: String, value: String?)]) -> MenuButton {
    let button = MenuButton(label: label, role: .contentPrimary, filled: true)
    let menu = NSMenu()
    for (index, option) in options.enumerated() {
      let item = menu.addItem(withTitle: option.title, action: #selector(chooseOption(_:)), keyEquivalent: "")
      item.target = self
      item.tag = index
      item.identifier = NSUserInterfaceItemIdentifier(name)
    }
    button.menu = menu
    menus[name] = (button, options)
    return button
  }

  @objc private func chooseOption(_ sender: NSMenuItem) {
    guard let name = sender.identifier?.rawValue, let entry = menus[name], entry.options.indices.contains(sender.tag)
    else { return }
    let value = entry.options[sender.tag].value
    switch name {
    case "w.mode", "h.mode":
      let attribute = name == "w.mode" ? "w" : "h"
      let measured = model.selectedBox.map { attribute == "w" ? $0.rect.width : $0.rect.height } ?? 0
      model.set([attribute: value == "fixed" ? formatNumber(measured.rounded()) : value], named: "Change Sizing")
    default:
      model.set([name: value], named: "Change \(entry.button.toolTip ?? name)")
    }
  }

  private func toggle(_ name: String, _ label: String) -> NSView {
    let toggle = NSSwitch()
    toggle.controlSize = .mini
    toggle.target = self
    toggle.action = #selector(flip(_:))
    toggle.identifier = NSUserInterfaceItemIdentifier(name)
    toggle.setAccessibilityLabel(label)
    switches[name] = toggle
    return toggle
  }

  @objc private func flip(_ sender: NSSwitch) {
    guard let name = sender.identifier?.rawValue else { return }
    model.set([name: sender.state == .on ? "true" : nil], named: "Change \(name.capitalized)")
  }

  @objc private func toggleSides(_ sender: Any?) {
    eachSide.toggle()
    shape = ""
    refresh()
  }

  @objc private func toggleShadow(_ sender: Any?) {
    let shadowed = model.selectedBox?.box.style.shadows.isEmpty == false
    model.set(["shadow": shadowed ? nil : "0 8 24 #00000026"], named: shadowed ? "Remove Shadow" : "Add Shadow")
  }

  private func color(_ name: String, _ label: String) {
    let well = NSColorWell(style: .minimal)
    well.identifier = NSUserInterfaceItemIdentifier(name)
    well.target = self
    well.action = #selector(colorChanged(_:))
    well.setAccessibilityLabel("\(label) colour")
    well.square(NyteControl.sm)
    wells[name] = well
    let tokens = GhostButton(
      symbol: "paintpalette", label: "Colour Tokens", size: .sm, target: self, action: #selector(showTokens(_:)))
    tokens.identifier = NSUserInterfaceItemIdentifier(name)
    row(label, [well, text(name, label), tokens])
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

  @objc private func showTokens(_ sender: NSButton) {
    guard let name = sender.identifier?.rawValue, let selection = model.selection,
      let scope = model.project?.scope(selection.site.file)
    else { return }
    let dark = model.selectedBox?.box.mode == .dark
    let menu = NSMenu()
    for token in scope.colors.keys.sorted() {
      let item = menu.addItem(withTitle: token, action: #selector(chooseToken(_:)), keyEquivalent: "")
      item.target = self
      item.identifier = NSUserInterfaceItemIdentifier(name)
      item.representedObject = "$" + token
      if let value = scope.colors[token], let color = parseColor(dark ? value.dark ?? value.light : value.light) {
        item.image = swatch(color)
      }
    }
    if name != "color" {
      menu.addItem(.separator())
      let none = menu.addItem(withTitle: "None", action: #selector(chooseToken(_:)), keyEquivalent: "")
      none.target = self
      none.identifier = NSUserInterfaceItemIdentifier(name)
      none.representedObject = "none"
    }
    menu.popUp(positioning: nil, at: NSPoint(x: 0, y: sender.bounds.maxY + NyteSpace.s1.rawValue), in: sender)
  }

  @objc private func chooseToken(_ sender: NSMenuItem) {
    guard let name = sender.identifier?.rawValue, let value = sender.representedObject as? String else { return }
    model.set([name: value], named: "Change Color")
  }

  private func swatch(_ color: RGBA) -> NSImage {
    let side = NyteGlyph.sm.rawValue
    return NSImage(size: NSSize(width: side, height: side), flipped: false) { rect in
      let shape = NSBezierPath(ovalIn: rect.insetBy(dx: NyteSpace.px.rawValue, dy: NyteSpace.px.rawValue))
      NSColor(srgbRed: color.red, green: color.green, blue: color.blue, alpha: color.alpha).setFill()
      shape.fill()
      NSColor.nyte(.strokeTertiary).setStroke()
      shape.stroke()
      return true
    }
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
    let flush = [String(lines[0])] + lines.dropFirst().map { String($0.dropFirst(min(indent, $0.count))) }
    let limit = 12
    guard flush.count > limit else { return flush.joined(separator: "\n") }
    let rest = flush.count - limit
    return (flush.prefix(limit) + ["… \(rest) more line\(rest == 1 ? "" : "s")"]).joined(separator: "\n")
  }
}

private final class SourceBox: AppearanceView {
  init(_ label: NSTextField) {
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false
    layer?.cornerRadius = NyteRadius.control.rawValue
    layer?.cornerCurve = .continuous
    addSubview(label)
    label.pin(to: self, insets: .all(.s2))
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  override func applyColors() {
    layer?.backgroundColor = NyteRole.fillTertiary.cgColor(dark: isDark)
  }
}
