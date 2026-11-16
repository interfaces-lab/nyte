import AppKit
import NyteCore
import NyteEditor
@testable import NyteDebug
import NyteUI

@MainActor
let debugPages: [GalleryPage] = [
    debugGoPausedPage, debugGoChangedPage, debugConsolePage, debugTypeScriptPage, debugEmptyPage, debugFailurePage,
    debugStartingPage, debugConsoleLoadPage, debugLongArrayPage, debugBreakpointsPage, debugReplPage, debugGoroutinesPage,
    debugManyLocalsPage, debugEditorStopPage,
]

@MainActor
private enum Specimen {
    static let paneWidth: CGFloat = 1000
    static let paneHeight: CGFloat = 300
    static let goLine = 49
    static let typeScriptLine = 38
    static let patience: Duration = .seconds(60)
    static let fixtures = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../../../Fixtures").standardizedFileURL
    static let go = fixtures.appendingPathComponent("notifyhub-go")
    static let typeScript = fixtures.appendingPathComponent("notifyhub-ts")
    static let broken = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-gallery-broken")
    static let slow = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-gallery-slow")
    static let workers = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-gallery-workers")
    static let many = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-gallery-many")
    static let array = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-gallery-array")
    static let arrayLine = 9
    static let arrayLength = 300
    static let arrayProgram = """
    package main

    import "fmt"

    func main() {
    \tvalues := make([]int, \(arrayLength))
    \tfor i := range values {
    \t\tvalues[i] = i * 2
    \t}
    \tfmt.Println(len(values))
    }

    """

    static let slowFunctions = 4_000
    static let slowLocals = 60

    static func slowProgram() -> String {
        var text = "package main\n\nimport \"fmt\"\n\nconst stamp = \(Int(Date().timeIntervalSince1970))\n\n"
        for function in 0..<slowFunctions {
            text += "func f\(function)(x int) int {\n"
            for local in 0..<slowLocals {
                text += "\tv\(local) := x + \(local * function)\n\tif v\(local)%7 == 3 {\n\t\tx += v\(local)\n\t}\n"
            }
            text += "\treturn x\n}\n\n"
        }
        text += "func main() {\n\tt := stamp\n"
        for function in 0..<slowFunctions { text += "\tt = f\(function)(t)\n" }
        return text + "\tfmt.Println(t)\n}\n"
    }

    static let manyLocals = 10_000
    static let workersLine = 20
    static let workersProgram = """
    package main

    import (
    \t"fmt"
    \t"os"
    \t"sync"
    \t"time"
    )

    func main() {
    \tname := "world"
    \tif len(os.Args) > 1 {
    \t\tname = os.Args[1]
    \t}
    \tjobs := make(chan int)
    \tvar wg sync.WaitGroup
    \twg.Add(1)
    \tgo worker(jobs, &wg)
    \ttime.Sleep(100 * time.Millisecond)
    \tpending := []string{"email", "webhook", "pager"}
    \tfmt.Println("hello", name, len(pending))
    \tjobs <- 1
    \tclose(jobs)
    \twg.Wait()
    }

    func worker(jobs chan int, wg *sync.WaitGroup) {
    \tdefer wg.Done()
    \tfor job := range jobs {
    \t\tfmt.Println("job", job)
    \t}
    }

    """

    static var key = ""
    static var debugger: Debugger?
    static var controller: DebugViewController?

    static func card(_ key: String, root: URL) -> NSView {
        let debugger = debugger(key, root: root)
        let controller = DebugViewController(debugger: debugger)
        debugger.onChange = { [weak controller] in controller?.debuggerDidChange($0) }
        controller.onAskAgent = { context in print("gallery: asked the agent about \(context)") }
        self.controller = controller
        let card = PaneCard()
        card.embed(controller.view)
        return Gallery.sized(card, width: paneWidth, height: paneHeight)
    }

