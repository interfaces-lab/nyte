import AppKit
import NyteUI
import os

@MainActor
protocol TextEngineDecorator: AnyObject {
    func drawUnderText(in rect: NSRect, of view: TextEngineView)
    func drawOverText(in rect: NSRect, of view: TextEngineView)
    func inlineBoxes(forLine line: Int, of view: TextEngineView) -> [InlineBox]
    func colourRuns(forLine line: Int, of view: TextEngineView) -> [(range: NSRange, color: NSColor)]
    func trailingNotes(forLine line: Int, of view: TextEngineView) -> [TrailingNote]
}

extension TextEngineDecorator {
    func drawUnderText(in rect: NSRect, of view: TextEngineView) {}
    func drawOverText(in rect: NSRect, of view: TextEngineView) {}
    func inlineBoxes(forLine line: Int, of view: TextEngineView) -> [InlineBox] { [] }
    func colourRuns(forLine line: Int, of view: TextEngineView) -> [(range: NSRange, color: NSColor)] { [] }
    func trailingNotes(forLine line: Int, of view: TextEngineView) -> [TrailingNote] { [] }
}

struct Composition: Equatable {
    var range: NSRange
    var original: [UInt16]
    var before: SelectionSet
    var selected: NSRange
    var underlines: [(range: NSRange, isThick: Bool)]

    static func == (left: Composition, right: Composition) -> Bool {
        left.range == right.range && left.original == right.original && left.before == right.before && left.selected == right.selected
            && left.underlines.map(\.range) == right.underlines.map(\.range) && left.underlines.map(\.isThick) == right.underlines.map(\.isThick)
    }
}

@MainActor
final class TextEngineView: NSView {
    static let verticalInset = Space.x2
    static let windowedLineLength = 4_096
    static let windowLength = 1_024
    static let caretWidth = Space.x05
    static let underlineWidth = Space.hair

    private(set) var model: TextModel
    var session: EditSession {
        get { model.session }
        _modify { yield &model.session }
    }
    var metrics = CodeRowMetrics() { didSet { relayoutAll() } }
    var rowMap = RowMap() {
        didSet {
            guard rowMap != oldValue else { return }
            model.rowMap = rowMap
            fitFrame()
            needsDisplay = true
        }
    }
    var cache = RowLayoutCache()
    var widest: CGFloat = 0
    var composition: Composition?
    var keyStroke: [TypingDecision.Action]?
    var blink = CaretBlink.State.idle
    var caretsShown = true
    var decorators: [any TextEngineDecorator] = []
    var isEditable = true
    var recordsHistory = true
    var canRunEditorCommand: ((Selector) -> Bool)?
    var mark: Int?
    var scratchTokens: [UInt64] = []
    var pendingGrowth = false
    var lastVisibleX: CGFloat = 0
    var trailingInset: CGFloat = 0
    let canvas = TextCanvas()
    var lineWindows: [Int: LineWindows] = [:]
    var windowTokens: (line: Int, revision: Int, tokens: [UInt64])?
    var onTextChange: (([TextChange]) -> Void)?
    var onSelectionChange: (() -> Void)?
    var onType: ((String) -> Void)?
    var contextMenuProvider: ((NSEvent, Int) -> NSMenu?)?
    var onDropFiles: (([URL], Int) -> Bool)?
    var undoManagerProvider: (() -> UndoManager?)?
    var undoRegistrar: ((EditHistory.Step) -> Void)?
    var onKey: ((NSEvent) -> Bool)?
    var onPointerMoved: ((NSPoint, Int?, NSEvent.ModifierFlags) -> Void)?
    var onPointerExited: (() -> Void)?
    var onClick: ((NSPoint, Int, NSEvent) -> Bool)?
    var onFocusLeave: (() -> Void)?
    var onViewportChange: (() -> Void)?
    var onEditorCommand: ((Selector) -> Bool)?
    var onFinderAction: ((NSTextFinder.Action) -> Bool)?
    var canPerformFinderAction: ((NSTextFinder.Action) -> Bool)?
    var onFinderToggle: ((EditorFindBar.Option) -> Bool)?
    var pointerArea: NSTrackingArea?

