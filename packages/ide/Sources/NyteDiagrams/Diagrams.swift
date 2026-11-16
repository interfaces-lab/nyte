import AppKit
import NyteUI

@MainActor
public enum Diagrams {
    public static func install() {
        MarkdownView.register(DiagramProvider.shared, language: "mermaid")
    }
}

@MainActor
final class DiagramProvider: MarkdownBlockProvider {
    static let shared = DiagramProvider()
    private let panelsInWindows = NSHashTable<DiagramPanel>.weakObjects()

    enum Mode { case diagram, source }

    struct Key: Hashable {
        let source: String
        let look: DiagramLook
        let percent: Int
    }

    private(set) var sizes: [String: CGSize] = [:]
    private(set) var texts: [String: CGFloat] = [:]
    private(set) var failures: [String: String] = [:]
    private var images: [Key: DiagramRender.Drawn] = [:]
    private var order: [Key] = []
    private var bytes = 0
    private var modes: [String: Mode] = [:]
    private var pending: Set<Key> = []
    private var tail: Task<Void, Never>?

    static let byteBudget = 48 << 20

    func height(source: String, isOpen: Bool, width: CGFloat) -> CGFloat {
        guard !isOpen else { return CodePanel.height(code: source) }
        if failures[source] != nil { return CodePanel.height(code: source, note: true) }
        guard let size = sizes[source] else {
            request(source, look: DiagramLook(NSApp.effectiveAppearance), scale: 1)
            return CodePanel.height(code: source)
        }
        if mode(source) == .source { return CodePanel.height(code: source) }
        return DiagramPanel.height(size: size, fit: fit(source, width: width))
    }

    func fit(_ source: String, width: CGFloat) -> DiagramFit {
        guard let size = sizes[source] else { return DiagramFit(scale: 1, scrolls: false) }
        return DiagramFit.decide(size: size, smallestText: texts[source] ?? DiagramFit.readableText, width: DiagramPanel.room(width))
    }

    func makeView() -> MarkdownBlockView { DiagramPanel(provider: self) }

    func startWatching(_ panel: DiagramPanel) { panelsInWindows.add(panel) }
    func stopWatching(_ panel: DiagramPanel) { panelsInWindows.remove(panel) }

    var residentBytes: Int { bytes }

    private func announceRender(of source: String) {
        for panel in panelsInWindows.allObjects { panel.rendered(source) }
    }

    func mode(_ source: String) -> Mode { modes[source] ?? .diagram }

    func setMode(_ mode: Mode, for source: String) {
        guard self.mode(source) != mode else { return }
        modes[source] = mode
        MarkdownBlocks.blockDidResize()
    }

    func image(_ source: String, look: DiagramLook, scale: CGFloat) -> DiagramRender.Drawn? {
        let key = Key(source: source, look: look, percent: Self.percent(scale))
        if let known = images[key] {
            order.removeAll { $0 == key }
            order.append(key)
            return known
        }
        request(source, look: look, scale: scale)
        return images.first { $0.key.source == source && $0.key.look == look }?.value
    }

    private static func percent(_ scale: CGFloat) -> Int { Int((scale * DiagramFit.steps).rounded()) }

    func request(_ source: String, look: DiagramLook, scale: CGFloat) {
        let key = Key(source: source, look: look, percent: Self.percent(scale))
        guard images[key] == nil, !pending.contains(key), failures[source] == nil else { return }
        pending.insert(key)
        let palette = DiagramPalette.theme(for: look, chart: DiagramRender.header(source)?.lowercased().hasPrefix("xychart") == true)
        let previous = tail
        tail = Task { @MainActor [weak self] in
            await previous?.value
            do {
                let drawn = try await DiagramRender.draw(source, theme: palette.theme, ramp: palette.ramp,
                                                         scale: CGFloat(key.percent) / DiagramFit.steps)
                self?.finish(key, drawn: drawn)
            } catch {
                self?.fail(key, reason: DiagramRender.message(error))
            }
        }
    }

    private func fail(_ key: Key, reason: String) {
        pending.remove(key)
        failures[key.source] = reason
        MarkdownBlocks.blockDidResize()
        announceRender(of: key.source)
    }