    static func debugger(_ key: String, root: URL) -> Debugger {
        if key == self.key, let debugger { return debugger }
        self.key = key
        let workspace = Workspace(root: root)
        let made = Debugger(workspace: workspace, toolchain: Toolchain(workspace: root))
        made.removeAllBreakpoints()
        debugger = made
        return made
    }

    static func target(_ debugger: Debugger, near file: URL, where matches: (DebugTarget) -> Bool) async -> DebugTarget? {
        await debugger.targets(near: file).first(where: matches)
    }

    static func goTarget(_ debugger: Debugger) async -> DebugTarget? {
        await target(debugger, near: go.appendingPathComponent("main.go")) { target in
            if case let .goPackage(folder) = target.kind { folder.standardizedFileURL.path == go.path } else { false }
        }
    }

    static func typeScriptTarget(_ debugger: Debugger) async -> DebugTarget? {
        await target(debugger, near: typeScript.appendingPathComponent("src/index.ts")) { target in
            if case let .node(file) = target.kind { file.lastPathComponent == "index.ts" } else { false }
        }
    }

    @discardableResult
    static func wait(_ debugger: Debugger, _ done: @escaping (Debugger.State) -> Bool) async -> Bool {
        guard await Wait.until(patience, { done(debugger.state) }) else {
            print("gallery: gave up waiting, state \(debugger.state)")
            return false
        }
        return true
    }

    static func isPaused(_ state: Debugger.State) -> Bool { if case .paused = state { true } else { false } }
    static func isEnded(_ state: Debugger.State) -> Bool { if case .ended = state { true } else { false } }
    static func isFailed(_ state: Debugger.State) -> Bool { if case .failed = state { true } else { false } }
    static func isStarting(_ state: Debugger.State) -> Bool { if case .starting = state { true } else { false } }

    static func pausedAtFirstStop(_ debugger: Debugger, target: DebugTarget?, file: URL, line: Int) async {
        guard debugger.state == .idle, let target else { return }
        debugger.setBreakpoint(line: line, in: file)
        await debugger.start(target, debugging: true)
        await wait(debugger, isPaused)
    }

    static func teardown() async {
        guard let debugger else { return }
        await wait(debugger) { !isStarting($0) }
        await debugger.stop()
        debugger.removeAllBreakpoints()
        debugger.onChange = nil
        self.debugger = nil
        controller = nil
        key = ""
        for folder in [broken, array, slow, workers, many] { try? FileManager.default.removeItem(at: folder) }
    }
}

@MainActor
private func debugPage(_ title: String, note: String, key: String, root: URL) -> NSView {
    Gallery.page([Gallery.section(title, note: note, [Specimen.card(key, root: root)])])
}

@MainActor
let debugGoPausedPage = GalleryPage(name: "debug-go-paused", settle: Motion.slow, prepare: {
    guard let debugger = Specimen.debugger else { return }
    await Specimen.pausedAtFirstStop(debugger, target: await Specimen.goTarget(debugger),
                                     file: Specimen.go.appendingPathComponent("hub/hub.go"), line: Specimen.goLine)
    await Specimen.controller?.reveal(["message"])
    Specimen.controller?.variables.field.stringValue = "len(h.channels)"
    await Specimen.controller?.variables.evaluate("len(h.channels)")
}, teardown: { await Specimen.teardown() }) {
    debugPage("Go, first stop", note: "Hosted in the dock, whose tab says Debug. Paused on the first statement of Submit, message open, an expression evaluated.",
              key: "go-paused", root: Specimen.go)
}

