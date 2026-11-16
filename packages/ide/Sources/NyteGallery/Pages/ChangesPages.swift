import AppKit
@testable import NyteChanges
import NyteCore
@testable import NyteUI

@MainActor
private enum ChangesFixtures {
    static let root = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-gallery-changes-\(getpid())", isDirectory: true)
    nonisolated static let fixtures = URL(fileURLWithPath: #filePath).resolvingSymlinksInPath().deletingLastPathComponent()
        .appendingPathComponent("../../../Fixtures").standardizedFileURL
    static let listHeight: CGFloat = 560
    static let stateHeight: CGFloat = 400
    static let diffHeight: CGFloat = 560
    static let diffWidth: CGFloat = 900
    static let reviewHeight: CGFloat = 620
    static let perfLines = 50_000
    static let perfHunks = 2_000
    static let perfSteps = 400
    static let perfStride = 997
    static let scrolled: CGFloat = 240
    static let splitWidth: CGFloat = 1_200
    static let millisecond: Double = 1_000
    static let percentile = 0.95
    static var controllers: [NSViewController] = []

    static let environment: [String: String] = {
        var environment = ProcessInfo.processInfo.environment
        environment["GIT_CONFIG_NOSYSTEM"] = "1"
        environment["GIT_CONFIG_GLOBAL"] = "/dev/null"
        for role in ["AUTHOR", "COMMITTER"] {
            environment["GIT_\(role)_NAME"] = "Gallery"
            environment["GIT_\(role)_EMAIL"] = "gallery@nyte.sh"
        }
        return environment
    }()

    static func git(_ arguments: [String], in folder: URL) {
        let process = Process()
        process.executableURL = GitRepository.systemGit
        process.arguments = arguments
        process.environment = environment
        process.currentDirectoryURL = folder
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try? process.run()
        process.waitUntilExit()
    }

    static func write(_ text: String, _ path: String, in folder: URL) {
        let url = folder.appendingPathComponent(path)
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? Data(text.utf8).write(to: url)
    }

    nonisolated static func fixture(_ path: String) -> String {
        (try? String(contentsOf: fixtures.appendingPathComponent(path), encoding: .utf8)) ?? ""
    }

    static func repository(_ name: String, _ build: (URL) -> Void = { _ in }) -> URL {
        let folder = root.appendingPathComponent(name, isDirectory: true)
        try? FileManager.default.removeItem(at: folder)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        git(["init", "-q", "-b", "main"], in: folder)
        build(folder)
        return folder
    }

    nonisolated static var goEdited: String {
        fixture("notifyhub-go/hub/hub.go")
            .replacingOccurrences(of: "// Submit sends a message through its channel and records how it went.",
                                  with: "// Submit sends a message through its channel, retrying once, and records how it went.")
            .replacingOccurrences(of: "\terr := channel.Send(ctx, message)\n", with: """
            \terr := channel.Send(ctx, message)
            \tif errors.Is(err, context.DeadlineExceeded) {
            \t\terr = channel.Send(ctx, message)
            \t}

            """)
            .replacingOccurrences(of: "func (h *Hub) record(name string, delivered bool) {", with: "func (h *Hub) record(channel string, delivered bool) {")
            .replacingOccurrences(of: "\th.stats.add(name, delivered)", with: "\th.stats.add(channel, delivered)")
    }

    nonisolated static var tsEdited: String {
        fixture("notifyhub-ts/src/hub.ts")
            .replacingOccurrences(of: "  async submit(message: Message, signal: AbortSignal): Promise<void> {",
                                  with: "  async submit(message: Message, signal: AbortSignal, attempts = 2): Promise<void> {")
            .replacingOccurrences(of: "      await channel.send(message, signal);\n", with: """
                  for (let attempt = 1; ; attempt++) {
                    try {
                      await channel.send(message, signal);
                      break;
                    } catch (error) {
                      if (attempt >= attempts || signal.aborted) throw error;
                    }
                  }

            """)
            .replacingOccurrences(of: "    return structuredClone(this.#stats);", with: "    return { ...this.#stats, channels: { ...this.#stats.channels } };")
    }

    static func populated() -> URL {
        repository("populated") { folder in
            for path in ["hub/hub.go", "hub/stats.go", "hub/email.go", "hub/webhook.go", "main.go"] {
                write(fixture("notifyhub-go/" + path), path, in: folder)
            }
            write("# notifyhub\n", "README.md", in: folder)
            git(["add", "-A"], in: folder)
            git(["commit", "-q", "-m", "start"], in: folder)
            write(goEdited, "hub/hub.go", in: folder)
            git(["add", "hub/hub.go"], in: folder)
            write(goEdited + "\n// Close stops the hub.\nfunc (h *Hub) Close() {}\n", "hub/hub.go", in: folder)
            git(["mv", "hub/webhook.go", "hub/hooks.go"], in: folder)
            write(fixture("notifyhub-go/hub/stats.go").replacingOccurrences(of: "func", with: "func "), "hub/stats.go", in: folder)
            try? FileManager.default.removeItem(at: folder.appendingPathComponent("hub/email.go"))
            write("package hub\n\n// Pager pages someone.\ntype Pager struct{ Number string }\n", "hub/pager.go", in: folder)
            write("# notifyhub\n\nRoutes notifications to channels.\n", "README.md", in: folder)
        }
    }

    static func list(_ folder: URL, width: CGFloat, height: CGFloat = listHeight, git: URL = GitRepository.systemGit) -> ChangesViewController {
        let controller = ChangesViewController(workspace: Workspace(root: folder), environment: environment, git: git)
        controllers.append(controller)
        controller.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            controller.view.widthAnchor.constraint(equalToConstant: width),
            controller.view.heightAnchor.constraint(equalToConstant: height),
        ])
        return controller
    }

    static func card(_ view: NSView, width: CGFloat, height: CGFloat) -> NSView {
        let card = PaneCard()
        card.translatesAutoresizingMaskIntoConstraints = false
        card.embed(view)
        NSLayoutConstraint.activate([card.widthAnchor.constraint(equalToConstant: width), card.heightAnchor.constraint(equalToConstant: height)])
        return card
    }

    static func diff(_ source: DiffSource, width: CGFloat = diffWidth, height: CGFloat = diffHeight, split: Bool = false) -> NSView {
        let controller = DiffViewController(source: source)
        controllers.append(controller)
        controller.isSideBySide = split
        return card(controller.view, width: width, height: height)
    }

    static func comment(_ canvas: DiffCanvas, newLine: Int? = nil, hunk: Int? = nil, words: String, open: Bool = false) {
        if let hunk {
            canvas.move(to: Int(canvas.rows.headers[hunk]), extending: false)
        } else if let newLine, let row = canvas.rows.kinds.indices.first(where: { canvas.rows.new[$0] == Int32(newLine) && canvas.rows.kinds[$0] != .removed }) {
            canvas.move(to: row, extending: false)
        }
        canvas.openComposer()
        canvas.composer?.field.string = words
        if !open { canvas.commitComposer() }
    }

    static func waitForAll() async {
        _ = await Wait.until(.seconds(30)) {
            controllers.allSatisfy { controller in
                if let list = controller as? ChangesViewController {
                    if case .locating = list.phase { return false }
                    if case .ready(_, nil) = list.phase { return false }
                    return true
                }
                if let diff = controller as? DiffViewController { return diff.document != nil }
                if let review = controller as? ReviewViewController { return review.diffs[review.shown]?.document != nil }
                return true
            }
        }
    }

    static func pane(_ document: DiffDocument, actions: HunkActions = .none, width: CGFloat = diffWidth / 2 - Space.x2,
                     height: CGFloat) -> NSView {
        let pane = DiffPane()
        pane.onOpenFile = {}
        pane.show(document, actions: actions)
        return card(pane, width: width, height: height)
    }

    static func document(_ path: String, before: String?, after: String?) -> DiffDocument {
        var document = DiffDocument(path: path, oldTitle: "HEAD", newTitle: "Working Tree")
        document.oldExists = before != nil
        document.newExists = after != nil
        return document.comparing(Data((before ?? "").utf8), Data((after ?? "").utf8))
    }
}

