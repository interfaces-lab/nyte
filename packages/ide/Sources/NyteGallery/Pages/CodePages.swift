import AppKit
@testable import NyteUI

@MainActor
enum CodeSpecimens {
    typealias Token = (text: String, syntax: SyntaxColor)

    static let lineHeight: CGFloat = 18
    static let gutter = Space.x8 + Space.x2
    static let bar = Space.x05 + Space.hair
    static let width: CGFloat = 520
    static let pinnedHeight: CGFloat = 200
    static let pinnedScroll: CGFloat = 5
    static let pushed: CGFloat = 0.5

    static let source: [[Token]] = [
        [("func", .keyword), (" (", .plain), ("h", .variable), (" *", .operator), ("Hub", .type), (") ", .plain),
         ("Run", .function), ("(", .plain), ("ctx", .variable), (" context.", .plain), ("Context", .type), (") {", .plain)],
        [("\tfor", .keyword), (" {", .plain)],
        [("\t\tselect", .keyword), (" {", .plain)],
        [("\t\tcase", .keyword), (" client := <-h.", .plain), ("register", .property), (":", .plain)],
        [("\t\t\th.", .plain), ("clients", .property), ("[client] = ", .plain), ("true", .constant)],
        [("\t\tcase", .keyword), (" msg := <-h.", .plain), ("broadcast", .property), (":", .plain)],
        [("\t\t\t// fan out to every client", .comment)],
        [("\t\t\tfor", .keyword), (" client := ", .plain), ("range", .keyword), (" h.", .plain), ("clients", .property), (" {", .plain)],
        [("\t\t\t\tclient.", .plain), ("send", .property), (" <- msg", .plain)],
        [("\t\t\t}", .plain)],
        [("\t\tcase", .keyword), (" <-ctx.", .plain), ("Done", .function), ("():", .plain)],
        [("\t\t\treturn", .keyword)],
        [("\t\t}", .plain)],
        [("\t}", .plain)],
        [("}", .plain)],
    ]

    static func attributed(_ tokens: [Token]) -> NSAttributedString {
        let out = NSMutableAttributedString()
        for token in tokens {
            var attributes = TextStyle.code.attributes(token.syntax.color)
            if token.syntax == .comment { attributes[.font] = TextStyle.code.slantedFont() }
            out.append(NSAttributedString(string: token.text.replacingOccurrences(of: "\t", with: "    "), attributes: attributes))
        }
        return out
    }

    static var pinned: [(scroll: NSScrollView, view: PinnedLinesView, offset: CGFloat)] = []

    static func pinnedCode(scrolledBy lines: CGFloat) -> NSView {
        let scroll = NSScrollView()
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.scrollerStyle = .overlay
        let text = CodeLines(lines: source.map(attributed))
        text.frame = NSRect(x: 0, y: 0, width: width, height: CGFloat(source.count) * lineHeight)
        scroll.documentView = text
        let view = PinnedLinesView()
        pinned.append((scroll, view, lines * lineHeight))
        let card = PaneCard()
        card.embed(scroll)
        return Gallery.sized(card, width: width, height: pinnedHeight)
    }

    static func showPinned() {
        for (scroll, view, offset) in pinned {
            scroll.layoutSubtreeIfNeeded()
            scroll.contentView.scroll(to: NSPoint(x: 0, y: offset))
            scroll.reflectScrolledClipView(scroll.contentView)
            let push = offset.truncatingRemainder(dividingBy: lineHeight)
            view.show(source.prefix(3).map(attributed), lineHeight: lineHeight, leadingInset: gutter,
                      baseline: CodeLines.baseline, push: push, in: scroll)
        }
        pinned = []
    }
}

@MainActor
final class CodeLines: NSView {
    static let baseline = TextStyle.code.font().ascender + (CodeSpecimens.lineHeight - TextStyle.code.font().ascender
        + TextStyle.code.font().descender) / 2
    let lines: [NSAttributedString]

