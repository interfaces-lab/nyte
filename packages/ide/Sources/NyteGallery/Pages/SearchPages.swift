import AppKit
import Darwin
import NyteCore
@testable import NyteSearch
@testable import NyteUI

@MainActor
private enum SearchFixture {
    static let wide = NSSize(width: 1_000, height: 240)
    static let narrow = NSSize(width: 700, height: 300)
    static let replaceSize = NSSize(width: 1_000, height: 300)
    static let stateSize = NSSize(width: 700, height: 220)
    static let perfSize = NSSize(width: 700, height: 480)
    static let perfFiles = 200
    static let perfLines = 250
    static let perfSteps = 300
    static let perfStride = 397
    static let millisecond: Double = 1_000
    static let nanosecond: Double = 1e9

    static func cpu() -> Double { Double(clock_gettime_nsec_np(CLOCK_THREAD_CPUTIME_ID)) / nanosecond }
    static let percentile = 0.95

    static let files: [(String, String)] = [
        ("Sources/App/Renderer.swift", """
        import AppKit

        final class Renderer {
            private var frames: [Frame] = []
            private let queue = DispatchQueue(label: "render")

            func render(_ scene: Scene) -> Frame {
                let frame = Frame(size: scene.size)
                for layer in scene.layers where layer.isVisible {
                    frame.draw(layer)
                }
                frames.append(frame)
                return frame
            }

            func renderAll(_ scenes: [Scene]) -> [Frame] {
                scenes.map(render)
            }
        }
        """),
        ("Sources/App/Scene.swift", """
        struct Scene {
            var size: CGSize
            var layers: [Layer]

            func rendered(by renderer: Renderer) -> Frame {
                renderer.render(self)
            }
        }
        """),
        ("Sources/Kit/Theme.swift", """
        enum Theme {
            static let accent = "blue"
            // Render the theme once per window, not per frame.
            static func apply(to window: Window) {
                window.render(with: accent)
            }
        }
        """),
        ("web/src/render.ts", """
        export function render(node: Node, into: HTMLElement): void {
          const html = toHTML(node);
          into.innerHTML = html; // render synchronously
        }

        export const renderLater = (node: Node) => queueMicrotask(() => render(node, document.body));
        """),
        ("web/src/components/Toolbar.tsx", """
        export function Toolbar({ items }: Props) {
          return <nav>{items.map((item) => <Button key={item.id} onClick={() => render(item)} />)}</nav>;
        }
        """),
        ("docs/rendering.md", """
        # Rendering

        Call `render` once per scene. A renderer keeps its frames.
        """),
        ("locked/secret.txt", "render me\n"),
    ]

    static func workspace() -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-search-gallery")
        try? FileManager.default.removeItem(at: root)
        for (path, text) in files {
            let url = root.appendingPathComponent(path)
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? Data(text.utf8).write(to: url)
        }
        _ = chmod(root.appendingPathComponent("locked/secret.txt").path, 0)
        return root
    }

    static let root = workspace()

    static func controller(_ text: String, configure: (FindInFilesViewController) -> Void = { _ in }) -> FindInFilesViewController {
        let controller = FindInFilesViewController(workspace: Workspace(root: root))
        controller.loadViewIfNeeded()
        configure(controller)
        controller.bar.field.stringValue = text
        return controller
    }

    static func card(_ controller: FindInFilesViewController, size: NSSize) -> NSView {
        let card = PaneCard()
        card.embed(controller.view)
        return Gallery.sized(card, width: size.width, height: size.height)
    }

    static func finish(_ controllers: [FindInFilesViewController], selecting: Bool = true) async {
        _ = await Wait.until(.seconds(10)) {
            controllers.allSatisfy { if case .done = $0.phase { true } else { false } }
        }
        guard selecting else { return }
        for controller in controllers {
            guard let row = controller.rowKind.indices.first(where: { controller.rowKind[$0] == .match }).map({ $0 + 1 }),
                  row < controller.rowKind.count, controller.rowKind[row] == .match else { continue }
            controller.list.selectedRows = IndexSet(integer: row)
            controller.selectionChanged()
        }
        _ = await Wait.until(.seconds(5)) { controllers.allSatisfy { $0.preview.source != nil } }
        for controller in controllers { controller.list.showsFocusAlways = true }
        controllers.first?.list.focus()
    }
}

