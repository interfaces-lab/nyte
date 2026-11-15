import AppKit
import NyteDesign

/// The open files, drawn in the titlebar row above the editor pane. One view draws every tab from
/// a flat array; there is no view per tab. Tabs are flat fills, never glass: they are clicked
/// constantly, and the selected one takes the pane's own surface so it reads as part of it.
@MainActor
final class TabStripView: NSView {
    struct Item: Equatable {
        var title: String
        var detail: String
        var isDirty: Bool
        var isPreview: Bool
    }

    var items: [Item] = [] { didSet { if items != oldValue { measure() } } }
    var selectedIndex: Int? { didSet { if selectedIndex != oldValue { revealSelection() } } }
    var onSelect: ((Int) -> Void)?
    var onClose: ((Int) -> Void)?
    var menuForTab: ((Int) -> NSMenu?)?

    private var widths: [CGFloat] = []
    private var offsets: [CGFloat] = []
    private var contentWidth: CGFloat = 0
    private var scroll: CGFloat = 0 { didSet { needsDisplay = true; updateFade() } }
    private var hovered: Int? { didSet { if hovered != oldValue { needsDisplay = true } } }
    private var hoveringClose = false { didSet { if hoveringClose != oldValue { needsDisplay = true } } }
    private let fade = CAGradientLayer()

    private static let padding: CGFloat = 10
    private static let closeSlot: CGFloat = 16
    private static let gap: CGFloat = 2
    private static let minWidth: CGFloat = 72
    private static let maxWidth: CGFloat = 200
    private static let fadeWidth: CGFloat = 12

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        fade.startPoint = CGPoint(x: 0, y: 0.5)
        fade.endPoint = CGPoint(x: 1, y: 0.5)
        layer?.mask = fade
        setAccessibilityRole(.tabGroup)
        setAccessibilityLabel("Open files")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isFlipped: Bool { true }
    override var mouseDownCanMoveWindow: Bool { false }

    // MARK: Layout

    private func attributes(_ item: Item, selected: Bool) -> [NSAttributedString.Key: Any] {
        let base = TextStyle.sm.font(.regular)
        let font = item.isPreview ? NSFontManager.shared.convert(base, toHaveTrait: .italicFontMask) : base
        return [.font: font, .foregroundColor: selected ? Palette.contentPrimary : Palette.contentSecondary]
    }

    private func measure() {
        widths = items.map { item in
            let text = ceil((item.title as NSString).size(withAttributes: attributes(item, selected: true)).width)
            let natural = Self.padding + text + Space.x15 + Self.closeSlot + Space.x15
            return min(max(natural, Self.minWidth), Self.maxWidth)
        }
        var x: CGFloat = 0
        offsets = widths.map { width in
            defer { x += width + Self.gap }
            return x
        }
        contentWidth = max(0, x - Self.gap)
        clampScroll()
        needsDisplay = true
        NSAccessibility.post(element: self, notification: .layoutChanged)
    }

    override func layout() {
        super.layout()
        fade.frame = bounds
        clampScroll()
        revealSelection()
    }

    private var tabY: CGFloat { ((bounds.height - Metric.tab) / 2).rounded() }

    private func tabRect(_ index: Int) -> NSRect {
        NSRect(x: offsets[index] - scroll, y: tabY, width: widths[index], height: Metric.tab)
    }

    private func closeRect(_ index: Int) -> NSRect {
        let tab = tabRect(index)
        return NSRect(
            x: tab.maxX - Space.x15 - Self.closeSlot, y: tab.midY - Self.closeSlot / 2,
            width: Self.closeSlot, height: Self.closeSlot
        )
    }

    private func clampScroll() {
        let limit = max(0, contentWidth - bounds.width)
        let clamped = min(max(scroll, 0), limit)
        if clamped != scroll { scroll = clamped } else { updateFade() }
    }

    private func revealSelection() {
        guard let index = selectedIndex, index < offsets.count, bounds.width > 0 else { return needsDisplay = true }
        let left = offsets[index], right = left + widths[index]
        if left < scroll { scroll = left } else if right > scroll + bounds.width { scroll = right - bounds.width }
        clampScroll()
        needsDisplay = true
    }

    /// Fades the edge that has more tabs beyond it, so a cut tab never ends on a hard line.
    private func updateFade() {
        let width = max(bounds.width, 1)
        let leading = scroll > 0.5 ? Self.fadeWidth / width : 0
        let trailing = contentWidth - scroll > bounds.width + 0.5 ? Self.fadeWidth / width : 0
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        fade.colors = [NSColor.clear.cgColor, NSColor.black.cgColor, NSColor.black.cgColor, NSColor.clear.cgColor]
        fade.locations = [0, NSNumber(value: leading), NSNumber(value: 1 - trailing), 1]
        if leading == 0 { fade.colors?[0] = NSColor.black.cgColor }
        if trailing == 0 { fade.colors?[3] = NSColor.black.cgColor }
        CATransaction.commit()
    }

    // MARK: Drawing

    override func draw(_ dirtyRect: NSRect) {
        for index in items.indices {
            let rect = tabRect(index)
            guard rect.intersects(dirtyRect) else { continue }
            draw(items[index], in: rect, index: index)
        }
    }

