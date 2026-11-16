import AppKit

public struct PickerSegment: Sendable {
  public let symbol: String?
  public let title: String?
  public let label: String

  public static func symbol(_ name: String, _ label: String) -> PickerSegment {
    PickerSegment(symbol: name, title: nil, label: label)
  }

  public static func title(_ title: String, _ label: String? = nil) -> PickerSegment {
    PickerSegment(symbol: nil, title: title, label: label ?? title)
  }
}

public final class SegmentedPicker: NSView {
  public var onChoose: ((Int) -> Void)?
  public var selected: Int? { didSet { if selected != oldValue { needsDisplay = true } } }

  public var segments: [PickerSegment] {
    didSet {
      invalidateIntrinsicContentSize()
      needsDisplay = true
    }
  }

  private let size: NyteControl
  private var hovered: Int?
  private var tracking: NSTrackingArea?

  public init(label: String, _ segments: [PickerSegment], size: NyteControl = .sm) {
    self.segments = segments
    self.size = size
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false
    setAccessibilityElement(true)
    setAccessibilityRole(.radioGroup)
    setAccessibilityLabel(label)
    setContentHuggingPriority(.defaultLow, for: .horizontal)
    height(size)
  }

  public required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  public override var isFlipped: Bool { true }

  private var font: NSFont { .nyte(.sm, .medium) }

  public override var intrinsicContentSize: NSSize {
    let widest = segments.map { segment -> CGFloat in
      guard let title = segment.title else { return size.rawValue + NyteSpace.s1.rawValue }
      return ceil((title as NSString).size(withAttributes: [.font: font]).width) + NyteSpace.s3.rawValue * 2
    }.max() ?? 0
    return NSSize(width: widest * CGFloat(segments.count), height: size.rawValue)
  }

  private func rect(_ index: Int) -> NSRect {
    let width = bounds.width / CGFloat(max(1, segments.count))
    return NSRect(x: (CGFloat(index) * width).rounded(), y: 0, width: width.rounded(), height: bounds.height)
  }

  private func index(at event: NSEvent) -> Int? {
    let point = convert(event.locationInWindow, from: nil)
    return segments.indices.first { rect($0).contains(point) }
  }

  public override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let tracking { removeTrackingArea(tracking) }
    let area = NSTrackingArea(
      rect: .zero, options: [.mouseEnteredAndExited, .mouseMoved, .activeInKeyWindow, .inVisibleRect], owner: self)
    addTrackingArea(area)
    tracking = area
  }

  public override func mouseMoved(with event: NSEvent) {
    let next = index(at: event)
    if next != hovered {
      hovered = next
      toolTip = next.map { segments[$0].label }
      needsDisplay = true
    }
  }

  public override func mouseExited(with event: NSEvent) {
    hovered = nil
    needsDisplay = true
  }

  public override func mouseDown(with event: NSEvent) {
    guard let index = index(at: event), index != selected else { return }
    selected = index
    onChoose?(index)
  }

  public override func accessibilityValue() -> Any? {
    selected.map { segments[$0].label }
  }

  public override func draw(_ dirtyRect: NSRect) {
    let radius = size.cornerRadius
    NSColor.nyte(.bgMutedTranslucent).setFill()
    NSBezierPath(roundedRect: bounds, xRadius: radius, yRadius: radius).fill()
    for (index, segment) in segments.enumerated() {
      let box = rect(index)
      let chosen = index == selected
      if chosen || index == hovered {
        let inset = NyteSpace.s0_5.rawValue
        (chosen ? NSColor.nyte(.fillSecondary, hue: .blue) : NSColor.nyte(.fillTertiary)).setFill()
        NSBezierPath(
          roundedRect: box.insetBy(dx: inset, dy: inset), xRadius: radius - inset, yRadius: radius - inset
        ).fill()
      }
      let tint: NSColor = chosen ? .nyte(.contentAccent, hue: .blue) : .nyte(.contentSecondary)
      if let symbol = segment.symbol,
        let image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)?
          .withSymbolConfiguration(
            .init(pointSize: NyteGlyph.sm.pointSize, weight: .medium).applying(.init(paletteColors: [tint])))
      {
        image.draw(
          in: NSRect(
            x: box.midX - image.size.width / 2, y: box.midY - image.size.height / 2, width: image.size.width,
            height: image.size.height),
          from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
      } else if let title = segment.title {
        let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: tint]
        let measured = (title as NSString).size(withAttributes: attributes)
        (title as NSString).draw(
          at: NSPoint(x: (box.midX - measured.width / 2).rounded(), y: ((box.height - measured.height) / 2).rounded()),
          withAttributes: attributes)
      }
    }
  }
}