    private func finish(_ key: Key, drawn: DiagramRender.Drawn) {
        pending.remove(key)
        images[key] = drawn
        order.append(key)
        bytes += drawn.image.bytesPerRow * drawn.image.height
        while bytes > Self.byteBudget, order.count > 1, let oldest = order.first, oldest != key {
            order.removeFirst()
            if let evicted = images.removeValue(forKey: oldest) { bytes -= evicted.image.bytesPerRow * evicted.image.height }
        }
        announceRender(of: key.source)
        guard key.percent == Self.percent(1) else { return }
        let known = sizes[key.source]
        sizes[key.source] = drawn.size
        texts[key.source] = drawn.smallestText
        if known != drawn.size { MarkdownBlocks.blockDidResize() }
    }
}

enum DiagramCue: Equatable {
    case none
    case overflow(trailing: Bool, leading: Bool)
}

@MainActor
final class DiagramPanel: MarkdownBlockView {
    static let padding = Space.x3

    private let provider: DiagramProvider
    private let panel = CodePanel()
    private let scroll = SideScroll()
    private let canvas = DiagramCanvas()
    private let modes = Segmented([.init("Diagram"), .init("Source")], size: .xs, sizing: .hug)
    private let tools = DiagramTools()
    private lazy var expand = Button(symbol: "arrow.up.left.and.arrow.down.right", label: "Expand diagram", size: .xs) { [weak self] in
        self?.openExpanded()
    }
    private var source = ""
    private var isOpen = false
    private var shownOutcome: Outcome?
    private var expanded: FloatingPanel?
    private(set) var fit = DiagramFit(scale: 1, scrolls: false)

    init(provider: DiagramProvider) {
        self.provider = provider
        super.init(frame: .zero)
        addSubview(panel)
        scroll.documentView = canvas
        scroll.showsEdges = true
        tools.items = [modes]
        modes.onSelect = { [weak self] index in
            guard let self else { return }
            provider.setMode(index == 0 ? .diagram : .source, for: source)
            refresh()
        }
        setAccessibilityElement(false)
    }

    static func room(_ width: CGFloat) -> CGFloat { max(1, width - padding * 2 - Metric.hairline * 2) }

    static func height(size: CGSize, fit: DiagramFit) -> CGFloat {
        CodePanel.header + (size.height * fit.scale).rounded(.up) + padding * 2 + (fit.scrolls ? SideScroll.scrollerHeight : 0)
    }

    var cue: DiagramCue {
        guard panel.content != nil, scroll.overflows else { return .none }
        return .overflow(trailing: scroll.edgeShown(.maxX), leading: scroll.edgeShown(.minX))
    }

    var offersExpand: Bool { tools.items.contains { $0 === expand } }

    override func show(source: String, isOpen: Bool, width: CGFloat) {
        let changed = source != self.source || isOpen != self.isOpen
        self.source = source
        self.isOpen = isOpen
        if changed { refresh() } else { needsLayout = true }
    }

    func rendered(_ rendered: String) {
        guard rendered == source else { return }
        refresh()
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        guard window != nil else {
            expanded?.dismiss()
            return provider.stopWatching(self)
        }
        provider.startWatching(self)
        if shownOutcome != outcome { refresh() }
    }

    private struct Outcome: Equatable {
        let failure: String?
        let size: CGSize?
    }

