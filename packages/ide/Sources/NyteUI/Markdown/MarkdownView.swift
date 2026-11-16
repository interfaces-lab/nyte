import AppKit

@MainActor
public final class MarkdownView: NSView, NSTextViewDelegate {

    public var body: TextStyle {
        didSet { if body != oldValue { restyle() } }
    }
    public var ink: NSColor {
        didSet { if ink != oldValue { restyle() } }
    }
    public var onOpenLink: ((URL) -> Void)?
    public var onOpenFile: ((String, Int?) -> Void)?
    public var onHeightChange: (() -> Void)?
    public var markdown: String { engine.source }
    public var baseURL: URL? {
        didSet { if baseURL != oldValue { needsLayout = true } }
    }
    public static var loadsRemoteImages: Bool {
        get { MarkdownImages.allowsRemote }
        set { MarkdownImages.allowsRemote = newValue }
    }

    private var engine: MarkdownLayout
    private var text: MarkdownTextView
    private var panels: [Int: NSView] = [:]
    private var pool: [String: [NSView]] = [:]
    var accessGroups: [MarkdownAccessGroup]?
    private var accessSize = NSSize.zero
    private weak var observedClip: NSClipView?
    private var washes: [NSView] = []
    private var seenResizeGeneration = MarkdownBlocks.resizeGeneration

    private static let realizeMargin = Space.x8 * 4
    private static let poolLimit = 4
    private static let tableKey = "\u{1}table"
    private static let codeKey = "\u{1}code"
    private static let imageKey = "\u{1}image"

    public let code: MarkdownStyle.CodeLines?

