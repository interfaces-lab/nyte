import AppKit

open class AppearanceView: NSView {
  public override init(frame: NSRect) {
    super.init(frame: frame)
    wantsLayer = true
  }

  public required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  open override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    applyColors()
  }

  open override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    applyColors()
  }

  open func applyColors() {}

  public var isDark: Bool { effectiveAppearance.isDark }
}

public final class Hairline: AppearanceView {
  private let role: NyteRole

  public init(_ role: NyteRole = .strokeQuaternary) {
    self.role = role
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false
    heightAnchor.constraint(equalToConstant: NyteSpace.px.rawValue).isActive = true
  }

  public required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  public override func applyColors() {
    layer?.backgroundColor = role.cgColor(dark: isDark)
  }
}

public enum NyteShape: Sendable {
  case radius(NyteRadius)
  case pill(NyteControl)

  public var cornerRadius: CGFloat {
    switch self {
    case .radius(let radius): return radius.rawValue
    case .pill(let control): return control.rawValue / 2
    }
  }
}

public final class FloatingSurface: AppearanceView {
  public let contentView = NSView()
  private let blur = NSVisualEffectView()
  private let tint = NSView()
  private let radius: CGFloat

  public init(_ shape: NyteShape) {
    radius = shape.cornerRadius
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false
    layer?.masksToBounds = false
    shadow = NSShadow()

    blur.material = .popover
    blur.blendingMode = .withinWindow
    blur.state = .active
    blur.wantsLayer = true
    blur.layer?.cornerRadius = radius
    blur.layer?.cornerCurve = .continuous
    blur.layer?.masksToBounds = true
    tint.wantsLayer = true
    tint.layer?.cornerRadius = radius
    tint.layer?.cornerCurve = .continuous
    tint.layer?.borderWidth = 1

    for view in [blur, tint, contentView] {
      view.translatesAutoresizingMaskIntoConstraints = false
      addSubview(view)
      NSLayoutConstraint.activate([
        view.leadingAnchor.constraint(equalTo: leadingAnchor), view.trailingAnchor.constraint(equalTo: trailingAnchor),
        view.topAnchor.constraint(equalTo: topAnchor), view.bottomAnchor.constraint(equalTo: bottomAnchor),
      ])
    }
  }

  public required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  public override func applyColors() {
    tint.layer?.backgroundColor = NyteRole.popupMaterial.cgColor(dark: isDark)
    tint.layer?.borderColor = NyteRole.strokeTertiary.cgColor(dark: isDark)
    layer?.shadowColor = CGColor(srgbRed: 0.165, green: 0.11, blue: 0, alpha: 1)
    layer?.shadowOpacity = isDark ? 0.4 : 0.12
    layer?.shadowRadius = 14
    layer?.shadowOffset = CGSize(width: 0, height: -8)
  }

  public override func layout() {
    super.layout()
    layer?.shadowPath = CGPath(
      roundedRect: bounds, cornerWidth: min(radius, bounds.height / 2),
      cornerHeight: min(radius, bounds.height / 2), transform: nil)
  }
}

public final class GlassSurface: NSView {
  public let contentView = NSView()

  public init(_ shape: NyteShape) {
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false
    contentView.translatesAutoresizingMaskIntoConstraints = false
    let glass = NSGlassEffectView()
    glass.cornerRadius = shape.cornerRadius
    glass.contentView = contentView
    glass.translatesAutoresizingMaskIntoConstraints = false
    addSubview(glass)
    NSLayoutConstraint.activate([
      glass.leadingAnchor.constraint(equalTo: leadingAnchor), glass.trailingAnchor.constraint(equalTo: trailingAnchor),
      glass.topAnchor.constraint(equalTo: topAnchor), glass.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])
  }

  public required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }
}

public final class GhostButton: NSButton {
  public var isOn = false { didSet { needsDisplay = true } }
  private var hovered = false
  private var tracking: NSTrackingArea?
  private let size: NyteControl
  private let radius: CGFloat