private let changesListPage = GalleryPage(name: "changes-list", settle: 0.4, prepare: {
    await ChangesFixtures.waitForAll()
}) {
    ChangesFixtures.controllers = []
    let folder = ChangesFixtures.populated()
    let narrow = ChangesFixtures.list(folder, width: Metric.sidebarWidth)
    let wide = ChangesFixtures.list(folder, width: Metric.sidebarWidth + Space.x8 * 2)
    let clean = ChangesFixtures.repository("clean") { folder in
        ChangesFixtures.write("hi\n", "a.txt", in: folder)
        ChangesFixtures.git(["add", "-A"], in: folder)
        ChangesFixtures.git(["commit", "-q", "-m", "start"], in: folder)
    }
    let plain = ChangesFixtures.root.appendingPathComponent("plain")
    try? FileManager.default.createDirectory(at: plain, withIntermediateDirectories: true)
    let height = ChangesFixtures.stateHeight
    let states: [(String, ChangesViewController)] = [
        ("clean", ChangesFixtures.list(clean, width: Metric.sidebarWidth, height: height)),
        ("not a repository", ChangesFixtures.list(plain, width: Metric.sidebarWidth, height: height)),
        ("git missing", ChangesFixtures.list(plain, width: Metric.sidebarWidth, height: height, git: URL(fileURLWithPath: "/nonexistent/git"))),
    ]
    let loading = ChangesFixtures.list(plain, width: Metric.sidebarWidth, height: height)
    loading.phase = .locating
    let failed = ChangesFixtures.list(plain, width: Metric.sidebarWidth, height: height)
    Task { @MainActor in
        await ChangesFixtures.waitForAll()
        loading.apply(.locating)
        failed.apply(.failed(nil, GitFailure(.exited(128), command: "git status",
                                             message: "fatal: index file smaller than expected")))
        narrow.list.selectedRow = 2
        wide.list.selectedRows = IndexSet([4, 5])
        narrow.showNotice(Banner("Couldn’t stage", detail: "error: hub/pager.go: does not exist and --remove not passed",
                                 tone: .danger, onDismiss: {}))
    }
    return Gallery.page([
        Gallery.section("Changes at the sidebar's width", note: "Staged and Changes, a partly staged file in both, rename, deletion, untracked",
                        [Gallery.row([Gallery.specimen("256 pt, one row selected, an operation failed", narrow.view),
                                      Gallery.specimen("320 pt, two rows selected", wide.view)], alignment: .top)]),
        Gallery.section("States", [
            Gallery.row(states.map { Gallery.specimen($0.0, $0.1.view) }, spacing: Space.x4, alignment: .top),
            Gallery.row([Gallery.specimen("loading", loading.view), Gallery.specimen("failed with git's message", failed.view)],
                        spacing: Space.x4, alignment: .top),
        ]),
    ])
}

