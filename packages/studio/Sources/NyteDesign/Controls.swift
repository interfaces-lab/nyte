import AppKit

public final class MenuButton: NSButton {
  public static let padding = NyteSpace.s2

  public var mark: NSImage? {
    didSet {
      invalidateIntrinsicContentSize()
      needsDisplay = true
    }
  }

  public override var title: String {
    didSet {
      invalidateIntrinsicContentSize()
      needsDisplay = true
    }
  }

  private let size: NyteControl
  private let text: NyteText
  private let weight: NSFont.Weight
  private let role: NyteRole
  private let radius: CGFloat
  private let filled: Bool
  private var hovered = false
  private var tracking: NSTrackingArea?

  public init(
    label: String, size: NyteControl = .sm, text: NyteText = .sm, weight: NSFont.Weight = .regular,
    role: NyteRole = .contentSecondary, round: Bool = false, filled: Bool = false
  ) {
    self.size = size
    self.filled = filled
    radius = round ? size.rawValue / 2 : size.cornerRadius
    self.text = text
    self.weight = weight
    self.role = role
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false
    isBordered = false
    setButtonType(.momentaryChange)
    title = ""
    target = self
    action = #selector(open(_:))
    toolTip = label
    setAccessibilityLabel(label)
    setAccessibilityRole(.popUpButton)
    setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    setContentHuggingPriority(.defaultHigh, for: .horizontal)
  }

  public required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  private var attributes: [NSAttributedString.Key: Any] {
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineBreakMode = .byTruncatingTail
    return [
      .font: NSFont.nyte(text, weight), .paragraphStyle: paragraph,
      .foregroundColor: NSColor.nyte(isEnabled ? role : .contentTertiary),
    ]
  }

  private var chevron: NSImage? {
    guard isEnabled else { return nil }
    return NSImage(systemSymbolName: "chevron.up.chevron.down", accessibilityDescription: nil)?
      .withSymbolConfiguration(
        .init(pointSize: NyteGlyph.xxs.pointSize, weight: .semibold)
          .applying(.init(paletteColors: [.nyte(.contentTertiary)])))
  }

  private var markSide: CGFloat { mark == nil ? 0 : size.glyph.rawValue + NyteSpace.s1_5.rawValue }
  private var chevronSide: CGFloat { chevron.map { $0.size.width + NyteSpace.s1.rawValue } ?? 0 }

  public override var intrinsicContentSize: NSSize {
    let title = ceil((title as NSString).size(withAttributes: attributes).width)
    return NSSize(
      width: MenuButton.padding.rawValue * 2 + markSide + title + chevronSide, height: size.rawValue)
  }

  public override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let tracking { removeTrackingArea(tracking) }
    let area = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
    addTrackingArea(area)
    tracking = area
  }

  public override func mouseEntered(with event: NSEvent) {
    hovered = true
    needsDisplay = true
  }

  public override func mouseExited(with event: NSEvent) {
    hovered = false
    needsDisplay = true
  }

  public override func mouseDown(with event: NSEvent) {
    guard isEnabled else { return }
    open(nil)
  }

  public var onTracking: ((Bool) -> Void)?

  @objc private func open(_ sender: Any?) {
    guard let menu, isEnabled else { return }
    isHighlighted = true
    menu.minimumWidth = bounds.width
    onTracking?(true)
    menu.popUp(positioning: nil, at: NSPoint(x: 0, y: bounds.maxY + NyteSpace.s1.rawValue), in: self)
    onTracking?(false)
    isHighlighted = false
    hovered = false
    needsDisplay = true
  }

  public override func draw(_ dirtyRect: NSRect) {
    let shape = NSBezierPath(roundedRect: bounds, xRadius: radius, yRadius: radius)
    if filled {
      NSColor.nyte(.bgMutedTranslucent).setFill()
      shape.fill()
      let edge = NSBezierPath(
        roundedRect: bounds.insetBy(dx: NyteSpace.px.rawValue / 2, dy: NyteSpace.px.rawValue / 2), xRadius: radius,
        yRadius: radius)
      NSColor.nyte(.strokeQuaternary).setStroke()
      edge.lineWidth = NyteSpace.px.rawValue
      edge.stroke()
    }
    if isEnabled, isHighlighted || hovered {
      NSColor.nyte(isHighlighted ? .fillSecondary : .fillTertiary).setFill()
      shape.fill()
    }
    var x = MenuButton.padding.rawValue
    if let mark {
      let side = size.glyph.rawValue
      mark.draw(
        in: NSRect(x: x, y: (bounds.height - side) / 2, width: side, height: side), from: .zero,
        operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
      x += markSide
    }
    let trailing = bounds.width - MenuButton.padding.rawValue - chevronSide
    let height = ceil((title as NSString).size(withAttributes: attributes).height)
    (title as NSString).draw(
      with: NSRect(x: x, y: ((bounds.height - height) / 2).rounded(), width: max(0, trailing - x), height: height),
      options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine], attributes: attributes)
    if let chevron {
      chevron.draw(
        in: NSRect(
          x: bounds.width - MenuButton.padding.rawValue - chevron.size.width,
          y: (bounds.height - chevron.size.height) / 2, width: chevron.size.width, height: chevron.size.height),
        from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
    }
  }
}

