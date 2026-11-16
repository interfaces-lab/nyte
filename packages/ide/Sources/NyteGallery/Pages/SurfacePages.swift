import AppKit
@testable import NyteUI

@MainActor
let surfacePages: [GalleryPage] = [
    listsPage, compactListsPage, overlaysPage, panesPage, listPerformancePage, diffPage, pinnedLinesPage, codeViewPage, toolWindowPage,
]

@MainActor
private enum Picks {
    static let problemRows: IndexSet = [Specimens.selectedRow - 2, Specimens.selectedRow - 1]
    static let variableRow: IndexSet = [Specimens.selectedRow + 1]
}

@MainActor
let listsPage = GalleryPage(name: "lists", prepare: { Specimens.scrollPinnedLists() }) {
    Gallery.page([
        Specimens.states("Code with matches", note: "Syntax colour is the base ink; a match only changes weight; removed and "
                         + "added draw on top.", Specimens.codeMatches, height: Metric.rowCompact),
        Gallery.section("Width priority", note: "Detail truncates, then meta gives way, the title last. Changed-line counts stay; "
                        + "the folder goes first.", [Gallery.row(Specimens.fitWidths.map { width in
                            Gallery.specimen("\(Int(width)) points", Gallery.sized({
                                let list = ListView()
                                let rows = Specimens.changedFiles
                                list.rowCount = { rows.count }
                                list.content = { rows[$0] }
                                list.reload()
                                let card = PaneCard()
                                card.embed(list)
                                return card
                            }(), width: width, height: Metric.row * CGFloat(Specimens.changedFiles.count)))
                        })]),
        Gallery.section("Short forms first", note: "Every short form is tried before anything drops: parameters collapse to (…), "
                        + "then the result to Promise<…>; only then does the detail go, then the meta, then the title truncates. "
                        + "The selected row of a focused list measures as it draws.", [
            Gallery.row(Specimens.shortWidths.map { width in
                Gallery.specimen("\(Int(width)) points", Specimens.list(Specimens.signatures, selected: [0], focused: true, width: width))
            }),
        ]),
        Gallery.section("Coloured values", note: "valueSyntax colours a variable's value after its name, and descriptionSyntax its "
                        + "expanded value on the second line; the value is a yield part and goes before the name truncates.", [
            Gallery.row([
                Gallery.specimen("wide", Specimens.list(Specimens.debugValues, heightOf: { Specimens.debugValues[$0].description.isEmpty
                    ? Metric.row : Metric.rowDouble })),
                Gallery.specimen("narrow", Specimens.list(Specimens.debugValues, heightOf: {
                    Specimens.debugValues[$0].description.isEmpty ? Metric.row : Metric.rowDouble
                }, width: 200)),
            ]),
        ]),
                Specimens.states("Code descriptions and bounded meta", note: "A wrapped description in the code font; a path in the "
                         + "trailing column keeps its file name within a maximum width.", Specimens.codeRows,
                         heightOf: { RowRenderer.wrappedHeight(Specimens.codeRows[$0], width: Specimens.listWidth) }),
        Gallery.section("Pinned groups", note: "A scrolled-off file header stays under the top edge with a hairline until the next "
                        + "header pushes it out. Folders drop from the left first; the source sits 8 points after the message.", [
            Gallery.row([
                Gallery.specimen("header pinned", Specimens.pinned(Specimens.groupedProblems, scrolledBy: Metric.row * 3)),
                Gallery.specimen("next header pushing it out", Specimens.pinned(Specimens.groupedProblems,
                                                                                 scrolledBy: Metric.row * 6.5)),
            ]),
        ]),
        Specimens.states("Outline", Specimens.outline, outline: true),
        Specimens.states("Problems", note: "File groups are labels: they open and close, and never take the selection.",
                         Specimens.problems, outline: true, hovered: 1, selected: Picks.problemRows),
        Specimens.states("Debugger frames", note: "Library frames step down to tertiary ink.", Specimens.frames),
        Specimens.states("Agent sessions", note: "Two-line rows at 40. The title line keeps the title and the needs-input mark; age, cost and changed lines sit in columns on the second.",
                         Specimens.sessions, height: Metric.rowDouble, hovered: 1, selected: [2]),
    ])
}