    init(lines: [NSAttributedString]) {
        self.lines = lines
        super.init(frame: .zero)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        Palette.bgBase.setFill()
        dirtyRect.fill()
        let font = TextStyle.code.font()
        for (index, line) in lines.enumerated() {
            let top = CGFloat(index) * CodeSpecimens.lineHeight
            Draw.text(String(index + 1), in: NSRect(x: 0, y: top, width: CodeSpecimens.gutter - Space.x2,
                                                     height: CodeSpecimens.lineHeight),
                      style: .code, ink: Palette.contentQuaternary, alignment: .right)
            line.draw(at: NSPoint(x: CodeSpecimens.gutter, y: top + Self.baseline - font.ascender))
        }
    }
}

@MainActor
final class DiffLines: NSView {
    enum Change { case context, added, removed }

    let rows: [(change: Change, tokens: [CodeSpecimens.Token], span: NSRange?)]

    init(_ rows: [(change: Change, tokens: [CodeSpecimens.Token], span: NSRange?)]) {
        self.rows = rows
        super.init(frame: .zero)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        let font = TextStyle.code.font()
        for (index, row) in rows.enumerated() {
            let rect = NSRect(x: 0, y: CGFloat(index) * CodeSpecimens.lineHeight, width: bounds.width, height: CodeSpecimens.lineHeight)
            let (ground, span, bar): (NSColor, NSColor?, NSColor?) = switch row.change {
            case .context: (Palette.bgBase, nil, nil)
            case .added: (Palette.diffAddedLine, Palette.diffAddedSpan, Palette.diffAddedBar)
            case .removed: (Palette.diffRemovedLine, Palette.diffRemovedSpan, Palette.diffRemovedBar)
            }
            ground.setFill()
            rect.fill()
            if let bar {
                bar.setFill()
                NSRect(x: rect.minX, y: rect.minY, width: CodeSpecimens.bar, height: rect.height).fill()
            }
            let text = CodeSpecimens.attributed(row.tokens)
            let origin = NSPoint(x: CodeSpecimens.gutter, y: rect.minY + CodeLines.baseline - font.ascender)
            if let span, let fill = row.span, NSMaxRange(fill) <= text.length {
                let start = text.attributedSubstring(from: NSRange(location: 0, length: fill.location)).size().width
                let width = text.attributedSubstring(from: fill).size().width
                Draw.fill(NSRect(x: origin.x + start, y: rect.minY, width: width, height: rect.height), radius: 0, color: span)
            }
            text.draw(at: origin)
        }
    }
}

@MainActor
final class SyntaxSwatches: NSView {
    static let rowHeight: CGFloat = 22
    static let nameWidth: CGFloat = 96
    static let sampleWidth: CGFloat = 240

    override var isFlipped: Bool { true }

    static var height: CGFloat { CGFloat(SyntaxColor.allCases.count) * rowHeight }

    override func draw(_ dirtyRect: NSRect) {
        Palette.bgBase.setFill()
        bounds.fill()
        for (index, syntax) in SyntaxColor.allCases.enumerated() {
            let top = CGFloat(index) * Self.rowHeight
            let ratio = Palette.contrast(Palette.composite(syntax.color, over: Palette.bgBase), Palette.bgBase)
            Draw.text("\(syntax)", in: NSRect(x: Space.x3, y: top, width: Self.nameWidth, height: Self.rowHeight),
                      style: .sm, ink: Palette.contentSecondary)
            let sample = syntax == .comment ? "// fan out to every client" : "client.broadcast(msg)"
            var attributes = TextStyle.code.attributes(syntax.color)
            if syntax == .comment { attributes[.font] = TextStyle.code.slantedFont() }
            (sample as NSString).draw(at: NSPoint(x: Space.x3 + Self.nameWidth, y: top + Space.x05), withAttributes: attributes)
            Draw.text(String(format: "%.2f:1", ratio), in: NSRect(x: Space.x3 + Self.nameWidth + Self.sampleWidth, y: top,
                                                                  width: Self.nameWidth, height: Self.rowHeight),
                      style: .sm, ink: Palette.contentTertiary, tabular: true)
        }
    }
}