@MainActor
private var searchControllers: [FindInFilesViewController] = []

@MainActor
private let searchResultsPage = GalleryPage(name: "search-results", settle: 0.4, prepare: {
    await SearchFixture.finish(searchControllers)
}) {
    let wide = SearchFixture.controller("render")
    let narrow = SearchFixture.controller("render")
    searchControllers = [wide, narrow]
    return Gallery.page([
        Gallery.section("Find in Files, bottom dock at 1,000 by 240", note: "Results grouped by file with pinned headers, the preview beside them.", [
            SearchFixture.card(wide, size: SearchFixture.wide),
        ]),
        Gallery.section("At 700 by 300 the preview moves below", [SearchFixture.card(narrow, size: SearchFixture.narrow)]),
    ])
}

@MainActor
private let searchReplacePage = GalleryPage(name: "search-replace", settle: 0.4, prepare: {
    await SearchFixture.finish(searchControllers)
    for controller in searchControllers { controller.bar.replace.stringValue = "draw$1" }
}) {
    let replacing = SearchFixture.controller("render(\\w*)") { controller in
        controller.flip(.regex)
        controller.onApply = { _ in true }
        controller.bar.setDisclosed(true)
        controller.bar.include.stringValue = "*.swift, *.ts"
    }
    searchControllers = [replacing]
    return Gallery.page([
        Gallery.section("Replace, with capture groups", note: "Each row shows the removed text, then the added text. Replace All re-runs the query without the display cap and confirms with the true count.", [
            SearchFixture.card(replacing, size: SearchFixture.replaceSize),
        ]),
    ])
}

@MainActor
private let searchStatesPage = GalleryPage(name: "search-states", settle: 0.4, prepare: {
    await SearchFixture.finish(Array(searchControllers.dropFirst()), selecting: false)
    let searching = searchControllers[0]
    var progress = SearchProgress()
    progress.filesSearched = 1_204
    progress.filesTotal = 4_231
    searching.phase = .searching(progress)
    searching.render()
    let stopped = searchControllers[4]
    if case let .done(summary) = stopped.phase {
        var cut = summary
        cut.ending = .cancelled
        stopped.phase = .done(cut)
        stopped.render()
    }
    searchControllers[3].bar.field.stringValue = "render("
}) {
    let searching = SearchFixture.controller("")
    let idle = SearchFixture.controller("")
    let none = SearchFixture.controller("rasterize")
    let invalid = SearchFixture.controller("render") { $0.flip(.regex) }
    let stopped = SearchFixture.controller("render")
    let unreadable = SearchFixture.controller("renderAll")
    searchControllers = [searching, idle, none, invalid, stopped, unreadable]
    let size = SearchFixture.stateSize
    return Gallery.page([
        Gallery.section("States at 700 points", [
            Gallery.specimen("empty query: the keys", SearchFixture.card(idle, size: size)),
            Gallery.specimen("searching, with live counts", SearchFixture.card(searching, size: size)),
            Gallery.specimen("no results: what was searched, an unreadable file, and a way out", SearchFixture.card(none, size: size)),
            Gallery.specimen("an invalid pattern says why and keeps the last results", SearchFixture.card(invalid, size: size)),
            Gallery.specimen("stopped", SearchFixture.card(stopped, size: size)),
            Gallery.specimen("a file that could not be read, listed last", SearchFixture.card(unreadable, size: size)),
        ]),
    ])
}