    public init(body: TextStyle = .prose, ink: NSColor = Palette.contentPrimary, code: MarkdownStyle.CodeLines? = nil) {
        self.body = body
        self.ink = ink
        self.code = code
        engine = MarkdownLayout(style: MarkdownStyle(body: body, ink: ink, code: code))
        text = MarkdownTextView(frame: .zero, textContainer: engine.container)
        super.init(frame: .zero)
        prepare(text)
        addSubview(text)
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public var isFlipped: Bool { true }

    public static func height(for markdown: String, width: CGFloat, body: TextStyle = .prose,
                              code: MarkdownStyle.CodeLines? = nil) -> CGFloat {
        MarkdownMeasure.shared.height(markdown, width: width, style: MarkdownStyle(body: body, ink: Palette.contentPrimary, code: code))
    }

    public static func register(_ provider: MarkdownBlockProvider, language: String) {
        MarkdownBlocks.register(provider, language: language)
    }

    private func prepare(_ text: MarkdownTextView) {
        text.isEditable = false
        text.isSelectable = true
        text.isRichText = true
        text.drawsBackground = false
        text.textContainerInset = .zero
        text.isVerticallyResizable = false
        text.isHorizontallyResizable = false
        text.usesFontPanel = false
        text.linkTextAttributes = [.foregroundColor: Palette.accentInk, .cursor: NSCursor.pointingHand]
        text.delegate = self
        text.owner = self
        text.setAccessibilityElement(false)
    }

    private func adopt(_ measured: MarkdownLayout) {
        for (leaf, view) in panels { recycle(view, leaf: leaf) }
        panels = [:]
        let next = MarkdownTextView(frame: text.frame, textContainer: measured.container)
        prepare(next)
        replaceSubview(text, with: next)
        text = next
        engine = measured
        accessGroups = nil
        needsLayout = true
    }

    public func update(_ markdown: String) {
        guard markdown != engine.source else { return }
        let extends = !engine.source.isEmpty && markdown.utf8.starts(with: engine.source.utf8)
        if !extends, let measured = MarkdownMeasure.shared.take(markdown, style: MarkdownStyle(body: body, ink: ink, code: code)) {
            adopt(measured)
            return
        }
        let first = engine.set(markdown)
        accessGroups = nil
        for (leaf, view) in panels where leaf >= first {
            panels[leaf] = nil
            recycle(view, leaf: leaf)
        }
        needsLayout = true
    }

    public var contentHeight: CGFloat { engine.height }

    public func clearSelection() { text.setSelectedRange(NSRange(location: 0, length: 0)) }

    private func restyle() {
        engine.restyle(MarkdownStyle(body: body, ink: ink, code: code))
        for (leaf, view) in panels { recycle(view, leaf: leaf) }
        panels = [:]
        accessGroups = nil
        needsLayout = true
    }

    override public func layout() {
        super.layout()
        engine.setWidth(bounds.width)
        if accessSize != bounds.size {
            accessSize = bounds.size
            accessGroups = nil
        }
        text.frame = NSRect(x: 0, y: 0, width: bounds.width, height: max(bounds.height, engine.height))
        realize()
    }

    override public func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if window == nil {
            MarkdownBlocks.stopWatching(self)
        } else {
            MarkdownBlocks.startWatching(self)
            if seenResizeGeneration != MarkdownBlocks.resizeGeneration { blocksResized() }
        }
        let clip = enclosingScrollView?.contentView
        guard clip !== observedClip else { return }
        if let observedClip {
            NotificationCenter.default.removeObserver(self, name: NSView.boundsDidChangeNotification, object: observedClip)
        }
        observedClip = clip
        if let clip {
            NotificationCenter.default.addObserver(self, selector: #selector(scrolled), name: NSView.boundsDidChangeNotification, object: clip)
        }
    }

    @objc private func scrolled() { realize() }

    func blocksResized() {
        seenResizeGeneration = MarkdownBlocks.resizeGeneration
        guard !engine.blocks.isEmpty else { return }
        engine.invalidateBlocks()
        for (leaf, view) in panels { configure(view, leaf: leaf) }
        needsLayout = true
        onHeightChange?()
    }

    private func realize() {
        guard bounds.width > 0 else { return }
        let visible = visibleRect.insetBy(dx: 0, dy: -Self.realizeMargin)
        for leaf in engine.blocks {
            let rect = engine.blockRect(leaf)
            guard rect.intersects(visible), !visible.isEmpty else {
                if let view = panels.removeValue(forKey: leaf) { recycle(view, leaf: leaf) }
                continue
            }
            let view = panels[leaf] ?? dequeue(leaf)
            panels[leaf] = view
            if view.frame != rect { view.frame = rect }
            configure(view, leaf: leaf)
        }
        if !washes.isEmpty || text.selectedRange().length > 0 { wash() }
    }

    public func textViewDidChangeSelection(_ notification: Notification) { wash() }

    private func wash() {
        let selected = text.selectedRanges.map(\.rangeValue).filter { $0.length > 0 }
        let covered = panels.keys.filter { leaf in
            leaf < engine.places.count && selected.contains { NSLocationInRange(engine.places[leaf].location, $0) }
        }.sorted()
        while washes.count < covered.count {
            let view = Wash(fill: Palette.fillSecondary, radius: Radius.control)
            addSubview(view, positioned: .above, relativeTo: nil)
            washes.append(view)
        }
        for (index, view) in washes.enumerated() {
            view.isHidden = index >= covered.count
            guard index < covered.count, let panel = panels[covered[index]] else { continue }
            view.frame = panel.frame
        }
    }

    private func key(_ leaf: Int) -> String {
        let document = engine.document
        if document.kinds[leaf] == .table { return Self.tableKey }
        if document.kinds[leaf] == .image { return Self.imageKey }
        let language = document.language(leaf).lowercased()
        return MarkdownBlocks.provider(for: language) == nil ? Self.codeKey : language
    }

    private func dequeue(_ leaf: Int) -> NSView {
        let key = key(leaf)
        if let view = pool[key]?.popLast() {
            view.isHidden = false
            return view
        }
        let view: NSView
        switch key {
        case Self.tableKey:
            let table = TablePanel()
            table.onLink = { [weak self] target in self?.open(target) }
            view = table
        case Self.codeKey:
            view = CodePanel()
        case Self.imageKey:
            let image = ImagePanel()
            image.onOpen = { [weak self] target in self?.open(target) }
            view = image
        default:
            view = MarkdownBlocks.provider(for: key)?.makeView() ?? CodePanel()
        }
        view.identifier = NSUserInterfaceItemIdentifier(key)
        addSubview(view)
        return view
    }

    private func recycle(_ view: NSView, leaf: Int) {
        let key = view.identifier?.rawValue ?? Self.codeKey
        guard (pool[key]?.count ?? 0) < Self.poolLimit else {
            view.removeFromSuperview()
            return
        }
        view.isHidden = true
        pool[key, default: []].append(view)
    }

    private func configure(_ view: NSView, leaf: Int) {
        guard leaf < engine.document.count else { return }
        if view.identifier?.rawValue != key(leaf) {
            panels[leaf] = nil
            recycle(view, leaf: leaf)
            let fresh = dequeue(leaf)
            panels[leaf] = fresh
            fresh.frame = engine.blockRect(leaf)
            configure(fresh, leaf: leaf)
            return
        }
        let markdown = { [weak self] in self?.engine.topMarkdown(leaf) ?? "" }
        switch view {
        case let code as CodePanel:
            code.markdown = markdown
            code.compact = engine.isCompact(leaf)
            code.wraps = engine.style.code == .wrap
            code.show(code: engine.code(leaf), language: engine.document.language(leaf), isOpen: engine.isOpen(leaf))
        case let table as TablePanel:
            table.markdown = markdown
            table.show(engine.grid(leaf, width: view.frame.width), plain: TableGrid.plain(engine.document, leaf: leaf))
        case let image as ImagePanel:
            image.show(source: engine.document.imageSource(leaf), alt: engine.document.string(engine.document.ranges[leaf]),
                       base: baseURL)
        case let block as MarkdownBlockView:
            block.show(source: engine.code(leaf), isOpen: engine.isOpen(leaf), width: view.frame.width)
        default:
            break
        }
    }

    public func textView(_ textView: NSTextView, clickedOnLink link: Any, at charIndex: Int) -> Bool {
        let target = (link as? URL)?.absoluteString ?? (link as? String) ?? ""
        open(target)
        return true
    }

    func open(_ target: String) {
        if let file = MarkdownLinks.file(target), let onOpenFile {
            onOpenFile(file.path, file.line)
            return
        }
        guard let url = URL(string: target) else { return }
        if let onOpenLink {
            onOpenLink(url)
            return
        }
        NSWorkspace.shared.open(url)
    }

    func plainText(_ range: NSRange) -> String { engine.plain(range) }

    func markdownText(_ range: NSRange) -> String { engine.markdown(range) }

    var layoutEngine: MarkdownLayout { engine }
    var textView: MarkdownTextView { text }
    var realized: [Int: NSView] { panels }

}

private final class Wash: SurfaceView {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

final class MarkdownTextView: NSTextView {
    weak var owner: MarkdownView?

