import AppKit

struct CodePosition: Comparable, Equatable {
    var line: Int
    var column: Int

    static func < (lhs: CodePosition, rhs: CodePosition) -> Bool {
        lhs.line != rhs.line ? lhs.line < rhs.line : lhs.column < rhs.column
    }
}

@MainActor
final class CodeCanvas: NSView, NSMenuItemValidation {
    static let style = TextStyle.code
    static let textInset = Space.x3
    static let verticalInset = Space.x2
    static let markOutset = Space.hair
    static let cacheLimit = 1_024

    private(set) var source: CodeViewSource?
    var marks: [CodeMark] = [] { didSet { if marks != oldValue { needsDisplay = true } } }
    private(set) var anchor: CodePosition?
    private(set) var head: CodePosition?
    private var states: [UInt8] = []
    private var cache: [Int: CodeRowLayout] = [:]
    private var widest: CGFloat = 0
    private let metrics = CodeRowMetrics(style: CodeCanvas.style)
    private var advance: CGFloat { metrics.font.maximumAdvancement.width }

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { source != nil }
    override var isOpaque: Bool { false }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    init() {
        super.init(frame: .zero)
        setAccessibilityElement(true)
        setAccessibilityRole(.textArea)
        setAccessibilityLabel("Code")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    static func baselineOffset(_ font: NSFont) -> CGFloat {
        ((style.lineHeight - (font.ascender - font.descender)) / 2 + font.ascender).rounded()
    }

    func load(_ source: CodeViewSource?, marks: [CodeMark]) {
        self.source = source
        self.marks = marks
        states = source.map { [$0.entryState] } ?? []
        cache.removeAll()
        anchor = nil
        head = nil
        widest = CGFloat(source?.widestColumns ?? 0) * advance
        setAccessibilityLabel(source.map { $0.name.isEmpty ? "Code" : $0.name } ?? "Code")
        needsDisplay = true
    }

    func fit(to visible: NSSize) {
        let count = CGFloat(source?.lineCount ?? 0)
        let width = Self.textInset * 2 + widest
        let height = count * Self.style.lineHeight + Self.verticalInset * 2
        let size = NSSize(width: max(width, visible.width).rounded(.up), height: max(height, visible.height).rounded(.up))
        if size != frame.size { setFrameSize(size) }
    }

    func top(ofLine index: Int) -> CGFloat { Self.verticalInset + CGFloat(index) * Self.style.lineHeight }

    func lines(in rect: NSRect) -> Range<Int> {
        guard let source, source.lineCount > 0 else { return 0 ..< 0 }
        let height = Self.style.lineHeight
        let first = max(0, Int(((rect.minY - Self.verticalInset) / height).rounded(.down)))
        let last = min(source.lineCount, Int(((rect.maxY - Self.verticalInset) / height).rounded(.up)))
        return first < last ? first ..< last : 0 ..< 0
    }

    func rect(of mark: CodeMark) -> NSRect {
        guard let source else { return .zero }
        let index = mark.line - source.firstLine
        guard index >= 0, index < source.lineCount else { return .zero }
        let start = x(of: mark.start, inLine: index)
        let end = x(of: mark.end, inLine: index)
        return NSRect(x: Self.textInset + start, y: top(ofLine: index), width: max(end - start, advance / 2), height: Self.style.lineHeight)
    }

    func x(of column: Int, inLine index: Int) -> CGFloat {
        row(index).x(ofColumn: column)
    }

    func ctLine(_ index: Int) -> CTLine { row(index).line }

    func row(_ index: Int) -> CodeRowLayout {
        if let cached = cache[index] { return cached }
        guard let source else { return [UInt16]().withUnsafeBufferPointer { CodeRowBuilder.build(units: $0, tokens: [], metrics: metrics) } }
        let units = Array(source.line(index).utf16)
        var tokens: [UInt64] = []
        let built = units.withUnsafeBufferPointer { buffer in
            let end = Lexer.line(buffer, state: state(at: index), language: source.language, offset: 0, tokens: &tokens, emit: true)
            if index + 1 == states.count { states.append(end) }
            return CodeRowBuilder.build(units: buffer, tokens: tokens, metrics: metrics)
        }
        if cache.count >= Self.cacheLimit { cache.removeAll(keepingCapacity: true) }
        cache[index] = built
        if built.width > widest {
            widest = built.width
            NSObject.cancelPreviousPerformRequests(withTarget: self, selector: #selector(grow), object: nil)
            perform(#selector(grow), with: nil, afterDelay: 0)
        }
        return built
    }

    @objc private func grow() { fit(to: Self.visibleSize(enclosingScrollView)) }

    static func visibleSize(_ scrollView: NSScrollView?) -> NSSize { scrollView?.contentView.bounds.size ?? .zero }

    func state(at index: Int) -> UInt8 {
        guard let source else { return LexState.normal }
        if let given = source.state?(index) { return given }
        if index < states.count { return states[index] }
        var tokens: [UInt64] = []
        while states.count <= index, let last = states.last {
            let units = Array(source.line(states.count - 1).utf16)
            states.append(units.withUnsafeBufferPointer {
                Lexer.line($0, state: last, language: source.language, offset: 0, tokens: &tokens, emit: false)
            })
        }
        return states[index]
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let source else { return }
        let lines = lines(in: dirtyRect)
        guard !lines.isEmpty, let context = NSGraphicsContext.current?.cgContext else { return }
        let height = Self.style.lineHeight
        let current = Set(marks.filter(\.isCurrent).map(\.line))
        let selection = selectionRange
        let selectionInk = KeyFocus.shows(holdsFocus: window?.firstResponder === self, windowIsKey: window?.hasKeyFocus ?? false)
            ? Palette.fillPrimary : Palette.fillSecondary
        for index in lines {
            let number = source.firstLine + index
            let top = top(ofLine: index)
            if current.contains(number) {
                Draw.fill(NSRect(x: dirtyRect.minX, y: top, width: dirtyRect.width, height: height), radius: 0, color: Palette.fillTertiary)
            }
            if let selection, let span = selectedSpan(index, in: selection) {
                selectionInk.setFill()
                NSRect(x: Self.textInset + span.lowerBound, y: top, width: span.upperBound - span.lowerBound, height: height).fill()
            }
            for mark in marks where mark.line == number {
                let rect = rect(of: mark).insetBy(dx: -Self.markOutset, dy: 0)
                Draw.fill(rect, radius: Radius.indicator, color: mark.isCurrent ? Palette.fillPrimary : Palette.fillSecondary)
                if mark.isCurrent { Draw.ring(rect, radius: Radius.indicator, color: Palette.strokeSecondary) }
            }
            context.saveGState()
            context.translateBy(x: Self.textInset, y: 0)
            row(index).draw(at: top, metrics: metrics, in: context)
            context.restoreGState()
        }
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        cache.removeAll()
        needsDisplay = true
    }

    var selectionRange: ClosedRange<CodePosition>? {
        guard let anchor, let head, anchor != head else { return nil }
        return min(anchor, head) ... max(anchor, head)
    }

    private func selectedSpan(_ index: Int, in selection: ClosedRange<CodePosition>) -> Range<CGFloat>? {
        guard index >= selection.lowerBound.line, index <= selection.upperBound.line else { return nil }
        let start = index == selection.lowerBound.line ? x(of: selection.lowerBound.column, inLine: index) : 0
        let lineEnd = index < selection.upperBound.line
        let end = lineEnd ? row(index).width + advance / 2
            : x(of: selection.upperBound.column, inLine: index)
        return end > start ? start ..< end : nil
    }

    var selectedText: String {
        guard let source, let selection = selectionRange else { return "" }
        let lines = (selection.lowerBound.line ... selection.upperBound.line).map { index -> String in
            let units = Array(source.line(index).utf16)
            let start = index == selection.lowerBound.line ? min(selection.lowerBound.column, units.count) : 0
            let end = index == selection.upperBound.line ? min(selection.upperBound.column, units.count) : units.count
            return String(decoding: units[start ..< max(start, end)], as: UTF16.self)
        }
        return lines.joined(separator: "\n")
    }

    func position(at point: NSPoint) -> CodePosition? {
        guard let source, source.lineCount > 0 else { return nil }
        let raw = Int(((point.y - Self.verticalInset) / Self.style.lineHeight).rounded(.down))
        let index = min(max(0, raw), source.lineCount - 1)
        if raw < 0 { return CodePosition(line: 0, column: 0) }
        let layout = row(index)
        if raw >= source.lineCount { return CodePosition(line: index, column: layout.length) }
        return CodePosition(line: index, column: layout.column(at: point.x - Self.textInset))
    }

    func select(from anchor: CodePosition?, to head: CodePosition?) {
        self.anchor = anchor
        self.head = head
        needsDisplay = true
    }

    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        let point = convert(event.locationInWindow, from: nil)
        guard let hit = position(at: point) else { return }
        if event.clickCount == 2 {
            selectWord(at: hit)
        } else if event.modifierFlags.contains(.shift), anchor != nil {
            select(from: anchor, to: hit)
        } else {
            select(from: hit, to: hit)
        }
        while let next = window?.nextEvent(matching: [.leftMouseUp, .leftMouseDragged]) {
            guard next.type == .leftMouseDragged else { return }
            autoscroll(with: next)
            if let moved = position(at: convert(next.locationInWindow, from: nil)) { select(from: anchor, to: moved) }
        }
    }

    private func selectWord(at hit: CodePosition) {
        guard let source else { return }
        let text = NSAttributedString(string: source.line(hit.line))
        guard text.length > 0 else { return }
        let word = text.doubleClick(at: min(hit.column, text.length - 1))
        select(from: CodePosition(line: hit.line, column: word.location), to: CodePosition(line: hit.line, column: NSMaxRange(word)))
    }

    @objc func copy(_ sender: Any?) {
        let text = selectedText
        guard !text.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    override func selectAll(_ sender: Any?) {
        guard let source, source.lineCount > 0 else { return }
        let last = source.lineCount - 1
        select(from: CodePosition(line: 0, column: 0), to: CodePosition(line: last, column: source.line(last).utf16.count))
    }

    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        switch menuItem.action {
        case #selector(copy(_:)): selectionRange != nil
        case #selector(selectAll(_:)): source != nil
        default: false
        }
    }

    override func keyDown(with event: NSEvent) {
        let modifiers = event.modifierFlags.intersection([.command, .option, .control, .shift])
        switch (modifiers, event.charactersIgnoringModifiers) {
        case (.command, "c"?): copy(nil)
        case (.command, "a"?): selectAll(nil)
        default: super.keyDown(with: event)
        }
    }

    override func becomeFirstResponder() -> Bool {
        needsDisplay = true
        return super.becomeFirstResponder()
    }

    override func resignFirstResponder() -> Bool {
        needsDisplay = true
        return super.resignFirstResponder()
    }

    override func viewWillMove(toWindow newWindow: NSWindow?) {
        super.viewWillMove(toWindow: newWindow)
        observeKeyFocus(moving: newWindow, #selector(windowKeyDidChange))
        if newWindow == nil { NSObject.cancelPreviousPerformRequests(withTarget: self, selector: #selector(grow), object: nil) }
    }

    @objc private func windowKeyDidChange() { needsDisplay = true }

    override func accessibilityValue() -> Any? {
        guard let source else { return "" }
        return (0 ..< source.lineCount).map(source.line).joined(separator: "\n")
    }

    override func accessibilitySelectedText() -> String? { selectedText }
}