@MainActor
private enum DiffCaption {
    static var text: String {
        var parts: [String] = []
        NSApp.effectiveAppearance.performAsCurrentDrawingAppearance {
            for (name, ground) in [("added line", Palette.diffAddedLine), ("added span", Palette.composite(Palette.diffAddedSpan, over: Palette.diffAddedLine)),
                                   ("removed line", Palette.diffRemovedLine),
                                   ("removed span", Palette.composite(Palette.diffRemovedSpan, over: Palette.diffRemovedLine))] {
                let resolved = Palette.composite(ground, over: Palette.bgBase)
                let lowest = SyntaxColor.allCases.map { Palette.contrast(Palette.composite($0.color, over: resolved), resolved) }.min() ?? 0
                parts.append("\(name) \(String(format: "%.2f", lowest)):1")
            }
        }
        return "Lowest contrast of any syntax colour, measured here: " + parts.joined(separator: ", ") + "."
    }
}

@MainActor
let diffPage = GalleryPage(name: "diff") {
    let lines: [(change: DiffLines.Change, tokens: [CodeSpecimens.Token], span: NSRange?)] = [
        (.context, [("func", .keyword), (" ", .plain), ("NewHub", .function), ("() *", .plain), ("Hub", .type), (" {", .plain)], nil),
        (.removed, [("\treturn", .keyword), (" &", .operator), ("Hub", .type), ("{", .plain), ("clients", .property),
                    (": ", .plain), ("map", .keyword), ("[*Client]", .plain), ("bool", .type), ("{}}", .plain)], NSRange(location: 25, length: 3)),
        (.added, [("\treturn", .keyword), (" &", .operator), ("Hub", .type), ("{", .plain), ("clients", .property),
                  (": ", .plain), ("make", .builtin), ("(", .plain), ("map", .keyword), ("[*Client]", .plain), ("bool", .type),
                  ("), ", .plain), ("limit", .property), (": ", .plain), ("512", .number), ("}", .plain)], NSRange(location: 25, length: 4)),
        (.added, [("\t// keep the buffer bounded", .comment)], nil),
        (.removed, [("\tlog.", .plain), ("Printf", .function), ("(", .plain), ("\"hub %s\"", .string), (", ", .plain), ("name", .variable),
                    (")", .plain)], nil),
        (.context, [("}", .plain)], nil),
    ]
    let diff = DiffLines(lines)
    let marks = ListView()
    let files = GitChange.allCases.map { change in
        var row = RowContent(title: "\(change.word).go", leading: .image(FileIcon.forFile(named: "a.go").image(for: NSApp.effectiveAppearance)))
        row.status = change.status
        return row
    }
    marks.rowCount = { files.count }
    marks.content = { files[$0] }
    marks.reload()
    let bars = GitChange.allCases.map { change in
        Gallery.specimen(change.word, Gallery.sized(SurfaceView(fill: change.bar), width: CodeSpecimens.bar, height: CodeSpecimens.lineHeight))
    }
    return Gallery.page([
        Gallery.section("Diff lines", note: DiffCaption.text, onCard: true, [
            Gallery.sized(diff, width: CodeSpecimens.width, height: CGFloat(lines.count) * CodeSpecimens.lineHeight),
        ]),
        Gallery.section("Syntax colours", note: "Every SyntaxColor on the editor ground, with its contrast measured in this appearance. "
                        + "Comments carry the editor's slant through the font, so Core Text drawers match.", onCard: true, [
            Gallery.sized(SyntaxSwatches(), width: CodeSpecimens.width, height: SyntaxSwatches.height),
        ]),
        Gallery.section("Gutter change bars", [Gallery.row(bars)]),
        Gallery.section("Changed files", note: "One letter per status, in the same inks as the navigator.", onCard: true, [
            Gallery.sized(marks, width: Specimens.listWidth, height: CGFloat(files.count) * Metric.row),
        ]),
    ])
}

@MainActor
let pinnedLinesPage = GalleryPage(name: "pinned-lines", prepare: { CodeSpecimens.showPinned() }) {
    Gallery.page([
        Gallery.section("Pinned lines", note: "The editor's sticky declarations: opaque ground, a hairline, a soft shadow over "
                        + "scrolled code, and a last line that slides under the next.", [
            Gallery.row([
                Gallery.specimen("three lines pinned", CodeSpecimens.pinnedCode(scrolledBy: CodeSpecimens.pinnedScroll)),
                Gallery.specimen("last line being pushed out", CodeSpecimens.pinnedCode(
                    scrolledBy: CodeSpecimens.pinnedScroll + CodeSpecimens.pushed)),
            ], spacing: Space.x6),
        ]),
    ])
}

