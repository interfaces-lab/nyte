import AppKit
import NyteCore
import NyteUI

@MainActor
final class SignatureFeature: EditorFeature {
    static let callReach = 4000

    private unowned let editor: EditorViewController
    private let panel = FloatingPanel(radius: Radius.card, presentation: .hover)
    private let view = DocumentationView()
    private var isActive = false
    private var isScheduled = false
    private var request: Task<Void, Never>?

    init(editor: EditorViewController) {
        self.editor = editor
        panel.content = view
        panel.onDismiss = { [weak self] in self?.panelDismissed() }
    }

    func documentDidChange() { close() }
    func focusDidLeave() { close() }

    func selectionDidChange() {
        if isActive { schedule() }
    }

    func viewportDidChange() {
        guard isActive, panel.isShown else { return }
        if let rect = editor.caretRect(at: editor.caretRange.location), editor.textView.visibleRect.intersects(rect) {
            schedule()
        } else {
            close()
        }
    }

    func didType(_ text: String) {
        guard !editor.isEditingInPlace, let url = editor.url, let intelligence = editor.intelligence, editor.isAssisted else { return }
        guard isActive || intelligence.triggers(for: url).signature.contains(text) else { return }
        isActive = true
        schedule()
    }

    func canPerform(_ command: EditorCommand) -> Bool {
        command == .showParameterInfo && editor.isAssisted
    }

    func perform(_ command: EditorCommand) -> Bool {
        guard command == .showParameterInfo, editor.isAssisted else { return false }
        isActive = true
        schedule()
        return true
    }

    private func schedule() {
        guard !isScheduled else { return }
        isScheduled = true
        DispatchQueue.main.async { [weak self] in
            self?.isScheduled = false
            self?.ask()
        }
    }

    private func ask() {
        let caret = editor.caretRange
        guard isActive, let url = editor.url, let intelligence = editor.intelligence,
              let position = editor.position(at: caret.location)
        else { return close() }
        let revision = editor.revision
        request?.cancel()
        request = Task { [weak self] in
            let help = await intelligence.signatureHelp(at: position, in: url)
            guard let self, !Task.isCancelled, isActive, editor.revision == revision, editor.caretRange == caret else { return }
            guard let help, help.signatures.indices.contains(help.activeSignature) else { return close() }
            show(help, caret: caret.location)
        }
    }

    private func show(_ help: SignatureHelp, caret: Int) {
        let signature = help.signatures[help.activeSignature]
        let active = help.activeParameter.flatMap { index in
            signature.parameterUTF16Ranges.indices.contains(index) ? signature.parameterUTF16Ranges[index] : nil
        }
        let overload = help.signatures.count > 1 ? "\(help.activeSignature + 1)/\(help.signatures.count)" : ""
        view.language = editor.fenceLanguage
        view.show(signature: signature.label, active: active.map { NSRange(location: $0.lowerBound, length: $0.count) },
                  overload: overload, note: Self.firstLine(of: signature.documentation))
        let shown = editor.shownText
        let paren = Self.openParen(before: caret, in: shown)
        var target = paren ?? caret
        if let paren {
            let start = Identifier.start(before: paren, in: shown)
            let name = shown.substring(with: NSRange(location: start, length: paren - start))
            if !name.isEmpty, signature.label.hasPrefix(name) { target = start }
        }
        guard let rect = editor.caretRect(at: target) else { return close() }
        let lead = DocumentationView.inset + (overload.isEmpty ? 0 : Draw.width(of: overload + "  ", style: .code))
        panel.show(size: view.fittingSize(), anchoredTo: NSRect(x: rect.minX - lead, y: rect.minY, width: 0, height: rect.height),
                   in: editor.textView, prefersAbove: true)
    }

    private static func openParen(before caret: Int, in text: some UnitString) -> Int? {
        var depth = 0
        var index = caret - 1
        let floor = max(0, caret - callReach)
        while index >= floor {
            switch text.character(at: index) {
            case UInt16(UInt8(ascii: ")")), UInt16(UInt8(ascii: "]")), UInt16(UInt8(ascii: "}")): depth += 1
            case UInt16(UInt8(ascii: "(")):
                if depth == 0 { return index }
                depth -= 1
            case UInt16(UInt8(ascii: "[")):
                if depth > 0 { depth -= 1 }
            case UInt16(UInt8(ascii: "{")), UInt16(UInt8(ascii: ";")):
                if depth == 0 { return nil }
                depth -= 1
            default: break
            }
            index -= 1
        }
        return nil
    }

    private static func firstLine(of markdown: String) -> String {
        let paragraph = markdown.components(separatedBy: "\n\n").first { !$0.hasPrefix("```") } ?? ""
        return paragraph.replacingOccurrences(of: "\n", with: " ").replacingOccurrences(of: "`", with: "")
            .trimmingCharacters(in: .whitespaces)
    }

    private func close() {
        request?.cancel()
        isActive = false
        if panel.isShown { panel.dismiss() }
    }

    private func panelDismissed() {
        guard !panel.isShown else { return }
        request?.cancel()
        isActive = false
    }
}