    init(store: TextStore = TextStore(), context: EditContext? = nil) {
        model = TextModel(EditSession(store, context: context))
        super.init(frame: .zero)
        canvas.engine = self
        canvas.translatesAutoresizingMaskIntoConstraints = false
        addSubview(canvas)
        setAccessibilityElement(true)
        setAccessibilityRole(.textArea)
        registerForDraggedTypes([.string, .fileURL])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isFlipped: Bool { true }
    override var isOpaque: Bool { false }
    override var acceptsFirstResponder: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override var undoManager: UndoManager? { undoManagerProvider?() ?? super.undoManager }

    var store: TextStore { session.store }
    var selections: SelectionSet { session.selections }
    var context: EditContext {
        get { session.context }
        set { session.context = newValue }
    }

    func load(_ store: TextStore, selections: SelectionSet = SelectionSet(caret: 0), widestColumns: Int = 0) {
        let context = EditContext(indent: session.context.indent, language: store.language)
        var session = EditSession(store, context: context)
        session.select(selections)
        attach(TextModel(session, widestColumns: widestColumns))
    }

    func attach(_ next: TextModel) {
        if composition != nil { commitComposition() }
        guard next !== model else { return }
        model = next
        lineWindows.removeAll()
        rowMap = model.rowMap
        cache.removeAll()
        widest = max(model.widest, CGFloat(model.widestColumns) * metrics.advance)
        fitFrame()
        needsDisplay = true
        onSelectionChange?()
    }

    var rowCount: Int { rowMap.rowCount(lines: store.lineCount) }
    func top(ofRow row: Int) -> CGFloat { Self.verticalInset + CGFloat(row) * metrics.lineHeight }
    func top(ofLine line: Int) -> CGFloat { top(ofRow: rowMap.row(of: line)) }

    func row(atY y: CGFloat) -> Int {
        min(max(0, Int(((y - Self.verticalInset) / metrics.lineHeight).rounded(.down))), max(0, rowCount - 1))
    }

    func rows(in rect: NSRect) -> Range<Int> {
        guard rowCount > 0 else { return 0..<0 }
        let first = max(0, Int(((rect.minY - Self.verticalInset) / metrics.lineHeight).rounded(.down)))
        let last = min(rowCount, Int(((rect.maxY - Self.verticalInset) / metrics.lineHeight).rounded(.up)))
        return first < last ? first..<last : 0..<0
    }

    func fitFrame() {
        let clip = enclosingScrollView?.contentView.bounds.size ?? .zero
        let height = CGFloat(rowCount) * metrics.lineHeight + Self.verticalInset * 2
        let width = widest + metrics.advance * 2
        let size = NSSize(width: max(width, clip.width).rounded(.up), height: max(height, clip.height).rounded(.up))
        if frame.size != size { setFrameSize(size) }
    }

    func isWindowed(_ line: Int) -> Bool { store.lineRange(line).length > Self.windowedLineLength }

    func windows(of line: Int) -> LineWindows {
        if let known = lineWindows[line] { return known }
        let built = store.buffer.withUnits(store.lineRange(line)) { units in
            LineWindows.build(units, size: Self.windowLength, advance: metrics.advance) { measure(units, $0) }
        }
        lineWindows[line] = built
        widest = max(widest, built.width)
        return built
    }

    func measure(_ units: UnsafeBufferPointer<UInt16>, _ range: Range<Int>) -> CGFloat {
        let text = NSAttributedString(string: String(decoding: UnsafeBufferPointer(rebasing: units[range]), as: UTF16.self),
                                      attributes: [.font: metrics.font, .paragraphStyle: metrics.paragraph])
        return CGFloat(CTLineGetTypographicBounds(CTLineCreateWithAttributedString(text), nil, nil, nil))
    }

    func layout(line: Int, window: Int = 0) -> CodeRowLayout {
        let key = RowLayoutCache.Key(line: line, window: window)
        if let cached = cache[key] { return cached }
        let span = store.lineRange(line)
        let built: CodeRowLayout
        if span.length > Self.windowedLineLength {
            let table = windows(of: line)
            let start = table.starts[min(window, table.count - 1)]
            let end = table.end(of: min(window, table.count - 1))
            let tokens = longLineTokens(line, span: span)
            built = store.buffer.withUnits(NSRange(location: span.location + start, length: end - start)) { units in
                CodeRowBuilder.build(units: units, start: start, origin: table.origins[min(window, table.count - 1)], tokens: tokens, tokenBase: 0,
                                     metrics: metrics)
            }
        } else {
            scratchTokens.removeAll(keepingCapacity: true)
            let boxes = decorators.flatMap { $0.inlineBoxes(forLine: line, of: self) }.sorted { $0.column < $1.column }
            let runs = decorators.flatMap { $0.colourRuns(forLine: line, of: self) }
            built = store.buffer.withUnits(span) { units in
                if store.language.family != .plain {
                    _ = Lexer.line(units, state: store.lines.entryState(of: line), language: store.language, offset: 0,
                                   tokens: &scratchTokens, emit: true)
                }
                return CodeRowBuilder.build(units: units, start: 0, origin: 0, tokens: scratchTokens, tokenBase: 0, runs: runs, boxes: boxes,
                                            metrics: metrics)
            }
            if built.width > widest {
                widest = built.width
                model.widest = widest
                scheduleGrowth()
            }
        }
        cache.store(built, for: key)
        return built
    }

    private func longLineTokens(_ line: Int, span: NSRange) -> [UInt64] {
        guard span.length <= TextStore.longestLexedLine, store.language.family != .plain else { return [] }
        if let known = windowTokens, known.line == line, known.revision == store.revision { return known.tokens }
        var tokens: [UInt64] = []
        store.buffer.withUnits(span) { units in
            _ = Lexer.line(units, state: store.lines.entryState(of: line), language: store.language, offset: 0, tokens: &tokens, emit: true)
        }
        windowTokens = (line, store.revision, tokens)
        return tokens
    }

    func layout(line: Int, column: Int) -> CodeRowLayout {
        layout(line: line, window: isWindowed(line) ? windows(of: line).window(containing: column) : 0)
    }

    func layout(line: Int, atX x: CGFloat) -> CodeRowLayout {
        layout(line: line, window: isWindowed(line) ? windows(of: line).window(atX: x) : 0)
    }

    func x(of offset: Int) -> CGFloat {
        let line = store.line(at: offset)
        let column = offset - store.lineRange(line).location
        return layout(line: line, column: column).x(ofColumn: column)
    }

    func caretRect(at offset: Int) -> NSRect {
        let line = store.line(at: min(max(0, offset), store.length))
        return NSRect(x: max(0, x(of: offset) - Self.caretWidth / 2), y: top(ofLine: line), width: Self.caretWidth, height: metrics.lineHeight)
    }

    func offset(at point: NSPoint) -> Int {
        guard store.lineCount > 0 else { return 0 }
        if point.y < Self.verticalInset { return 0 }
        let raw = Int(((point.y - Self.verticalInset) / metrics.lineHeight).rounded(.down))
        if raw >= rowCount { return store.length }
        let line = rowMap.line(atRow: raw)
        return store.lineRange(line).location + layout(line: line, atX: point.x).column(at: point.x)
    }

    var columnMeasure: ColumnMeasure {
        ColumnMeasure(
            x: { [unowned self] line, column in layout(line: line, column: column).x(ofColumn: column) },
            column: { [unowned self] line, x in layout(line: line, atX: x).column(at: x) },
            pageRows: max(1, Int(visibleRect.height / metrics.lineHeight) - 1),
            step: { [unowned self] line, rows in
                let row = rowMap.row(of: line) + rows
                return row >= 0 && row < rowCount ? rowMap.line(atRow: row) : nil
            }
        )
    }

    func rects(for range: NSRange) -> [NSRect] {
        let firstLine = store.line(at: range.location)
        let lastLine = store.line(at: NSMaxRange(range))
        return (firstLine...lastLine).compactMap { line in
            guard !rowMap.folds.isHidden(line) else { return nil }
            let span = store.lineRange(line)
            let start = max(range.location, span.location)
            let end = min(NSMaxRange(range), NSMaxRange(span))
            guard end >= start else { return nil }
            let left = x(of: start)
            let right = end > start ? x(of: end) : left
            return NSRect(x: left, y: top(ofLine: line), width: right - left, height: metrics.lineHeight)
        }
    }

    func relayoutAll() {
        cache.removeAll()
        lineWindows.removeAll()
        fitFrame()
        needsDisplay = true
    }

    func invalidateLayout(lines: ClosedRange<Int>) {
        for line in lines { cache.remove(line: line) }
        invalidate(lines: lines)
    }

    func invalidate(lines: ClosedRange<Int>) {
        let first = top(ofLine: lines.lowerBound)
        let last = top(ofLine: min(lines.upperBound, max(0, store.lineCount - 1))) + metrics.lineHeight
        let visible = visibleRect
        let rect = NSRect(x: visible.minX, y: first, width: visible.width, height: last - first).intersection(visible)
        if !rect.isEmpty { setNeedsDisplay(rect) }
    }

    func invalidateBelow(line: Int) {
        let visible = visibleRect
        let top = top(ofLine: line)
        guard top < visible.maxY else { return }
        setNeedsDisplay(NSRect(x: visible.minX, y: max(top, visible.minY), width: visible.width, height: visible.maxY - max(top, visible.minY)))
    }

    func scheduleGrowth() {
        guard !pendingGrowth else { return }
        pendingGrowth = true
        perform(#selector(growToWidest), with: nil, afterDelay: 0)
    }

    @objc private func growToWidest() {
        pendingGrowth = false
        fitFrame()
    }

    override func viewWillMove(toWindow newWindow: NSWindow?) {
        super.viewWillMove(toWindow: newWindow)
        if newWindow == nil {
            NSObject.cancelPreviousPerformRequests(withTarget: self, selector: #selector(growToWidest), object: nil)
            pendingGrowth = false
        }
        observeWindowState(moving: newWindow)
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        cache.removeAll()
        needsDisplay = true
    }
}
