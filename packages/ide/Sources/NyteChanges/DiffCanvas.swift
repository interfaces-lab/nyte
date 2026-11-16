import AppKit
import NyteCore
import NyteUI
import os

enum HunkAction: Sendable, Equatable {
    case stage, unstage, discard, revert

    func title(lines: Bool) -> String {
        let verb = switch self {
        case .stage: "Stage"
        case .unstage: "Unstage"
        case .discard: "Discard"
        case .revert: "Revert"
        }
        return lines ? verb + " Lines" : verb + " Hunk"
    }

    var isDestructive: Bool { self == .discard || self == .revert }
}

struct HunkActions: Equatable {
    var primary: HunkAction?
    var destructive: HunkAction?

    static let none = HunkActions()
}

@MainActor
final class DiffCanvas: NSView {
    struct Line {
        let text: CTLine
        let spans: [ClosedRange<CGFloat>]
    }

    static let lineHeight = TextStyle.code.lineHeight
    static var headerHeight: CGFloat { Metric.rowCompact }
    static let font = TextStyle.code.font()
    static let headerFont = TextStyle.codeSmall.font()
    static let commentFont = TextStyle.code.slantedFont(flippedTextMatrix: true)
    static let gutterPadding = Space.x2
    static let textGap = Space.x3
    static let trailing = Space.x8
    static let leastDigits = 3
    static let cacheLimit = 600
    static let tabColumns: CGFloat = 4
    static let spanRadius = Radius.indicator / 2
    static let actionGap = Space.x1

    var document = DiffDocument(path: "", oldTitle: "", newTitle: "") { didSet { documentDidChange() } }
    var mode = DiffMode.unified { didSet { if mode != oldValue { rebuild(keepingCursor: true) } } }
    var folds = DiffFolds(hunks: 0)
    var actions = HunkActions.none { didSet { updateActionButtons() } }
    private(set) var rows = DiffRows()

    var onAction: ((HunkAction, DiffSelection) -> Void)?
    var onBoundary: ((Int) -> Void)?
    var onCursorChange: (() -> Void)?

    var cursor = -1
    var anchor = -1
    var hovered = -1 { didSet { if hovered != oldValue { updateActionButtons() } } }
    var dragging = false

    private var cache: [Int: Line] = [:]
    private var tokens: [UInt64] = []
    private var units: [UInt16] = []
    private(set) var charWidth: CGFloat = 0
    private(set) var numberWidth: CGFloat = 0
    private var tabStyle = NSParagraphStyle()
    let primaryButton = Button("", size: .xs)
    let destructiveButton = Button("", size: .xs)
    var accessRows: [Int: NSAccessibilityElement] = [:]
    var notes: [DiffNote] = []
    var composing: Composing?
    var noteViews: [Int: NoteView] = [:]
    var composer: NoteComposer?
    var nextNote = 1
    var acceptsNotes = true
    var onNotesChange: (() -> Void)?
    private var notedWidth: CGFloat = 0

    init() {
        super.init(frame: .zero)
        let advance = ("0" as NSString).size(withAttributes: [.font: Self.font]).width
        charWidth = advance
        let style = NSMutableParagraphStyle()
        style.tabStops = []
        style.defaultTabInterval = advance * Self.tabColumns
        style.lineBreakMode = .byClipping
        tabStyle = style
        for button in [primaryButton, destructiveButton] {
            button.isHidden = true
            button.translatesAutoresizingMaskIntoConstraints = true
            addSubview(button)
        }
        primaryButton.onPress = { [weak self] in self?.performActive(\.primary) }
        destructiveButton.onPress = { [weak self] in self?.performActive(\.destructive) }
        setAccessibilityElement(true)
        setAccessibilityRole(.table)
        setAccessibilityLabel("Changes")
        installTracking()
        Density.observe(self) { [weak self] in self?.densityDidChange() }
    }

