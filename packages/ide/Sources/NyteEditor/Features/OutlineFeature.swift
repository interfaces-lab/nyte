import AppKit
import NyteCore
import NyteUI

@MainActor
final class OutlineFeature: EditorFeature {
    private unowned let editor: EditorViewController
    private static let delay: Duration = .milliseconds(400)

    private var symbols: [DocumentSymbol] = []
    private var subtreeEnds: [Int] = []
    private var reported: [SymbolCrumb]?
    private var request: Task<Void, Never>?

    init(editor: EditorViewController) {
        self.editor = editor
    }

    func documentDidChange() {
        request?.cancel()
        symbols.removeAll()
        subtreeEnds.removeAll()
        editor.outline = ([], [])
        report()
        refresh(after: .zero)
    }

    func textDidChange(in range: NSRange, delta: Int) {
        refresh(after: Self.delay)
    }

    func selectionDidChange() {
        report()
    }

    func intelligenceDidReport(_ event: IntelligenceEvent) {
        switch event {
        case let .diagnostics(url) where url.standardizedFileURL == editor.url && symbols.isEmpty: refresh(after: .zero)
        case let .status(status) where status.state == .ready: refresh(after: .zero)
        default: break
        }
    }

    private func refresh(after delay: Duration) {
        request?.cancel()
        guard let url = editor.url, let intelligence = editor.intelligence, intelligence.handles(url) else { return }
        request = Task { [weak self] in
            if delay > .zero { try? await Task.sleep(for: delay) }
            guard !Task.isCancelled, let self else { return }
            let revision = editor.revision
            let answer = await intelligence.symbols(in: url)
            guard !Task.isCancelled, editor.url == url, editor.revision == revision else { return }
            accept(answer)
        }
    }

    private func accept(_ answer: [DocumentSymbol]) {
        defer { editor.outline = (symbols, subtreeEnds) }
        symbols = answer
        subtreeEnds = Array(repeating: answer.count, count: answer.count)
        var open: [Int] = []
        for index in answer.indices {
            while let last = open.last, answer[last].depth >= answer[index].depth {
                subtreeEnds[last] = index
                open.removeLast()
            }
            open.append(index)
        }
        report()
    }

    private func report() {
        var chain: [SymbolCrumb] = []
        if editor.url != nil, let position = editor.position(at: editor.textView.selectedRange().location) {
            var index = 0
            while index < symbols.count {
                let range = symbols[index].range
                if range.start <= position, position <= range.end {
                    chain.append(SymbolCrumb(name: symbols[index].name, kind: symbols[index].kind, selection: symbols[index].selection))
                    index += 1
                } else {
                    index = subtreeEnds[index]
                }
            }
        }
        guard chain != reported else { return }
        reported = chain
        editor.onSymbolPathChange?(chain)
    }
}
