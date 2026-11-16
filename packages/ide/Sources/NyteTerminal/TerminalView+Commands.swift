import AppKit
import NyteUI

extension TerminalView: NSMenuItemValidation, NSUserInterfaceValidations {
    func reply<Value: Sendable>(_ body: @escaping @Sendable @MainActor (TerminalView, Value) -> Void) -> @Sendable (Value) -> Void {
        let generation = generation
        return { [weak self] value in
            DispatchQueue.main.async {
                guard let self, self.generation == generation, self.session != nil else { return }
                body(self, value)
            }
        }
    }

    @objc func copy(_ sender: Any?) {
        let copied = reply { (view: TerminalView, text: String?) in
            guard let text, !text.isEmpty else { return }
            view.pasteboard.clearContents()
            view.pasteboard.setString(text, forType: .string)
        }
        session?.enqueue { $0.copySelection(reply: copied) }
    }

    @objc func paste(_ sender: Any?) {
        guard !isExited, let text = pasteboard.string(forType: .string), !text.isEmpty else { return }
        let pasted = reply { (view: TerminalView, outcome: PasteOutcome) in
            if outcome == .needsConfirmation { view.confirmPaste(text) }
        }
        session?.enqueue { $0.paste(text, confirmed: false, reply: pasted) }
    }

    @objc override func selectAll(_ sender: Any?) {
        session?.enqueue { $0.selectAll() }
    }

    @objc func clearTerminal(_ sender: Any?) {
        session?.enqueue { $0.clearScreen() }
    }

    @objc func askNyte(_ sender: Any?) { onAskAgent?() }

    var hasSelectedText: Bool { selectionTextCache != nil || hasSelection }

    override func menu(for event: NSEvent) -> NSMenu? {
        var items = [
            MenuItem("Copy", enabled: hasSelectedText) { [weak self] in self?.copy(nil) },
            MenuItem("Paste", enabled: canPaste) { [weak self] in self?.paste(nil) },
            MenuItem("Select All", enabled: session != nil) { [weak self] in self?.selectAll(nil) },
            .separator,
            MenuItem("Clear", enabled: session != nil && !isExited) { [weak self] in self?.clearTerminal(nil) },
        ]
        if onAskAgent != nil {
            items += [.separator, MenuItem("Ask Nyte", enabled: hasSelectedText) { [weak self] in self?.askNyte(nil) }]
        }
        return Menu.make(items)
    }

    private var canPaste: Bool { session != nil && !isExited && pasteboard.availableType(from: [.string]) != nil }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        validateUserInterfaceItem(item)
    }

    func validateUserInterfaceItem(_ item: any NSValidatedUserInterfaceItem) -> Bool {
        switch item.action {
        case #selector(copy(_:)): hasSelectedText
        case #selector(paste(_:)): canPaste
        case #selector(askNyte(_:)): onAskAgent != nil && hasSelectedText
        case #selector(selectAll(_:)): session != nil
        case #selector(clearTerminal(_:)): session != nil && !isExited
        default: false
        }
    }

    private func confirmPaste(_ text: String) {
        guard let window else { return }
        var lines = text.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline).count
        if text.last?.isNewline == true { lines -= 1 }
        lines = max(lines, 1)
        let alert = NSAlert()
        alert.messageText = lines == 1 ? "Paste 1 line into the terminal?" : "Paste \(lines) lines into the terminal?"
        alert.informativeText = "The text contains line breaks or control characters, so the shell may run it as soon as it arrives."
        alert.addButton(withTitle: "Paste")
        alert.addButton(withTitle: "Cancel")
        let generation = generation
        alert.beginSheetModal(for: window) { [weak self] response in
            guard let self, self.generation == generation, response == .alertFirstButtonReturn else { return }
            self.session?.enqueue { $0.paste(text, confirmed: true) { _ in } }
        }
    }
}
