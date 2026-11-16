import AppKit

@MainActor
public protocol MarkdownBlockProvider: AnyObject {
    func height(source: String, isOpen: Bool, width: CGFloat) -> CGFloat
    func makeView() -> MarkdownBlockView
}

@MainActor
open class MarkdownBlockView: NSView {
    override public init(frame: NSRect) { super.init(frame: frame) }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override open var isFlipped: Bool { true }

    open func show(source: String, isOpen: Bool, width: CGFloat) {}
}

@MainActor
public enum MarkdownBlocks {
    static var providers: [String: MarkdownBlockProvider] = [:]
    static private(set) var resizeGeneration = 0
    private static let viewsInWindows = NSHashTable<MarkdownView>.weakObjects()

    static func startWatching(_ view: MarkdownView) { viewsInWindows.add(view) }
    static func stopWatching(_ view: MarkdownView) { viewsInWindows.remove(view) }

    public static func register(_ provider: MarkdownBlockProvider, language: String) {
        providers[language.lowercased()] = provider
    }

    public static func provider(for language: String) -> MarkdownBlockProvider? {
        providers.isEmpty ? nil : providers[language.lowercased()]
    }

    public static func blockDidResize() {
        MarkdownMeasure.shared.invalidate()
        resizeGeneration += 1
        for view in viewsInWindows.allObjects { view.blocksResized() }
    }
}

final class BlockAttachment: NSTextAttachment {
    let leaf: Int
    let indent: CGFloat

    init(leaf: Int, indent: CGFloat, cell: BlockCell) {
        self.leaf = leaf
        self.indent = indent
        super.init(data: nil, ofType: nil)
        attachmentCell = cell
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }
}

final class BlockCell: NSTextAttachmentCell {
    private let measure: @MainActor (CGFloat) -> CGFloat
    private let indent: CGFloat
    private let descent: CGFloat

    init(indent: CGFloat, measure: @escaping @MainActor (CGFloat) -> CGFloat) {
        self.measure = measure
        self.indent = indent
        descent = TextStyle.code.font().descender
        super.init(imageCell: nil)
    }

    @available(*, unavailable)
    required init(coder: NSCoder) { fatalError("init(coder:) is not used") }

    nonisolated override func cellFrame(for textContainer: NSTextContainer, proposedLineFragment lineFrag: NSRect,
                                        glyphPosition position: NSPoint, characterIndex charIndex: Int) -> NSRect {
        let width = max(0, textContainer.size.width - indent)
        let height = MainActor.assumeIsolated { [measure] in measure(width) }
        return NSRect(x: 0, y: descent, width: width, height: height)
    }

    nonisolated override func cellBaselineOffset() -> NSPoint { NSPoint(x: 0, y: descent) }

    nonisolated override func draw(withFrame cellFrame: NSRect, in controlView: NSView?) {}

    nonisolated override func draw(withFrame cellFrame: NSRect, in controlView: NSView?, characterIndex charIndex: Int,
                                   layoutManager: NSLayoutManager) {}
}

@MainActor
final class MarkdownLayout {
    let storage = NSTextStorage()
    let manager = ProseLayoutManager()
    let container = NSTextContainer(size: NSSize(width: 0, height: CGFloat.greatestFiniteMagnitude))
    private(set) var document = MarkdownDocument()
    private(set) var source = ""
    private(set) var places: [NSRange] = []
    private(set) var blocks: [Int] = []
    private(set) var style: MarkdownStyle
    private var grids: [Int: TableGrid] = [:]
    private var codes: [Int: String] = [:]

    init(style: MarkdownStyle) {
        self.style = style
        container.lineFragmentPadding = 0
        container.widthTracksTextView = false
        manager.addTextContainer(container)
        storage.addLayoutManager(manager)
    }

    var width: CGFloat { container.size.width }

    func setWidth(_ width: CGFloat) {
        guard width != container.size.width else { return }
        grids = [:]
        container.size = NSSize(width: max(0, width), height: .greatestFiniteMagnitude)
    }

    func restyle(_ next: MarkdownStyle) {
        guard !next.matches(style) else { return }
        style = next
        let text = source
        source = ""
        document = MarkdownDocument()
        places = []
        set(text)
    }

    @discardableResult
    func set(_ markdown: String) -> Int {
        guard markdown != source else { return document.count }
        let extends = !document.topSources.isEmpty && markdown.utf8.count > source.utf8.count
            && markdown.utf8.starts(with: source.utf8)
        let previous = document
        var first: Int
        if extends {
            first = document.reparse(markdown, fromTop: document.topSources.count - 1)
        } else {
            document = MarkdownDocument.parse(markdown)
            first = 0
        }
        first = firstChanged(from: first, previous: previous)
        source = markdown
        let location = first == 0 ? 0 : NSMaxRange(places[first - 1])
        grids = grids.filter { $0.key < first }
        codes = codes.filter { $0.key < first }
        let builder = MarkdownText(document: document, style: style, mode: .flow(block: { [unowned self] leaf, indent in
            BlockAttachment(leaf: leaf, indent: indent, cell: BlockCell(indent: indent) { [unowned self] width in
                blockHeight(leaf, width: width)
            })
        }))
        let text = builder.build(from: first, places: &places, offset: location)
        storage.beginEditing()
        storage.replaceCharacters(in: NSRange(location: location, length: storage.length - location), with: text)
        storage.endEditing()
        blocks = blocks.filter { $0 < first } + (first ..< document.count).filter { Self.isBlock(document.kinds[$0]) }
        rebuilt = first ..< document.count
        return first
    }

