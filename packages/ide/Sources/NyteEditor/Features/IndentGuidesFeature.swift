import AppKit
import NyteCore
import NyteUI

@MainActor
final class IndentGuidesFeature: EditorFeature {
    private unowned let editor: EditorViewController
    private var depths: [Int] = []
    private var caretLine: Int?

    init(editor: EditorViewController) {
        self.editor = editor
    }

    func selectionDidChange() {
        let line = editor.lineIndex?.line(at: editor.caretRange.location)
        guard line != caretLine else { return }
        caretLine = line
        editor.textView.needsDisplay = true
    }

    func drawUnderText(in rect: NSRect) {
        guard editor.preferences.showsIndentGuides, let lines = editor.lineIndex, editor.url != nil else { return }
        let text = editor.shownText
        let visible = editor.visibleRange
        let first = lines.line(at: visible.location)
        let last = lines.line(at: NSMaxRange(visible))
        let width = max(1, editor.textView.indent.width)
        IndentGuides.columns(lines: first...last, tabWidth: FileIO.tabColumns, into: &depths) { line in
            lines.range(of: line, length: text.length)
        } character: { text.character(at: $0) }
        let caretLine = lines.line(at: editor.caretRange.location)
        let scope = IndentGuides.scope(of: caretLine - first, depths: depths, step: width)
        let origin = editor.textView.textOrigin
        for line in first...last {
            let slot = line - first
            let depth = depths[slot]
            let view = editor.textView
            guard depth > 0, !view.rowMap.folds.isHidden(line) else { continue }
            let box = NSRect(x: 0, y: view.top(ofLine: line), width: 0, height: view.metrics.lineHeight)
            guard box.maxY >= rect.minY, box.minY <= rect.maxY else { continue }
            var column = 0
            while column < depth {
                let strong = scope.map { $0.column == column && $0.lines.contains(slot) } ?? false
                let x = origin.x + CGFloat(column) * editor.textView.metrics.advance
                (strong ? Palette.strokeTertiary : Palette.strokeQuaternary).setFill()
                NSRect(x: x, y: box.minY, width: Metric.hairline, height: box.height).fill()
                column += width
            }
        }
    }
}

enum IndentGuides {
    static let blank = -1

    static func columns(lines: ClosedRange<Int>, tabWidth: Int, into depths: inout [Int],
                        range: (Int) -> NSRange, character: (Int) -> UInt16) {
        depths.removeAll(keepingCapacity: true)
        for line in lines {
            let span = range(line)
            var columns = 0
            var index = span.location
            var isBlank = true
            while index < NSMaxRange(span) {
                let unit = character(index)
                if unit == UInt16(UInt8(ascii: " ")) {
                    columns += 1
                } else if unit == UInt16(UInt8(ascii: "\t")) {
                    columns += tabWidth - columns % tabWidth
                } else {
                    isBlank = false
                    break
                }
                index += 1
            }
            depths.append(isBlank ? blank : columns)
        }
        fillBlanks(&depths)
    }

    static func fillBlanks(_ depths: inout [Int]) {
        var previous = 0
        var index = 0
        while index < depths.count {
            guard depths[index] == blank else {
                previous = depths[index]
                index += 1
                continue
            }
            var next = index
            while next < depths.count, depths[next] == blank { next += 1 }
            let following = next < depths.count ? depths[next] : previous
            for slot in index..<next { depths[slot] = min(previous, following) }
            index = next
        }
    }

    static func scope(of slot: Int, depths: [Int], step: Int) -> (column: Int, lines: ClosedRange<Int>)? {
        guard depths.indices.contains(slot), depths[slot] >= step else { return nil }
        let column = (depths[slot] - 1) / step * step
        var low = slot
        var high = slot
        while low > 0, depths[low - 1] > column { low -= 1 }
        while high + 1 < depths.count, depths[high + 1] > column { high += 1 }
        return (column, low...high)
    }
}