    private func draw(_ item: Item, in rect: NSRect, index: Int) {
        let selected = index == selectedIndex
        let hovering = index == hovered
        if selected {
            Palette.bgBase.setFill()
            NSBezierPath(roundedRect: rect, xRadius: Radius.control, yRadius: Radius.control).fill()
            Palette.strokeQuaternary.setStroke()
            let ring = NSBezierPath(
                roundedRect: rect.insetBy(dx: 0.5, dy: 0.5), xRadius: Radius.control - 0.5, yRadius: Radius.control - 0.5
            )
            ring.lineWidth = 1
            ring.stroke()
        } else if hovering {
            Palette.fillTertiary.setFill()
            NSBezierPath(roundedRect: rect, xRadius: Radius.control, yRadius: Radius.control).fill()
        }

        let title = NSAttributedString(string: item.title, attributes: attributes(item, selected: selected || hovering))
        let close = closeRect(index)
        let textHeight = ceil(title.size().height)
        let textRect = NSRect(
            x: rect.minX + Self.padding, y: rect.midY - textHeight / 2,
            width: close.minX - Space.x15 - rect.minX - Self.padding, height: textHeight
        )
        title.draw(with: textRect, options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])

        if hovering || (selected && !item.isDirty) {
            if hovering, hoveringClose {
                Palette.fillSecondary.setFill()
                NSBezierPath(roundedRect: close, xRadius: Radius.indicator, yRadius: Radius.indicator).fill()
            }
            let ink = hovering && hoveringClose ? Palette.contentPrimary : Palette.contentTertiary
            drawCross(in: close, color: ink)
        } else if item.isDirty {
            Palette.contentTertiary.setFill()
            NSBezierPath(ovalIn: NSRect(x: close.midX - 3, y: close.midY - 3, width: 6, height: 6)).fill()
        }
    }

    private func drawCross(in rect: NSRect, color: NSColor) {
        let arm: CGFloat = 3.25
        let path = NSBezierPath()
        path.move(to: NSPoint(x: rect.midX - arm, y: rect.midY - arm))
        path.line(to: NSPoint(x: rect.midX + arm, y: rect.midY + arm))
        path.move(to: NSPoint(x: rect.midX + arm, y: rect.midY - arm))
        path.line(to: NSPoint(x: rect.midX - arm, y: rect.midY + arm))
        path.lineWidth = 1.25
        path.lineCapStyle = .round
        color.setStroke()
        path.stroke()
    }

    // MARK: Pointer

    private func index(at point: NSPoint) -> Int? {
        items.indices.first { tabRect($0).contains(point) }
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(
            rect: bounds, options: [.mouseEnteredAndExited, .mouseMoved, .activeInKeyWindow, .inVisibleRect], owner: self
        ))
    }

    override func mouseMoved(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        hovered = index(at: point)
        hoveringClose = hovered.map { closeRect($0).contains(point) } ?? false
        toolTip = hovered.map { items[$0].detail }
    }

    override func mouseExited(with event: NSEvent) {
        hovered = nil
        hoveringClose = false
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        guard let index = index(at: point) else {
            return event.clickCount == 2 ? TitlebarDragView.performDoubleClick(in: window) : window?.performDrag(with: event) ?? ()
        }
        guard closeRect(index).contains(point) else { return onSelect?(index) ?? () }
        while let next = window?.nextEvent(matching: [.leftMouseUp, .leftMouseDragged]) {
            guard next.type == .leftMouseUp else { continue }
            if closeRect(index).contains(convert(next.locationInWindow, from: nil)) { onClose?(index) }
            return
        }
    }

    override func otherMouseUp(with event: NSEvent) {
        guard event.buttonNumber == 2, let index = index(at: convert(event.locationInWindow, from: nil)) else { return }
        onClose?(index)
    }

    override func menu(for event: NSEvent) -> NSMenu? {
        index(at: convert(event.locationInWindow, from: nil)).flatMap { menuForTab?($0) }
    }

    override func scrollWheel(with event: NSEvent) {
        let delta = abs(event.scrollingDeltaX) > abs(event.scrollingDeltaY) ? event.scrollingDeltaX : event.scrollingDeltaY
        scroll -= delta
        clampScroll()
    }

    // MARK: Accessibility

    override func accessibilityChildren() -> [Any]? {
        items.indices.map { index in
            let element = NSAccessibilityElement()
            element.setAccessibilityRole(.radioButton)
            element.setAccessibilitySubrole(.tabButtonSubrole)
            element.setAccessibilityLabel(items[index].title)
            element.setAccessibilityValue(index == selectedIndex)
            element.setAccessibilityParent(self)
            element.setAccessibilityFrameInParentSpace(tabRect(index))
            return element
        }
    }
}

/// The empty stretch of the titlebar row: drags the window, and double-click follows the user's
/// system setting for titlebars.
@MainActor
final class TitlebarDragView: NSView {
    override var mouseDownCanMoveWindow: Bool { false }

    override func mouseDown(with event: NSEvent) {
        if event.clickCount == 2 { return Self.performDoubleClick(in: window) }
        window?.performDrag(with: event)
    }

    static func performDoubleClick(in window: NSWindow?) {
        switch UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") {
        case "Minimize": window?.performMiniaturize(nil)
        case "None": break
        default: window?.performZoom(nil)
        }
    }
}