@MainActor
let debugGoChangedPage = GalleryPage(name: "debug-go-changed", settle: Motion.slow, prepare: {
    guard let debugger = Specimen.debugger, let controller = Specimen.controller else { return }
    if debugger.state == .idle {
        await Specimen.pausedAtFirstStop(debugger, target: await Specimen.goTarget(debugger),
                                         file: Specimen.go.appendingPathComponent("hub/hub.go"), line: Specimen.goLine)
        await controller.addWatch("message.Subject")
        await controller.addWatch("missing")
        await controller.reveal(["message"])
        await debugger.resume()
        await Specimen.wait(debugger, { if case let .paused(_, _, frame) = $0 { frame?.line == Specimen.goLine } else { false } })
        await controller.reveal([])
        let survived = controller.variables.tree.rows.contains { $0.name == "message" && $0.isOpen }
        print("gallery: message stays open across the resume: \(survived)")
    } else {
        await controller.reveal([])
        await controller.addWatch("message.Subject")
        await controller.addWatch("missing")
    }
    await controller.reveal(["message", "Channel"])
}, teardown: { await Specimen.teardown() }) {
    debugPage("Go, second stop", note: "Values that changed since the last stop take the accent ink and a dot; names stay primary, types secondary.",
              key: "go-changed", root: Specimen.go)
}

@MainActor
let debugConsolePage = GalleryPage(name: "debug-console", settle: Motion.slow, prepare: {
    guard let debugger = Specimen.debugger, debugger.state == .idle, let target = await Specimen.goTarget(debugger) else { return }
    await debugger.start(target, debugging: true)
    await Specimen.wait(debugger, Specimen.isEnded)
}, teardown: { await Specimen.teardown() }) {
    debugPage("Console", note: "After the program finished: stderr carries a bar as well as its ink, the debugger's own lines are dimmed.",
              key: "console", root: Specimen.go)
}

@MainActor
let debugTypeScriptPage = GalleryPage(name: "debug-ts-paused", settle: Motion.slow, prepare: {
    guard let debugger = Specimen.debugger else { return }
    await Specimen.pausedAtFirstStop(debugger, target: await Specimen.typeScriptTarget(debugger),
                                     file: Specimen.typeScript.appendingPathComponent("src/hub.ts"), line: Specimen.typeScriptLine)
    await Specimen.controller?.reveal(["message"])
    guard let pane = Specimen.controller?.variables else { return }
    let expression = #"JSON.stringify({ ...message, note: "The deploy pipeline finished every stage and the release is live in all regions." })"#
    pane.field.stringValue = expression
    await pane.evaluate(expression)
    pane.toggleFullValue(0)
    pane.list.selectedRow = 0
}, teardown: { await Specimen.teardown() }) {
    debugPage("TypeScript, first stop", note: "Paused in submit, message open. Return on the long result shows its full value.",
              key: "ts-paused", root: Specimen.typeScript)
}

@MainActor
let debugEmptyPage = GalleryPage(name: "debug-empty", teardown: { await Specimen.teardown() }) {
    debugPage("Before anything runs", note: "How to start, with the keys.", key: "empty", root: Specimen.go)
}

@MainActor
let debugFailurePage = GalleryPage(name: "debug-failure", settle: Motion.slow, prepare: {
    guard let debugger = Specimen.debugger, debugger.state == .idle else { return }
    let target = DebugTarget(id: "broken", name: "notifyhub", kind: .goPackage(Specimen.broken), directory: Specimen.broken)
    await debugger.start(target, debugging: true)
    await Specimen.wait(debugger, Specimen.isFailed)
}, teardown: { await Specimen.teardown() }) {
    try? FileManager.default.removeItem(at: Specimen.broken)
    try? FileManager.default.copyItem(at: Specimen.go, to: Specimen.broken)
    let main = Specimen.broken.appendingPathComponent("main.go")
    if let source = try? String(contentsOf: main, encoding: .utf8) {
        try? source.replacingOccurrences(of: "h := hub.New()", with: "h := hub.New(").write(to: main, atomically: true, encoding: .utf8)
    }
    return debugPage("Build failure", note: "The Console leads with the first error, linked to main.go line 18; Ask Nyte to Fix sits beside Restart.",
                     key: "failure",
                     root: Specimen.broken)
}

