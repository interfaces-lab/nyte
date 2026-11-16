import AppKit
import NyteCore
@testable import NyteEditor
import NyteLanguage
import NyteUI

@MainActor enum EditorBench {
    static let defaultSizes = [100_000]
    static let geometrySizes = [2_000, 10_000, 100_000, 500_000]
    static let keys = Int(ProcessInfo.processInfo.environment["NYTE_BENCH_KEYS"] ?? "") ?? 40
    static let warmup = 5
    static let pane = NSRect(x: 0, y: 0, width: 860, height: 520)
    static let xKey: UInt16 = 7
    static let returnKey: UInt16 = 36
    static let headerLines = 4
    static let unitLines = 13
    static let serverWait = Duration.seconds(60)
    static let switches = 20
    static let serverPoll = Duration.milliseconds(50)
    static var kept: [EditorViewController] = []
    static var services: [LanguageService] = []

    static func run(sizes: [Int]) async {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-editor-bench", isDirectory: true)
        try? FileManager.default.removeItem(at: folder)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? "module bench\n\ngo 1.22\n".write(to: folder.appendingPathComponent("go.mod"), atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: folder) }
        let quiet = ProcessInfo.processInfo.environment["NYTE_BENCH_SERVER"] == "quiet"
        print("every feature attached, \(quiet ? "a quiet stand-in" : "gopls") as the language server")
        print("lines    | where   | our code p50 / p95 µs | + draw and commit p50 / p95 µs | draws")
        for lines in sizes.isEmpty ? defaultSizes : sizes {
            let url = folder.appendingPathComponent("bench\(lines).go")
            try? goSource(lines: lines).write(to: url, atomically: true, encoding: .utf8)
            await bench(url: url, folder: folder, lines: lines, quiet: quiet)
        }
        for service in services { await service.shutdown() }
    }

    static func open(_ url: URL, folder: URL, quiet: Bool) async -> (EditorViewController, NSWindow) {
        let workspace = Workspace(root: folder)
        let editor = EditorViewController(workspace: workspace)
        if quiet {
            editor.intelligence = QuietIntelligence()
        } else {
            let service = LanguageService(workspace: workspace, toolchain: Toolchain(workspace: folder))
            service.onEvent = { [weak editor] in editor?.handle($0) }
            service.applyEdit = { [weak editor] in await editor?.apply($0) ?? false }
            editor.intelligence = service
            services.append(service)
        }
        kept.append(editor)
        let window = OffscreenWindow(contentRect: pane, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = editor.view
        editor.view.layoutSubtreeIfNeeded()
        window.makeFirstResponder(editor.textView)
        editor.open(url, preview: false)
        while editor.shown == nil { await Task.yield() }
        return (editor, window)
    }

    static func bench(url: URL, folder: URL, lines: Int, quiet: Bool) async {
        let clock = ContinuousClock()
        let opened = clock.now
        let (editor, window) = await open(url, folder: folder, quiet: quiet)
        flush(window)
        let firstPaint = clock.now - opened
        if !quiet {
            let deadline = clock.now + serverWait
            while clock.now < deadline, editor.intelligence?.status(for: url)?.state != .ready {
                try? await Task.sleep(for: serverPoll)
                guard !Task.isCancelled else { return }
            }
            print("  server \(editor.intelligence?.status(for: url)?.state == .ready ? "ready" : "not ready") after \(Int(micros(clock.now - opened) / 1000)) ms")
        }
        print(String(format: "open %d lines: first paint %.1f ms", lines, micros(firstPaint) / 1000))
        let counter = DrawCounter()
        editor.textView.decorators.append(counter)
        for spot in ["start", "middle", "end", "newline"] {
            let store = editor.textView.store
            let offset = switch spot {
            case "start": 0
            case "middle", "newline": store.lineRange(store.lineCount / 2).location
            default: store.length
            }
            editor.textView.select(SelectionSet(caret: offset))
            flush(window)
            await Task.yield()
            var ours: [Double] = []
            var drawn: [Double] = []
            let drawsBefore = counter.draws
            let event = key(spot == "newline" ? "\r" : "x")
            for index in 0..<(warmup + keys) {
                let started = clock.now
                editor.textView.keyDown(with: event)
                let typed = clock.now
                flush(window)
                let shown = clock.now
                if index >= warmup {
                    ours.append(micros(typed - started))
                    drawn.append(micros(shown - started))
                }
                await Task.yield()
            }
            print(String(format: "%-8d | %-7@ | %8.1f / %8.1f | %8.1f / %8.1f | %d", lines, spot as NSString, percentile(ours, 0.5),
                         percentile(ours, 0.95), percentile(drawn, 0.5), percentile(drawn, 0.95), counter.draws - drawsBefore))
        }
        let clip = editor.scrollView.contentView
        editor.textView.moveToEndOfDocument(nil)
        flush(window)
        var frames: [Double] = []
        for _ in 0..<(ProcessInfo.processInfo.environment["NYTE_BENCH_SCROLLS"].flatMap(Int.init) ?? keys) {
            let started = clock.now
            let above = clip.bounds.minY - clip.bounds.height
            clip.scroll(to: NSPoint(x: 0, y: above < 0 ? editor.textView.frame.height - clip.bounds.height : above))
            editor.scrollView.reflectScrolledClipView(clip)
            flush(window)
            frames.append(micros(clock.now - started))
        }
        print(String(format: "  scroll a page near the end and draw it: p50 %.1f µs, p95 %.1f µs", percentile(frames, 0.5), percentile(frames, 0.95)))
        withExtendedLifetime(window) {}
    }

    static func flush(_ window: NSWindow) {
        window.displayIfNeeded()
        CATransaction.flush()
    }

    static func percentile(_ samples: [Double], _ share: Double) -> Double {
        let sorted = samples.sorted()
        return sorted.isEmpty ? 0 : sorted[min(sorted.count - 1, Int(Double(sorted.count) * share))]
    }
    static func key(_ characters: String) -> NSEvent {
        NSEvent.keyEvent(
            with: .keyDown, location: .zero, modifierFlags: [], timestamp: 0, windowNumber: 0, context: nil,
            characters: characters, charactersIgnoringModifiers: characters, isARepeat: false,
            keyCode: characters == "\r" ? returnKey : xKey
        ) ?? NSEvent()
    }
    static func micros(_ duration: Duration) -> Double {
        Double(duration.components.seconds) * 1_000_000 + Double(duration.components.attoseconds) / 1e12
    }
    static func residentBytes() -> Int {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
        let result = withUnsafeMutablePointer(to: &info) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
            }
        }
        return result == KERN_SUCCESS ? Int(info.phys_footprint) : 0
    }
    static func goSource(lines: Int) -> String {
        (0..<max(1, (lines - headerLines) / unitLines)).reduce(into: "package main\n\nimport \"fmt\"\n\n") { out, unit in
            out += "// Item\(unit) holds one generated record.\ntype Item\(unit) struct {\n\tName  string\n\tCount int\n}\n\n"
                + "func build\(unit)(name string, count int) Item\(unit) {\n\t/* format the name */\n"
                + "\ts := fmt.Sprintf(\"%s-%d\", name, count)\n\treturn Item\(unit){Name: s, Count: count * \(unit)}\n}\n\n\n"
        }
    }
}

