import AppKit
import NyteCore
@testable import NyteAgent
import NyteUI

let markdownPages: [GalleryPage] = [
    GalleryPage(name: "markdown-reply") { markdownReply() },
    GalleryPage(name: "markdown-code") { markdownCode() },
    GalleryPage(name: "markdown-table") { markdownTable() },
    GalleryPage(name: "markdown-lists") { markdownLists() },
    GalleryPage(name: "markdown-alerts") { markdownAlerts() },
    GalleryPage(name: "markdown-streaming") { markdownStreaming() },
    GalleryPage(name: "markdown-docs") { markdownDocs() },
    GalleryPage(name: "markdown-images", settle: MarkdownSamples.imageSettle) { markdownImages() },
    GalleryPage(name: "markdown-diagrams", prepare: { await settleDiagrams() }) { markdownDiagrams() },
    GalleryPage(name: "markdown-transcript", settle: MarkdownSamples.paneSettle) { markdownTranscript() },
]

private enum MarkdownSamples {
    static let agentText = Metric.agentWidth - Space.x4 * 2
    static let wideText: CGFloat = 560
    static let popupWidth: CGFloat = 420
    static let narrowHover: CGFloat = 280
    static let paneText: CGFloat = 400
    static let diagramWidths = [agentText, paneText, wideText]
    static let shortHover: CGFloat = 200
    static let diagramSettle: Duration = .seconds(60)
    static let imageSettle: TimeInterval = 1
    static let swatch = NSSize(width: 480, height: 270)
    static let steadyPolls = 20
    @MainActor static weak var diagramPage: NSView?
    static let streamChunk = 40
    static let paneSettle = Motion.slow * 3
    static let pane = NSSize(width: Metric.agentWidth, height: 860)
    static let root = URL(fileURLWithPath: NSHomeDirectory())
    @MainActor static var kept: [AgentViewController] = []

    static let added = 42, removed = 7

    static let turn = [
        "`Run` now takes a `context.Context`, and each client's write loop selects on `ctx.Done()`, so a cancelled request stops its broadcast. The change is in `internal/hub/hub.go:42`.",
        "",
        "```go",
        "select {",
        "case c.send <- msg:",
        "case <-ctx.Done():",
        "    return ctx.Err()",
        "}",
        "```",
        "",
        "| Test | Result |",
        "|------|--------|",
        "| `TestBroadcast` | passes |",
        "| `TestShutdown` | passes |",
    ].joined(separator: "\n")

    static let failing = "The race detector found a write to `h.clients` from `Run` while `Broadcast` reads it. I'll guard the map with the hub's mutex."

    static let reply = [
        "I traced the dropped messages to `Hub.Broadcast` in internal/hub/hub.go:42. When a client's send buffer is full the hub **unregisters** it, but the *read* loop still holds a reference, so the next write panics. See [the Go memory model](https://go.dev/ref/mem) for why the race detector misses it.",
        "",
        "## What changed",
        "",
        "1. `Broadcast` now skips a full client instead of closing it.",
        "2. The read loop owns unregistering, so there is one place a client leaves.",
        "3. Tests cover a slow client, a closed client and ten thousand clients.",
        "",
        "### Before and after",
        "",
        "| Case | Before | After |",
        "|:-----|-------:|------:|",
        "| Slow client | panic | skipped |",
        "| 10k clients | 41 ms | **38 ms** |",
        "",
        "```go",
        "func (h *Hub) Broadcast(msg []byte) int {",
        "    sent := 0",
        "    for c := range h.clients {",
        "        select {",
        "        case c.send <- msg:",
        "            sent++",
        "        default:",
        "        }",
        "    }",
        "    return sent",
        "}",
        "```",
        "",
        "> The race only shows under load; with fewer than a hundred clients the buffer never fills.",
        "",
        "> [!NOTE]",
        "> `go test -race ./...` passes on every package.",
        "",
        "- [x] Reproduce the panic",
        "- [x] Fix the ownership",
        "- [ ] Run the load test on staging",
        "",
        "---",
        "",
        "That's all for now. ~~A rewrite~~ isn't needed.",
    ].joined(separator: "\n")