    private func densityDidChange() {
        guard rows.count > 0, let clip = enclosingScrollView?.contentView else { return rebuild(keepingCursor: true) }
        let top = rows.row(at: clip.bounds.minY)
        let into = clip.bounds.minY - rows.rect(of: top, width: 0).minY
        rebuild(keepingCursor: true)
        guard top < rows.count else { return }
        let landing = rows.rect(of: top, width: 0)
        clip.scroll(to: NSPoint(x: clip.bounds.minX, y: landing.minY + min(into, landing.height)))
        enclosingScrollView?.reflectScrolledClipView(clip)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isFlipped: Bool { true }
    override var isOpaque: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    var textX: CGFloat {
        switch mode {
        case .unified: numberWidth * 2 + charWidth + Self.textGap
        case .split: numberWidth + charWidth + Self.textGap
        }
    }

    func splitColumns(width: CGFloat) -> Int {
        let room = (width / 2).rounded() - (numberWidth + charWidth + Self.textGap)
        return charWidth > 0 ? Int(room / charWidth) : 0
    }

    var sideWidth: CGFloat { textX + CGFloat(document.columns) * charWidth + Self.trailing }

    var contentWidth: CGFloat {
        guard mode == .split else { return sideWidth }
        let clip = enclosingScrollView?.contentView.bounds.width ?? bounds.width
        return clip + max(0, sideWidth - (clip / 2).rounded())
    }

    func halves(_ visible: NSRect) -> (width: CGFloat, old: CGFloat, new: CGFloat) {
        let width = (visible.width / 2).rounded()
        return (width, visible.minX, visible.minX + width)
    }

    func textStart(_ side: Side, _ visible: NSRect) -> CGFloat {
        guard mode == .split else { return textX }
        return (side == .old ? 0 : halves(visible).width) + textX
    }

    private func documentDidChange() {
        cache.removeAll(keepingCapacity: true)
        let digits = max(Self.leastDigits, String(max(document.old.count, document.new.count)).count)
        numberWidth = (CGFloat(digits) * charWidth + Self.gutterPadding * 2).rounded(.up)
        folds = DiffFolds(hunks: document.diff.hunks.count)
        if document.patch != nil { folds = folds.expandedAll() }
        cursor = -1
        anchor = -1
        rebuild(keepingCursor: false)
    }

    func rebuild(keepingCursor: Bool) {
        let signpost = OSSignposter.changes.beginInterval("diff rows")
        let previous = keepingCursor && cursor >= 0 && cursor < rows.count ? rows.owner[cursor] : nil
        folds = folds.revealing(notes + (composing.map { [DiffNote(id: 0, side: $0.side, lines: $0.lines, quoted: [], comment: "")] } ?? []),
                                in: document)
        rows = DiffRows.build(document, mode: mode, folds: folds, line: Self.lineHeight, header: Self.headerHeight)
            .gapped(document.patch?.gaps ?? [], height: Self.headerHeight)
            .anchored(noteAnchors())
        OSSignposter.changes.endInterval("diff rows", signpost)
        cache.removeAll(keepingCapacity: true)
        accessRows.removeAll()
        if let previous, Int(previous) < rows.headers.count {
            cursor = Int(rows.headers[Int(previous)])
        } else if !keepingCursor {
            cursor = -1
        }
        anchor = cursor
        hovered = -1
        resize()
        updateActionButtons()
        layoutNotes()
        needsDisplay = true
    }

    func resize() {
        let clip = enclosingScrollView?.contentView.bounds.size ?? bounds.size
        let size = NSSize(width: max(clip.width, contentWidth), height: max(clip.height, rows.height))
        if frame.size != size { setFrameSize(size) }
        if clip.width != notedWidth {
            notedWidth = clip.width
            if !notes.isEmpty || composing != nil { rebuild(keepingCursor: true) }
        }
    }

    var selectedRows: IndexSet {
        guard cursor >= 0, anchor >= 0, cursor < rows.count, anchor < rows.count else { return [] }
        return IndexSet(integersIn: min(cursor, anchor)...max(cursor, anchor))
    }

    var activeHunk: Int? {
        let row = hovered >= 0 ? hovered : cursor
        guard row >= 0, row < rows.count, rows.kinds[row] != .fold, !rows.headers.isEmpty else { return nil }
        let owner = Int(rows.owner[row])
        return owner < rows.headers.count ? owner : nil
    }

    var linesChosen: Bool {
        guard selectedRows.count > 1 || (cursor >= 0 && cursor < rows.count && rows.isChange(cursor)) else { return false }
        return !rows.selection(selectedRows).isEmpty
    }

    func chosenSelection() -> DiffSelection? {
        if linesChosen { return rows.selection(selectedRows) }
        guard let hunk = cursorHunk ?? activeHunk else { return nil }
        return DiffSelection(hunks: [document.diff.hunks[hunk]])
    }

    var cursorHunk: Int? {
        guard cursor >= 0, cursor < rows.count, rows.kinds[cursor] != .fold, !rows.headers.isEmpty else { return nil }
        let owner = Int(rows.owner[cursor])
        return owner < rows.headers.count ? owner : nil
    }

    private func performActive(_ which: KeyPath<HunkActions, HunkAction?>) {
        guard let action = actions[keyPath: which], let hunk = activeHunk else { return }
        let lines = linesChosen && rows.selection(selectedRows).isEmpty == false && selectedRows.allSatisfy { Int(rows.owner[$0]) == hunk }
        let selection = lines ? rows.selection(selectedRows) : DiffSelection(hunks: [document.diff.hunks[hunk]])
        onAction?(action, selection)
    }

    func updateActionButtons() {
        guard let hunk = activeHunk, hunk < rows.headers.count else {
            primaryButton.isHidden = true
            destructiveButton.isHidden = true
            return
        }
        let header = rows.rect(of: Int(rows.headers[hunk]), width: bounds.width)
        let lines = linesChosen && selectedRows.allSatisfy { Int(rows.owner[$0]) == hunk }
        var end = visibleRect.maxX - Self.gutterPadding
        for (button, action) in [(destructiveButton, actions.destructive), (primaryButton, actions.primary)] {
            guard let action else {
                button.isHidden = true
                continue
            }
            button.title = action.title(lines: lines)
            button.tone = action.isDestructive ? .danger : .neutral
            button.setAccessibilityLabel(button.title)
            let size = button.intrinsicContentSize
            button.frame = NSRect(x: (end - size.width).rounded(), y: (header.midY - size.height / 2).rounded(), width: size.width,
                                  height: size.height)
            button.isHidden = false
            end = button.frame.minX - Self.actionGap
        }
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        cache.removeAll(keepingCapacity: true)
        needsDisplay = true
    }

    override func draw(_ dirtyRect: NSRect) {
        let signpost = OSSignposter.changes.beginInterval("diff draw")
        defer { OSSignposter.changes.endInterval("diff draw", signpost) }
        Palette.bgBase.setFill()
        dirtyRect.fill()
        guard rows.count > 0, let context = NSGraphicsContext.current?.cgContext else { return }
        let first = max(0, rows.row(at: dirtyRect.minY)), last = min(rows.count - 1, rows.row(at: dirtyRect.maxY))
        guard first <= last else { return }
        evict(keeping: first...last)
        let visible = visibleRect
        let selection = selectedRows
        let focused = window?.firstResponder === self && window?.isKeyWindow == true
        context.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
        for row in first...last {
            let rect = rows.rect(of: row, width: bounds.width)
            switch rows.kinds[row] {
            case .header: drawHeader(row, rect, visible)
            case .fold: drawFold(row, rect, visible)
            case .gap: drawGap(row, rect, visible)
            case .context, .removed, .added, .changed: drawLine(row, rect, visible, context)
            case .note, .composer: continue
            }
            if selection.contains(row) {
                Palette.fillSecondary.setFill()
                rect.fill(using: .sourceOver)
            }
            if row == cursor, focused {
                Palette.focus.setFill()
                NSRect(x: visible.minX, y: rect.minY, width: Space.x05, height: rect.height).fill()
            }
        }
    }

    private func drawLine(_ row: Int, _ rect: NSRect, _ visible: NSRect, _ context: CGContext) {
        let kind = rows.kinds[row]
        let oldLine = Int(rows.old[row]), newLine = Int(rows.new[row])
        switch mode {
        case .unified:
            let ground: NSColor? = kind == .removed ? Palette.diffRemovedLine : kind == .added ? Palette.diffAddedLine : nil
            if let ground {
                ground.setFill()
                rect.fill()
            }
            let side: Side = kind == .removed ? .old : .new
            let line = side == .old ? oldLine : newLine
            drawText(side, line, kind == .context ? nil : side, x: textX, in: rect, clip: nil, context)
            gutter(rect, visible, ground: ground)
            number(.old, oldLine, x: visible.minX, in: rect)
            number(.new, newLine, x: visible.minX + numberWidth, in: rect)
            sign(kind == .removed ? "\u{2212}" : kind == .added ? "+" : "", kind, x: visible.minX + numberWidth * 2, in: rect)
        case .split:
            let halves = halves(visible)
            let half = halves.width
            defer {
                Palette.strokeQuaternary.setFill()
                NSRect(x: halves.new, y: rect.minY, width: Metric.hairline, height: rect.height).fill()
            }
            for (side, line, origin) in [(Side.old, oldLine, halves.old), (Side.new, newLine, halves.new)] {
                let area = NSRect(x: origin, y: rect.minY, width: half, height: rect.height)
                let changed = kind == .changed
                if line < 0 {
                    Palette.fillTertiary.setFill()
                    area.fill()
                    continue
                }
                if changed {
                    (side == .old ? Palette.diffRemovedLine : Palette.diffAddedLine).setFill()
                    area.fill()
                }
                let textArea = NSRect(x: origin + textX - Self.textGap / 2, y: rect.minY, width: half - textX + Self.textGap / 2,
                                      height: rect.height)
                drawText(side, line, changed ? side : nil, x: textStart(side, visible), in: rect, clip: textArea, context)
                number(side == .old ? .old : .new, line, x: origin, in: rect)
                sign(changed ? (side == .old ? "\u{2212}" : "+") : "", changed ? (side == .old ? .removed : .added) : .context,
                     x: origin + numberWidth, in: rect)
            }
        }
    }

    private func gutter(_ rect: NSRect, _ visible: NSRect, ground: NSColor?) {
        let gutter = NSRect(x: visible.minX, y: rect.minY, width: textX - Self.textGap / 2, height: rect.height)
        Palette.bgBase.setFill()
        gutter.fill()
        if let ground {
            ground.setFill()
            gutter.fill()
        }
    }

    private func number(_ side: ReviewComment.Side, _ line: Int, x: CGFloat, in rect: NSRect) {
        guard line >= 0 else { return }
        let text = String(document.number(side, line))
        let attributes: [NSAttributedString.Key: Any] = [.font: Self.font, .foregroundColor: Self.numberInk]
        let width = CGFloat(text.count) * charWidth
        (text as NSString).draw(at: NSPoint(x: x + numberWidth - Self.gutterPadding - width, y: rect.minY + baselineInset),
                                withAttributes: attributes)
    }

    private func sign(_ text: String, _ kind: DiffRows.Kind, x: CGFloat, in rect: NSRect) {
        guard !text.isEmpty else { return }
        let ink = kind == .removed ? Palette.dangerInk : Palette.successInk
        (text as NSString).draw(at: NSPoint(x: x, y: rect.minY + baselineInset), withAttributes: [.font: Self.font, .foregroundColor: ink])
    }

    private var baselineInset: CGFloat {
        ((Self.lineHeight - (Self.font.ascender - Self.font.descender)) / 2).rounded()
    }

    private func drawText(_ side: Side, _ line: Int, _ spanSide: Side?, x: CGFloat, in rect: NSRect, clip: NSRect?,
                          _ context: CGContext) {
        guard line >= 0 else { return }
        let cached = text(side, line)
        context.saveGState()
        if let clip { context.clip(to: clip) }
        if spanSide != nil, !cached.spans.isEmpty {
            (side == .old ? Palette.diffRemovedSpan : Palette.diffAddedSpan).setFill()
            for span in cached.spans {
                Shape.rounded(NSRect(x: x + span.lowerBound, y: rect.minY + Space.hair, width: span.upperBound - span.lowerBound,
                                     height: rect.height - Space.hair * 2), radius: Self.spanRadius).fill()
            }
        }
        // Core Graphics: the text matrix is not part of the graphics state, and AppKit string drawing resets it
        context.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
        context.textPosition = CGPoint(x: x, y: rect.minY + baselineInset + Self.font.ascender)
        CTLineDraw(cached.text, context)
        context.restoreGState()
    }

    private func drawHeader(_ row: Int, _ rect: NSRect, _ visible: NSRect) {
        let hunkIndex = Int(rows.owner[row])
        let hunk = document.diff.hunks[hunkIndex]
        Palette.strokeQuaternary.setFill()
        NSRect(x: rect.minX, y: rect.minY, width: rect.width, height: Metric.hairline).fill()
        let range = "@@ \u{2212}\(headerStart(.old, hunk.old)),\(hunk.old.count) +\(headerStart(.new, hunk.new)),\(hunk.new.count) @@"
        let font = Self.headerFont
        let y = rect.minY + ((rect.height - (font.ascender - font.descender)) / 2).rounded()
        let x = visible.minX + Self.gutterPadding
        (range as NSString).draw(at: NSPoint(x: x, y: y), withAttributes: [.font: font, .foregroundColor: Palette.contentTertiary])
        var end = (primaryButton.isHidden ? visible.maxX : min(primaryButton.frame.minX, destructiveButton.isHidden ? visible.maxX
                : destructiveButton.frame.minX)) - Space.x2
        if document.unsaved {
            let hint = Self.unsavedHint as NSString
            let width = hint.size(withAttributes: [.font: TextStyle.sm.font()]).width
            end = visible.maxX - Self.gutterPadding - width
            hint.draw(at: NSPoint(x: end, y: rect.minY + ((rect.height - TextStyle.sm.lineHeight) / 2).rounded()),
                      withAttributes: [.font: TextStyle.sm.font(), .foregroundColor: Palette.contentTertiary])
            end -= Space.x3
        }
        let start = x + (range as NSString).size(withAttributes: [.font: font]).width + Space.x3
        guard let words = heading(of: hunkIndex) else { return }
        let style = NSMutableParagraphStyle()
        style.lineBreakMode = .byTruncatingTail
        (words as NSString).draw(with: NSRect(x: start, y: y, width: max(0, end - start), height: rect.height),
                                 options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
                                 attributes: [.font: font, .foregroundColor: Palette.contentSecondary, .paragraphStyle: style])
    }

    static let unsavedHint = "Save to stage or discard"

    static let numberInk = Palette.contentTertiary

    func headerStart(_ side: ReviewComment.Side, _ lines: Range<Int>) -> Int {
        if !lines.isEmpty { return document.number(side, lines.lowerBound) }
        if lines.lowerBound > 0 { return document.number(side, lines.lowerBound - 1) }
        return max(0, document.number(side, 0) - 1)
    }

    func heading(of hunk: Int) -> String? {
        if let headings = document.patch?.headings, hunk < headings.count { return headings[hunk].isEmpty ? nil : headings[hunk] }
        let declaration = Int(document.declarations[hunk])
        return declaration >= 0 ? document.new.string(of: declaration).trimmingCharacters(in: .whitespaces) : nil
    }

    func gapLabel(_ row: Int) -> String {
        guard let gaps = document.patch?.gaps, Int(rows.old[row]) < gaps.count else { return "" }
        return gaps[Int(rows.old[row])].label
    }

    private func drawGap(_ row: Int, _ rect: NSRect, _ visible: NSRect) {
        Palette.fillTertiary.setFill()
        rect.fill()
        let font = TextStyle.sm.font()
        let y = rect.minY + ((rect.height - (font.ascender - font.descender)) / 2).rounded()
        ("\u{22EF}  " + gapLabel(row) as NSString).draw(at: NSPoint(x: visible.minX + Self.gutterPadding, y: y),
                                                     withAttributes: [.font: font, .foregroundColor: Palette.contentTertiary])
    }

    static let foldStep = "Show \(DiffFolds.step) More"
    static let foldAll = "Show All"

    func foldLinks(_ rect: NSRect, _ visible: NSRect) -> (step: NSRect, all: NSRect) {
        let font = TextStyle.sm.font()
        let all = (Self.foldAll as NSString).size(withAttributes: [.font: font]).width
        let step = (Self.foldStep as NSString).size(withAttributes: [.font: font]).width
        let allRect = NSRect(x: visible.maxX - Self.gutterPadding - all, y: rect.minY, width: all, height: rect.height)
        let stepRect = NSRect(x: allRect.minX - Space.x4 - step, y: rect.minY, width: step, height: rect.height)
        return (stepRect, allRect)
    }

    var hoveredLink: Int = -1 { didSet { if hoveredLink != oldValue { needsDisplay = true } } }

    private func drawFold(_ row: Int, _ rect: NSRect, _ visible: NSRect) {
        Palette.fillTertiary.setFill()
        rect.fill()
        let hidden = rows.hiddenLines(ofFold: row)
        let font = TextStyle.sm.font()
        let y = rect.minY + ((rect.height - (font.ascender - font.descender)) / 2).rounded()
        let label = "\u{22EF}  \(hidden.formatted()) unchanged \(hidden == 1 ? "line" : "lines")"
        (label as NSString).draw(at: NSPoint(x: visible.minX + Self.gutterPadding, y: y),
                                 withAttributes: [.font: font, .foregroundColor: Palette.contentTertiary])
        let links = foldLinks(rect, visible)
        let showsStep = hidden > Int(DiffFolds.step)
        for (index, link, text) in [(0, links.step, Self.foldStep), (1, links.all, Self.foldAll)] where index == 1 || showsStep {
            let lit = hoveredLink == index && hovered == row
            (text as NSString).draw(at: NSPoint(x: link.minX, y: y),
                                    withAttributes: [.font: font, .foregroundColor: lit ? Palette.contentPrimary : Palette.contentSecondary])
        }
    }

    enum Side { case old, new }

    private func text(_ side: Side, _ line: Int) -> Line {
        let key = (side == .old ? 0 : 1 << 40) | line
        if let cached = cache[key] { return cached }
        let lines = side == .old ? document.old : document.new
        let content = lines.content(of: line)
        let string = String(decoding: content, as: UTF8.self)
        var built: Line?
        effectiveAppearance.performAsCurrentDrawingAppearance {
            let attributed = NSMutableAttributedString(string: string, attributes: [
                .font: Self.font, .paragraphStyle: tabStyle,
                NSAttributedString.Key(kCTForegroundColorAttributeName as String): Palette.contentPrimary.cgColor,
            ])
            let states = side == .old ? document.oldStates : document.newStates
            if line < states.count {
                units.removeAll(keepingCapacity: true)
                units.append(contentsOf: string.utf16)
                tokens.removeAll(keepingCapacity: true)
                let state = states[line], language = document.language
                _ = units.withUnsafeBufferPointer { buffer in
                    Lexer.line(buffer, state: state, language: language, offset: 0, tokens: &tokens, emit: true)
                }
                for token in tokens {
                    let range = Token.range(token)
                    guard NSMaxRange(range) <= attributed.length else { continue }
                    attributed.addAttribute(NSAttributedString.Key(kCTForegroundColorAttributeName as String),
                                            value: Token.kind(token).color.cgColor, range: range)
                    if Token.kind(token) == .comment { attributed.addAttribute(.font, value: Self.commentFont, range: range) }
                }
            }
            let ctLine = CTLineCreateWithAttributedString(attributed)
            built = Line(text: ctLine, spans: spans(side, line, string, ctLine))
        }
        let result = built ?? Line(text: CTLineCreateWithAttributedString(NSAttributedString(string: string)), spans: [])
        cache[key] = result
        return result
    }

    private func spans(_ side: Side, _ line: Int, _ string: String, _ ctLine: CTLine) -> [ClosedRange<CGFloat>] {
        guard let partner = partner(side, line) else { return [] }
        let old = side == .old ? line : partner, new = side == .old ? partner : line
        guard let found = Diff.spans(document.old.content(of: old), document.new.content(of: new)) else { return [] }
        let ranges = side == .old ? found.removed : found.added
        let utf8 = string.utf8
        return ranges.compactMap { range in
            guard range.upperBound <= utf8.count else { return nil }
            let start = utf8.index(utf8.startIndex, offsetBy: range.lowerBound).utf16Offset(in: string)
            let end = utf8.index(utf8.startIndex, offsetBy: range.upperBound).utf16Offset(in: string)
            return CTLineGetOffsetForStringIndex(ctLine, start, nil)...CTLineGetOffsetForStringIndex(ctLine, end, nil)
        }
    }

    private func partner(_ side: Side, _ line: Int) -> Int? {
        let hunks = document.diff.hunks
        var low = 0, high = hunks.count - 1
        while low <= high {
            let middle = (low + high) / 2
            let range = side == .old ? hunks[middle].old : hunks[middle].new
            if line < range.lowerBound {
                high = middle - 1
            } else if line >= range.upperBound {
                low = middle + 1
            } else {
                let hunk = hunks[middle]
                let offset = line - range.lowerBound
                guard offset < hunk.old.count, offset < hunk.new.count else { return nil }
                return side == .old ? hunk.new.lowerBound + offset : hunk.old.lowerBound + offset
            }
        }
        return nil
    }

    private func evict(keeping visible: ClosedRange<Int>) {
        guard cache.count > Self.cacheLimit else { return }
        var keep = Set<Int>()
        for row in visible {
            if rows.old[row] >= 0 { keep.insert(Int(rows.old[row])) }
            if rows.new[row] >= 0 { keep.insert(1 << 40 | Int(rows.new[row])) }
        }
        cache = cache.filter { keep.contains($0.key) }
    }
}
