import AppKit

@MainActor
public final class GutterSplitView: NSSplitView {
    override public var dividerThickness: CGFloat { Metric.gutter }
    override public func drawDivider(in rect: NSRect) {}
}

@MainActor
public final class HairlineSplitView: NSSplitView {
    public static let grabMargin = Space.x1

    override public init(frame: NSRect) {
        super.init(frame: frame)
        dividerStyle = .thin
        translatesAutoresizingMaskIntoConstraints = false
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public var dividerThickness: CGFloat { Metric.hairline }
    override public var dividerColor: NSColor { Palette.strokeQuaternary }

    public func grabRect(around drawn: NSRect) -> NSRect {
        isVertical ? drawn.insetBy(dx: -Self.grabMargin, dy: 0) : drawn.insetBy(dx: 0, dy: -Self.grabMargin)
    }
}

@MainActor
public final class ContentSplitView: NSSplitView {
    public static let grabMargin = Space.x1
    public var onResetDivider: ((Int) -> Void)?

    override public init(frame: NSRect) {
        super.init(frame: frame)
        dividerStyle = .thin
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public var dividerThickness: CGFloat { Metric.hairline }
    override public var dividerColor: NSColor { Palette.strokeQuaternary }

    func divider(at point: NSPoint) -> Int? {
        let panes = arrangedSubviews.filter { !isSubviewCollapsed($0) }
        guard panes.count > 1 else { return nil }
        for index in 0 ..< panes.count - 1 {
            let edge = isVertical ? panes[index].frame.maxX : panes[index].frame.maxY
            let near = isVertical ? abs(point.x - edge) : abs(point.y - edge)
            if near <= Self.grabMargin + dividerThickness { return index }
        }
        return nil
    }

    override public func mouseDown(with event: NSEvent) {
        if event.clickCount == 2, let index = divider(at: convert(event.locationInWindow, from: nil)) {
            onResetDivider?(index)
            return
        }
        super.mouseDown(with: event)
    }
}

@MainActor
open class GutterSplitViewController: NSSplitViewController {
    public var defaultPositions: [Int: CGFloat] = [:]

    public init(vertical: Bool, autosave: String) {
        super.init(nibName: nil, bundle: nil)
        let split = ContentSplitView()
        split.isVertical = vertical
        split.autosaveName = autosave
        split.onResetDivider = { [weak self] in self?.resetDivider($0) }
        splitView = split
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override open func splitView(_ splitView: NSSplitView, effectiveRect proposedEffectiveRect: NSRect, forDrawnRect drawnRect: NSRect,
                                 ofDividerAt dividerIndex: Int) -> NSRect {
        let rect = super.splitView(splitView, effectiveRect: proposedEffectiveRect, forDrawnRect: drawnRect, ofDividerAt: dividerIndex)
        let margin = ContentSplitView.grabMargin
        return splitView.isVertical ? rect.insetBy(dx: -margin, dy: 0) : rect.insetBy(dx: 0, dy: -margin)
    }

    public func resetDivider(_ index: Int) {
        let items = splitViewItems.filter { !$0.isCollapsed }
        guard index + 1 < items.count else { return }
        let total = splitView.isVertical ? splitView.bounds.width : splitView.bounds.height
        if let position = defaultPositions[index] {
            splitView.setPosition(position < 0 ? total + position : position, ofDividerAt: index)
            return
        }
        let views = items.map(\.viewController.view)
        let start = index == 0 ? 0 : (splitView.isVertical ? views[index - 1].frame.maxX : views[index - 1].frame.maxY)
        let end = splitView.isVertical ? views[index + 1].frame.maxX : views[index + 1].frame.maxY
        splitView.setPosition(((start + end) / 2).rounded(), ofDividerAt: index)
    }

    public func toggle(_ item: NSSplitViewItem, from sender: Any?, completion: (@MainActor () -> Void)? = nil) {
        let duration = sender is NSControl ? Motion.duration(Motion.slow) : 0
        guard duration > 0 else {
            item.isCollapsed.toggle()
            completion?()
            return
        }
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = duration
            context.timingFunction = Motion.easeOutQuint
            context.allowsImplicitAnimation = true
            item.animator().isCollapsed.toggle()
        }, completionHandler: { MainActor.assumeIsolated { completion?() } })
    }
}

@MainActor
public final class ContentSurface: SurfaceView {
    public static var inset: CGFloat { Metric.contentInset }
    public static var radius: CGFloat { Metric.contentRadius }

    public init() {
        super.init(fill: Palette.bgBase, ring: Palette.strokeQuaternary, radius: Metric.contentRadius)
        clipsContent = true
        setAccessibilityElement(false)
    }

    public func embed(_ view: NSView) { Pin.fill(view, in: self) }
}

@MainActor
public final class PaneViewController: NSViewController {
    public let card = PaneCard()
    private let content: NSView

    public init(content: NSView) {
        self.content = content
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public func loadView() {
        card.embed(content)
        view = card
    }
}