private let commitBoxPage = GalleryPage(name: "changes-commit") {
    @MainActor func box(_ message: String, ready: CommitReadiness, busy: Bool = false, failure: GitFailure? = nil, amend: Bool = false) -> NSView {
        let box = CommitBox()
        box.field.string = message
        box.amend.state = amend ? .on : .off
        box.update(readiness: ready, message: message, busy: busy)
        box.showFailure(failure)
        return Gallery.wide(box, width: Metric.sidebarWidth)
    }
    let long = "Retry deliveries that time out once before counting them as failed"
    return Gallery.page([Gallery.section("Commit box", note: "At 256 pt, under the list", [Gallery.row([
        Gallery.specimen("empty, nothing staged", box("", ready: .blocked("Stage changes to commit"))),
        Gallery.specimen("filled", box("Retry timed-out deliveries once\n\nA deadline is the only error worth a second try.", ready: .ready)),
        Gallery.specimen("first line past 72", box(long + " in every channel", ready: .ready)),
        Gallery.specimen("amending, committing", box("Retry timed-out deliveries once", ready: .blocked("Committing…"), busy: true, amend: true)),
    ], spacing: Space.x4, alignment: .top), Gallery.row([
        Gallery.specimen("failing: a hook's stderr", box("Retry timed-out deliveries once", ready: .ready, failure: GitFailure(
            .exited(1), command: "git commit", message: "husky > pre-commit (node v26)\n✖ eslint found 3 problems in src/hub.ts"))),
        Gallery.specimen("conflicts block it", box("Merge main", ready: .blocked("Resolve conflicts first"))),
    ], spacing: Space.x4, alignment: .top)])])
}