    private(set) var rebuilt = 0 ..< 0

    static func isBlock(_ kind: MarkdownDocument.Kind) -> Bool { kind == .code || kind == .table || kind == .image }

    private func firstChanged(from start: Int, previous: MarkdownDocument) -> Int {
        var leaf = start
        let limit = min(document.count, previous.count, places.count)
        while leaf < limit, document.leafMatches(leaf, in: previous) { leaf += 1 }
        guard leaf > start, leaf < document.count, leaf < previous.count, document.owners[leaf] == previous.owners[leaf] else { return leaf }
        let top = document.owners[leaf]
        let same = MarkdownText.markerColumns(document, top: top, style: style)
            == MarkdownText.markerColumns(previous, top: top, style: style)
        return same ? leaf : max(start, document.topLeaves[top].lowerBound)
    }

    var height: CGFloat {
        guard storage.length > 0, container.size.width > 0 else { return 0 }
        manager.ensureLayout(for: container)
        return manager.usedRect(for: container).maxY.rounded(.up)
    }

    func invalidateBlocks() {
        grids = [:]
        for leaf in blocks where leaf < places.count {
            manager.invalidateLayout(forCharacterRange: places[leaf], actualCharacterRange: nil)
        }
    }

    func code(_ leaf: Int) -> String {
        if let known = codes[leaf] { return known }
        let code = document.string(document.ranges[leaf])
        codes[leaf] = code
        return code
    }

    func isOpen(_ leaf: Int) -> Bool { document.flags[leaf].contains(.open) }

    func blockHeight(_ leaf: Int, width: CGFloat) -> CGFloat {
        guard leaf < document.count else { return 0 }
        if document.kinds[leaf] == .table { return grid(leaf, width: width).height }
        if document.kinds[leaf] == .image { return ImagePanel.height(width: width) }
        if let provider = MarkdownBlocks.provider(for: document.language(leaf)) {
            return provider.height(source: code(leaf), isOpen: isOpen(leaf), width: width)
        }
        guard style.code == .scroll else {
            return CodePanel.height(lines: CodePanel.wrappedLines(code(leaf), width: width, compact: isCompact(leaf), copies: !isOpen(leaf)),
                                    note: false, compact: isCompact(leaf))
        }
        return CodePanel.height(code: code(leaf), compact: isCompact(leaf), overflows: CodePanel.overflows(code(leaf), width: width))
    }

    func isCompact(_ leaf: Int) -> Bool {
        !style.roomy && document.kinds[leaf] == .code && CodePanel.lines(code(leaf)) <= CodePanel.compactLines
    }

    func grid(_ leaf: Int, width: CGFloat) -> TableGrid {
        if let known = grids[leaf], known.width == width { return known }
        let made = TableGrid(document: document, leaf: leaf, style: style, width: width)
        grids[leaf] = made
        return made
    }

    func blockRect(_ leaf: Int) -> NSRect {
        guard leaf < places.count, places[leaf].location < storage.length else { return .zero }
        let glyph = manager.glyphIndexForCharacter(at: places[leaf].location)
        let line = manager.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
        let indent = (storage.attribute(.attachment, at: places[leaf].location, effectiveRange: nil) as? BlockAttachment)?.indent ?? 0
        let width = max(0, container.size.width - indent)
        let height = blockHeight(leaf, width: width)
        return NSRect(x: indent, y: line.maxY - height, width: width, height: height)
    }

    func leaf(at location: Int) -> Int {
        var low = 0
        var high = places.count - 1
        while low < high {
            let middle = (low + high + 1) / 2
            if places[middle].location <= location { low = middle } else { high = middle - 1 }
        }
        return max(0, low)
    }

    func leafRect(_ leaf: Int) -> NSRect {
        guard leaf < places.count else { return .zero }
        let glyphs = manager.glyphRange(forCharacterRange: places[leaf], actualCharacterRange: nil)
        guard glyphs.length > 0 else { return .zero }
        var rect = NSRect.null
        manager.enumerateLineFragments(forGlyphRange: glyphs) { _, used, _, _, _ in rect = rect.union(used) }
        return rect.isNull ? .zero : rect
    }

