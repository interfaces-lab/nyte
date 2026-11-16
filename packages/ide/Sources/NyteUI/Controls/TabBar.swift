import AppKit

@MainActor
public final class TabBar: Control, NSViewToolTipOwner {
    public enum Style: Sendable { case file, plain }

    public struct Item: Equatable {
        public var title: String
        public var icon: NSImage?
        public var count: Int?
        public var toolTip: String
        public var isDirty: Bool
        public var isPreview: Bool
        public var isClosable: Bool

        public init(_ title: String, icon: NSImage? = nil, count: Int? = nil, toolTip: String = "",
                    isDirty: Bool = false, isPreview: Bool = false, isClosable: Bool = true) {
            self.title = title
            self.icon = icon
            self.count = count
            self.toolTip = toolTip
            self.isDirty = isDirty
            self.isPreview = isPreview
            self.isClosable = isClosable
        }
    }

    public var items: [Item] = [] { didSet { itemsDidChange(from: oldValue) } }
    public var selectedIndex: Int? { didSet { if selectedIndex != oldValue { revealSelection(); noteFocusRingMaskChanged() } } }
    public let style: Style
    public var onSelect: ((Int) -> Void)?
    public var onClose: ((Int) -> Void)?
    public var onMove: ((Int, Int) -> Void)?
    public var menuForTab: ((Int) -> NSMenu?)?

    static let gap = Space.x05
    static let closeSlot = Glyph.md.rawValue
    static let closeGlyph = Glyph.xxs
    static let iconGap = Space.x15
    static let closeGap = Space.x1
    static let countGap = Space.x1
    static let paddingStart = Space.x2
    static let listSize = Size.sm
    static let listGap = Space.x1
    static let editedWord = "edited"

    var height: CGFloat { style == .file ? Metric.tab : Metric.toolTab }
    var radius: CGFloat { style == .file ? Radius.control : Radius.small }
    var textStyle: TextStyle { style == .file ? .sm : .base }
    var paddingEnd: CGFloat { style == .file ? Space.x15 : Space.x1 }

    var widths: [CGFloat] = []
    var offsets: [CGFloat] = []
    var shown: [CGFloat] = []
    var contentWidth: CGFloat = 0
    var scroll: CGFloat = 0 { didSet { if scroll != oldValue { scrollDidChange() } } }
    var hovered: Int? { didSet { if hovered != oldValue { needsDisplay = true } } }
    var hoveringClose = false { didSet { if hoveringClose != oldValue { needsDisplay = true } } }
    var pressingClose: Int? { didSet { if pressingClose != oldValue { needsDisplay = true } } }
    var drag: (index: Int, x: CGFloat, target: Int)?
    var pendingMove: (from: Int, to: Int, x: CGFloat)?
    var slide: (from: [CGFloat], start: CFTimeInterval)?
    var slideGoal: [CGFloat] = []
    var link: CADisplayLink?
    let listButton = Button(symbol: "chevron.down", label: "Show All Tabs", size: TabBar.listSize)

    private func italic(_ weight: NSFont.Weight) -> NSFont {
        NSFontManager.shared.convert(textStyle.font(weight), toHaveTrait: .italicFontMask)
    }