@MainActor
let compactListsPage = GalleryPage(name: "lists-compact") {
    Gallery.page([
        Specimens.states("Find results", note: "Line numbers in a right-aligned tabular column the list sizes from its widest value. "
                         + "Replace, Replace All in File and Dismiss show on the hovered row and on the selected row of a focused list. "
                         + "A list driven from a field never holds focus itself: set showsFocusAlways, as the right-hand list here does, "
                         + "or the selected row shows no actions.",
                         Specimens.findResults, height: Metric.rowCompact, outline: true, hovered: 1, selected: [2]),
        Specimens.states("Refactoring preview", note: "A check box per edit and per file; removed text struck through on the diff "
                         + "view's removed span, added text on its added span.",
                         Specimens.refactorPreview, height: Metric.rowCompact, outline: true, hovered: 2, selected: [1]),
        Specimens.states("Changes with row actions", note: "Stage and Discard replace the age while shown; the status letter stays.",
                         Specimens.changesWithActions, height: Metric.rowCompact, hovered: 1, selected: [3]),
        Specimens.states("Variables", Specimens.variables, height: Metric.rowCompact, outline: true, selected: Picks.variableRow),
        Specimens.states("Frames, compact", Specimens.frames, height: Metric.rowCompact),
        Gallery.section("Navigator at 220 points", note: "Git marks sit right after the name (marksFollowTitle), not at the far edge.", [
            Gallery.row([Gallery.specimen("tree", Specimens.list(Specimens.navigatorTree, height: Metric.rowCompact, hovered: nil,
                                                                 width: Specimens.navigatorWidth))]),
        ]),
                Gallery.section("Folders", note: "FileIcon's folder, open and closed, in the label's ink, as the navigator draws it.", [
            Gallery.row([Gallery.specimen("tree", Specimens.list(Specimens.folders, height: Metric.rowCompact, hovered: nil,
                                                                 width: Specimens.factWidths[0]))]),
        ]),
        Gallery.section("Session facts in fixed places", note: "Working, retrying, waiting with an Approval or Question label, unread "
                        + "and failed. Under 360 points the trailing edge holds only the request label and the age, and the title "
                        + "has the rest; from 360 the change totals take their fixed column. The totals stay in the tooltip.", [
            Gallery.row(Specimens.factWidths.map { width in
                Gallery.specimen("\(Int(width)) points", Specimens.list(Specimens.sessionStates, height: Metric.rowCompact,
                                                                       hovered: nil, width: width))
            }),
        ]),
        Specimens.states("Sessions, one line", note: "Below 360 points a one-line row drops the cost and the changed lines before it shortens the title.",
                         Specimens.sessions.map { row in
                             var row = row
                             row.description = ""
                             return row
                         }, height: Metric.rowCompact, hovered: 1, selected: [2]),
        Specimens.states("Wrapped descriptions", note: "A row that sets descriptionWraps grows to its description's natural height.",
                         Specimens.choices, heightOf: { RowCell.Geometry.height(Specimens.choices[$0], width: Specimens.listWidth) }),
    ])
}

@MainActor
private enum Overlay {
    static let completionWidth: CGFloat = 420
    static let documentationWidth: CGFloat = 420
    static let documentationHeight: CGFloat = 196
    static let problemHoverHeight: CGFloat = 480
    static let signatureWidth: CGFloat = 360
    static let completionRows = 7
}

@MainActor
private func floating(_ content: NSView, radius: CGFloat, width: CGFloat, height: CGFloat) -> NSView {
    let surface = FloatingSurface(radius: radius)
    content.translatesAutoresizingMaskIntoConstraints = false
    surface.addSubview(content)
    NSLayoutConstraint.activate([
        content.leadingAnchor.constraint(equalTo: surface.leadingAnchor),
        content.trailingAnchor.constraint(equalTo: surface.trailingAnchor),
        content.topAnchor.constraint(equalTo: surface.topAnchor),
        content.bottomAnchor.constraint(equalTo: surface.bottomAnchor),
    ])
    return Gallery.sized(surface, width: width, height: height)
}

@MainActor
private func completion() -> NSView {
    let rows = Specimens.completion
    let list = ListView()
    list.rowHeight = Metric.rowCompact
    list.showsFocusAlways = true
    list.verticalInset = Space.x1
    list.rowCount = { rows.count }
    list.content = { rows[$0] }
    list.reload()
    list.selectedRow = 0
    return floating(list, radius: Radius.card, width: Overlay.completionWidth,
                    height: CGFloat(Overlay.completionRows) * Metric.rowCompact + Space.x1 * 2)
}

@MainActor
private final class ProseSpecimen: NSView {
    let storage: NSTextStorage
    let layout = ProseLayoutManager()
    let container: NSTextContainer

    init(_ text: NSAttributedString, width: CGFloat) {
        storage = NSTextStorage(attributedString: text)
        container = NSTextContainer(size: NSSize(width: width, height: CGFloat.greatestFiniteMagnitude))
        container.lineFragmentPadding = 0
        layout.addTextContainer(container)
        storage.addLayoutManager(layout)
        super.init(frame: .zero)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        let glyphs = layout.glyphRange(for: container)
        let origin = NSPoint(x: Space.x3, y: Space.x3)
        layout.drawBackground(forGlyphRange: glyphs, at: origin)
        layout.drawGlyphs(forGlyphRange: glyphs, at: origin)
    }
}

