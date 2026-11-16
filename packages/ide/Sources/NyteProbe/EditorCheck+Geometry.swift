import AppKit
import NyteCore
@testable import NyteEditor
import NyteUI

extension EditorCheck {
    static let geometrySizes = [2_000, 10_000, 100_000]

    func geometry() async {
        for size in Self.geometrySizes {
            let editor = await openEditor(EditorBench.goSource(lines: size), file: "geometry\(size).go")
            let other = folder.appendingPathComponent("other\(size).go")
            try? "package other\n".write(to: other, atomically: true, encoding: .utf8)
            let lines = editor.lineIndex?.count ?? 0
            editor.textView.moveToEndOfDocument(nil)
            editor.ruler.updateLayer()
            let immediate = Self.geometryProblem(editor, caret: true)
            expect(immediate == nil, "\(size) lines: Move to End right after opening is exact at once, with no layout to wait for", immediate ?? "")
            await expectGeometry(editor, "\(size) lines, Move to End", caret: true) { editor.textView.moveToEndOfDocument(nil) }
            await expectGeometry(editor, "\(size) lines, reveal a line in the last third", caret: true) {
                editor.reveal(FileLocation(url: editor.url ?? other, range: TextSpan(at: TextPosition(line: lines * 5 / 6, column: 3))))
            }
            for share in [0.5, 0.9] {
                await expectGeometry(editor, "\(size) lines, scroller dragged to \(Int(share * 100))%", caret: false) {
                    Self.dragScroller(editor, to: share)
                }
            }
            editor.textView.setSelectedRange(NSRange(location: editor.lineIndex?.start(of: lines * 3 / 4) ?? 0, length: 0))
            Self.dragScroller(editor, to: 0.75)
            await settle(editor)
            let savedTop = editor.textView.visibleRect.minY
            await expectGeometry(editor, "\(size) lines, a saved viewport restored", caret: false) {
                editor.open(other, preview: false)
                while editor.shown?.url != other.standardizedFileURL { await Task.yield() }
                editor.select(at: 0)
            }
            expect(abs(editor.textView.visibleRect.minY - savedTop) <= 1, "\(size) lines: the restored viewport is where it was left",
                   "\(editor.textView.visibleRect.minY) against \(savedTop)")
            editor.close(at: 1)
            await expectGeometry(editor, "\(size) lines, after an edit near the top adds and removes lines", caret: false) {
                editor.replaceUntracked(NSRange(location: editor.lineIndex?.start(of: 3) ?? 0, length: 0), with: "// one\n// two\n// three\n")
                let fifth = editor.lineIndex.map { NSRange(location: $0.start(of: 5), length: $0.start(of: 6) - $0.start(of: 5)) }
                editor.replaceUntracked(fifth ?? NSRange(location: 0, length: 0), with: "")
            }
            await expectGeometry(editor, "\(size) lines, after a font size preference", caret: false) {
                editor.apply(EditorPreferences(fontSize: TextStyle.code.size + 2, lineHeight: TextStyle.code.lineHeight + 3))
            }
            editor.apply(EditorPreferences())
        }
    }

    static let switchLines = 500_000
    static let switchBudget = Duration.milliseconds(16)

    func tabSwitch() async {
        let editor = await openEditor(EditorBench.goSource(lines: Self.switchLines), file: "switch.go")
        let small = folder.appendingPathComponent("switch-small.go")
        try? "package small\n".write(to: small, atomically: true, encoding: .utf8)
        let view = editor.textView
        let line = view.store.lineCount * 3 / 4
        view.select(SelectionSet([Selection(anchor: view.store.lineRange(line).location + 2, head: view.store.lineRange(line + 1).location + 5)]))
        Self.scroll(editor, to: view.top(ofLine: line) - 37)
        let origin = editor.scrollView.contentView.bounds.origin
        let selections = view.selections
        editor.open(small, preview: false)
        while editor.shown?.url != small.standardizedFileURL { await Task.yield() }
        let started = ContinuousClock.now
        editor.select(at: 0)
        let elapsed = ContinuousClock.now - started
        expect(editor.scrollView.contentView.bounds.origin == origin && view.selections == selections && elapsed < Self.switchBudget,
               "switching back to a \(Self.switchLines)-line tab is instant and returns to the exact viewport and selection",
               "\(editor.scrollView.contentView.bounds.origin) against \(origin), \(elapsed)")
        view.display()
        let drawn = EditorBench.largestBacking(editor.view.layer)
        expect(drawn.width <= editor.view.bounds.width && drawn.height <= editor.view.bounds.height,
               "the text draws into a layer the size of the viewport, not the document", "\(drawn)")
        Self.scroll(editor, to: view.top(ofLine: 40) + 7)
        let mismatch = Self.surfaceMismatch(editor)
        expect(mismatch < 0.01, "the text on screen matches the text drawn for a snapshot, scrolled", String(format: "%.3f of pixels differ", mismatch))
        editor.close(at: 1)
    }