    public init(style: Style, label: String) {
        self.style = style
        super.init(label: label)
        tracksMovement = true
        setAccessibilityRole(.tabGroup)
        setContentHuggingPriority(.required, for: .vertical)
        listButton.isHidden = true
        listButton.menuProvider = { [weak self] in self?.tabMenu() }
        addSubview(listButton)
        NSLayoutConstraint.activate([
            listButton.trailingAnchor.constraint(equalTo: trailingAnchor),
            listButton.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
    }

    override public var intrinsicContentSize: NSSize { NSSize(width: NSView.noIntrinsicMetric, height: height) }

    private func naturalWidth(_ item: Item) -> CGFloat {
        let title = Draw.width(of: item.title, style: textStyle, weight: .medium)
        var width = Self.paddingStart + title + (item.isClosable || style == .file ? paddingEnd : Self.paddingStart)
        if style == .file {
            width += Self.closeSlot + Self.iconGap + Self.closeGap + Self.closeSlot
            return min(max(width, Metric.tabMin), Metric.tabMax)
        }
        if let count = item.count { width += Self.countGap + Draw.width(of: String(count), style: textStyle, tabular: true) }
        if item.isClosable { width += Self.closeGap + Self.closeSlot }
        return width
    }

    func measure() {
        widths = items.map(naturalWidth)
        var x: CGFloat = 0
        offsets = widths.map { width in
            defer { x += width + Self.gap }
            return x
        }
        contentWidth = max(0, x - Self.gap)
        updateOverflow()
        clampScroll()
        needsDisplay = true
        updateToolTips()
        NSAccessibility.post(element: self, notification: .layoutChanged)
    }

    private func itemsDidChange(from old: [Item]) {
        let previous = shown
        measure()
        defer { pendingMove = nil }
        if let move = pendingMove, old.count == items.count, items.indices.contains(move.to),
           old.indices.contains(move.from), items[move.to] == old[move.from], previous.count == items.count {
            var start = previous
            start.remove(at: move.from)
            start.insert(move.x, at: move.to)
            animate(from: start)
            return
        }
        if items.map(\.title) != old.map(\.title) || items.count != old.count { shown = offsets; slide = nil }
    }

    override public func layout() {
        super.layout()
        updateOverflow()
        if shown.count != offsets.count { shown = offsets }
        clampScroll()
        revealSelection()
        updateToolTips()
    }

    var overflows: Bool { contentWidth > bounds.width }

    var stripWidth: CGFloat { overflows ? max(0, bounds.width - Self.listSize.height - Self.listGap) : bounds.width }

    private func updateOverflow() {
        guard listButton.isHidden == overflows else { return }
        listButton.isHidden = !overflows
        NSAccessibility.post(element: self, notification: .layoutChanged)
    }

    var tabY: CGFloat { ((bounds.height - height) / 2).rounded() }

    func tabRect(_ index: Int) -> NSRect {
        let x = drag?.index == index ? drag?.x ?? 0 : (shown.indices.contains(index) ? shown[index] : offsets[index])
        return NSRect(x: (x - scroll).rounded(), y: tabY, width: widths[index], height: height)
    }

    func closeRect(_ index: Int) -> NSRect { closeSlot(in: tabRect(index)) }

    func closeSlot(in tab: NSRect) -> NSRect {
        NSRect(x: tab.maxX - paddingEnd - Self.closeSlot, y: (tab.midY - Self.closeSlot / 2).rounded(),
                      width: Self.closeSlot, height: Self.closeSlot)
    }

    func showsClose(_ index: Int) -> Bool {
        items[index].isClosable && drag == nil && (index == selectedIndex || index == hovered)
    }

    func clampScroll() {
        let clamped = min(max(scroll, 0), max(0, contentWidth - stripWidth))
        if clamped != scroll { scroll = clamped }
    }

    private func scrollDidChange() {
        needsDisplay = true
        updateToolTips()
    }

    func revealSelection() {
        guard let index = selectedIndex else { return needsDisplay = true }
        reveal(index)
    }

    func reveal(_ index: Int) {
        guard offsets.indices.contains(index), bounds.width > 0 else { return needsDisplay = true }
        let left = offsets[index], right = left + widths[index]
        if left < scroll { scroll = left } else if right > scroll + stripWidth { scroll = right - stripWidth }
        clampScroll()
        needsDisplay = true
    }

    func tabMenu() -> NSMenu {
        let menu = NSMenu(title: accessibilityLabel() ?? "")
        menu.autoenablesItems = false
        for index in items.indices {
            let item = items[index]
            let entry = ClosureMenuItem(title: item.title, action: #selector(ClosureMenuItem.fire), keyEquivalent: "")
            entry.target = entry
            entry.handler = { [weak self] in self?.choose(index) }
            entry.state = index == selectedIndex ? .on : .off
            if let icon = item.icon?.copy() as? NSImage {
                icon.size = NSSize(width: Glyph.md.rawValue, height: Glyph.md.rawValue)
                entry.image = icon
                entry.preferredImageVisibility = .visible
            }
            menu.addItem(entry)
        }
        return menu
    }

    func choose(_ index: Int) {
        guard items.indices.contains(index) else { return }
        if index != selectedIndex { onSelect?(index) }
        reveal(index)
    }

    override public var outline: NSBezierPath {
        guard let index = selectedIndex, items.indices.contains(index) else { return Shape.rounded(bounds, radius: radius) }
        return Shape.rounded(tabRect(index), radius: radius)
    }

    override public var focusRingMaskBounds: NSRect { outline.bounds }

    override public func draw(_ dirtyRect: NSRect) {
        let strip = NSRect(x: bounds.minX, y: bounds.minY, width: stripWidth, height: bounds.height)
        NSBezierPath(rect: strip).addClip()
        for index in items.indices where index != drag?.index {
            guard let rect = visiblePart(of: tabRect(index), in: strip), rect.intersects(dirtyRect) else { continue }
            drawTab(index, in: rect)
        }
        if let drag { drawTab(drag.index, in: tabRect(drag.index)) }
    }

    private func visiblePart(of tab: NSRect, in strip: NSRect) -> NSRect? {
        let visible = tab.intersection(strip)
        guard visible.width < tab.width else { return tab }
        return visible.width >= Self.legiblePart ? visible : nil
    }

    static let legiblePart = Metric.tabMin

    private func drawTab(_ index: Int, in rect: NSRect) {
        let item = items[index]
        let selected = index == selectedIndex
        let hovering = index == hovered && drag == nil
        if drag?.index == index {
            NSGraphicsContext.saveGraphicsState()
            Elevation.sm.shadow(flipped: true).set()
            Draw.fill(rect, radius: radius, color: Palette.bgElevated)
            NSGraphicsContext.restoreGraphicsState()
        }
        var state: Interaction = []
        if selected || drag?.index == index { state.insert(.on) }
        if hovering { state.insert(.hovered) }
        if let fill = Stairs.fill(state) { Draw.fill(rect, radius: radius, color: fill) }
        if state.contains(.on) { Draw.ring(rect, radius: radius, color: Palette.strokeQuaternary) }
        let ink = selected || hovering ? Palette.contentPrimary : Palette.contentSecondary
        let weight: NSFont.Weight = selected ? .medium : .regular
        var x = rect.minX + Self.paddingStart
        if style == .file {
            let slot = NSRect(x: x, y: (rect.midY - Self.closeSlot / 2).rounded(), width: Self.closeSlot, height: Self.closeSlot)
            if let icon = item.icon {
                if icon.isTemplate { Draw.glyph(icon, centeredIn: slot, ink: ink) }
                else { icon.draw(in: slot, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil) }
            }
            x = slot.maxX + Self.iconGap
        }
        let trailing = item.isClosable || style == .file ? closeSlot(in: rect).minX - Self.closeGap : rect.maxX - Self.paddingStart
        let countText = item.count.map(String.init) ?? ""
        let countWidth = countText.isEmpty ? 0 : Draw.width(of: countText, style: textStyle, tabular: true) + Self.countGap
        let titleWidth = min(Draw.width(of: item.title, style: textStyle, weight: weight), trailing - countWidth - x)
        Draw.text(item.title, in: NSRect(x: x, y: rect.minY, width: titleWidth, height: rect.height), style: textStyle, ink: ink,
                  weight: weight, font: item.isPreview && style == .file ? italic(weight) : nil)
        if !countText.isEmpty {
            Draw.text(countText, in: NSRect(x: x + titleWidth + Self.countGap, y: rect.minY, width: countWidth, height: rect.height),
                      style: textStyle, ink: Palette.contentTertiary, tabular: true)
        }
        drawCloseSlot(index, item: item, ink: ink, slot: closeSlot(in: rect))
    }

    private func drawCloseSlot(_ index: Int, item: Item, ink: NSColor, slot: NSRect) {
        if showsClose(index) && (!item.isDirty || index == hovered) {
            let hot = index == hovered && hoveringClose
            if hot || pressingClose == index {
                Draw.fill(slot, radius: Radius.indicator, color: pressingClose == index ? Palette.fillPrimary : Palette.fillSecondary)
            }
            if let cross = Symbol.image("xmark", glyph: Self.closeGlyph, weight: .semibold) {
                Draw.glyph(cross, centeredIn: slot, ink: hot ? Palette.contentPrimary : ink)
            }
        } else if item.isDirty {
            Draw.dot(in: slot, diameter: Metric.smallDot, color: ink)
        }
    }

    private func updateToolTips() {
        removeAllToolTips()
        for index in items.indices where !items[index].toolTip.isEmpty {
            let rect = tabRect(index).intersection(NSRect(x: bounds.minX, y: bounds.minY, width: stripWidth, height: bounds.height))
            if !rect.isEmpty { addToolTip(rect, owner: self, userData: nil) }
        }
    }

    public func view(_ view: NSView, stringForToolTip tag: NSView.ToolTipTag, point: NSPoint,
                     userData data: UnsafeMutableRawPointer?) -> String {
        index(at: point).map { items[$0].toolTip } ?? ""
    }

    func index(at point: NSPoint) -> Int? {
        guard bounds.contains(point), point.x < bounds.minX + stripWidth else { return nil }
        return items.indices.first { tabRect($0).contains(point) }
    }

    override public func accessibilityChildren() -> [Any]? {
        let tabs: [Any] = items.indices.map { index in
            let label = items[index].isDirty ? "\(items[index].title), \(Self.editedWord)" : items[index].title
            let element = PressableElement.make(role: .radioButton, label: label,
                                                frame: tabRect(index), parent: self) { [weak self] in self?.onSelect?(index) }
            element.setAccessibilitySubrole(.tabButtonSubrole)
            element.setAccessibilityValue(index == selectedIndex ? 1 : 0)
            if items[index].isClosable {
                element.setAccessibilityCustomActions([NSAccessibilityCustomAction(name: "Close") { [weak self] in
                    MainActor.assumeIsolated { self?.onClose?(index) }
                    return true
                }])
            }
            return element
        }
        return listButton.isHidden ? tabs : tabs + [listButton]
    }

    override public func accessibilityPerformPress() -> Bool { false }
    override public func press() {}
}