@MainActor
let debugStartingPage = GalleryPage(name: "debug-starting", prepare: {
    guard let debugger = Specimen.debugger else { return }
    if debugger.state == .idle {
        let target = DebugTarget(id: "slow", name: "slow", kind: .goPackage(Specimen.slow), directory: Specimen.slow)
        Task { await debugger.start(target, debugging: true) }
    }
    await Specimen.wait(debugger, Specimen.isStarting)
    print("gallery: starting page captures \(debugger.state)")
}, teardown: { await Specimen.teardown() }) {
    if !FileManager.default.fileExists(atPath: Specimen.slow.appendingPathComponent("main.go").path) {
        try? FileManager.default.createDirectory(at: Specimen.slow, withIntermediateDirectories: true)
        try? "module example.com/slow\n\ngo 1.22\n".write(to: Specimen.slow.appendingPathComponent("go.mod"), atomically: true, encoding: .utf8)
        try? Specimen.slowProgram().write(to: Specimen.slow.appendingPathComponent("main.go"), atomically: true, encoding: .utf8)
    }
    return debugPage("Starting", note: "A large Go program is building: the state in words, with a loader, and Stop available.", key: "starting",
                     root: Specimen.slow)
}

@MainActor
private enum Load {
    static let lines = 100_000
    static let perEvent = 4
    static let perFlush = 250
    static let errorEvery = 50
    static let latency = 97
    static let words = ["GET /api/hubs 200", "POST /api/messages 202", "queue depth", "deliver email ok", "deliver webhook retry"]
}

@MainActor
private func draw(_ view: NSView) {
    guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
    view.cacheDisplay(in: view.bounds, to: bitmap)
}

@MainActor
let debugConsoleLoadPage = GalleryPage(name: "debug-console-load", settle: Motion.slow, prepare: {
    guard let controller = Specimen.controller else { return }
    controller.tab = .console
    let console = controller.console
    let clock = ContinuousClock()
    var slowest = Duration.zero
    var flushes: [Duration] = []
    var draws: [Duration] = []
    var total = Duration.zero
    var line = 0
    while line < Load.lines {
        var batch: [DebugOutput] = []
        for _ in 0..<Load.perFlush {
            var text = ""
            for _ in 0..<Load.perEvent {
                text += "\(line) \(Load.words[line % Load.words.count]) took \(line % Load.latency)ms\n"
                line += 1
            }
            batch.append(DebugOutput(category: line % Load.errorEvery == 0 ? .stderr : .stdout, text: text))
        }
        let started = clock.now
        controller.debuggerDidChange(.output(batch))
        console.flush()
        let flushed = clock.now
        draw(controller.view)
        let spent = clock.now - started
        total += spent
        slowest = max(slowest, spent)
        flushes.append(flushed - started)
        draws.append(spent)
        await Task.yield()
    }
    flushes.sort()
    draws.sort()
    let percentile = { (values: [Duration], share: Int) in values[min(values.count - 1, values.count * share / 100)] }
    print("console load: flush alone median \(percentile(flushes, 50)) p95 \(percentile(flushes, 95)) max \(flushes.last ?? .zero); flush and draw median \(percentile(draws, 50)) p95 \(percentile(draws, 95))")
    print("console load: \(Load.lines) lines in \(Load.lines / (Load.perEvent * Load.perFlush)) flushes, total \(total), slowest flush and draw \(slowest), kept \(console.lineCount) lines, at end \(console.isAtEnd)")
    let top = clock.now
    console.scroll.documentView?.scroll(.zero)
    draw(controller.view)
    let bottom = clock.now
    console.scrollToEnd()
    draw(controller.view)
    print("console load: jump to the top and draw \(bottom - top), back to the end and draw \(clock.now - bottom)")
    let tail = [DebugOutput(category: .stdout, text: "one more line\n")]
    console.scroll.documentView?.scroll(.zero)
    controller.debuggerDidChange(.output(tail))
    console.flush()
    print("console load: scrolled up, a new line keeps the view where it was: \(console.scroll.contentView.bounds.minY == 0)")
    let filterStart = clock.now
    await console.applyFilter("took 42ms")
    draw(controller.view)
    let filtered = clock.now - filterStart
    let clearStart = clock.now
    await console.applyFilter("")
    draw(controller.view)
    print("console load: filter over \(console.lineCount) kept lines and draw \(filtered), back to everything and draw \(clock.now - clearStart), dropped \(console.dropped)")
    console.scrollToEnd()
    controller.debuggerDidChange(.output(tail))
    console.flush()
    print("console load: at the end, a new line is followed: \(console.isAtEnd)")
}, teardown: { await Specimen.teardown() }) {
    debugPage("Console at 100,000 lines", note: "Appended in batches; the scrollback keeps the last 50,000 and says how many it dropped.",
              key: "load", root: Specimen.go)
}

