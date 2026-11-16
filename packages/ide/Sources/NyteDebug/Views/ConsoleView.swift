import AppKit
import NyteUI

@MainActor
final class ConsoleView: NSView {
    static let scrollback = 50_000
    static let trimSlack = 5_000
    static let flushDelay: Duration = .milliseconds(16)
    static let filterDelay: Duration = .milliseconds(120)

    var onDroppedChange: ((Int) -> Void)?
    var onFilterCount: ((Int?) -> Void)?

    private let storage = NSTextStorage()
    private let layout = ConsoleLayoutManager()
    private let container = NSTextContainer()
    let text: ConsoleTextView
    let scroll = NSScrollView()
    private(set) var buffer = ConsoleBuffer(limit: ConsoleView.scrollback, slack: ConsoleView.trimSlack)
    private var pending: [DebugOutput] = []
    private var flushing: Task<Void, Never>?
    private var filtering: Task<Void, Never>?
    private(set) var filter = ""
    private var matchedLines = 0

    init() {
        container.widthTracksTextView = true
        container.lineFragmentPadding = 0
        layout.allowsNonContiguousLayout = true
        layout.addTextContainer(container)
        storage.addLayoutManager(layout)
        text = ConsoleTextView(frame: .zero, textContainer: container)
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        text.isEditable = false
        text.isSelectable = true
        text.isRichText = false
        text.drawsBackground = false
        text.usesFindBar = true
        text.isIncrementalSearchingEnabled = true
        text.textContainerInset = NSSize(width: Metric.paneInset, height: Space.x2)
        text.isVerticallyResizable = true
        text.isHorizontallyResizable = false
        text.autoresizingMask = [.width]
        text.minSize = .zero
        text.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        text.selectedTextAttributes = [.backgroundColor: TerminalPalette.selection]
        text.setAccessibilityLabel("Console")
        text.onClear = { [weak self] in self?.clear() }
        text.onCopyAll = { [weak self] in self?.copyAll() }
        scroll.documentView = text
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.scrollerStyle = .overlay
        scroll.translatesAutoresizingMaskIntoConstraints = false
        addSubview(scroll)
        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: trailingAnchor),
            scroll.topAnchor.constraint(equalTo: topAnchor),
            scroll.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    var string: String { storage.string }
    var isEmpty: Bool { buffer.count == 0 && pending.isEmpty }
    var lineCount: Int { buffer.count }
    var dropped: Int { buffer.dropped }

    func append(_ outputs: [DebugOutput]) {
        pending += outputs
        guard flushing == nil else { return }
        flushing = Task { [weak self] in
            try? await Task.sleep(for: Self.flushDelay)
            guard !Task.isCancelled else { return }
            self?.flush()
        }
    }

    var codeLanguage = ""

    func echo(_ text: String, stream: ConsoleBuffer.Stream) {
        flush()
        appendBatch([(text, stream)])
    }

    func flush() {
        flushing?.cancel()
        flushing = nil
        guard !pending.isEmpty else { return }
        let batch = pending.map { ($0.text, Self.stream($0.category)) }
        pending = []
        appendBatch(batch)
    }

    private func appendBatch(_ batch: [(String, ConsoleBuffer.Stream)]) {
        let following = isAtEnd
        let appended = NSMutableAttributedString()
        var filtered = 0
        for (chunk, stream) in batch {
            let before = buffer.count
            let continuing = buffer.isLastOpen
            let broke = buffer.append(chunk, stream: stream)
            if filter.isEmpty {
                appended.append(Self.styled((broke ? "\n" : "") + chunk, stream: stream, code: codeLanguage))
                continue
            }
            let first = continuing && !broke ? max(before - 1, 0) : before
            for index in first..<buffer.count where buffer.line(index).localizedCaseInsensitiveContains(filter) {
                appended.append(Self.styled(buffer.line(index) + "\n", stream: stream, code: codeLanguage))
                filtered += 1
            }
        }
        let dropped = buffer.trim()
        storage.beginEditing()
        storage.append(appended)
        if dropped > 0, filter.isEmpty { trimStorage(lines: dropped) }
        storage.endEditing()
        if dropped > 0 { onDroppedChange?(buffer.dropped) }
        if !filter.isEmpty, filtered > 0 {
            matchedLines += filtered
            onFilterCount?(matchedLines)
        }
        if following { scrollToEnd() }
    }

    private func trimStorage(lines: Int) {
        let string = storage.string as NSString
        var location = 0
        for _ in 0..<lines {
            let found = string.range(of: "\n", options: .literal, range: NSRange(location: location, length: string.length - location))
            guard found.location != NSNotFound else { break }
            location = found.location + 1
        }
        storage.deleteCharacters(in: NSRange(location: 0, length: location))
    }

    func setFilter(_ query: String) {
        let query = query.trimmingCharacters(in: .whitespaces)
        guard query != filter else { return }
        filtering?.cancel()
        filtering = Task { [weak self] in
            try? await Task.sleep(for: Self.filterDelay)
            guard !Task.isCancelled else { return }
            await self?.applyFilter(query)
        }
    }

