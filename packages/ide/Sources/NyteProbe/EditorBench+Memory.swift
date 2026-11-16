import AppKit
@testable import NyteEditor
import NyteCore
import NyteUI

extension EditorBench {
    static let memoryFiles = 10
    static let memoryLines = 3_000

    static func memory() async {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-editor-memory", isDirectory: true)
        try? FileManager.default.removeItem(at: folder)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let urls = (0..<memoryFiles).map { index in
            let url = folder.appendingPathComponent("memory\(index).go")
            try? goSource(lines: memoryLines).write(to: url, atomically: true, encoding: .utf8)
            return url
        }
        let editor = EditorViewController(workspace: Workspace(root: folder))
        editor.intelligence = QuietIntelligence()
        kept.append(editor)
        let window = OffscreenWindow(contentRect: pane, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = editor.view
        editor.view.layoutSubtreeIfNeeded()
        flush(window)
        await settleMemory()
        let empty = heapBytes()
        print("with no file: heap \(megabytes(empty)), footprint \(megabytes(residentBytes())) including the window's drawables")
        print("files | heap in use | added by this file | this file's text at 2 bytes per unit plus 9 per line | footprint")
        var previous = empty
        for (index, url) in urls.enumerated() {
            editor.open(url, preview: false)
            while editor.shown?.url != url.standardizedFileURL { await Task.yield() }
            flush(window)
            await settleMemory()
            let now = heapBytes()
            let store = editor.textView.store
            let text = store.length * 2 + store.lineCount * 9
            print(String(format: "%5d | %11@ | %18@ | %51@ | %@", index + 1, megabytes(now) as NSString, megabytes(now - previous) as NSString,
                         megabytes(text) as NSString, megabytes(residentBytes()) as NSString))
            previous = now
        }
        let backing = largestBacking(window.contentView?.layer)
        print("largest drawn layer: \(Int(backing.width)) × \(Int(backing.height)) pt, the visible pane is \(Int(pane.width)) × \(Int(pane.height))")
        if ProcessInfo.processInfo.environment["NYTE_LAYERS"] != nil { printFormats(window.contentView?.layer) }
        print("a document not on screen holds no row layouts: the cache belongs to the one view (\(editor.documents.count) documents)")
        withExtendedLifetime(window) {}
    }

    static func settleMemory() async {
        for _ in 0..<memorySettles {
            CATransaction.flush()
            await Task.yield()
        }
    }

    static let memorySettles = 20

    static func printFormats(_ layer: CALayer?) {
        guard let layer else { return }
        if layer.contents != nil, layer.bounds.width > 400 { print(type(of: layer), layer.delegate.map { "\(type(of: $0))" } ?? "-", layer.contentsFormat.rawValue) }
        (layer.sublayers ?? []).forEach { printFormats($0) }
    }

    static func heapBytes() -> Int {
        var statistics = malloc_statistics_t()
        malloc_zone_statistics(nil, &statistics)
        return statistics.size_in_use
    }

    static func megabytes(_ bytes: Int) -> String { String(format: "%.2f MB", Double(bytes) / 1_048_576) }

    static func largestBacking(_ layer: CALayer?) -> CGSize {
        guard let layer else { return .zero }
        let own = layer.contents == nil || layer.isHidden ? CGSize.zero : layer.bounds.size
        return ((layer.sublayers ?? []).map { largestBacking($0) } + [own]).max { $0.width * $0.height < $1.width * $1.height } ?? own
    }
}
