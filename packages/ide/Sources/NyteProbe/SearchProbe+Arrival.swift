import AppKit
import Darwin
import NyteCore
@testable import NyteSearch
@testable import NyteUI

extension SearchCheck {
    static func synthetic(_ files: [(path: String, order: Int, lines: [String])]) -> SearchResults {
        var results = SearchResults()
        for file in files {
            results.beginFile(file.path, order: file.order)
            for (index, line) in file.lines.enumerated() {
                let slot = Array(line.utf8).withUnsafeBufferPointer { results.addSlot($0, column: 0, byte: index * 100, startsLine: true) }
                results.addMatch(line: index, column: 0, endLine: index, endColumn: min(4, line.utf16.count), bytes: index * 100..<index * 100 + 4,
                                 slot: slot)
            }
        }
        return results
    }

    func arrival() async {
        let releases: [(Int, Bool, Release)] = [(10, true, .wait), (40, true, .outOfOrder), (500, false, .inOrder)]
        for (waited, beyond, want) in releases {
            let got = Release.decide(frontierWaiting: .milliseconds(waited), completedBeyond: beyond)
            expect(got == want, "arrival: after \(waited) ms with \(beyond ? "later files done" : "nothing later") the engine says \(want)")
        }
        let visible = 10..<20
        let placements: [(String, RowSplice, Bool, Placement)] = [
            ("below the view goes in", RowSplice(start: 25, removed: 0, inserted: 3), true, .now),
            ("above the view goes in and keeps the view", RowSplice(start: 5, removed: 0, inserted: 3), true, .nowKeepingView),
            ("at the first visible row keeps the view", RowSplice(start: 10, removed: 0, inserted: 3), true, .nowKeepingView),
            ("inside the view waits while the list is used", RowSplice(start: 12, removed: 0, inserted: 3), true, .hold),
            ("inside the view goes in once the list is idle", RowSplice(start: 12, removed: 0, inserted: 3), false, .now),
            ("a change reaching into the view waits", RowSplice(start: 8, removed: 4, inserted: 5), true, .hold),
        ]
        for (name, change, interacting, want) in placements {
            expect(Placement.decide(change, visible: visible, interacting: interacting) == want, "arrival: \(name)")
        }
        let a = RowIdentity.file(0), b = RowIdentity.file(1), c = RowIdentity.file(2), x = RowIdentity.file(9)
        let splices: [([RowIdentity], [RowIdentity], RowSplice)] = [
            ([a, b, c], [a, x, b, c], RowSplice(start: 1, removed: 0, inserted: 1)), ([a, b], [a, b], RowSplice(start: 2, removed: 0, inserted: 0)),
            ([a, b], [a], RowSplice(start: 1, removed: 1, inserted: 0)),
        ]
        for (old, new, want) in splices { expect(RowSplice.diff(old, new) == want, "arrival: the row splice of \(old.count) to \(new.count) rows") }

        write("stream/a_slow.txt", String(repeating: "lorem ipsum dolor sit amet consectetur\n", count: 200_000) + "late9\n")
        for index in 0..<40 { write(String(format: "stream/b%02d.txt", index), "word9\n") }
        let engine = SearchEngine(root: corpus)
        let started = ContinuousClock.now
        guard let run = try? engine.start(SearchQuery("[a-z]+9", isRegex: true, scope: .folder("stream"))) else {
            return expect(false, "arrival: the slow search starts")
        }
        var arrivals: [(order: Int32, path: String, at: Duration)] = []
        for await event in run.events {
            guard case let .batch(batch, _) = event else { continue }
            for file in 0..<batch.fileCount { arrivals.append((batch.fileOrder[file], batch.paths[file], ContinuousClock.now - started)) }
        }
        let slow = arrivals.first { $0.path == "stream/a_slow.txt" }
        let firstSmall = arrivals.first { $0.path != "stream/a_slow.txt" }
        expect(arrivals.count == 41, "arrival: every file arrives", "\(arrivals.count)")
        if let slow, let firstSmall {
            expect(firstSmall.at + .milliseconds(30) < slow.at && firstSmall.order > slow.order,
                   "arrival: later files are not held behind a slow earlier file", "small at \(firstSmall.at), slow at \(slow.at)")
        } else {
            expect(false, "arrival: later files are not held behind a slow earlier file")
        }
        await noReshuffle()
    }