    static let go = [
        "Here's the handler with the timeout threaded through:",
        "",
        "```go",
        "// Serve answers one request, or gives up after the deadline.",
        "func Serve(ctx context.Context, w http.ResponseWriter, r *http.Request) error {",
        "    ctx, cancel := context.WithTimeout(ctx, 3*time.Second)",
        "    defer cancel()",
        "    body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))",
        "    if err != nil {",
        "        return fmt.Errorf(\"read body: %w\", err)",
        "    }",
        "    return json.NewEncoder(w).Encode(Response{Size: len(body), Path: r.URL.Path})",
        "}",
        "```",
        "",
        "And the client side, in TypeScript:",
        "",
        "```ts",
        "export async function send(path: string, body: unknown): Promise<Response> {",
        "  const controller = new AbortController();",
        "  const timer = setTimeout(() => controller.abort(), 3_000); // matches the server's deadline",
        "  try {",
        "    return await fetch(`/api/${path}`, { method: \"POST\", body: JSON.stringify(body), signal: controller.signal });",
        "  } finally {",
        "    clearTimeout(timer);",
        "  }",
        "}",
        "```",
        "",
        "```diff",
        "@@ -12,3 +12,4 @@ func Serve(",
        "-    body, err := io.ReadAll(r.Body)",
        "+    body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))",
        "+    defer r.Body.Close()",
        "```",
    ].joined(separator: "\n")

    static let table = [
        "The benchmarks across the three machines, five runs each:",
        "",
        "| Benchmark | M1 Pro | M3 Max | Linux x86 (Ryzen 9 7950X) | Notes |",
        "|:----------|-------:|-------:|--------------------------:|:------|",
        "| Parse 2,000 lines | 1.9 ms | 1.2 ms | 2.4 ms | md4c, cold cache |",
        "| First layout | 14 ms | 9 ms | n/a | TextKit 1, one container, `ensureLayout` over the whole document |",
        "| Stream 40 chars | 0.3 ms | 0.2 ms | n/a | Re-parses the open block only |",
        "| Resident memory | 3.1 MB | 3.0 MB | 2.2 MB | Storage, glyphs and panels for **visible** blocks |",
        "",
        "A short one:",
        "",
        "| Key | Value |",
        "|-----|-------|",
        "| `timeout` | 3s |",
        "| `retries` | 2 |",
    ].joined(separator: "\n")

    static let lists = [
        "The plan:",
        "",
        "- Parse with md4c into flat arrays",
        "  - Blocks: kind, depth, range",
        "  - Spans: kind, range, link target",
        "    - Nested three deep, with `code` and **bold**",
        "- Lay out in one text container",
        "- Put real views where code and tables sit",
        "",
        "Steps for the release:",
        "",
        "1. Bump the version",
        "2. Build and notarize",
        "   1. Archive with `xcodebuild`",
        "   2. Submit with `notarytool`",
        "3. Publish the notes",
        "",
        "Then, numbered from nine:",
        "",
        "9. Nine",
        "10. Ten, where the marker is wider",
        "11. Eleven",
        "",
        "Checklist:",
        "",
        "- [x] Selection runs across blocks",
        "- [x] Copy as Markdown returns the source",
        "- [ ] Accessibility rotor for headings",
        "  - [x] Headings are their own elements",
        "  - [ ] A rotor entry",
    ].joined(separator: "\n")

    static let alerts = [
        "> [!NOTE]",
        "> Useful information that users should know, even when skimming.",
        "",
        "> [!TIP]",
        "> Run `swift build --build-path .build-m` so two agents never share a build folder.",
        "",
        "> [!IMPORTANT]",
        "> The host must be running before the agent pane connects.",
        "",
        "> [!WARNING]",
        "> This deletes the derived data folder. It takes a few minutes to rebuild.",
        "",
        "> [!CAUTION]",
        "> Never run `git reset --hard` in a shared checkout.",
        "",
        "> A plain quote, for contrast, with a second paragraph.",
        ">",
        "> > And a nested one inside it.",
    ].joined(separator: "\n")