    func applyFilter(_ query: String) async {
        flush()
        filter = query
        guard !query.isEmpty else {
            let all = buffer
            let match = await Task.detached { all.matching("") }.value
            show(match)
            matchedLines = 0
            onFilterCount?(nil)
            return
        }
        let snapshot = buffer
        let match = await Task.detached { snapshot.matching(query) }.value
        guard filter == query, !Task.isCancelled else { return }
        show(match)
        matchedLines = match.lines
        onFilterCount?(match.lines)
    }

    private func show(_ match: ConsoleBuffer.Match) {
        let shown = NSMutableAttributedString(string: match.text)
        let text = match.text as NSString
        var location = 0
        for run in match.runs {
            let range = NSRange(location: location, length: run.length)
            shown.replaceCharacters(in: range, with: Self.styled(text.substring(with: range), stream: run.stream, code: codeLanguage))
            location += run.length
        }
        storage.setAttributedString(shown)
        scrollToEnd()
    }

    var isAtEnd: Bool {
        let visible = scroll.contentView.bounds
        return visible.maxY >= text.frame.maxY - TextStyle.code.lineHeight
    }

    func scrollToEnd() {
        text.scrollRangeToVisible(NSRange(location: storage.length, length: 0))
    }

    func copyAll() {
        flush()
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(storage.string, forType: .string)
    }

    func clear() {
        flushing?.cancel()
        flushing = nil
        filtering?.cancel()
        pending = []
        matchedLines = 0
        buffer.removeAll()
        storage.setAttributedString(NSAttributedString())
        onDroppedChange?(0)
        if !filter.isEmpty { onFilterCount?(0) }
    }

    static func stream(_ category: DebugOutput.Category) -> ConsoleBuffer.Stream {
        switch category {
        case .stdout: .stdout
        case .stderr: .stderr
        case .console: .console
        }
    }

    static func styled(_ text: String, stream: ConsoleBuffer.Stream, code language: String) -> NSAttributedString {
        let styled = NSMutableAttributedString(string: text, attributes: attributes(stream))
        guard stream.isCode, !language.isEmpty else { return styled }
        for (range, color) in CodeColors.ranges(in: text, language: language) {
            styled.addAttribute(.foregroundColor, value: color.color, range: range)
        }
        return styled
    }

    static func attributes(_ stream: ConsoleBuffer.Stream) -> [NSAttributedString.Key: Any] {
        let ink = switch stream {
        case .stdout: Palette.contentPrimary
        case .stderr: Palette.dangerInk
        case .console: Palette.contentTertiary
        case .input, .prompt: Palette.contentSecondary
        case .result: Palette.contentPrimary
        }
        var attributes = TextStyle.code.attributes(ink)
        attributes[ConsoleLayoutManager.streamKey] = stream.rawValue
        guard stream == .stderr, let base = attributes[.paragraphStyle] as? NSParagraphStyle,
              let indented = base.mutableCopy() as? NSMutableParagraphStyle else { return attributes }
        indented.firstLineHeadIndent = ConsoleLayoutManager.barWidth + ConsoleLayoutManager.barGap
        indented.headIndent = indented.firstLineHeadIndent
        attributes[.paragraphStyle] = indented
        return attributes
    }
}

final class ConsoleLayoutManager: NSLayoutManager {
    static let streamKey = NSAttributedString.Key("sh.nyte.ide.console.stream")
    static let barWidth: CGFloat = 2
    static let barGap = Space.x15

    override func drawBackground(forGlyphRange glyphsToShow: NSRange, at origin: NSPoint) {
        super.drawBackground(forGlyphRange: glyphsToShow, at: origin)
        guard let storage = textStorage else { return }
        let characters = characterRange(forGlyphRange: glyphsToShow, actualGlyphRange: nil)
        storage.enumerateAttribute(Self.streamKey, in: characters) { value, range, _ in
            guard let raw = value as? UInt8, ConsoleBuffer.Stream(rawValue: raw) == .stderr else { return }
            Palette.dangerInk.setFill()
            let glyphs = glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            enumerateLineFragments(forGlyphRange: glyphs) { rect, _, _, _, _ in
                NSRect(x: origin.x + rect.minX, y: origin.y + rect.minY, width: Self.barWidth, height: rect.height).fill()
            }
        }
    }
}

@MainActor
final class ConsoleTextView: NSTextView {
    var onClear: (() -> Void)?
    var onCopyAll: (() -> Void)?

    override func menu(for event: NSEvent) -> NSMenu? {
        Menu.make([
            MenuItem("Copy", key: "c", enabled: selectedRange().length > 0) { [weak self] in self?.copy(nil) },
            MenuItem("Copy All") { [weak self] in self?.onCopyAll?() },
            MenuItem("Select All", key: "a") { [weak self] in self?.selectAll(nil) },
            .separator,
            MenuItem("Clear", key: "k", enabled: !string.isEmpty) { [weak self] in self?.onClear?() },
        ])
    }
}
