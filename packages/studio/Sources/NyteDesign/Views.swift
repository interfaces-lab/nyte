import AppKit

/// A view that redraws its layer colours when the appearance changes. Layer colours are
/// resolved CGColors, so they don't follow light and dark on their own.
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

  /// Sets every layer colour for the current appearance.
  open func applyColors() {}

  public var isDark: Bool { effectiveAppearance.isDark }
}

/// A one-pixel separator.
public final class Hairline: AppearanceView {
  private let role: NyteRole

  public init(_ role: NyteRole = .strokeQuaternary) {
    self.role = role
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false
    heightAnchor.constraint(equalToConstant: 1).isActive = true
  }

  public required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  public override func applyColors() {
    layer?.backgroundColor = role.cgColor(dark: isDark)
  }
}

/// Nyte's floating surface for chrome people use all the time: the popup material over a blur
/// of what is behind it, a hairline ring and a soft shadow. It keeps its own colour over any
/// content, which a control floating above someone's design has to.
public final class FloatingSurface: AppearanceView {
  public let contentView = NSView()
  private let blur = NSVisualEffectView()
  private let tint = NSView()
  private let radius: CGFloat

  public init(radius: CGFloat) {
    self.radius = radius
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

/// The system's glass, for the few surfaces that are a moment rather than a tool: what you
/// summon in zen mode, the hand-off to Nyte, the project picker. Controls used many times a
/// minute sit on `FloatingSurface` instead, where nothing shimmers under the pointer.
public final class GlassSurface: NSView {
  public let contentView = NSView()

  public init(radius: CGFloat) {
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false
    contentView.translatesAutoresizingMaskIntoConstraints = false
    let glass = NSGlassEffectView()
    glass.cornerRadius = radius
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

/// A square button with no fill until the pointer is over it: one step of fill on hover, two
/// when pressed or on.
public final class GhostButton: NSButton {
  public var isOn = false { didSet { needsDisplay = true } }
  private var hovered = false
  private var tracking: NSTrackingArea?
  private let side: CGFloat

  public init(symbol: String, label: String, side: CGFloat = NyteControl.md, target: AnyObject?, action: Selector?) {
    self.side = side
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false
    isBordered = false
    bezelStyle = .regularSquare
    imagePosition = .imageOnly
    setButtonType(.momentaryChange)
    self.target = target
    self.action = action
    toolTip = label
    setAccessibilityLabel(label)
    setSymbol(symbol)
    NSLayoutConstraint.activate([
      widthAnchor.constraint(equalToConstant: side), heightAnchor.constraint(equalToConstant: side),
    ])
  }

  public required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  public func setSymbol(_ name: String) {
    image = NSImage(systemSymbolName: name, accessibilityDescription: nil)?
      .withSymbolConfiguration(.init(pointSize: side * 0.46, weight: .medium))
    contentTintColor = .nyte(.contentSecondary)
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

  public override func draw(_ dirtyRect: NSRect) {
    let pressed = isHighlighted || isOn
    if pressed || hovered {
      NSColor.nyte(pressed ? .fillSecondary : .fillTertiary).setFill()
      NSBezierPath(roundedRect: bounds, xRadius: NyteRadius.sm, yRadius: NyteRadius.sm).fill()
    }
    super.draw(dirtyRect)
  }
}

/// The Nyte mark: a moon lit from the upper right.
public final class MoonView: NSView {
  private let side: CGFloat

  public init(side: CGFloat) {
    self.side = side
    super.init(frame: NSRect(x: 0, y: 0, width: side, height: side))
    translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      widthAnchor.constraint(equalToConstant: side), heightAnchor.constraint(equalToConstant: side),
    ])
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
    let colors = [
      CGColor(srgbRed: 0.757, green: 0.816, blue: 0.965, alpha: 1), CGColor(srgbRed: 0.392, green: 0.498, blue: 0.796, alpha: 1),
    ]
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
    context.setFillColor(CGColor(srgbRed: 1, green: 0.976, blue: 0.847, alpha: 1))
    context.fillEllipse(in: light)
    context.restoreGState()
  }

  /// The mark as an image, for a menu item or a toolbar button.
  public static func image(side: CGFloat) -> NSImage {
    NSImage(size: NSSize(width: side, height: side), flipped: false) { rect in
      draw(in: rect)
      return true
    }
  }
}

extension NSTextField {
  /// A label in a step of the type scale and a content role.
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

  /// A label that wraps onto as many lines as it needs.
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

extension NSView {
  /// Pins this view to all four edges of another, with optional insets.
  public func pin(to other: NSView, insets: NSEdgeInsets = NSEdgeInsetsZero) {
    translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      leadingAnchor.constraint(equalTo: other.leadingAnchor, constant: insets.left),
      trailingAnchor.constraint(equalTo: other.trailingAnchor, constant: -insets.right),
      topAnchor.constraint(equalTo: other.topAnchor, constant: insets.top),
      bottomAnchor.constraint(equalTo: other.bottomAnchor, constant: -insets.bottom),
    ])
  }
}
