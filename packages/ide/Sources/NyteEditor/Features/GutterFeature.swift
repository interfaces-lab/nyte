import AppKit
import NyteCore
import NyteUI

@MainActor
final class GutterFeature: EditorFeature {
    private unowned let editor: EditorViewController
    private static let breakpointWash = Palette.color(.fillTertiary, tone: .danger)
    private static let executionWash = Palette.color(.fillSecondary, tone: .primary)

    init(editor: EditorViewController) {
        self.editor = editor
    }

    func documentDidChange() {
        guard let ruler = editor.scrollView.verticalRulerView as? LineNumberRuler, ruler.onClickLine == nil else { return }
        ruler.breakpoints = { [weak editor] in editor.flatMap { editor in editor.url.flatMap { editor.breakpoints?($0) } } ?? [] }
        ruler.executionLine = { [weak self] in self?.executionLine }
        ruler.onBreakpointMenu = { [weak editor] line in
            guard let editor, let url = editor.url else { return nil }
            return editor.breakpointMenu?(url, line)
        }
        ruler.onClickLine = { [weak editor] line in
            guard let editor, let url = editor.url else { return }
            editor.onToggleBreakpoint?(url, line)
        }
    }

    func drawUnderText(in rect: NSRect) {
        guard let url = editor.url, let lines = editor.lineIndex else { return }
        let visible = editor.visibleRange
        let first = lines.line(at: visible.location)
        let last = lines.line(at: NSMaxRange(visible))
        let execution = executionLine
        for breakpoint in editor.breakpoints?(url) ?? [] where breakpoint.isEnabled && breakpoint.zeroBasedLine != execution {
            guard breakpoint.zeroBasedLine >= first, breakpoint.zeroBasedLine <= last else { continue }
            wash(line: breakpoint.zeroBasedLine, in: rect, color: Self.breakpointWash)
        }
        if let execution, execution >= first, execution <= last { wash(line: execution, in: rect, color: Self.executionWash) }
    }

    func canPerform(_ command: EditorCommand) -> Bool {
        command == .toggleBreakpoint && editor.url != nil && editor.onToggleBreakpoint != nil
    }

    func perform(_ command: EditorCommand) -> Bool {
        guard canPerform(command), let url = editor.url, let lines = editor.lineIndex else { return false }
        editor.onToggleBreakpoint?(url, lines.line(at: editor.textView.selectedRange().location))
        return true
    }

    private var executionLine: Int? {
        guard let point = editor.executionPoint, let url = editor.url, point.url.standardizedFileURL == url else { return nil }
        return point.range.start.line
    }

    private func wash(line: Int, in rect: NSRect, color: NSColor) {
        guard let start = editor.lineIndex?.start(of: line),
              let caret = editor.rects(for: NSRange(location: start, length: 0)).first
        else { return }
        let band = NSRect(x: editor.textView.bounds.minX, y: caret.minY, width: editor.textView.bounds.width, height: caret.height)
        guard band.intersects(rect) else { return }
        color.setFill()
        band.intersection(rect).fill(using: .sourceOver)
    }
}