    static let docs = [
        "```go",
        "func (h *Hub) Broadcast(ctx context.Context, msg []byte, opts ...BroadcastOption) (sent int, err error)",
        "```",
        "",
        "Broadcast sends `msg` to every registered client and returns how many received it. A client whose send buffer is full is **skipped**, not dropped.",
        "",
        "- Safe to call from any goroutine.",
        "- See [Hub.Run](https://pkg.go.dev) for the loop that drains it.",
        "",
        "| Return | Meaning |",
        "|--------|---------|",
        "| `0` | No client was ready |",
        "| `n` | `n` clients got the message |",
        "",
        "> [!WARNING]",
        "> Broadcast holds the hub's lock while it sends.",
    ].joined(separator: "\n")

    static let diagrams = [
        "How cancellation reaches the writer:",
        "",
        "```mermaid",
        "graph LR",
        "    Cancel -.->|ctx.Done| Hub",
        "    Request --> Hub",
        "    Hub -->|broadcast| Writer",
        "    Writer -->|frame| Client",
        "```",
        "",
        "The request path, as it is now:",
        "",
        "```mermaid",
        "graph TD",
        "    A[Client] -->|POST /api| B{Auth}",
        "    B -->|valid| C[Handler]",
        "    B -->|invalid| D[401]",
        "    C --> E[(Database)]",
        "    C --> F[Cache]",
        "```",
        "",
        "How a send travels:",
        "",
        "```mermaid",
        "sequenceDiagram",
        "    participant C as Client",
        "    participant H as Hub",
        "    participant W as Writer",
        "    C->>H: Broadcast(msg)",
        "    H->>W: send <- msg",
        "    W-->>C: frame",
        "    H-->>C: sent count",
        "```",
        "",
        "The types involved:",
        "",
        "```mermaid",
        "classDiagram",
        "    class Hub {",
        "        +map clients",
        "        +Broadcast(msg) int",
        "        +Run()",
        "    }",
        "    class Client {",
        "        +chan send",
        "        +readLoop()",
        "    }",
        "    Hub \"1\" --> \"*\" Client : holds",
        "```",
        "",
        "A client's life:",
        "",
        "```mermaid",
        "stateDiagram-v2",
        "    [*] --> Connecting",
        "    Connecting --> Open: handshake",
        "    Open --> Draining: buffer full",
        "    Draining --> Open: caught up",
        "    Open --> Closed: read error",
        "    Closed --> [*]",
        "```",
        "",
        "And one the library cannot read:",
        "",
        "```mermaid",
        "gantt",
        "    title Release",
        "    section Build",
        "    Archive :a1, 2026-01-01, 3d",
        "```",
    ].joined(separator: "\n")
}

@MainActor
private func settleDiagrams() async {
    let deadline = ContinuousClock.now + MarkdownSamples.diagramSettle
    var (last, steady): (CGFloat, Int) = (-1, 0)
    while steady < MarkdownSamples.steadyPolls, ContinuousClock.now < deadline {
        let next = MarkdownSamples.diagramWidths.map { MarkdownView.height(for: MarkdownSamples.diagrams, width: $0) }.reduce(0, +)
        steady = next == last ? steady + 1 : 0
        last = next
        guard await Wait.pause(Wait.poll) else { return }
    }
    guard let window = MarkdownSamples.diagramPage?.window, let content = window.contentView else { return }
    window.setContentSize(content.fittingSize)
}

@MainActor
private func specimen(_ markdown: String, width: CGFloat, body: TextStyle = .prose) -> NSView {
    let view = MarkdownView(body: body)
    view.update(markdown)
    return framed(view, markdown: markdown, width: width, body: body)
}

@MainActor
private func framed(_ view: MarkdownView, markdown: String, width: CGFloat, body: TextStyle) -> NSView {
    let inset = body == .prose ? Space.x4 : Space.x3
    let height = MarkdownView.height(for: markdown, width: width, body: body)
    let card = FlippedCard()
    card.addSubview(view)
    view.frame = NSRect(x: inset, y: inset, width: width, height: height)
    let sized = Gallery.sized(card, width: width + inset * 2, height: height + inset * 2)
    let tall = card.constraints.first { $0.firstAttribute == .height }
    view.onHeightChange = { [weak view] in
        guard let view else { return }
        let next = MarkdownView.height(for: view.markdown, width: width, body: body)
        view.frame.size.height = next
        tall?.constant = next + inset * 2
    }
    return sized
}