public final class NyteField: AppearanceView, NSTextFieldDelegate {
  public var onCommit: ((String) -> Void)?

  public var onScrub: ((String) -> Void)?
  public var step: CGFloat? {
    didSet { input.alignment = step == nil ? .natural : .right }
  }
  public var range: ClosedRange<CGFloat>?

  private let input = FocusTextField()
  private let size: NyteControl
  private var lead: NSView?
  private var shown = ""
  private var hint = ""
  private var focused = false { didSet { applyColors() } }

  public init(
    prefix: String? = nil, symbol: String? = nil, suffix: String? = nil, label: String, size: NyteControl = .sm
  ) {
    self.size = size
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false
    layer?.cornerRadius = size.cornerRadius
    layer?.cornerCurve = .continuous
    layer?.borderWidth = NyteSpace.px.rawValue

    input.isBordered = false
    input.drawsBackground = false
    input.focusRingType = .none
    input.font = .nyte(.sm)
    input.textColor = .nyte(.contentPrimary)
    input.lineBreakMode = .byTruncatingTail
    input.cell?.usesSingleLineMode = true
    input.cell?.sendsActionOnEndEditing = true
    input.delegate = self
    input.target = self
    input.action = #selector(commit(_:))
    input.setAccessibilityLabel(label)
    input.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    input.setContentHuggingPriority(.defaultLow, for: .horizontal)
    input.onFocus = { [weak self] in self?.focused = true }

    var views: [NSView] = [input]
    func fixed(_ view: NSView) {
      view.setContentHuggingPriority(.required, for: .horizontal)
      view.setContentCompressionResistancePriority(.required, for: .horizontal)
      view.setAccessibilityElement(false)
    }
    if let symbol {
      let glyph = NSImageView()
      glyph.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
      glyph.symbolConfiguration = .init(pointSize: NyteGlyph.xs.pointSize, weight: .medium)
      glyph.contentTintColor = .nyte(.contentTertiary)
      glyph.square(NyteGlyph.sm)
      fixed(glyph)
      views.insert(glyph, at: 0)
      lead = glyph
    } else if let prefix {
      let caption = NSTextField.nyteLabel(prefix, .sm, .regular, .contentTertiary)
      fixed(caption)
      views.insert(caption, at: 0)
      lead = caption
    }
    if let suffix {
      let unit = NSTextField.nyteLabel(suffix, .sm, .regular, .contentTertiary)
      fixed(unit)
      views.append(unit)
    }
    let row = NSStackView.row(gap: .s1, align: symbol == nil ? .firstBaseline : .centerY, views)
    addSubview(row)
    row.pin(to: self, insets: NyteInsets(horizontal: .s1_5), edges: .horizontal)
    row.centerYAnchor.constraint(equalTo: centerYAnchor).isActive = true
    height(size)
    setContentHuggingPriority(.defaultLow, for: .horizontal)
  }

  public required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  public func show(value: String, hint: String) {
    input.placeholderAttributedString = NSAttributedString(
      string: hint, attributes: [.font: NSFont.nyte(.sm), .foregroundColor: NSColor.nyte(.contentTertiary)])
    input.toolTip = value.isEmpty ? hint : value
    self.hint = hint
    defer { if hugs { invalidateIntrinsicContentSize() } }
    guard input.currentEditor() == nil || shown == input.stringValue else { return }
    shown = value
    input.stringValue = value
  }