    override var writablePasteboardTypes: [NSPasteboard.PasteboardType] { [.string, MarkdownPasteboard.markdownType] }

    override func writeSelection(to pboard: NSPasteboard, types: [NSPasteboard.PasteboardType]) -> Bool {
        guard let owner else { return super.writeSelection(to: pboard, types: types) }
        let range = selectedRange()
        guard range.length > 0 else { return false }
        let markdown = types.contains(MarkdownPasteboard.markdownType) ? owner.markdownText(range) : nil
        MarkdownPasteboard.write(plain: owner.plainText(range), markdown: markdown, to: pboard)
        return true
    }

    override func copy(_ sender: Any?) {
        guard selectedRange().length > 0 else { return }
        _ = writeSelection(to: .general, types: writablePasteboardTypes)
    }

    @objc func copyAsMarkdown(_ sender: Any?) {
        guard let owner else { return }
        let markdown = owner.markdownText(selectedRange())
        MarkdownPasteboard.write(plain: markdown, markdown: markdown)
    }

    override func validateUserInterfaceItem(_ item: NSValidatedUserInterfaceItem) -> Bool {
        switch item.action {
        case #selector(copy(_:)):
            (item as? NSMenuItem)?.title = "Copy"
            return selectedRange().length > 0
        case #selector(copyAsMarkdown(_:)):
            (item as? NSMenuItem)?.title = selectedRange().length > 0 ? "Copy as Markdown" : "Copy All as Markdown"
            return owner != nil
        default:
            return super.validateUserInterfaceItem(item)
        }
    }

    var linkRanges: [NSRange] {
        guard let storage = textStorage else { return [] }
        var ranges: [NSRange] = []
        storage.enumerateAttribute(.link, in: NSRange(location: 0, length: storage.length)) { value, range, _ in
            if value != nil { ranges.append(range) }
        }
        return ranges
    }

    override var acceptsFirstResponder: Bool { true }

    override func keyDown(with event: NSEvent) {
        guard !isEditable else { return super.keyDown(with: event) }
        switch event.keyCode {
        case KeyCode.tab: moveToLink(forward: !event.modifierFlags.contains(.shift))
        case KeyCode.returnKey, KeyCode.enter: openFocusedLink()
        default: super.keyDown(with: event)
        }
    }

    override var canBecomeKeyView: Bool { !linkRanges.isEmpty }

    private func openFocusedLink() {
        let selected = selectedRange()
        guard let storage = textStorage, selected.length > 0, linkRanges.contains(selected),
              let link = storage.attribute(.link, at: selected.location, effectiveRange: nil)
        else { return }
        clicked(onLink: link, at: selected.location)
    }

    override func becomeFirstResponder() -> Bool {
        let became = super.becomeFirstResponder()
        guard became, selectedRange().length == 0 else { return became }
        setSelectedRange(NSRange(location: 0, length: 0))
        if let event = NSApp.currentEvent, event.type == .keyDown {
            let forward = !event.modifierFlags.contains(.shift)
            if let link = forward ? linkRanges.first : linkRanges.last { focus(link) }
        }
        return became
    }

    private func moveToLink(forward: Bool) {
        let links = linkRanges
        let current = selectedRange()
        let next = forward ? links.first { $0.location > current.location || ($0.location == current.location && current.length == 0) }
            : links.last { $0.location < current.location }
        guard let next else {
            setSelectedRange(NSRange(location: current.location, length: 0))
            if forward { window?.selectNextKeyView(self) } else { window?.selectPreviousKeyView(self) }
            return
        }
        focus(next)
    }

    private func focus(_ link: NSRange) {
        setSelectedRange(link)
        scrollRangeToVisible(link)
    }

    override func menu(for event: NSEvent) -> NSMenu? {
        let selected = selectedRange().length > 0
        return Menu.make([
            MenuItem("Copy", enabled: selected) { [weak self] in self?.copy(nil) },
            MenuItem(selected ? "Copy as Markdown" : "Copy All as Markdown") { [weak self] in self?.copyAsMarkdown(nil) },
            .separator,
            MenuItem("Select All") { [weak self] in self?.selectAll(nil) },
        ])
    }
}