private final class FlippedCard: SurfaceView {
    init() { super.init(fill: Palette.bgBase, ring: Palette.strokeQuaternary, radius: Radius.pane) }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isFlipped: Bool { true }
}

@MainActor
private func markdownReply() -> NSView {
    Gallery.page([
        Gallery.section("Agent reply", note: "Every block type at the agent pane's text width", [
            Gallery.row([
                Gallery.specimen("prose, 368pt", specimen(MarkdownSamples.reply, width: MarkdownSamples.agentText)),
                Gallery.specimen("prose, 560pt", specimen(MarkdownSamples.reply, width: MarkdownSamples.wideText)),
            ], spacing: Space.x8),
        ]),
    ])
}

@MainActor
private func markdownCode() -> NSView {
    Gallery.page([
        Gallery.section("Code blocks", note: "Go and TypeScript through the kit lexer, and a diff", [
            Gallery.row([
                Gallery.specimen("368pt", specimen(MarkdownSamples.go, width: MarkdownSamples.agentText)),
                Gallery.specimen("560pt", specimen(MarkdownSamples.go, width: MarkdownSamples.wideText)),
            ], spacing: Space.x8),
        ]),
    ])
}

@MainActor
private func markdownTable() -> NSView {
    Gallery.page([
        Gallery.section("Tables", note: "Columns sized to content, wrapping cells, scrolling when wider", [
            Gallery.row([
                Gallery.specimen("368pt", specimen(MarkdownSamples.table, width: MarkdownSamples.agentText)),
                Gallery.specimen("560pt", specimen(MarkdownSamples.table, width: MarkdownSamples.wideText)),
            ], spacing: Space.x8),
        ]),
    ])
}

@MainActor
private func markdownLists() -> NSView {
    Gallery.page([
        Gallery.section("Lists", note: "Nested, ordered, wide markers and tasks", [
            Gallery.row([
                Gallery.specimen("prose", specimen(MarkdownSamples.lists, width: MarkdownSamples.agentText)),
                Gallery.specimen("base", specimen(MarkdownSamples.lists, width: MarkdownSamples.agentText, body: .base)),
            ], spacing: Space.x8),
        ]),
    ])
}

@MainActor
private func markdownAlerts() -> NSView {
    Gallery.page([
        Gallery.section("Alerts and quotes", [
            Gallery.row([
                Gallery.specimen("prose", specimen(MarkdownSamples.alerts, width: MarkdownSamples.agentText)),
                Gallery.specimen("base", specimen(MarkdownSamples.alerts, width: MarkdownSamples.agentText, body: .base)),
            ], spacing: Space.x8),
        ]),
    ])
}

@MainActor
private func markdownStreaming() -> NSView {
    let full = MarkdownSamples.go
    let cut = full.range(of: "defer cancel()").map { full[..<$0.upperBound] }.map(String.init) ?? full
    let view = MarkdownView()
    var shown = ""
    var index = cut.startIndex
    while index < cut.endIndex {
        let next = cut.index(index, offsetBy: MarkdownSamples.streamChunk, limitedBy: cut.endIndex) ?? cut.endIndex
        shown += cut[index ..< next]
        view.update(shown)
        index = next
    }
    let opening = "Looking at the table first.\n\n| Step | State |\n|---|---|\n| parse | done |\n| lay"
    let partial = MarkdownView()
    partial.update(opening)
    return Gallery.page([
        Gallery.section("Streaming", note: "Fed 40 characters at a time; cut inside a fence, and inside a table row", [
            Gallery.row([
                Gallery.specimen("open fence", framed(view, markdown: shown, width: MarkdownSamples.agentText, body: .prose)),
                Gallery.specimen("open table", framed(partial, markdown: opening, width: MarkdownSamples.agentText, body: .prose)),
            ], spacing: Space.x8),
        ]),
    ])
}