  public override func applyColors() {
    layer?.backgroundColor = NyteRole.fillSecondary.cgColor(dark: isDark)
    layer?.borderColor = focused ? NyteRole.strokeAccent.cgColor(dark: isDark, hue: .blue) : .clear
  }

  public func hugContent() {
    hugs = true
    setContentHuggingPriority(.defaultHigh, for: .horizontal)
    invalidateIntrinsicContentSize()
  }

  private var hugs = false

  public override var intrinsicContentSize: NSSize {
    guard hugs else { return super.intrinsicContentSize }
    let words = input.stringValue.isEmpty ? hint : input.stringValue
    let text = ceil((words as NSString).size(withAttributes: [.font: NSFont.nyte(.sm)]).width)
    let row = subviews.first.map { $0.fittingSize.width - input.fittingSize.width } ?? 0
    return NSSize(width: text + max(0, row) + NyteSpace.s1_5.rawValue * 2 + NyteSpace.s1.rawValue, height: NSView.noIntrinsicMetric)
  }

  public func controlTextDidChange(_ notification: Notification) {
    if hugs { invalidateIntrinsicContentSize() }
  }

  public func focus() {
    window?.makeFirstResponder(input)
    input.currentEditor()?.selectAll(nil)
  }

  private var number: CGFloat? {
    let text = input.stringValue.trimmingCharacters(in: .whitespaces)
    return Double(text.isEmpty ? hint : text).map { CGFloat($0) } ?? Double(hint).map { CGFloat($0) }
  }

  private func format(_ value: CGFloat) -> String {
    let held = range.map { min(max(value, $0.lowerBound), $0.upperBound) } ?? value
    let places: CGFloat = (step ?? 1) < 1 ? 100 : 1
    let rounded = (held * places).rounded() / places
    return rounded == rounded.rounded() ? String(Int(rounded)) : String(Double(rounded))
  }

  private var scrubZone: NSRect {
    guard step != nil, let lead else { return .zero }
    let frame = convert(lead.bounds, from: lead)
    return NSRect(x: 0, y: 0, width: frame.maxX + NyteSpace.s1.rawValue, height: bounds.height)
  }

  public override func resetCursorRects() {
    super.resetCursorRects()
    if !scrubZone.isEmpty { addCursorRect(scrubZone, cursor: .resizeLeftRight) }
  }

  public override func mouseDown(with event: NSEvent) {
    guard let step, let start = number, scrubZone.contains(convert(event.locationInWindow, from: nil)) else {
      window?.makeFirstResponder(input)
      return
    }
    let origin = event.locationInWindow.x
    var last = format(start)
    var moved = false
    while let next = window?.nextEvent(matching: [.leftMouseDragged, .leftMouseUp]) {
      if next.type == .leftMouseUp { break }
      let travel = (next.locationInWindow.x - origin).rounded()
      guard moved || abs(travel) >= 2 else { continue }
      moved = true
      let value = format(start + travel * step * (next.modifierFlags.contains(.shift) ? 10 : 1))
      guard value != last else { continue }
      last = value
      input.stringValue = value
      onScrub?(value)
    }
    guard moved else {
      window?.makeFirstResponder(input)
      return
    }
    shown = last
    onCommit?(last)
  }

  public func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
    guard let step, let value = number else { return false }
    let change: CGFloat
    switch selector {
    case #selector(NSResponder.moveUp(_:)): change = step
    case #selector(NSResponder.moveDown(_:)): change = -step
    case #selector(NSResponder.moveUpAndModifySelection(_:)): change = step * 10
    case #selector(NSResponder.moveDownAndModifySelection(_:)): change = -step * 10
    default: return false
    }
    let next = format(value + change)
    textView.string = next
    textView.selectAll(nil)
    shown = next
    onCommit?(next)
    return true
  }

  public func controlTextDidEndEditing(_ notification: Notification) {
    focused = false
  }

  @objc private func commit(_ sender: Any?) {
    let next = input.stringValue.trimmingCharacters(in: .whitespaces)
    guard next != shown else { return }
    shown = next
    onCommit?(next)
  }
}

private final class FocusTextField: NSTextField {
  var onFocus: (() -> Void)?

  override func becomeFirstResponder() -> Bool {
    let became = super.becomeFirstResponder()
    if became { onFocus?() }
    return became
  }
}