@MainActor
let debugLongArrayPage = GalleryPage(name: "debug-long-array", settle: Motion.slow, prepare: {
    guard let debugger = Specimen.debugger, let controller = Specimen.controller else { return }
    if debugger.state == .idle {
        let main = Specimen.array.appendingPathComponent("main.go")
        debugger.setBreakpoint(line: Specimen.arrayLine, in: main)
        let target = DebugTarget(id: "array", name: "array", kind: .goPackage(Specimen.array), directory: Specimen.array)
        await debugger.start(target, debugging: true)
        await Specimen.wait(debugger, Specimen.isPaused)
    }
    await controller.reveal(["values"])
    let pane = controller.variables
    guard let values = pane.tree.rows.first(where: { DebugText.name($0.name) == "values" }) else { return }
    await pane.loadMore(values.path)
    pane.list.selectedRow = pane.tree.rows.lastIndex { $0.kind == .more }
}, teardown: { await Specimen.teardown() }) {
    try? FileManager.default.createDirectory(at: Specimen.array, withIntermediateDirectories: true)
    try? "module example.com/array\n\ngo 1.22\n".write(to: Specimen.array.appendingPathComponent("go.mod"), atomically: true, encoding: .utf8)
    try? Specimen.arrayProgram.write(to: Specimen.array.appendingPathComponent("main.go"), atomically: true, encoding: .utf8)
    return debugPage("Long array", note: "A 300-element slice fetched 100 at a time, after one Load next; the collection stays pinned above its tail.",
                     key: "array",
                     root: Specimen.array)
}

