import AppKit

@MainActor
public final class TextTabs: Control {
    public var titles: [String] { didSet { contentDidChange() } }
    public var selectedIndex: Int {
        didSet {
            guard selectedIndex != oldValue else { return }
            setAccessibilityValue(titles.indices.contains(selectedIndex) ? titles[selectedIndex] : nil)
            noteFocusRingMaskChanged()
            needsDisplay = true
        }
    }
    public var onSelect: ((Int) -> Void)?

    var hoveredTab: Int? { didSet { if hoveredTab != oldValue { needsDisplay = true } } }
    var pressedTab: Int? { didSet { if pressedTab != oldValue { needsDisplay = true } } }

    static let padding = Space.x2
    static let gap = Space.x05
    static let style = TextStyle.base

    public static func selectedFill() -> NSColor { Palette.fillSecondary }

    public init(_ titles: [String], selectedIndex: Int = 0, label: String = "", onSelect: ((Int) -> Void)? = nil) {
        self.titles = titles
        self.selectedIndex = selectedIndex
        super.init(label: label)
        self.onSelect = onSelect
        tracksMovement = true
        setAccessibilityRole(.tabGroup)
        setAccessibilityValue(titles.indices.contains(selectedIndex) ? titles[selectedIndex] : nil)
        setContentHuggingPriority(.required, for: .horizontal)
        setContentHuggingPriority(.required, for: .vertical)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    private func contentDidChange() {
        invalidateIntrinsicContentSize()
        needsDisplay = true
    }

    private func width(_ index: Int) -> CGFloat { (Draw.width(of: titles[index], style: Self.style) + Self.padding * 2).rounded(.up) }

    override public var intrinsicContentSize: NSSize {
        let content = titles.indices.map(width).reduce(0, +) + CGFloat(max(0, titles.count - 1)) * Self.gap
        return NSSize(width: content, height: Size.sm.height)
    }

    func tabRect(_ index: Int) -> NSRect {
        var x = bounds.minX
        for previous in 0..<index { x += width(previous) + Self.gap }
        let height = Size.sm.height
        return NSRect(x: x, y: (bounds.midY - height / 2).rounded(), width: width(index), height: height)
    }

    override public var outline: NSBezierPath { Shape.rounded(bounds, radius: Size.sm.radius) }
    override public var focusRingMaskBounds: NSRect { titles.indices.contains(selectedIndex) ? tabRect(selectedIndex) : bounds }
    override public func drawFocusRingMask() {
        guard titles.indices.contains(selectedIndex) else { return super.drawFocusRingMask() }
        Shape.rounded(tabRect(selectedIndex), radius: Size.sm.radius).fill()
    }

    override public func draw(_ dirtyRect: NSRect) {
        let enabled = isEnabled
        for index in titles.indices {
            let rect = tabRect(index)
            let selected = index == selectedIndex
            let hovered = enabled && index == hoveredTab
            if selected {
                Draw.fill(rect, radius: Size.sm.radius, color: Self.selectedFill())
            } else if enabled && index == pressedTab {
                Draw.fill(rect, radius: Size.sm.radius, color: Palette.fillSecondary)
            } else if hovered {
                Draw.fill(rect, radius: Size.sm.radius, color: Palette.fillTertiary)
            }
            let ink = !enabled ? Palette.contentDisabled : (selected || hovered ? Palette.contentPrimary : Palette.contentSecondary)
            Draw.text(titles[index], in: rect.insetBy(dx: Self.padding, dy: 0), style: Self.style, ink: ink)
        }
    }

    private func tab(at point: NSPoint) -> Int? { titles.indices.first { tabRect($0).insetBy(dx: -Self.gap / 2, dy: 0).contains(point) } }

    override public func mouseMoved(with event: NSEvent) {
        hoveredTab = isEnabled ? tab(at: convert(event.locationInWindow, from: nil)) : nil
    }

    override public func mouseExited(with event: NSEvent) {
        super.mouseExited(with: event)
        hoveredTab = nil
    }

    override public func mouseDown(with event: NSEvent) {
        guard isEnabled, let index = tab(at: convert(event.locationInWindow, from: nil)) else { return }
        pressedTab = index
        while let next = window?.nextEvent(matching: [.leftMouseUp, .leftMouseDragged]) {
            let inside = tab(at: convert(next.locationInWindow, from: nil)) == index
            pressedTab = inside ? index : nil
            guard next.type == .leftMouseUp else { continue }
            pressedTab = nil
            if inside { choose(index) }
            return
        }
        pressedTab = nil
    }

    override public func keyDown(with event: NSEvent) {
        guard isEnabled, !titles.isEmpty else { return super.keyDown(with: event) }
        let forward = userInterfaceLayoutDirection == .rightToLeft ? -1 : 1
        switch event.keyCode {
        case KeyCode.left: choose(max(0, selectedIndex - forward))
        case KeyCode.right: choose(min(titles.count - 1, selectedIndex + forward))
        default: super.keyDown(with: event)
        }
    }

    public func choose(_ index: Int) {
        guard titles.indices.contains(index), index != selectedIndex else { return }
        selectedIndex = index
        sendAction(action, to: target)
        onSelect?(index)
    }

    override public func press() {}

    override public func viewDidHide() {
        super.viewDidHide()
        hoveredTab = nil
    }

    override public func accessibilityChildren() -> [Any]? {
        titles.indices.map { index in
            let element = PressableElement.make(role: .radioButton, label: titles[index], frame: tabRect(index), parent: self) { [weak self] in
                self?.choose(index)
            }
            element.setAccessibilityValue(index == selectedIndex ? 1 : 0)
            return element
        }
    }

    override public func accessibilityPerformPress() -> Bool { false }
}
