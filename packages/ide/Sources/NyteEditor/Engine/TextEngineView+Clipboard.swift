import AppKit
import NyteUI

extension TextEngineView: @MainActor NSServicesMenuRequestor {
    static let longestRichCopy = 1_000_000

    var selectedText: String {
        selections.selections.filter { !$0.isEmpty }.map { store.string($0.range) }.joined(separator: "\n")
    }

    @objc func copy(_ sender: Any?) {
        let text = selectedText
        guard !text.isEmpty else { return }
        let board = NSPasteboard.general
        board.clearContents()
        write(text, to: board)
    }

    @objc func cut(_ sender: Any?) {
        guard isEditable else { return }
        copy(sender)
        perform(TextCommands.inserting([""], SelectionSet(selections.selections.filter { !$0.isEmpty }, primary: 0), in: store,
                                       kind: .named("Cut")))
    }

    @objc func delete(_ sender: Any?) {
        perform(TextCommands.inserting([""], selections, in: store, kind: .named("Delete")))
    }

    @objc func paste(_ sender: Any?) {
        guard isEditable, let text = NSPasteboard.general.string(forType: .string) else { return }
        breakUndoCoalescing()
        perform(TextCommands.pasting(text, selections, in: store))
    }

    @objc func pasteAsPlainText(_ sender: Any?) { paste(sender) }

    private func write(_ text: String, to board: NSPasteboard) {
        let total = selections.selections.reduce(0) { $0 + $1.range.length }
        board.declareTypes(total <= Self.longestRichCopy ? [.string, .rtf] : [.string], owner: nil)
        board.setString(text, forType: .string)
        guard total <= Self.longestRichCopy else { return }
        let rich = richText(for: selections.selections.filter { !$0.isEmpty }.map(\.range))
        if let data = rich.rtf(from: NSRange(location: 0, length: rich.length), documentAttributes: [:]) { board.setData(data, forType: .rtf) }
    }

    func richText(for ranges: [NSRange]) -> NSAttributedString {
        let out = NSMutableAttributedString()
        effectiveAppearance.performAsCurrentDrawingAppearance {
            for (index, range) in ranges.enumerated() {
                if index > 0 { out.append(NSAttributedString(string: "\n", attributes: [.font: metrics.font])) }
                out.append(colouredText(range))
            }
        }
        return out
    }

    private func colouredText(_ range: NSRange) -> NSAttributedString {
        let text = NSMutableAttributedString(string: store.string(range), attributes: [
            .font: metrics.font, .foregroundColor: Palette.contentPrimary.usingColorSpace(.sRGB) ?? Palette.contentPrimary,
        ])
        guard store.language.family != .plain else { return text }
        var tokens: [UInt64] = []
        for line in store.line(at: range.location)...store.line(at: NSMaxRange(range)) {
            let span = store.lineRange(line)
            guard span.length <= TextStore.longestLexedLine else { continue }
            store.buffer.withUnits(span) { units in
                _ = Lexer.line(units, state: store.lines.entryState(of: line), language: store.language, offset: span.location,
                               tokens: &tokens, emit: true)
            }
        }
        for token in tokens where Token.kind(token) != .plain {
            let local = NSIntersectionRange(Token.range(token), range)
            guard local.length > 0 else { continue }
            let color = Token.kind(token).color
            text.addAttribute(.foregroundColor, value: color.usingColorSpace(.sRGB) ?? color,
                              range: NSRange(location: local.location - range.location, length: local.length))
        }
        return text
    }

    override func validRequestor(forSendType sendType: NSPasteboard.PasteboardType?,
                                 returnType: NSPasteboard.PasteboardType?) -> Any? {
        let sends = sendType == nil || (sendType == .string && !selectedText.isEmpty)
        let returns = returnType == nil || (returnType == .string && isEditable)
        guard sends, returns, sendType != nil || returnType != nil else { return super.validRequestor(forSendType: sendType, returnType: returnType) }
        return self
    }

    func writeSelection(to pboard: NSPasteboard, types: [NSPasteboard.PasteboardType]) -> Bool {
        let text = selectedText
        guard types.contains(.string), !text.isEmpty else { return false }
        pboard.declareTypes([.string], owner: nil)
        return pboard.setString(text, forType: .string)
    }

    func readSelection(from pboard: NSPasteboard) -> Bool {
        guard isEditable, let text = pboard.string(forType: .string) else { return false }
        perform(TextCommands.inserting([text], selections, in: store, kind: .named("Replace")))
        return true
    }

    override func quickLook(with event: NSEvent) {
        let offset = offset(at: convert(event.locationInWindow, from: nil))
        lookUp(at: offset)
    }

    func lookUp(at offset: Int) {
        let primary = selections.primarySelection
        let range = !primary.isEmpty && NSLocationInRange(offset, primary.range) ? primary.range
            : TextUnits.word(at: offset, in: store, rule: .natural)
        guard let range, range.length > 0 else { return }
        let word = NSAttributedString(string: store.string(range), attributes: [.font: metrics.font])
        let line = store.line(at: range.location)
        showDefinition(for: word, at: NSPoint(x: x(of: range.location), y: top(ofLine: line) + metrics.baseline))
    }
}
