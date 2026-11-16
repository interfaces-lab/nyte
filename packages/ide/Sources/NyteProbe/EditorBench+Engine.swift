import AppKit
@testable import NyteEditor
import NyteUI

@MainActor final class DrawCounter: TextEngineDecorator {
    var draws = 0
    var started = ContinuousClock.now
    var inside: [Double] = []
    var heights: [CGFloat] = []
    func drawUnderText(in rect: NSRect, of view: TextEngineView) {
        draws += 1
        started = .now
        heights.append(rect.height)
    }
    func drawOverText(in rect: NSRect, of view: TextEngineView) { inside.append(EditorBench.micros(.now - started)) }
}

extension EditorBench {
    static let engineSizes = [1_000, 10_000, 100_000, 500_000]

    static func engineView(in window: NSWindow) -> (TextEngineView, NSScrollView, DrawCounter) {
        let view = TextEngineView()
        let scroll = NSScrollView(frame: pane)
        scroll.hasVerticalScroller = true
        scroll.hasHorizontalScroller = true
        scroll.documentView = view
        window.contentView = scroll
        let counter = DrawCounter()
        view.decorators = [counter]
        window.makeFirstResponder(view)
        return (view, scroll, counter)
    }

    static func flushDisplay(_ window: NSWindow) {
        window.displayIfNeeded()
        CATransaction.flush()
    }

    static func loadEngine(_ url: URL) async -> TextLoader.Loaded? {
        await Task.detached(priority: .userInitiated) {
            guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { return nil }
            return TextLoader.load(data, language: Language.detect(url))
        }.value
    }

    static func runEngine(sizes: [Int]) async {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-engine-bench", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        print("lines    | where   | key p50 / p95 µs | key + layout p50 | key + layout + draw p50 / p95 µs")
        for lines in sizes.isEmpty ? engineSizes : sizes {
            let url = folder.appendingPathComponent("engine\(lines).go")
            try? goSource(lines: lines).write(to: url, atomically: true, encoding: .utf8)
            await benchEngine(url: url, lines: lines)
        }
    }