@MainActor
private func documentation() -> NSView {
    let markdown = """
    ```
    func (h *Hub) Broadcast(msg []byte) int
    ```
    Broadcast sends `msg` to every registered client and returns how many received it. A client \
    whose send buffer is full is **dropped** and unregistered.

    - Safe to call from any goroutine.
    - See [Hub.Run](https://pkg.go.dev) for the loop that drains it.
    """
    let view = ProseSpecimen(Prose.render(markdown, body: .base), width: Overlay.documentationWidth - Space.x3 * 2)
    return floating(view, radius: Radius.card, width: Overlay.documentationWidth, height: Overlay.documentationHeight)
}

@MainActor
private func problemHover() -> NSView {
    let view = DocumentationView()
    view.show(notes: [
        DocumentationNote(symbol: "xmark.octagon.fill", tone: .danger, message: "undefined: upgrader",
                          detail: "compiler · UndeclaredName"),
        DocumentationNote(symbol: "exclamationmark.triangle.fill", tone: .warning, message: "unused parameter: ctx",
                          detail: "gopls · unusedparams"),
    ], markdown: """
    ```go
    var upgrader = websocket.Upgrader{ReadBufferSize: 1024}
    ```
    Declare `upgrader` at package level. Its buffers:

    | Field | Default |
    | --- | --- |
    | ReadBufferSize | 4096 |
    | WriteBufferSize | 4096 |

    - Reuse one value across handlers.
    - See [Upgrader](https://pkg.go.dev/github.com/gorilla/websocket) for the options.
    """)
    let size = view.fittingSize(maxWidth: Overlay.documentationWidth, maxHeight: Overlay.problemHoverHeight)
    return floating(view, radius: Radius.card, width: size.width, height: size.height)
}

@MainActor
private func signature() -> NSView {
    let view = DocumentationView()
    view.language = "go"
    let label = "func Broadcast(msg []byte, urgent bool) int"
    view.show(signature: label, active: (label as NSString).range(of: "msg []byte"), overload: "", note: "")
    let size = view.fittingSize(maxWidth: Overlay.signatureWidth)
    return floating(view, radius: Radius.control, width: size.width, height: size.height)
}

@MainActor
private func palette(query: String) -> NSView {
    let commands: [(String, String, String)] = [
        ("Go to File", "doc", "⌘P"), ("Go to Symbol", "number", "⇧⌘O"), ("Toggle Terminal", "terminal", "⌃`"),
        ("Toggle Agent", "bubble.left", "⇧⌘A"), ("Find in Files", "magnifyingglass", "⇧⌘F"),
        ("Format Document", "text.alignleft", "⌥⇧F"), ("Toggle Breakpoint", "circle.fill", "F9"),
        ("Go to Line", "arrow.right.to.line", "⌃G"), ("Git: Commit", "checkmark.circle", ""),
        ("Rename Symbol", "pencil", "F2"),
    ]
    let view = CommandView(placeholder: "Type a command")
    let matching = { (query: String) in
        commands.filter { query.isEmpty || $0.0.localizedCaseInsensitiveContains(query) }.map { command in
            var row = RowContent(title: command.0, meta: command.2, leading: .symbol(command.1, .secondary))
            let range = (command.0 as NSString).range(of: query, options: .caseInsensitive)
            if !query.isEmpty, range.location != NSNotFound { row.emphasis = [range] }
            return row
        }
    }
    view.results = { matching($0) }
    let surface = FloatingSurface(radius: Radius.surface)
    view.translatesAutoresizingMaskIntoConstraints = false
    surface.addSubview(view)
    surface.translatesAutoresizingMaskIntoConstraints = false
    let height = surface.heightAnchor.constraint(
        equalToConstant: CommandView.height(results: matching(query).count, query: query)
    )
    view.onHeightChange = { height.constant = $0 }
    NSLayoutConstraint.activate([
        view.leadingAnchor.constraint(equalTo: surface.leadingAnchor),
        view.trailingAnchor.constraint(equalTo: surface.trailingAnchor),
        view.topAnchor.constraint(equalTo: surface.topAnchor),
        view.bottomAnchor.constraint(equalTo: surface.bottomAnchor),
        surface.widthAnchor.constraint(equalToConstant: CommandView.width),
        height,
    ])
    view.setQuery(query)
    return surface
}

@MainActor
let overlaysPage = GalleryPage(name: "overlays", settle: Motion.slow * 2) {
    Gallery.page([
        Gallery.section("Popovers over the editor", note: "Elevated ground, strokeTertiary ring. The real panel adds the window server's shadow.", [
            Gallery.row([
                Gallery.specimen("completion", completion()),
                Gallery.specimen("hover documentation, body .base", documentation()),
            ], spacing: Space.x8),
            Gallery.row([
                Gallery.specimen("signature help", signature()),
                Gallery.specimen("problem hover: source · code on its own line, 4 points below; Markdown body with a table and a list", problemHover()),
            ], spacing: Space.x8),
        ]),
        Gallery.section("Command palette", [
            Gallery.specimen("all commands", palette(query: "")),
            Gallery.row([
                Gallery.specimen("filtered", palette(query: "go")),
                Gallery.specimen("nothing matches", palette(query: "zz")),
            ], spacing: Space.x8),
        ]),
    ])
}
