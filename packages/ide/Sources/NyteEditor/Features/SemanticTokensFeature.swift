import AppKit
import NyteCore
import NyteUI

@MainActor
final class SemanticTokensFeature: EditorFeature {
    private unowned let editor: EditorViewController
    private static let delay: Duration = .milliseconds(300)
    private static let editLimit = 512
    private static let cacheLimit = 8
    private static let inks = SyntaxColor.allCases.map(\.color)
    private static let semanticTypes = TokenKind.allCases.map { SyntaxColor.SemanticType(rawValue: "\($0)") }

    private var tokens = SemanticTokens()
    private var lineCount = 0
    private var editLines: [Int] = []
    private var editColumns: [Int] = []
    private var editRemoved: [Int] = []
    private var editInserted: [Int] = []
    private var cacheURLs: [URL] = []
    private var cacheRevisions: [Int] = []
    private var cacheTokens: [SemanticTokens] = []
    private var request: Task<Void, Never>?

    init(editor: EditorViewController) {
        self.editor = editor
    }

    func documentDidChange() {
        request?.cancel()
        clearEdits()
        lineCount = editor.lineIndex?.count ?? 0
        guard let url = editor.url else {
            tokens = SemanticTokens()
            return
        }
        if let slot = cacheURLs.firstIndex(of: url), cacheRevisions[slot] == editor.revision {
            tokens = cacheTokens[slot]
            editor.repaint()
        } else {
            tokens = SemanticTokens()
        }
        refresh(after: .zero)
    }

    func intelligenceDidReport(_ event: IntelligenceEvent) {
        switch event {
        case let .diagnostics(url) where url.standardizedFileURL == editor.url: refresh(after: Self.delay)
        case let .status(status) where status.state == .ready: refresh(after: Self.delay)
        default: break
        }
    }

    func textDidChange(in range: NSRange, delta: Int) {
        guard let lines = editor.lineIndex else { return }
        let change = editor.lastLineChange
        lineCount = lines.count
        if tokens.count > 0 {
            let position = lines.position(at: range.location)
            editLines.append(position.line)
            editColumns.append(position.column)
            editRemoved.append(change.removed)
            editInserted.append(change.inserted)
            if editLines.count > Self.editLimit {
                tokens = SemanticTokens()
                clearEdits()
            }
        }
        refresh(after: Self.delay)
    }

    func colourRuns(forLine line: Int) -> [(range: NSRange, color: NSColor)] {
        guard tokens.count > 0, let (old, limit) = lineBeforeEdits(line) else { return [] }
        let length = editor.shownStore.lineRange(line).length
        return tokens.indices(onLines: old, through: old).compactMap { index in
            let column = Int(tokens.columns[index])
            let end = column + Int(tokens.lengths[index])
            guard end <= limit, end <= length, let color = Self.color(tokens.kinds[index], tokens.modifiers[index]) else { return nil }
            return (NSRange(location: column, length: end - column), Self.inks[Int(color.rawValue)])
        }
    }

    static func color(_ kind: TokenKind, _ modifiers: TokenModifiers) -> SyntaxColor? {
        semanticTypes[Int(kind.rawValue)].flatMap { SyntaxColor.semantic($0, SyntaxColor.SemanticModifiers(rawValue: modifiers.rawValue)) }
    }

    private func lineBeforeEdits(_ line: Int) -> (line: Int, limit: Int)? {
        var line = line
        var limit = Int.max
        for edit in editLines.indices.reversed() {
            let first = editLines[edit]
            if line < first { continue }
            if line == first {
                limit = min(limit, editColumns[edit])
                continue
            }
            if line <= first + editInserted[edit] { return nil }
            line += editRemoved[edit] - editInserted[edit]
        }
        return (line, limit)
    }

    private func refresh(after delay: Duration) {
        request?.cancel()
        guard let url = editor.url, let intelligence = editor.intelligence, intelligence.handles(url) else { return }
        request = Task { [weak self] in
            if delay > .zero { try? await Task.sleep(for: delay) }
            guard !Task.isCancelled, let revision = self?.editor.revision else { return }
            let answer = await intelligence.semanticTokens(for: url)
            guard let self, !Task.isCancelled, let answer, editor.url == url, editor.revision == revision else { return }
            accept(answer, for: url, revision: revision)
        }
    }

    private func accept(_ answer: SemanticTokens, for url: URL, revision: Int) {
        let unchanged = editLines.isEmpty && answer == tokens
        tokens = answer
        clearEdits()
        if let slot = cacheURLs.firstIndex(of: url) {
            cacheURLs.remove(at: slot)
            cacheRevisions.remove(at: slot)
            cacheTokens.remove(at: slot)
        }
        cacheURLs.insert(url, at: 0)
        cacheRevisions.insert(revision, at: 0)
        cacheTokens.insert(answer, at: 0)
        if cacheURLs.count > Self.cacheLimit {
            cacheURLs.removeLast()
            cacheRevisions.removeLast()
            cacheTokens.removeLast()
        }
        if !unchanged { editor.repaint() }
    }

    private func clearEdits() {
        editLines.removeAll(keepingCapacity: true)
        editColumns.removeAll(keepingCapacity: true)
        editRemoved.removeAll(keepingCapacity: true)
        editInserted.removeAll(keepingCapacity: true)
    }
}