@MainActor
let debugBreakpointsPage = GalleryPage(name: "debug-breakpoints", settle: Motion.slow, prepare: {
    guard let debugger = Specimen.debugger, let controller = Specimen.controller else { return }
    if debugger.state == .idle {
        let hub = Specimen.go.appendingPathComponent("hub/hub.go")
        let main = Specimen.go.appendingPathComponent("main.go")
        debugger.setBreakpoint(Breakpoint(line: Specimen.goLine), in: hub)
        debugger.setBreakpoint(Breakpoint(line: Specimen.goLine + 1, condition: #"message.Channel == "pager""#), in: hub)
        debugger.setBreakpoint(Breakpoint(line: 27, hitCondition: "> 1", logMessage: "submitting {message.Subject}"), in: main)
        debugger.setBreakpoint(Breakpoint(line: 33, isEnabled: false), in: main)
        await Specimen.pausedAtFirstStop(debugger, target: await Specimen.goTarget(debugger), file: hub, line: Specimen.goLine)
    }
    controller.showBreakpoints()
}, teardown: { await Specimen.teardown() }) {
    let card = Specimen.card("breakpoints", root: Specimen.go)
    let editor = BreakpointEditor(Breakpoint(line: Specimen.goLine + 1, condition: #"message.Channel == "pager""#, hitCondition: "> 1"),
                                  place: "hub.go:51")
    let panel = FloatingSurface(radius: Radius.card)
    panel.translatesAutoresizingMaskIntoConstraints = false
    panel.addSubview(editor)
    NSLayoutConstraint.activate([
        editor.topAnchor.constraint(equalTo: panel.topAnchor),
        editor.leadingAnchor.constraint(equalTo: panel.leadingAnchor),
        editor.trailingAnchor.constraint(equalTo: panel.trailingAnchor),
        editor.bottomAnchor.constraint(equalTo: panel.bottomAnchor),
    ])
    return Gallery.page([
        Gallery.section("Breakpoints", note: "Line breakpoints with their conditions, hit counts and logpoints; the exception filters Delve offers.",
                        [card]),
        Gallery.section("Editing a breakpoint", note: "From the list's menu, or from the editor's gutter through editBreakpoint(line:in:anchoredTo:in:).",
                        [panel]),
    ])
}

@MainActor
let debugReplPage = GalleryPage(name: "debug-repl", settle: Motion.slow, prepare: {
    guard let debugger = Specimen.debugger, let controller = Specimen.controller else { return }
    await Specimen.pausedAtFirstStop(debugger, target: await Specimen.typeScriptTarget(debugger),
                                     file: Specimen.typeScript.appendingPathComponent("src/hub.ts"), line: Specimen.typeScriptLine)
    controller.tab = .console
    let pane = controller.consolePane
    for line in ["message.subject", "message.channel.toUpperCase()", "missing"] { await pane.run(line) }
    pane.prompt.stringValue = "message.bo"
    let completions = await debugger.completions(for: "message.bo", column: "message.bo".count)
    print("gallery: completions for message.bo: \(completions.map(\.label))")
}, teardown: { await Specimen.teardown() }) {
    debugPage("Console while paused", note: "The prompt evaluates in the selected frame; ↑ and ↓ walk the history, Tab asks js-debug for completions.",
              key: "repl", root: Specimen.typeScript)
}

@MainActor
let debugGoroutinesPage = GalleryPage(name: "debug-goroutines", settle: Motion.slow, prepare: {
    guard let debugger = Specimen.debugger, let controller = Specimen.controller else { return }
    if debugger.state == .idle {
        let main = Specimen.workers.appendingPathComponent("main.go")
        debugger.setBreakpoint(line: Specimen.workersLine, in: main)
        let target = DebugTarget(id: "workers", name: "workers", kind: .goPackage(Specimen.workers), directory: Specimen.workers,
                                 arguments: ["Ada"])
        await debugger.start(target, debugging: true)
        await Specimen.wait(debugger, Specimen.isPaused)
        _ = await Wait.until(.seconds(10)) { debugger.threads.contains { $0.state == "chan receive" } }
    }
    print("gallery: goroutines \(debugger.threads.map { "\($0.id) \($0.function) [\($0.state)]" })")
    guard let worker = debugger.threads.first(where: { $0.function == "main.worker" }) else { return }
    await controller.selectThread(worker.id)
}, teardown: { await Specimen.teardown() }) {
    try? FileManager.default.createDirectory(at: Specimen.workers, withIntermediateDirectories: true)
    try? "module example.com/workers\n\ngo 1.22\n".write(to: Specimen.workers.appendingPathComponent("go.mod"), atomically: true, encoding: .utf8)
    try? Specimen.workersProgram.write(to: Specimen.workers.appendingPathComponent("main.go"), atomically: true, encoding: .utf8)
    return debugPage("Goroutines", note: "Switched to the worker goroutine, blocked on chan receive: its frames and its variables.",
                     key: "workers", root: Specimen.workers)
}

@MainActor
let debugManyLocalsPage = GalleryPage(name: "debug-many-locals", settle: Motion.slow, prepare: {
    guard let debugger = Specimen.debugger, let controller = Specimen.controller else { return }
    if debugger.state == .idle {
        let main = Specimen.many.appendingPathComponent("main.go")
        debugger.setBreakpoint(line: Specimen.manyLocals * 2 + 5, in: main)
        let target = DebugTarget(id: "many", name: "many", kind: .goPackage(Specimen.many), directory: Specimen.many)
        await debugger.start(target, debugging: true)
        await Specimen.wait(debugger, Specimen.isPaused)
    }
    let clock = ContinuousClock()
    let started = clock.now
    await controller.selectFrame(at: 0)
    let shown = clock.now - started
    print("gallery: 10,000 locals from frame selection to rows shown in \(shown), \(controller.variables.tree.rows.count) rows built")
}, teardown: { await Specimen.teardown() }) {
    try? FileManager.default.createDirectory(at: Specimen.many, withIntermediateDirectories: true)
    try? "module example.com/many\n\ngo 1.22\n".write(to: Specimen.many.appendingPathComponent("go.mod"), atomically: true, encoding: .utf8)
    let body = (0..<Specimen.manyLocals).map { "\tv\($0) := \($0)\n\t_ = v\($0)" }.joined(separator: "\n")
    try? "package main\n\nimport \"fmt\"\n\nfunc main() {\n\(body)\n\tfmt.Println(\"done\")\n}\n"
        .write(to: Specimen.many.appendingPathComponent("main.go"), atomically: true, encoding: .utf8)
    return debugPage("10,000 locals", note: "A stop with 10,000 locals: the first 100 rows, and a paging row scoped to Locals.",
                     key: "many", root: Specimen.many)
}

@MainActor
private enum EditorStop {
    static let key = "editor-stop"
    static var specimen: EditorSpecimen?
}

@MainActor
let debugEditorStopPage = GalleryPage(name: "debug-editor-stop", settle: Motion.slow, prepare: {
    guard let made = EditorStop.specimen, let debugger = Specimen.debugger else { return }
    let hub = Specimen.go.appendingPathComponent("hub/hub.go").standardizedFileURL
    if debugger.state == .idle {
        debugger.setBreakpoint(Breakpoint(line: Specimen.goLine + 2, condition: #"message.Channel == "pager""#), in: hub)
        await Specimen.pausedAtFirstStop(debugger, target: await Specimen.goTarget(debugger), file: hub, line: Specimen.goLine)
    }
    guard case .paused = debugger.state, let frame = debugger.selectedFrame else { return }
    let lines = ((try? String(contentsOf: hub, encoding: .utf8)) ?? "").split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    let values = await debugger.inlineValues(in: hub) { lines.indices.contains($0) ? lines[$0] : nil }
    let notes = values.enumerated().map { order, value in
        let label = value.name + ": "
        let colours = CodeColors.ranges(in: value.text, language: "go").map { token in
            (range: NSRange(location: token.range.location + label.utf16.count, length: token.range.length), color: token.color)
        }
        return LineNote(zeroBasedLine: value.line, text: label + value.text, isChanged: value.isChanged, order: order, syntax: colours)
    }
    made.editor.breakpoints = { [weak debugger] url in debugger?.breakpoints(in: url) ?? [] }
    made.editor.lineNotes = { $0.standardizedFileURL == hub ? notes : [] }
    made.editor.executionPoint = FileLocation(url: hub, range: TextSpan(at: TextPosition(line: frame.line, column: frame.column)))
    made.editor.breakpointsDidChange()
    print("gallery: editor stop notes \(notes.map { "\($0.zeroBasedLine + 1) \($0.text)" })")
}, teardown: {
    await EditorStop.specimen?.shutdown()
    EditorStop.specimen = nil
    await Specimen.teardown()
}) {
    let made = EditorSpecimen(fixture: "notifyhub-go")
    EditorStop.specimen = made
    made.open("hub/hub.go", at: Specimen.goLine)
    _ = Specimen.debugger(EditorStop.key, root: Specimen.go)
    return Gallery.page([Gallery.section("Editor at a stop",
                                         note: "hub.go:50 carries a breakpoint, the execution line and an inline value at once; 52 is conditional.",
                                         [made.card])])
}
