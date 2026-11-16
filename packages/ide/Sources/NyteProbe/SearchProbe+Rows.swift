import AppKit
import Darwin
import NyteCore
@testable import NyteSearch
@testable import NyteUI

extension SearchBench {
    @MainActor static func rows() async {
        await jumpCost()
    }

    @MainActor static func jumpCost() async {
        let application = NSApplication.shared
        application.setActivationPolicy(.prohibited)
        let line = "    let value = render(node, at: index) // render"
        let files = (0..<200).map { (path: String(format: "Sources/File%03d.swift", $0), order: $0, lines: Array(repeating: line, count: 500)) }
        let results = SearchCheck.synthetic(files)
        let size = NSSize(width: 700, height: 480)
        func jumps(_ name: String, _ adjust: (FindInFilesViewController) -> Void) {
            let controller = FindInFilesViewController(workspace: Workspace(root: URL(fileURLWithPath: "/tmp")))
            let window = KitProbeWindow(size: size)
            window.place(controller.view, at: .zero, size: size)
            controller.replaceResults(with: results)
            controller.phase = .done(SearchProbeRun.empty)
            controller.render()
            adjust(controller)
            controller.view.layoutSubtreeIfNeeded()
            window.displayIfNeeded()
            let clip = controller.list.scrollView.contentView
            let rows = controller.rowKind.count
            var frames: [Double] = []
            for step in 0..<300 {
                let begin = Double(clock_gettime_nsec_np(CLOCK_THREAD_CPUTIME_ID)) / 1e6
                clip.scroll(to: NSPoint(x: 0, y: controller.list.table.rect(ofRow: (step * 397) % rows).minY))
                controller.list.scrollView.reflectScrolledClipView(clip)
                window.displayIfNeeded()
                frames.append(Double(clock_gettime_nsec_np(CLOCK_THREAD_CPUTIME_ID)) / 1e6 - begin)
            }
            let sorted = frames.sorted()
            print(String(format: "%@: mean %.2f ms, p95 %.2f ms, max %.2f ms", name, frames.reduce(0, +) / Double(frames.count),
                         sorted[Int(Double(sorted.count) * 0.95)], sorted.last ?? 0))
            window.orderOut(nil)
        }
        var calls = 0
        jumps("jumps across 100,000 results, main-thread CPU a frame") { controller in
            let content = controller.list.content
            controller.list.content = { row in
                calls += 1
                return content(row)
            }
        }
        print("content(_:) calls a jump: \(calls / 300), most of them the pinned header looking for its file row")
        let controller = FindInFilesViewController(workspace: Workspace(root: URL(fileURLWithPath: "/tmp")))
        let window = KitProbeWindow(size: size)
        window.place(controller.view, at: .zero, size: size)
        controller.replaceResults(with: results)
        controller.view.layoutSubtreeIfNeeded()
        let begin = CACurrentMediaTime()
        for row in stride(from: 0, to: controller.rowKind.count, by: 7).prefix(5_000) { _ = controller.row(row) }
        print(String(format: "row(_:) first seen: %.1f µs a row", (CACurrentMediaTime() - begin) * 1e6 / 5_000))
        let again = CACurrentMediaTime()
        for row in stride(from: 0, to: controller.rowKind.count, by: 7).prefix(5_000) { _ = controller.row(row) }
        print(String(format: "row(_:) seen again: %.1f µs a row", (CACurrentMediaTime() - again) * 1e6 / 5_000))
        window.orderOut(nil)
    }
}