private func diffPage(_ name: String, path: String, before: String, after: String) -> GalleryPage {
    GalleryPage(name: name, settle: 0.4, prepare: { await ChangesFixtures.waitForAll() }) {
        ChangesFixtures.controllers = []
        let source = DiffSource.texts(path: path, before: DiffText(title: "HEAD", text: before), after: DiffText(title: "Working Tree", text: after))
        return Gallery.page([
            Gallery.section("Unified", note: "Syntax colour, both line numbers, changed words, folded unchanged runs, function in each hunk header",
                            [ChangesFixtures.diff(source)]),
            Gallery.section("Side by side", [ChangesFixtures.diff(source, split: true)]),
        ])
    }
}

private let diffGoPage = diffPage("changes-diff-go", path: "hub/hub.go", before: ChangesFixtures.fixture("notifyhub-go/hub/hub.go"),
                                  after: ChangesFixtures.goEdited)
private let diffTypeScriptPage = diffPage("changes-diff-ts", path: "src/hub.ts", before: ChangesFixtures.fixture("notifyhub-ts/src/hub.ts"),
                                          after: ChangesFixtures.tsEdited)

private let diffStatesPage = GalleryPage(name: "changes-diff-states") {
    let height: CGFloat = 240
    let go = ChangesFixtures.fixture("notifyhub-go/hub/stats.go")
    var renamed = ChangesFixtures.document("hub/counts.go", before: go, after: go)
    renamed.originalPath = "hub/stats.go"
    var renamedEdited = ChangesFixtures.document("hub/counts.go", before: go, after: go.replacingOccurrences(of: "Stats", with: "Counts"))
    renamedEdited.originalPath = "hub/stats.go"
    var mode = DiffDocument(path: "scripts/release.sh", oldTitle: "HEAD", newTitle: "Working Tree")
    mode.oldMode = 0o100644
    mode.newMode = 0o100755
    mode = mode.comparing(Data("#!/bin/sh\n".utf8), Data("#!/bin/sh\n".utf8))
    var conflict = ChangesFixtures.document("hub/hub.go", before: "package hub\n\nconst retries = 1\n",
                                            after: "package hub\n\n<<<<<<< HEAD\nconst retries = 1\n=======\nconst retries = 3\n>>>>>>> retry\n")
    conflict.conflict = .bothModified
    var binary = DiffDocument(path: "assets/logo.png", oldTitle: "HEAD", newTitle: "Working Tree")
    binary = binary.comparing(Data([0x89, 0x50, 0x4E, 0x47, 0, 0, 0, 0] + [UInt8](repeating: 7, count: 12_000)),
                              Data([0x89, 0x50, 0x4E, 0x47, 0, 0, 0, 0] + [UInt8](repeating: 9, count: 14_500)))
    var large = DiffDocument(path: "data/fixtures.json", oldTitle: "HEAD", newTitle: "Working Tree")
    large.shape = .tooLarge(old: 31 << 20, new: 33 << 20)
    var unsaved = ChangesFixtures.document("hub/pager.go", before: "package hub\n\ntype Pager struct{}\n",
                                           after: "package hub\n\n// Pager pages someone.\ntype Pager struct{}\n")
    unsaved.unsaved = true
    var gone = DiffDocument(path: "vendor/lib", oldTitle: "HEAD", newTitle: "Working Tree")
    gone.shape = .unavailable("This is a submodule. Open it as its own repository to review its changes.")
    let specimens: [(String, DiffDocument)] = [
        ("new file", ChangesFixtures.document("hub/pager.go", before: nil, after: "package hub\n\n// Pager pages someone.\ntype Pager struct {\n\tNumber string\n}\n")),
        ("deleted file", ChangesFixtures.document("hub/email.go", before: ChangesFixtures.fixture("notifyhub-go/hub/webhook.go"), after: nil)),
        ("rename without edits", renamed),
        ("rename with edits", renamedEdited),
        ("mode change only", mode),
        ("conflict", conflict),
        ("binary", binary),
        ("too large", large),
        ("submodule", gone),
        ("open in the editor with unsaved edits", unsaved),
    ]
    let cells = specimens.map { Gallery.specimen($0.0, ChangesFixtures.pane($0.1, actions: $0.1.unsaved ? .none
            : HunkActions(primary: .stage, destructive: .discard), height: height)) }
    let rows = stride(from: 0, to: cells.count, by: 2).map { Gallery.row(Array(cells[$0..<min(cells.count, $0 + 2)]), spacing: Space.x4,
                                                                         alignment: .top) }
    return Gallery.page([Gallery.section("Special states", note: "Each file kind the diff can meet", rows)])
}