    static func surfaceMismatch(_ editor: EditorViewController) -> Double {
        let canvas = editor.textView.canvas
        canvas.window?.displayIfNeeded()
        CATransaction.flush()
        guard let layer = canvas.layer, let snapshot = canvas.bitmapImageRepForCachingDisplay(in: canvas.bounds) else { return 1 }
        canvas.cacheDisplay(in: canvas.bounds, to: snapshot)
        guard let screen = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: snapshot.pixelsWide, pixelsHigh: snapshot.pixelsHigh, bitsPerSample: 8,
                                            samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
              let context = NSGraphicsContext(bitmapImageRep: screen)?.cgContext
        else { return 1 }
        let scale = CGFloat(snapshot.pixelsWide) / canvas.bounds.width
        context.translateBy(x: 0, y: CGFloat(screen.pixelsHigh))
        context.scaleBy(x: scale, y: -scale)
        context.translateBy(x: -layer.bounds.minX, y: -layer.bounds.minY)
        layer.render(in: context)
        var differing = 0
        let step = 3
        var samples = 0
        for y in stride(from: 0, to: screen.pixelsHigh, by: step) {
            for x in stride(from: 0, to: screen.pixelsWide, by: step) {
                guard let a = screen.colorAt(x: x, y: y)?.usingColorSpace(.sRGB), let b = snapshot.colorAt(x: x, y: y)?.usingColorSpace(.sRGB) else { continue }
                samples += 1
                if abs(a.redComponent - b.redComponent) + abs(a.greenComponent - b.greenComponent) + abs(a.blueComponent - b.blueComponent) > 0.2 { differing += 1 }
            }
        }
        return samples == 0 ? 1 : Double(differing) / Double(samples)
    }

    static func scroll(_ editor: EditorViewController, to y: CGFloat) {
        let clip = editor.scrollView.contentView
        clip.scroll(to: NSPoint(x: clip.bounds.minX, y: y))
        editor.scrollView.reflectScrolledClipView(clip)
    }

    func expectGeometry(_ editor: EditorViewController, _ label: String, caret: Bool, _ act: () async -> Void) async {
        await act()
        await settle(editor)
        let problem = Self.geometryProblem(editor, caret: caret)
        expect(problem == nil, label + ": the text, the ruler and the caret sit at their rows", problem ?? "")
    }

    func settle(_ editor: EditorViewController) async {
        await Task.yield()
        editor.paint()
        editor.ruler.updateLayer()
    }

    static func dragScroller(_ editor: EditorViewController, to share: Double) {
        let clip = editor.scrollView.contentView
        let travel = editor.textView.frame.height - clip.bounds.height
        clip.scroll(to: NSPoint(x: clip.bounds.minX, y: (travel * share).rounded()))
        editor.scrollView.reflectScrolledClipView(clip)
    }

    static func geometryProblem(_ editor: EditorViewController, caret: Bool) -> String? {
        let view = editor.textView
        guard editor.lineIndex != nil else { return "no document" }
        let visible = view.visibleRect
        let inset = TextEngineView.verticalInset
        let height = view.metrics.lineHeight
        let row = Int(((visible.minY - inset) / height).rounded(.down))
        let drawn = view.store.line(at: editor.visibleRange.location)
        if drawn != view.rowMap.line(atRow: max(0, row)) || abs(view.top(ofLine: drawn) - (inset + CGFloat(view.rowMap.row(of: drawn)) * height)) > 1 {
            return "row arithmetic puts line \(row) at the top, the view draws line \(drawn) at y \(view.top(ofLine: drawn))"
        }
        if editor.visibleRange.length == 0 { return "no visible characters" }
        let numbers = editor.ruler.shownNumbers
        if numbers.isEmpty { return "the ruler shows no numbers" }
        for (line, numberTop) in numbers where !(editor.ruler.pinnedLines()?.lines.contains(line) ?? false) {
            let y = editor.ruler.convert(NSPoint(x: 0, y: numberTop), to: view).y
            let expected = inset + CGFloat(view.rowMap.row(of: line)) * height
            if abs(y - expected) > 1 { return "the ruler draws \(line + 1) at y \(y), its row is at \(expected)" }
        }
        guard caret else { return nil }
        guard let box = editor.rects(for: NSRange(location: view.selectedRange().location, length: 0)).first,
              visible.insetBy(dx: -1, dy: -1).contains(box)
        else { return "the caret is outside the visible rect" }
        return nil
    }
}