  public init(
    symbol: String, label: String, size: NyteControl = .md, round: Bool = false, target: AnyObject?,
    action: Selector?
  ) {
    self.size = size
    radius = round ? size.rawValue / 2 : size.cornerRadius
    super.init(frame: .zero)
    isBordered = false
    bezelStyle = .regularSquare
    imagePosition = .imageOnly
    setButtonType(.momentaryChange)
    self.target = target
    self.action = action
    toolTip = label
    setAccessibilityLabel(label)
    setSymbol(symbol)
    square(size)
  }

  public required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  public func setSymbol(_ name: String) {
    image = NSImage(systemSymbolName: name, accessibilityDescription: nil)?
      .withSymbolConfiguration(.init(pointSize: size.glyph.pointSize, weight: .medium))
    contentTintColor = .nyte(.contentSecondary)
  }

  public override var alignmentRectInsets: NSEdgeInsets { NSEdgeInsetsZero }

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

  public override func draw(_ dirtyRect: NSRect) {
    let pressed = isHighlighted || isOn
    if pressed || hovered {
      NSColor.nyte(pressed ? .fillSecondary : .fillTertiary).setFill()
      NSBezierPath(roundedRect: bounds, xRadius: radius, yRadius: radius).fill()
    }
    super.draw(dirtyRect)
  }
}

public final class MoonView: NSView {
  private let side: CGFloat

  public init(_ size: NyteControl) {
    side = size.rawValue
    super.init(frame: NSRect(x: 0, y: 0, width: side, height: side))
    square(size)
  }

  public init(_ metric: NyteMetric) {
    side = metric.rawValue
    super.init(frame: NSRect(x: 0, y: 0, width: side, height: side))
    square(metric)
  }

  public required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  public override var intrinsicContentSize: NSSize { NSSize(width: side, height: side) }

  public override func draw(_ dirtyRect: NSRect) {
    MoonView.draw(in: bounds)
  }

  public static func draw(in rect: NSRect) {
    guard let context = NSGraphicsContext.current?.cgContext else { return }
    context.saveGState()
    context.addEllipse(in: rect)
    context.clip()
    let colors = [NyteMoon.rim, NyteMoon.body]
    if let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: colors as CFArray, locations: [0, 0.7]) {
      context.drawLinearGradient(
        gradient, start: CGPoint(x: rect.minX, y: rect.minY), end: CGPoint(x: rect.maxX, y: rect.maxY), options: [])
    }
    let light = CGRect(
      x: rect.minX + rect.width / 3, y: rect.minY + rect.height / 3, width: rect.width * 2 / 3,
      height: rect.height * 2 / 3)
    context.setShadow(
      offset: CGSize(width: -rect.width * 0.03, height: -rect.width * 0.03), blur: rect.width * 0.1,
      color: CGColor(srgbRed: 0.05, green: 0.06, blue: 0.13, alpha: 0.4))
    context.setFillColor(NyteMoon.light)
    context.fillEllipse(in: light)
    context.restoreGState()
  }

  public static func image(_ glyph: NyteGlyph) -> NSImage {
    NSImage(size: NSSize(width: glyph.rawValue, height: glyph.rawValue), flipped: false) { rect in
      draw(in: rect)
      return true
    }
  }
}

extension NSTextField {
  public static func nyteLabel(
    _ text: String = "", _ style: NyteText = .base, _ weight: NSFont.Weight = .regular,
    _ role: NyteRole = .contentPrimary
  ) -> NSTextField {
    let label = NSTextField(labelWithString: text)
    label.font = .nyte(style, weight)
    label.textColor = .nyte(role)
    label.lineBreakMode = .byTruncatingTail
    label.translatesAutoresizingMaskIntoConstraints = false
    return label
  }

  public static func nyteWrapping(
    _ text: String = "", _ style: NyteText = .base, _ role: NyteRole = .contentPrimary
  ) -> NSTextField {
    let label = NSTextField(wrappingLabelWithString: text)
    label.font = .nyte(style)
    label.textColor = .nyte(role)
    label.isSelectable = false
    label.translatesAutoresizingMaskIntoConstraints = false
    return label
  }
}