@MainActor
enum CodeViewSpecimens {
    static let height: CGFloat = 236
    static let narrow: CGFloat = 300
    static let first = 117
    static var shown: [(view: CodeView, source: CodeViewSource, marks: [CodeMark], selection: (Int, Int, Int, Int)?)] = []

    static let prefix = ["package realtime", "", "/*", "Hub fans every message out to the registered clients."]
    static let lines = [
        "Run owns the maps below; nothing else touches them, so they need no lock.",
        "Stop it by cancelling ctx.",
        "*/",
        "func (h *Hub) Run(ctx context.Context) {",
        "\tfor {",
        "\t\tselect {",
        "\t\tcase client := <-h.register:",
        "\t\t\th.clients[client] = true",
        "\t\tcase msg := <-h.broadcast:",
        "\t\t\t// fan out to every client; a full send buffer drops the client rather than blocking the broadcast",
        "\t\t\tfor client := range h.clients {",
        "\t\t\t\tselect {",
        "\t\t\t\tcase client.send <- msg:",
        "\t\t\t\tdefault:",
        "\t\t\t\t\tclose(client.send)",
        "\t\t\t\t\tdelete(h.clients, client)",
        "\t\t\t\t}",
        "\t\t\t}",
        "\t\tcase <-ctx.Done():",
        "\t\t\treturn",
        "\t\t}",
        "\t}",
        "}",
    ]

    static var source: CodeViewSource {
        let language = Language.detect(fileName: "hub.go")
        return CodeViewSource(name: "hub.go", language: language, firstLine: first, lines: lines,
                              entryState: CodeViewSource.state(after: prefix, language: language))
    }

    static var marks: [CodeMark] {
        lines.enumerated().flatMap { index, line -> [CodeMark] in
            let found = (line as NSString).range(of: "broadcast")
            guard found.location != NSNotFound else { return [] }
            return [CodeMark(line: first + index, start: found.location, end: NSMaxRange(found), isCurrent: index == 8)]
        }
    }

    static func view(width: CGFloat, marks: [CodeMark], selection: (Int, Int, Int, Int)? = nil) -> NSView {
        let view = CodeView()
        shown.append((view, source, marks, selection))
        let card = PaneCard()
        card.embed(view)
        return Gallery.sized(card, width: width, height: height)
    }

    static func show() {
        for (view, source, marks, selection) in shown {
            view.layoutSubtreeIfNeeded()
            view.show(source, marks: marks)
            if case let (line, column, endLine, endColumn)? = selection {
                view.canvas.select(from: CodePosition(line: line, column: column), to: CodePosition(line: endLine, column: endColumn))
            }
            if view.frame.width < CodeSpecimens.width, let far = marks.last(where: { $0.start > 40 }) {
                view.reveal(CodeMark(line: far.line, start: far.start, end: far.end + 40))
            }
        }
        shown = []
    }
}

@MainActor
let codeViewPage = GalleryPage(name: "code-view", prepare: { CodeViewSpecimens.show() }) {
    Gallery.page([
        Gallery.section("Read-only code", note: "The window starts at line 118, inside a block comment the host carried in as the "
                        + "lexer's entry state, so the first lines are already comment ink and slant. Matches on fill, the current one "
                        + "with a ring and its line on a band; numbers sit in a gutter that stays put when the code scrolls sideways.", [
            Gallery.row([
                Gallery.specimen("current match revealed", CodeViewSpecimens.view(width: CodeSpecimens.width, marks: CodeViewSpecimens.marks)),
                Gallery.specimen("scrolled sideways", CodeViewSpecimens.view(width: CodeViewSpecimens.narrow, marks: CodeViewSpecimens.marks)),
            ], spacing: Space.x6),
            Gallery.row([
                Gallery.specimen("selection across lines", CodeViewSpecimens.view(width: CodeSpecimens.width, marks: [],
                                                                                    selection: (4, 1, 6, 14))),
            ]),
        ]),
    ])
}