    private var outcome: Outcome { Outcome(failure: provider.failures[source], size: provider.sizes[source]) }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        refresh()
    }

    private func refresh() {
        shownOutcome = outcome
        fit = provider.fit(source, width: bounds.width)
        let failure = provider.failures[source]
        let drawn = isOpen || failure != nil ? nil : provider.image(source, look: DiagramLook(effectiveAppearance), scale: fit.scale)
        let mode = provider.mode(source)
        tools.items = fit.scrolls && mode == .diagram ? [expand, modes] : [modes]
        panel.title = drawn != nil ? DiagramPanel.kind(source) : nil
        panel.accessory = drawn != nil ? tools : nil
        modes.selectedIndex = mode == .diagram ? 0 : 1
        panel.show(code: source, language: "mermaid", isOpen: isOpen, note: failure)
        if let drawn, mode == .diagram {
            canvas.drawn = drawn
            canvas.setAccessibilityLabel("\(DiagramPanel.kind(source)), Mermaid")
            panel.content = scroll
            panel.setAccessibilityLabel("Diagram, \(DiagramPanel.kind(source))")
        } else {
            panel.content = nil
        }
        place()
        needsLayout = true
    }

    static func kind(_ source: String) -> String {
        switch DiagramRender.header(source)?.lowercased() ?? "" {
        case "graph", "flowchart", "flowchart-elk": "Flowchart"
        case "sequencediagram": "Sequence diagram"
        case "classdiagram", "classdiagram-v2": "Class diagram"
        case "statediagram", "statediagram-v2": "State diagram"
        case "erdiagram": "ER diagram"
        case "xychart", "xychart-beta": "Chart"
        default: "Diagram"
        }
    }

    override func layout() {
        super.layout()
        if provider.fit(source, width: bounds.width) != fit { refresh() }
        place()
    }

    private func place() {
        panel.frame = bounds
        guard panel.content != nil, canvas.drawn != nil, let size = provider.sizes[source] else { return }
        let fitted = CGSize(width: (size.width * fit.scale).rounded(.up), height: (size.height * fit.scale).rounded(.up))
        let pane = NSSize(width: max(0, bounds.width - Metric.hairline * 2), height: max(0, bounds.height - CodePanel.header - Metric.hairline))
        let width = max(pane.width, fitted.width + Self.padding * 2)
        panel.layoutSubtreeIfNeeded()
        canvas.frame = NSRect(x: 0, y: 0, width: width, height: pane.height)
        canvas.box = NSRect(x: ((width - fitted.width) / 2).rounded(), y: Self.padding, width: fitted.width, height: fitted.height)
        scroll.tile()
    }

    private func openExpanded() {
        guard let window, let drawn = provider.image(source, look: DiagramLook(effectiveAppearance), scale: 1),
              let size = provider.sizes[source] else { return }
        let floating = FloatingPanel(radius: Radius.card, takesKey: true)
        let full = DiagramCanvas()
        full.drawn = drawn
        full.box = NSRect(x: Self.padding, y: Self.padding, width: size.width, height: size.height)
        full.frame = NSRect(x: 0, y: 0, width: size.width + Self.padding * 2, height: size.height + Self.padding * 2)
        full.setAccessibilityLabel("\(DiagramPanel.kind(source)), Mermaid")
        let viewer = QuietScrollView()
        viewer.drawsBackground = false
        viewer.hasHorizontalScroller = true
        viewer.hasVerticalScroller = true
        viewer.autohidesScrollers = true
        viewer.documentView = full
        floating.content = viewer
        floating.onDismiss = { [weak self] in self?.expanded = nil }
        expanded = floating
        floating.show(size: DiagramFit.expandedSize(diagram: size, within: window.frame.size), centredIn: window)
    }
}

@MainActor
final class DiagramTools: NSView {
    var items: [NSView] = [] {
        didSet {
            guard items.map(ObjectIdentifier.init) != oldValue.map(ObjectIdentifier.init) else { return }
            subviews.forEach { $0.removeFromSuperview() }
            items.forEach(addSubview)
            invalidateIntrinsicContentSize()
            needsLayout = true
        }
    }

    override var isFlipped: Bool { true }

    override var intrinsicContentSize: NSSize {
        let sizes = items.map(\.intrinsicContentSize)
        return NSSize(width: sizes.map(\.width).reduce(0, +) + Space.x1 * CGFloat(max(0, items.count - 1)),
                      height: sizes.map(\.height).max() ?? 0)
    }

    override func layout() {
        super.layout()
        var x: CGFloat = 0
        for item in items {
            let size = item.intrinsicContentSize
            item.frame = NSRect(x: x, y: ((bounds.height - size.height) / 2).rounded(), width: size.width, height: size.height)
            x += size.width + Space.x1
        }
    }
}

@MainActor
final class DiagramCanvas: NSView {
    var drawn: DiagramRender.Drawn? { didSet { needsDisplay = true } }
    var box = NSRect.zero { didSet { if box != oldValue { needsDisplay = true } } }

    override var isFlipped: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        setAccessibilityElement(true)
        setAccessibilityRole(.image)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func draw(_ dirtyRect: NSRect) {
        guard let drawn, let context = NSGraphicsContext.current?.cgContext, box.intersects(dirtyRect) else { return }
        context.saveGState()
        context.interpolationQuality = .high
        context.translateBy(x: box.minX, y: box.maxY)
        context.scaleBy(x: 1, y: -1)
        context.draw(drawn.image, in: CGRect(origin: .zero, size: box.size))
        context.restoreGState()
    }
}