@MainActor
private let searchPerformancePage = GalleryPage(name: "search-perf", settle: 0.2, prepare: {
    guard let controller = searchControllers.first, let report = perfReport else { return }
    _ = await Wait.until(.seconds(30)) { if case .done = controller.phase { true } else { false } }
    let window = NSWindow(contentRect: NSRect(origin: .zero, size: SearchFixture.perfSize), styleMask: [.borderless],
                          backing: .buffered, defer: false)
    window.alphaValue = 0
    window.contentView = controller.view
    window.orderBack(nil)
    controller.view.layoutSubtreeIfNeeded()
    let start = SearchFixture.cpu()
    controller.list.reload()
    window.displayIfNeeded()
    let reload = (SearchFixture.cpu() - start) * SearchFixture.millisecond
    let clip = controller.list.scrollView.contentView
    let rows = controller.rowKind.count
    let total = max(0, CGFloat(rows) * Metric.rowCompact - clip.bounds.height)
    var jumps: [Double] = []
    var steady: [Double] = []
    for step in 0..<SearchFixture.perfSteps {
        let begin = SearchFixture.cpu()
        clip.scroll(to: NSPoint(x: 0, y: min(CGFloat((step * SearchFixture.perfStride) % rows) * Metric.rowCompact, total)))
        controller.list.scrollView.reflectScrolledClipView(clip)
        window.displayIfNeeded()
        jumps.append((SearchFixture.cpu() - begin) * SearchFixture.millisecond)
    }
    for step in 0..<SearchFixture.perfSteps {
        let begin = SearchFixture.cpu()
        clip.scroll(to: NSPoint(x: 0, y: CGFloat(step) * Metric.rowCompact * 2))
        controller.list.scrollView.reflectScrolledClipView(clip)
        window.displayIfNeeded()
        steady.append((SearchFixture.cpu() - begin) * SearchFixture.millisecond)
    }
    window.orderOut(nil)
    let percentile = SearchFixture.percentile
    func summary(_ values: [Double]) -> String {
        let sorted = values.sorted()
        let mean = values.reduce(0, +) / Double(values.count)
        return String(format: "mean %.2f ms, p95 %.2f ms, max %.2f ms", mean,
                      sorted[Int(Double(sorted.count) * percentile)], sorted.last ?? 0)
    }
    let lines = [
        "\(controller.results.matchCount.formatted()) results in \(controller.results.fileCount) files, \(rows.formatted()) rows, 24pt, offscreen at 2x, main-thread CPU time",
        "results held: \(controller.results.byteCount / 1_000) KB in flat arrays",
        String(format: "reload and first display: %.2f ms", reload),
        "jumps across the whole list: " + summary(jumps),
        "steady scroll two rows a frame: " + summary(steady),
    ]
    lines.forEach { print("perf:", $0) }
    report.stringValue = lines.joined(separator: "\n")
}) {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-search-gallery-perf")
    try? FileManager.default.removeItem(at: root)
    try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let body = String(repeating: "    let value = render(node, at: index) // render\n", count: SearchFixture.perfLines)
    for file in 0..<SearchFixture.perfFiles {
        try? Data(body.utf8).write(to: root.appendingPathComponent("File\(file).swift"))
    }
    let controller = FindInFilesViewController(workspace: Workspace(root: root),
                                               engine: SearchEngine(root: root))
    controller.limits = SearchQuery.Limits(matchesPerFile: 1_000, matches: 100_000)
    controller.loadViewIfNeeded()
    searchControllers = [controller]
    let report = Label("measuring", style: .sm, color: Palette.contentSecondary)
    perfReport = report
    let holder = Gallery.sized(NSView(), width: SearchFixture.perfSize.width, height: Space.hair)
    holder.addSubview(controller.view)
    controller.bar.field.stringValue = "render"
    return Gallery.page([Gallery.section("Scrolling 100,000 results", [report])])
}

@MainActor
private let searchScopePage = GalleryPage(name: "search-scope", settle: 0.4, prepare: {
    await SearchFixture.finish(searchControllers)
}) {
    let grouped = SearchFixture.controller("render") { controller in
        controller.setGroupsByFolder(true)
    }
    let chipped = SearchFixture.controller("render") { controller in
        controller.scope = .folder("Sources/App")
        controller.updateScopes()
    }
    searchControllers = [grouped, chipped]
    return Gallery.page([
        Gallery.section("Folders as collapsible parents", note: "The grouping toggle beside the disclosure; a folder holding only one folder merges with it, as src/channels/ would.", [
            SearchFixture.card(grouped, size: SearchFixture.wide),
        ]),
        Gallery.section("A chosen folder as a removable chip", note: "Folder\u{2026} in the scope menu opens a chooser sheet on the window.", [
            SearchFixture.card(chipped, size: SearchFixture.wide),
        ]),
    ])
}

@MainActor
private var perfReport: Label?

@MainActor
let searchPages: [GalleryPage] = [searchResultsPage, searchReplacePage, searchScopePage, searchStatesPage, searchPerformancePage]
