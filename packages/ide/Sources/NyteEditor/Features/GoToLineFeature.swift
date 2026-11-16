import AppKit
import NyteCore
import NyteUI

@MainActor
final class GoToLineFeature: EditorFeature {
    private unowned let editor: EditorViewController
    private let panel = FloatingPanel(radius: PromptView.radius, takesKey: true)
    private let prompt = PromptView(placeholder: "Line or line:column", monospace: true)

    init(editor: EditorViewController) {
        self.editor = editor
        panel.content = prompt
        prompt.setAccessibilityLabel("Go to Line")
        prompt.input.onSubmit = { [weak self] in self?.submit($0) }
        prompt.input.onChange = { [weak self] _ in self?.clearMessage() }
        panel.onDismiss = { [weak self] in self?.dismissed() }
    }

    func documentDidChange() {
        if panel.isShown { panel.dismiss() }
    }

    func show() {
        guard let window = editor.textView.window, let lines = editor.lineIndex else { return }
        let caret = lines.position(at: editor.caretRange.location)
        prompt.message = ""
        prompt.input.stringValue = "\(caret.line + 1):\(caret.column + 1)"
        panel.show(size: prompt.fittingSize(for: prompt.input.stringValue), centredIn: window)
        panel.window.makeFirstResponder(prompt.input.field)
        prompt.input.field.currentEditor()?.selectAll(nil)
    }

    private func submit(_ input: String) {
        guard let lines = editor.lineIndex else { return }
        guard let target = GoToLine.parse(input) else { return complain("Type a line number, or line:column.") }
        guard target.line < lines.count else { return complain("This file has \(lines.count) lines.") }
        panel.dismiss()
        editor.select(TextSpan(at: target))
    }

    private func complain(_ message: String) {
        prompt.message = message
        panel.resize(to: prompt.fittingSize(for: prompt.input.stringValue))
    }

    private func clearMessage() {
        guard !prompt.message.isEmpty else { return }
        prompt.message = ""
        panel.resize(to: prompt.fittingSize(for: prompt.input.stringValue))
    }

    private func dismissed() {
        guard !panel.isShown, let window = editor.textView.window, NSApp.isActive else { return }
        window.makeKey()
        window.makeFirstResponder(editor.textView)
    }
}