    private func noReshuffle() async {
        let controller = FindInFilesViewController(workspace: Workspace(root: corpus))
        let size = NSSize(width: 600, height: 340)
        let window = KitProbeWindow(size: size)
        window.place(controller.view, at: .zero, size: size)
        let lines = ["alpha one", "alpha two", "alpha three"]
        let base = stride(from: 0, through: 90, by: 10).map { (path: String(format: "f%03d.txt", $0), order: $0, lines: lines) }
        controller.replaceResults(with: Self.synthetic(base))
        controller.phase = .done(SearchProbeRun.empty)
        controller.render()
        controller.view.layoutSubtreeIfNeeded()
        controller.split.adjustSubviews()
        controller.view.layoutSubtreeIfNeeded()
        window.displayIfNeeded()
        let clip = controller.list.scrollView.contentView
        clip.scroll(to: NSPoint(x: 0, y: controller.list.table.rect(ofRow: 16).minY))
        controller.list.scrollView.reflectScrolledClipView(clip)
        controller.noteInteraction()
        func seen() -> [String] {
            controller.list.visibleRows.map { row in
                let content = controller.row(row)
                return content.title + ":" + content.meta
            }
        }
        func deliver(_ order: Int) {
            controller.appendResults(Self.synthetic([(path: String(format: "f%03d.txt", order), order: order, lines: lines)]))
            controller.placeUnplaced()
        }
        let before = seen()
        expect(before.count >= 6 && controller.list.visibleRows.lowerBound >= 10, "no reshuffle: the list shows rows from the middle",
               "\(controller.list.visibleRows)")
        deliver(15)
        expect(seen() == before && controller.displayFiles.count == 11, "no reshuffle: a file landing above the view keeps every visible row in place",
               "\(before.prefix(3)) → \(seen().prefix(3))")
        let inside = controller.list.visibleRows.dropFirst(2).first { controller.rowKind[$0] == .file } ?? 0
        let topOrder = Int(controller.results.fileOrder[Int(controller.rowIndex[inside])]) - 1
        let held = seen()
        deliver(topOrder + 1)
        expect(seen() == held && controller.unplaced.count == 1, "no reshuffle: a file landing inside the view waits while the list is in use",
               "\(controller.unplaced.count) waiting")
        deliver(999)
        expect(seen() == held && controller.displayFiles.contains { controller.results.fileOrder[Int($0)] == 999 },
               "no reshuffle: a file landing below the view goes in at once")
        controller.lastInteraction = .now - .seconds(5)
        controller.placeUnplaced()
        let orders = controller.displayFiles.map { controller.results.fileOrder[Int($0)] }
        expect(controller.unplaced.isEmpty && orders == orders.sorted() && controller.rowKind.count == 13 * 4,
               "no reshuffle: once the list is idle the waiting file goes in and the order is by path", "\(orders)")
        window.orderOut(nil)
    }

    func jumpsStayColoured() {
        let line = "    let value = render(node, at: index) // render"
        let files = (0..<200).map { (path: String(format: "Sources/File%03d.swift", $0), order: $0, lines: Array(repeating: line, count: 500)) }
        let controller = FindInFilesViewController(workspace: Workspace(root: corpus))
        let size = NSSize(width: 700, height: 480)
        let window = KitProbeWindow(size: size)
        window.place(controller.view, at: .zero, size: size)
        controller.replaceResults(with: Self.synthetic(files))
        controller.phase = .done(SearchProbeRun.empty)
        controller.render()
        controller.view.layoutSubtreeIfNeeded()
        window.displayIfNeeded()
        let clip = controller.list.scrollView.contentView
        let rows = controller.rowKind.count
        var frames: [Double] = []
        var plain = 0
        for step in 0..<200 {
            let begin = Double(clock_gettime_nsec_np(CLOCK_THREAD_CPUTIME_ID)) / 1e6
            clip.scroll(to: NSPoint(x: 0, y: controller.list.table.rect(ofRow: (step * 397) % rows).minY))
            controller.list.scrollView.reflectScrolledClipView(clip)
            window.displayIfNeeded()
            frames.append(Double(clock_gettime_nsec_np(CLOCK_THREAD_CPUTIME_ID)) / 1e6 - begin)
            controller.list.table.enumerateAvailableRowViews { view, row in
                guard let cell = view as? RowCell, controller.list.visibleRows.contains(row), controller.rowKind[row] == .match else { return }
                if cell.content.syntax.isEmpty { plain += 1 }
            }
        }
        let p95 = frames.sorted()[frames.count * 95 / 100]
        expect(plain == 0, "jumps: every result line in view is drawn with its colour, never plain first", "\(plain) plain")
        expect(p95 < 16, "jumps: across 100,000 results the main thread spends under a frame at p95", String(format: "p95 %.2f ms CPU", p95))
        window.orderOut(nil)
    }

    func grouping() {
        let lines = ["alpha one", "alpha two"]
        let paths = ["hub/a.go", "hub/b.go", "src/channels/x.go", "src/channels/y.go", "top.go"]
        let results = Self.synthetic(paths.enumerated().map { (path: $1, order: $0, lines: lines) })
        func layout(_ display: [String], closed: Set<String> = []) -> RowLayout {
            let source = display.isEmpty ? results : Self.synthetic(display.enumerated().map { (path: $1, order: $0, lines: lines) })
            return RowLayout.build(RowLayout.Inputs(
                results: source, display: (0..<Int32(source.fileCount)).map { $0 }, fileOpen: Array(repeating: true, count: source.fileCount),
                fileShown: source.fileMatches.map { Int32($0.count) }, dismissed: Array(repeating: false, count: source.matchCount),
                groupsByFolder: true, closedFolders: closed, failures: 0, failuresOpen: false))
        }
        let grouped = layout([])
        expect(grouped.folders.map(\.title) == ["hub/", "src/channels/"] && grouped.folders.map(\.count) == [4, 4],
               "grouping: folders are parents with counts, and a chain of single folders reads src/channels/",
               grouped.folders.map { "\($0.title) \($0.count)" }.joined(separator: ", "))
        let fileDepths = grouped.kind.indices.filter { grouped.kind[$0] == .file }.map { grouped.depth[$0] }
        expect(grouped.kind.first == .folder && fileDepths == [1, 1, 1, 1, 0], "grouping: files sit one level under their folder; a root file stays at the top")
        let closed = layout([], closed: ["src/channels/"])
        expect(closed.kind.count == grouped.kind.count - 6 && closed.folders.count == 2, "grouping: a closed folder hides its files and results")
        let split = layout(paths + ["src/main.go"])
        expect(split.folders.map(\.title) == ["hub/", "src/", "channels/"], "grouping: a folder with its own files is not merged",
               split.folders.map(\.title).joined(separator: ", "))
    }
}