    func plain(_ range: NSRange) -> String {
        guard range.length > 0, !places.isEmpty else { return "" }
        let first = leaf(at: range.location)
        let last = leaf(at: max(range.location, NSMaxRange(range) - 1))
        var out = ""
        let string = storage.string as NSString
        for leaf in first ... last {
            let place = places[leaf]
            let piece = NSIntersectionRange(place, range)
            if leaf > first {
                let tight = document.lists[leaf] > 0 && document.lists[leaf - 1] > 0
                    && document.owners[leaf] == document.owners[leaf - 1]
                out += tight || document.kinds[leaf - 1] == .alertTitle ? "\n" : "\n\n"
            }
            switch document.kinds[leaf] {
            case .code:
                out += code(leaf)
            case .table:
                out += TableGrid.plain(document, leaf: leaf)
            case .rule:
                out += "---"
            case .image:
                out += document.string(document.ranges[leaf])
            case .alertTitle:
                out += document.string(document.ranges[leaf])
            case .paragraph, .heading:
                var text = piece.length > 0 ? string.substring(with: piece) : ""
                if piece.location == place.location, document.flags[leaf].contains(.itemStart), document.markers[leaf] != .none {
                    let marker = switch document.markers[leaf] {
                    case .open: "[ ]"
                    case .done: "[x]"
                    case .number: "\(document.values[leaf])."
                    default: "\u{2022}"
                    }
                    let body = text.split(separator: "\t", maxSplits: 2, omittingEmptySubsequences: false)
                    text = marker + " " + (body.last.map(String.init) ?? text)
                    text = String(repeating: "  ", count: max(0, Int(document.lists[leaf]) - 1)) + text
                }
                out += text.replacingOccurrences(of: "\u{2028}", with: "\n").replacingOccurrences(of: MarkdownInline.lead, with: "")
            }
        }
        return out
    }

    func markdown(_ range: NSRange) -> String {
        guard !places.isEmpty else { return source }
        if range.length == 0 || (range.location == 0 && NSMaxRange(range) >= storage.length) { return source }
        let first = document.owners[leaf(at: range.location)]
        let last = document.owners[leaf(at: max(range.location, NSMaxRange(range) - 1))]
        let bytes = Array(source.utf8)
        let span = document.topSources[first].lowerBound ..< document.topSources[last].upperBound
        return String(decoding: bytes[span.clamped(to: 0 ..< bytes.count)], as: UTF8.self)
    }

    func topMarkdown(_ leaf: Int) -> String {
        let bytes = Array(source.utf8)
        let span = document.topSources[document.owners[leaf]]
        return String(decoding: bytes[span.clamped(to: 0 ..< bytes.count)], as: UTF8.self)
    }
}

@MainActor
public final class MarkdownMeasure {
    public static let shared = MarkdownMeasure()

    private struct Key: Hashable {
        let text: Int
        let length: Int
        let width: CGFloat
        let body: CGFloat
        let wraps: Bool
    }

    private var heights: [Key: CGFloat] = [:]

    init() {
        Density.observe(self) { MarkdownBlocks.blockDidResize() }
    }
    private var live: [MarkdownLayout] = []
    private static let liveLimit = 4
    private static let heightLimit = 512

    public func height(_ markdown: String, width: CGFloat, body: TextStyle = .prose) -> CGFloat {
        height(markdown, width: width, style: MarkdownStyle(body: body, ink: Palette.contentPrimary))
    }

    func height(_ markdown: String, width: CGFloat, style: MarkdownStyle) -> CGFloat {
        guard !markdown.isEmpty, width > 0 else { return 0 }
        let key = Key(text: markdown.hashValue, length: markdown.utf8.count, width: width, body: style.body.size, wraps: style.code == .wrap)
        if let known = heights[key] { return known }
        let engine = engine(for: markdown, width: width, style: style)
        engine.set(markdown)
        let height = engine.height
        if heights.count > Self.heightLimit { heights = [:] }
        heights[key] = height
        return height
    }

    func take(_ markdown: String, style: MarkdownStyle) -> MarkdownLayout? {
        guard let index = live.lastIndex(where: { $0.source == markdown && $0.style.matches(style) }) else { return nil }
        return live.remove(at: index)
    }

    func invalidate() {
        heights = [:]
        for engine in live { engine.invalidateBlocks() }
    }

    private func engine(for markdown: String, width: CGFloat, style: MarkdownStyle) -> MarkdownLayout {
        let fits = { (engine: MarkdownLayout) in engine.style.body == style.body && engine.style.code == style.code && engine.width == width }
        if let index = live.firstIndex(where: { fits($0) && !$0.source.isEmpty && markdown.utf8.starts(with: $0.source.utf8) }) {
            let engine = live.remove(at: index)
            live.append(engine)
            return engine
        }
        let engine = live.count >= Self.liveLimit ? live.removeFirst() : MarkdownLayout(style: style)
        engine.restyle(style)
        engine.setWidth(width)
        live.append(engine)
        return engine
    }
}