private func reviewPage(_ width: CGFloat) -> GalleryPage {
    GalleryPage(name: "changes-review-\(Int(width))", settle: 0.4, prepare: { await ChangesFixtures.waitForAll() }) {
        ChangesFixtures.controllers = []
        let root = ChangesFixtures.root.appendingPathComponent("review")
        let set = AgentChangeSet(session: "s", scope: .run(turn: "t"), title: "Retry timed-out deliveries", root: root, files: [
            .init(path: "hub/hub.go", status: .modified, content: .texts(before: ChangesFixtures.fixture("notifyhub-go/hub/hub.go"),
                                                                         after: ChangesFixtures.goEdited), added: 5, removed: 3),
            .init(path: "src/hub.ts", status: .modified, content: .texts(before: ChangesFixtures.fixture("notifyhub-ts/src/hub.ts"),
                                                                         after: ChangesFixtures.tsEdited), added: 9, removed: 2),
            .init(path: "hub/pager.go", status: .added, content: .texts(before: "", after: "package hub\n\ntype Pager struct{}\n"),
                  added: 3, removed: 0),
            .init(path: "hub/email.go", status: .deleted, content: .texts(before: ChangesFixtures.fixture("notifyhub-go/hub/email.go"),
                                                                          after: ""), added: 0, removed: 41),
        ])
        let review = ReviewViewController(changes: set)
        review.onRevert = { _ in }
        review.onFocusReview = {}
        ChangesFixtures.controllers.append(review)
        Task { @MainActor in
            await ChangesFixtures.waitForAll()
            review.diffs[0]?.pane.canvas.showHunk(at: Int(review.diffs[0]?.pane.canvas.rows.headers.dropFirst().first ?? 0))
            review.diffs[0]?.pane.canvas.hovered = -1
            review.onSendComments = { _ in }
            if let canvas = review.diffs[0]?.pane.canvas {
                ChangesFixtures.comment(canvas, newLine: 59, words: "Retry only on a deadline, never on a refused connection.")
                ChangesFixtures.comment(canvas, hunk: 2, words: "")
            }
            review.diffs[0]?.pane.canvas.showHunk(at: Int(review.diffs[0]?.pane.canvas.rows.headers.dropFirst().first ?? 0))
        }
        return Gallery.page([Gallery.section("Review of an agent run at \(Int(width)) pt", note: "J and K walk every change across files",
                                             [ChangesFixtures.card(review.view, width: width, height: ChangesFixtures.reviewHeight)])])
    }
}

