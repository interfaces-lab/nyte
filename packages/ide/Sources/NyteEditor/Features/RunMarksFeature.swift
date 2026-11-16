import AppKit
import NyteCore
import NyteUI

@MainActor
final class RunMarksFeature: EditorFeature {
    private unowned let editor: EditorViewController
    private var marks: [RunMark] = []

    init(editor: EditorViewController) {
        self.editor = editor
    }

    func documentDidChange() {
        if let ruler = editor.scrollView.verticalRulerView as? LineNumberRuler, ruler.onClickRunMark == nil {
            ruler.runMark = { [weak self] line in self?.mark(on: line)?.kind }
            ruler.onClickRunMark = { [weak self, weak ruler] line, point in
                guard let self, let ruler else { return }
                showMenu(for: line, at: point, in: ruler)
            }
        }
        reload()
    }

    func reload() {
        let next = (editor.url.flatMap { url in editor.runMarks?(url) } ?? []).sorted { $0.line < $1.line }
        guard next != marks else { return }
        marks = next
        editor.scrollView.verticalRulerView?.needsDisplay = true
    }

    func textDidChange(in range: NSRange, delta: Int) {
        let change = editor.lastLineChange
        guard !marks.isEmpty, change.inserted != change.removed else { return }
        marks = marks.compactMap { mark in
            if mark.line > change.line, mark.line <= change.line + change.removed { return nil }
            var moved = mark
            if mark.line > change.line { moved.line += change.inserted - change.removed }
            return moved
        }
    }

    func mark(on line: Int) -> RunMark? {
        var low = 0
        var high = marks.count
        while low < high {
            let middle = (low + high) / 2
            if marks[middle].line < line { low = middle + 1 } else { high = middle }
        }
        return low < marks.count && marks[low].line == line ? marks[low] : nil
    }

    func menu(for line: Int) -> NSMenu? {
        guard let url = editor.url, let mark = mark(on: line) else { return nil }
        return editor.runMarkMenu?(url, mark)
    }

    private func showMenu(for line: Int, at point: NSPoint, in ruler: NSView) {
        menu(for: line)?.popUp(positioning: nil, at: point, in: ruler)
    }
}