extension EditorBench {
    static func geometry() async {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-editor-geometry", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        for size in geometrySizes {
            let url = folder.appendingPathComponent("geometry\(size).go")
            try? goSource(lines: size).write(to: url, atomically: true, encoding: .utf8)
            let (editor, window) = await open(url, folder: folder, quiet: true)
            let view = editor.textView
            view.moveToEndOfDocument(nil)
            let last = view.store.lineCount - 1
            let caret = view.caretRect(at: view.selections.primarySelection.head)
            let arithmetic = CGFloat(last) * view.metrics.lineHeight + TextEngineView.verticalInset
            print(String(format: "%7d lines: frame %.0f; after Move to End the caret line %d is drawn at y %.0f, row arithmetic says %.0f; caret visible %@",
                         size, view.frame.height, last, caret.minY, arithmetic, view.visibleRect.contains(caret) ? "yes" : "NO"))
            view.scroll(NSPoint(x: 0, y: view.frame.height / 2))
            let top = view.store.line(at: editor.visibleRange.location)
            let expected = Int((view.visibleRect.minY - TextEngineView.verticalInset) / view.metrics.lineHeight)
            print(String(format: "         scrolled to the middle: first visible line %d, row arithmetic says %d; %@", top, expected,
                         top == expected && caret.minY == arithmetic ? "exact" : "WRONG"))
            withExtendedLifetime(window) {}
        }
    }

    static func tabSwitch(lines: Int) async {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-editor-tabs", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let large = folder.appendingPathComponent("large.go")
        let small = folder.appendingPathComponent("small.go")
        try? goSource(lines: lines).write(to: large, atomically: true, encoding: .utf8)
        try? goSource(lines: 200).write(to: small, atomically: true, encoding: .utf8)
        let (editor, window) = await open(large, folder: folder, quiet: true)
        editor.open(small, preview: false)
        while editor.shown?.url != small.standardizedFileURL { await Task.yield() }
        editor.select(at: 0)
        let view = editor.textView
        view.select(SelectionSet(caret: view.store.lineRange(lines * 3 / 4).location + 3))
        view.scroll(NSPoint(x: 0, y: view.top(ofLine: lines * 3 / 4) - 137))
        flush(window)
        let origin = editor.scrollView.contentView.bounds.origin
        let caret = view.selections
        var samples: [Double] = []
        var exact = true
        for _ in 0..<switches {
            editor.select(at: 1)
            flush(window)
            let started = ContinuousClock.now
            editor.select(at: 0)
            flush(window)
            samples.append(micros(.now - started))
            exact = exact && editor.scrollView.contentView.bounds.origin == origin && view.selections == caret
        }
        print(String(format: "switch to a %d-line tab and draw it: p50 %.2f ms, p95 %.2f ms; viewport and caret %@", lines,
                     percentile(samples, 0.5) / 1000, percentile(samples, 0.95) / 1000, exact ? "exact" : "MOVED"))
        withExtendedLifetime(window) {}
    }
}