private let changesPerformancePage = GalleryPage(name: "changes-perf") {
    var random = SystemRandomNumberGenerator()
    let lines = (0..<ChangesFixtures.perfLines).map { "\tvalue\($0) := compute(ctx, \($0 % 977), \"text \($0 * 7)\") // note\n" }
    var edited = lines
    let spacing = ChangesFixtures.perfLines / ChangesFixtures.perfHunks
    for hunk in 0..<ChangesFixtures.perfHunks {
        let at = hunk * spacing + Int.random(in: 0..<spacing / 2, using: &random)
        edited[at] = edited[at].replacingOccurrences(of: "compute", with: "measure")
    }
    let source = DiffSource.texts(path: "big/table.go", before: DiffText(title: "HEAD", text: lines.joined()),
                                  after: DiffText(title: "Working Tree", text: edited.joined()))
    let loadStart = CACurrentMediaTime()
    let document = DiffDocument.comparingSync(source)
    let load = (CACurrentMediaTime() - loadStart) * ChangesFixtures.millisecond
    let size = NSSize(width: ChangesFixtures.diffWidth, height: ChangesFixtures.diffHeight)
    let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
    window.alphaValue = 0
    let pane = DiffPane()
    pane.translatesAutoresizingMaskIntoConstraints = true
    pane.frame = NSRect(origin: .zero, size: size)
    window.contentView = pane
    window.orderBack(nil)
    let start = CACurrentMediaTime()
    pane.show(document, actions: HunkActions(primary: .stage, destructive: .discard))
    pane.layoutSubtreeIfNeeded()
    window.displayIfNeeded()
    let first = (CACurrentMediaTime() - start) * ChangesFixtures.millisecond
    let clip = pane.scroll.contentView
    let rows = pane.canvas.rows
    guard let bitmap = pane.canvas.bitmapImageRepForCachingDisplay(in: NSRect(origin: .zero, size: size)) else { return NSView() }
    @MainActor func run(_ offsets: [CGFloat]) -> [Double] {
        offsets.map { y in
            let begin = CACurrentMediaTime()
            clip.scroll(to: NSPoint(x: 0, y: min(y, rows.height - clip.bounds.height)))
            pane.scroll.reflectScrolledClipView(clip)
            pane.canvas.cacheDisplay(in: pane.canvas.visibleRect, to: bitmap)
            return (CACurrentMediaTime() - begin) * ChangesFixtures.millisecond
        }
    }
    let jumps = run((0..<ChangesFixtures.perfSteps).map { CGFloat(($0 * ChangesFixtures.perfStride) % rows.count) * DiffCanvas.lineHeight })
    let steady = run((0..<ChangesFixtures.perfSteps).map { CGFloat($0) * DiffCanvas.lineHeight * 2 })
    let expandStart = CACurrentMediaTime()
    pane.canvas.expandAll()
    window.displayIfNeeded()
    let expand = (CACurrentMediaTime() - expandStart) * ChangesFixtures.millisecond
    let expanded = run((0..<ChangesFixtures.perfSteps).map { CGFloat(($0 * ChangesFixtures.perfStride) % pane.canvas.rows.count) * DiffCanvas.lineHeight })
    pane.setMode(.split)
    window.displayIfNeeded()
    let split = run((0..<ChangesFixtures.perfSteps).map { CGFloat($0) * DiffCanvas.lineHeight * 2 })
    window.orderOut(nil)
    @MainActor func summary(_ values: [Double]) -> String {
        let sorted = values.sorted()
        return String(format: "mean %.2f ms, p95 %.2f ms, max %.2f ms", values.reduce(0, +) / Double(values.count),
                      sorted[Int(Double(sorted.count) * ChangesFixtures.percentile)], sorted.last ?? 0)
    }
    let report = [
        "\(ChangesFixtures.perfLines.formatted()) lines, \(document.diff.hunks.count.formatted()) hunks, \(rows.count.formatted()) rows folded, \(ChangesFixtures.perfSteps) frames each, each frame runs draw(_:) over the whole visible rect into a 2x bitmap",
        String(format: "diff, line table and lexer states off the main actor: %.1f ms", load),
        String(format: "rows and first display: %.2f ms", first),
        "jumps across the file: " + summary(jumps),
        "steady scroll two lines a frame: " + summary(steady),
        String(format: "expand every fold (%@ rows): %.2f ms", pane.canvas.rows.count.formatted(), expand),
        "jumps across the expanded file: " + summary(expanded),
        "side by side, steady scroll: " + summary(split),
    ]
    report.forEach { print("perf:", $0) }
    return Gallery.page([Gallery.section("Diff of a 50,000-line file with 2,000 hunks", [
        Label(report.joined(separator: "\n"), style: .sm, color: Palette.contentSecondary),
    ])])
}