@MainActor
private func markdownDocs() -> NSView {
    let width = MarkdownSamples.popupWidth - Space.x3 * 2
    return Gallery.page([
        Gallery.section("Documentation popup", note: "Base type in a 420pt popup", [
            Gallery.row([
                Gallery.specimen("MarkdownView, base", specimen(MarkdownSamples.docs, width: width, body: .base)),
                Gallery.specimen("Prose.render, base", ProseSpecimen(Prose.render(MarkdownSamples.docs, body: .base), width: width)),
            ], spacing: Space.x8),
        ]),
        Gallery.section("Hover", note: "DocumentationView on a floating surface at 280 and 420pt, scrolled and at rest", [
            Gallery.row([
                Gallery.specimen("280pt, top", hover(width: MarkdownSamples.narrowHover, height: DocumentationView.maxHeight)),
                Gallery.specimen("280pt, scrolled to the end", hover(width: MarkdownSamples.narrowHover, height: MarkdownSamples.shortHover, scrolled: true)),
                Gallery.specimen("420pt", hover(width: MarkdownSamples.popupWidth, height: DocumentationView.maxHeight)),
            ], spacing: Space.x6),
        ]),
    ])
}

@MainActor
private func hover(width: CGFloat, height: CGFloat, scrolled: Bool = false) -> NSView {
    let view = DocumentationView()
    view.language = "go"
    view.show(notes: [], markdown: MarkdownSamples.docs)
    let size = view.fittingSize(maxWidth: width, maxHeight: height)
    let surface = FloatingSurface(radius: Radius.card)
    surface.addSubview(view)
    view.frame = NSRect(origin: .zero, size: size)
    view.layoutSubtreeIfNeeded()
    if scrolled, let scroll = view.subviews.compactMap({ $0 as? NSScrollView }).first, let body = scroll.documentView {
        scroll.contentView.scroll(to: NSPoint(x: 0, y: max(0, body.frame.height - scroll.contentSize.height)))
        scroll.reflectScrolledClipView(scroll.contentView)
    }
    return Gallery.sized(surface, width: size.width, height: size.height)
}

@MainActor
private func swatchURI() -> String {
    let image = NSImage(size: MarkdownSamples.swatch, flipped: false) { rect in
        Draw.fill(rect, radius: 0, color: Palette.color(.contentAccent, in: .blue))
        let radius = rect.height / 4
        Draw.fill(NSRect(x: rect.midX - radius, y: rect.midY - radius, width: radius * 2, height: radius * 2), radius: radius, color: Palette.bgBase)
        return true
    }
    guard let tiff = image.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else { return "" }
    return "data:image/png;base64," + png.base64EncodedString()
}

@MainActor
private func markdownImages() -> NSView {
    let images = "A block image is boxed before it loads, so the text below never moves:\n\n![A blue swatch with a white circle](\(swatchURI()))\n\n"
        + "A remote image is not fetched unless the host allows it:\n\n![Build status](https://example.com/badge.png)\n\n"
        + "A missing file says so:\n\n![Architecture sketch](/tmp/nyte-missing-image.png)"
    return Gallery.page([Gallery.section("Images", note: "Decoded off the main actor at the box's size, in a byte-bounded cache", [Gallery.row([
        Gallery.specimen("368pt", specimen(images, width: MarkdownSamples.agentText)),
        Gallery.specimen("560pt", specimen(images, width: MarkdownSamples.wideText)),
    ], spacing: Space.x8)])])
}

@MainActor
private func markdownDiagrams() -> NSView {
    let page = Gallery.page([
        Gallery.section("Diagrams", note: "Fit by scaling while text stays at 11pt or more; past that, scroll with an edge cue and Expand", [
            Gallery.row([
                Gallery.specimen("368pt", specimen(MarkdownSamples.diagrams, width: MarkdownSamples.agentText)),
                Gallery.specimen("400pt", specimen(MarkdownSamples.diagrams, width: MarkdownSamples.paneText)),
            ], spacing: Space.x8),
            Gallery.specimen("560pt", specimen(MarkdownSamples.diagrams, width: MarkdownSamples.wideText)),
        ]),
    ])
    MarkdownSamples.diagramPage = page
    return page
}