    static func benchEngine(url: URL, lines: Int) async {
        let window = OffscreenWindow(contentRect: pane, styleMask: [.borderless], backing: .buffered, defer: false)
        let (view, scroll, counter) = engineView(in: window)
        let before = residentBytes()
        let clock = ContinuousClock()
        let opened = clock.now
        guard let loaded = await loadEngine(url) else { return print("could not load \(url.lastPathComponent)") }
        let decoded = clock.now
        view.load(loaded.store, widestColumns: loaded.widestColumns)
        flushDisplay(window)
        let painted = clock.now
        let resident = residentBytes() - before
        let units = loaded.store.length
        let structure = loaded.store.buffer.chunks.reduce(0) { $0 + $1.capacity * 2 } + loaded.store.lineCount * (MemoryLayout<Int>.size + 1)
        print(String(format: "  text structure: %.2f bytes per UTF-16 unit (%.1f MB: chunks at 2 bytes per unit plus 9 bytes per line)",
                     Double(structure) / Double(max(1, units)), Double(structure) / 1_048_576))
        print(String(format: "open %d lines: first paint %.1f ms (decode off the main actor %.1f ms, main actor %.1f ms, %d draws), resident +%.1f MB, %.2f bytes per UTF-16 unit",
                     lines, micros(painted - opened) / 1000, micros(decoded - opened) / 1000, micros(painted - decoded) / 1000, counter.draws,
                     Double(resident) / 1_048_576, Double(resident) / Double(max(1, units))))
        for spot in ["start", "middle", "end", "newline"] {
            let store = view.store
            let offset = switch spot {
            case "start": 0
            case "middle", "newline": store.lineRange(store.lineCount / 2).location
            default: store.length
            }
            view.select(SelectionSet(caret: offset))
            flushDisplay(window)
            var keyOnly: [Double] = []
            var laidOut: [Double] = []
            var drawn: [Double] = []
            let drawsBefore = counter.draws
            let event = key(spot == "newline" ? "\r" : "x")
            for index in 0..<(warmup + keys) {
                let started = clock.now
                view.keyDown(with: event)
                let typed = clock.now
                let line = view.store.line(at: view.selections.primarySelection.head)
                _ = view.layout(line: line, column: view.selections.primarySelection.head - view.store.lineRange(line).location)
                let layoutDone = clock.now
                flushDisplay(window)
                let drawDone = clock.now
                guard index >= warmup else { continue }
                keyOnly.append(micros(typed - started))
                laidOut.append(micros(layoutDone - started))
                drawn.append(micros(drawDone - started))
            }
            print(String(format: "%-8d | %-7@ | %7.1f / %7.1f | %7.1f | %7.1f / %7.1f (%d draws)", lines, spot as NSString, percentile(keyOnly, 0.5),
                         percentile(keyOnly, 0.95), percentile(laidOut, 0.5), percentile(drawn, 0.5), percentile(drawn, 0.95),
                         counter.draws - drawsBefore))
            print(String(format: "           text drawing inside draw: p50 %.1f µs over dirty rects p50 %.0f pt tall", percentile(counter.inside, 0.5),
                         Double(counter.heights.sorted()[counter.heights.count / 2])))
            counter.inside.removeAll()
            counter.heights.removeAll()
        }
        let clip = scroll.contentView
        view.run(.documentEnd, extending: false)
        flushDisplay(window)
        var frames: [Double] = []
        counter.inside.removeAll()
        let drawsBefore = counter.draws
        for _ in 0..<keys {
            let started = clock.now
            clip.scroll(to: NSPoint(x: 0, y: max(0, clip.bounds.minY - clip.bounds.height)))
            scroll.reflectScrolledClipView(clip)
            flushDisplay(window)
            frames.append(micros(clock.now - started))
        }
        print(String(format: "  scroll a page near the end and draw it: p50 %.1f µs, p95 %.1f µs (%d draws; text drawing inside draw p50 %.1f µs)",
                     percentile(frames, 0.5), percentile(frames, 0.95), counter.draws - drawsBefore, percentile(counter.inside, 0.5)))
        withExtendedLifetime(window) {}
    }

    static func engineGeometry() async {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-engine-geometry", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        for size in geometrySizes {
            let url = folder.appendingPathComponent("geometry\(size).go")
            try? goSource(lines: size).write(to: url, atomically: true, encoding: .utf8)
            let window = OffscreenWindow(contentRect: pane, styleMask: [.borderless], backing: .buffered, defer: true)
            let (view, _, _) = engineView(in: window)
            guard let loaded = await loadEngine(url) else { continue }
            view.load(loaded.store, widestColumns: loaded.widestColumns)
            let height = view.metrics.lineHeight
            view.moveToEndOfDocument(nil)
            let last = view.store.lineCount - 1
            let caretY = view.caretRect(at: view.selections.primarySelection.head).minY
            let arithmetic = CGFloat(last) * height + TextEngineView.verticalInset
            let shown = view.visibleRect.contains(view.caretRect(at: view.selections.primarySelection.head))
            print(String(format: "%7d lines: frame %.0f; after Move to End the caret line %d is drawn at y %.0f, row arithmetic says %.0f; caret visible %@",
                         size, view.frame.height, last, caretY, arithmetic, shown ? "yes" : "NO"))
            view.scroll(NSPoint(x: 0, y: view.frame.height / 2))
            let visible = view.accessibilityVisibleCharacterRange()
            let top = view.store.line(at: visible.location)
            let expected = Int((view.visibleRect.minY - TextEngineView.verticalInset) / height)
            print(String(format: "         scrolled to the middle of the frame: first visible line %d, row arithmetic says %d, visible characters %d; %@",
                         top, expected, visible.length, top == expected && caretY == arithmetic && shown ? "exact" : "WRONG"))
            withExtendedLifetime(window) {}
        }
    }
}