extension DiffDocument {
    static func comparingSync(_ source: DiffSource) -> DiffDocument {
        guard case let .texts(path, before, after) = source else { return DiffDocument(path: "", oldTitle: "", newTitle: "") }
        let document = DiffDocument(path: path, oldTitle: before.title, newTitle: after.title)
        return document.comparing(Data((before.text ?? "").utf8), Data((after.text ?? "").utf8))
    }
}

private let commentsPage = GalleryPage(name: "changes-comments", settle: 0.4, prepare: { await ChangesFixtures.waitForAll() }) {
    ChangesFixtures.controllers = []
    let source = DiffSource.texts(path: "hub/hub.go", before: DiffText(title: "HEAD", text: ChangesFixtures.fixture("notifyhub-go/hub/hub.go")),
                                  after: DiffText(title: "Working Tree", text: ChangesFixtures.goEdited))
    let unified = ChangesFixtures.diff(source)
    let split = ChangesFixtures.diff(source, split: true)
    let views = ChangesFixtures.controllers.compactMap { $0 as? DiffViewController }
    Task { @MainActor in
        await ChangesFixtures.waitForAll()
        for (index, diff) in views.enumerated() {
            diff.onSendComments = { _ in }
            let canvas = diff.pane.canvas
            ChangesFixtures.comment(canvas, newLine: 47, words: "Say what “went” means: delivered, or counted as failed?")
            ChangesFixtures.comment(canvas, hunk: 1, words: "")
            ChangesFixtures.comment(canvas, newLine: 62, words: index == 0 ? "Keep name; channel reads like the Channel type" : "", open: true)
            canvas.showHunk(at: Int(canvas.rows.headers[1]))
        }
    }
    return Gallery.page([
        Gallery.section("Comments to the agent", note: "A comment on a line, a hunk pointed at without words, the field open on a third line",
                        [unified]),
        Gallery.section("Side by side", [split]),
    ])
}

private let wideLinesPage = GalleryPage(name: "changes-wide", settle: 0.4, prepare: { await ChangesFixtures.waitForAll() }) {
    ChangesFixtures.controllers = []
    let before = ChangesFixtures.fixture("notifyhub-ts/src/hub.ts")
    let after = before.replacingOccurrences(of: "    super(`unknown channel: \"${channel}\"`);",
                                            with: "    super(`unknown channel: \"${channel}\"; register it with hub.register(channel) before submitting messages to it, or check the spelling of message.channel`);")
    let source = DiffSource.texts(path: "src/hub.ts", before: DiffText(title: "HEAD", text: before), after: DiffText(title: "Working Tree", text: after))
    let split = ChangesFixtures.diff(source, height: ChangesFixtures.stateHeight, split: true)
    let unified = ChangesFixtures.diff(source, height: ChangesFixtures.stateHeight)
    let views = ChangesFixtures.controllers.compactMap { $0 as? DiffViewController }
    Task { @MainActor in
        await ChangesFixtures.waitForAll()
        for diff in views {
            let clip = diff.pane.scroll.contentView
            clip.scroll(to: NSPoint(x: ChangesFixtures.scrolled, y: 0))
            diff.pane.scroll.reflectScrolledClipView(clip)
        }
    }
    return Gallery.page([Gallery.section("Long lines scroll, never wrap", note: "Both scrolled 240 pt right: the gutters stay, both sides move together",
                                         [split, unified])])
}