@MainActor
private func transcriptPane(_ rows: [RowSpec]) -> NSView {
    let controller = AgentViewController(workspace: Workspace(root: MarkdownSamples.root), hosted: false)
    _ = controller.view
    MarkdownSamples.kept.append(controller)
    let updates: [AgentUpdate] = [
        .connection(.ready), .shown("s1"), .title("Port the hub to context cancellation"),
        .transcript(TranscriptSnapshot(rows: rows, live: false, sessionOpen: true, canLoadEarlier: false)),
    ]
    for update in updates { controller.receive(AgentEvent(session: 0, connection: 0, update: update)) }
    let card = PaneCard()
    card.embed(controller.view)
    return Gallery.sized(card, width: MarkdownSamples.pane.width, height: MarkdownSamples.pane.height)
}

@MainActor
private func step(_ key: String, _ kind: StepKind, _ outcome: StepOutcome, _ subject: String, added: Int = 0,
                  removed: Int = 0) -> RowSpec {
    StepWords.row(key: key, kind: kind, outcome: outcome, subject: subject, added: added, removed: removed)
}

@MainActor
private func markdownTranscript() -> NSView {
    let stopped: [RowSpec] = [
        RowSpec(kind: .user, key: "u1", text: "Port the hub to context cancellation. Keep Shutdown working."),
        RowSpec(kind: .thinking, key: "k1", text: "", expandable: true),
        step("t1", .read, .done, "hub.go"),
        step("t2", .list, .done, "hub"),
        step("t3", .edit, .done, "hub.go", added: MarkdownSamples.added, removed: MarkdownSamples.removed),
        step("t4", .shell, .done, "go test ./internal/hub/..."),
        RowSpec(kind: .prose, key: "a1", part: "a1", text: MarkdownSamples.turn),
        RowSpec(kind: .ended, key: "ended:1", text: "Stopped"),
    ]
    let failed: [RowSpec] = [
        RowSpec(kind: .user, key: "u2", text: "Run the race detector too."),
        step("t5", .shell, .failed, "go test -race ./internal/hub/..."),
        RowSpec(kind: .prose, key: "a2", part: "a2", text: MarkdownSamples.failing),
        RowSpec(kind: .failure, key: "ended:2", lead: "Rate limited",
                text: "The provider asked to wait 30 seconds before the next request.", retryable: true),
    ]
    return Gallery.page([
        Gallery.section("Transcript", note: "The pane fed plain values: steps, a reply, a stopped run, and a failed one", [
            Gallery.row([
                Gallery.specimen("stopped", transcriptPane(stopped)),
                Gallery.specimen("failed", transcriptPane(stopped + failed)),
            ], spacing: Space.x8),
        ]),
    ])
}

@MainActor
private final class ProseSpecimen: NSView {
    private let storage: NSTextStorage
    private let layout = ProseLayoutManager()
    private let container: NSTextContainer
    private let size: NSSize

    init(_ text: NSAttributedString, width: CGFloat) {
        storage = NSTextStorage(attributedString: text)
        container = NSTextContainer(size: NSSize(width: width, height: CGFloat.greatestFiniteMagnitude))
        container.lineFragmentPadding = 0
        layout.addTextContainer(container)
        storage.addLayoutManager(layout)
        size = NSSize(width: width + Space.x3 * 2, height: ProseMeasure.shared.height(text, width: width) + Space.x3 * 2)
        super.init(frame: .zero)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isFlipped: Bool { true }
    override var intrinsicContentSize: NSSize { size }

    override func draw(_ dirtyRect: NSRect) {
        Palette.bgElevated.setFill()
        Shape.rounded(bounds, radius: Radius.card).fill()
        let glyphs = layout.glyphRange(for: container)
        let origin = NSPoint(x: Space.x3, y: Space.x3)
        layout.drawBackground(forGlyphRange: glyphs, at: origin)
        layout.drawGlyphs(forGlyphRange: glyphs, at: origin)
    }
}