private let splitPage = GalleryPage(name: "changes-split", settle: 0.4, prepare: { await ChangesFixtures.waitForAll() }) {
    ChangesFixtures.controllers = []
    let before = ChangesFixtures.fixture("notifyhub-go/hub/hub.go")
    let after = ChangesFixtures.goEdited.replacingOccurrences(of: "\th.stats.track(channel.Name())\n", with: "")
    let source = DiffSource.texts(path: "hub/hub.go", before: DiffText(title: "HEAD", text: before),
                                  after: DiffText(title: "Working Tree", text: after))
    let narrow = ChangesFixtures.diff(source, width: ChangesFixtures.diffWidth, split: true)
    let wide = ChangesFixtures.diff(source, width: ChangesFixtures.splitWidth, split: true)
    return Gallery.page([
        Gallery.section("Side by side at 900 pt", note: "Each half would hold under 60 columns, so it stays unified and says why",
                        [narrow]),
        Gallery.section("Side by side at 1,200 pt", note: "A removed line, a replaced comment and a renamed parameter with their changed words",
                        [wide]),
    ])
}

private let patchReviewPage = GalleryPage(name: "changes-review-patch", settle: 0.4, prepare: { await ChangesFixtures.waitForAll() }) {
    ChangesFixtures.controllers = []
    let root = ChangesFixtures.root.appendingPathComponent("patch")
    let patch = """
    diff --git a/hub/hub.go b/hub/hub.go
    --- a/hub/hub.go
    +++ b/hub/hub.go
    @@ -55,7 +55,10 @@ func (h *Hub) Submit(ctx context.Context, message Message) error {
     \t\treturn fmt.Errorf("%w: %q", ErrUnknownChannel, message.Channel)
     \t}
     
    -\terr := channel.Send(ctx, message)
    +\terr := channel.Send(ctx, message)
    +\tif errors.Is(err, context.DeadlineExceeded) {
    +\t\terr = channel.Send(ctx, message)
    +\t}
     \th.record(channel.Name(), err == nil)
     \treturn err
     }
    @@ -70,3 +73,3 @@ func (h *Hub) Stats() Stats {
     \tdefer h.mu.Unlock()
    -\treturn h.stats.clone()
    +\treturn h.stats.copy()
     }
    """
    let set = AgentChangeSet(session: "s", scope: .step(part: "p"), title: "Edited hub.go", root: root, files: [
        .init(path: "hub/hub.go", status: .modified, content: .patches([patch]), added: 5, removed: 2),
    ])
    let review = ReviewViewController(changes: set)
    review.onRevert = { _ in }
    review.onFocusReview = {}
    ChangesFixtures.controllers.append(review)
    return Gallery.page([Gallery.section("A step that arrived as a patch only", note: "Shown hunk by hunk with the patch's own line numbers; nothing outside it is guessed",
                                         [ChangesFixtures.card(review.view, width: ChangesFixtures.diffWidth, height: ChangesFixtures.diffHeight)])])
}

let changesPages: [GalleryPage] = [
    changesListPage, commitBoxPage, commentsPage, wideLinesPage, splitPage, patchReviewPage, diffGoPage, diffTypeScriptPage, diffStatesPage, reviewPage(900), reviewPage(1_300),
    changesPerformancePage,
]
