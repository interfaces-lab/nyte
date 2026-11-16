import Foundation

extension TextCommands {
    enum Deletion: CaseIterable, Sendable {
        case backward, forward, wordBackward, wordForward, subwordBackward, subwordForward
        case toLineStart, toLineEnd, toParagraphStart, toParagraphEnd

        var isKill: Bool {
            switch self {
            case .toLineStart, .toLineEnd, .toParagraphStart, .toParagraphEnd: true
            default: false
            }
        }
    }

    static func deleting(_ set: SelectionSet, _ deletion: Deletion, in store: TextStore, context: EditContext) -> TextTransaction {
        perSelection(store, set, kind: .deletion) { selection in
            if !selection.isEmpty { return .caret(after: selection.range, inserting: []) }
            let caret = selection.head
            let span = deletionSpan(deletion, at: caret, in: store, context: context)
            guard span.length > 0 else { return nil }
            return .caret(after: span, inserting: [])
        }
    }

    static func deletionSpan(_ deletion: Deletion, at caret: Int, in store: TextStore, context: EditContext) -> NSRange {
        let line = store.lineRange(store.line(at: caret))
        let to: Int
        switch deletion {
        case .backward:
            if context.pairsBrackets, deletesPair(at: Selection(caret: caret), in: store) {
                return NSRange(location: caret - 1, length: 2)
            }
            to = TextUnits.clusterStart(before: caret, in: store)
        case .forward: to = TextUnits.clusterEnd(after: caret, in: store)
        case .wordBackward: to = TextUnits.wordStart(before: caret, in: store, rule: context.words)
        case .wordForward: to = TextUnits.wordEnd(after: caret, in: store, rule: context.words)
        case .subwordBackward: to = TextUnits.subwordStart(before: caret, in: store)
        case .subwordForward: to = TextUnits.subwordEnd(after: caret, in: store)
        case .toLineStart, .toParagraphStart: to = caret == line.location ? max(0, caret - 1) : line.location
        case .toLineEnd, .toParagraphEnd: to = caret == NSMaxRange(line) ? min(store.length, caret + 1) : NSMaxRange(line)
        }
        return NSRange(location: min(caret, to), length: abs(to - caret))
    }

    static func killedText(_ transaction: TextTransaction, in store: TextStore) -> [String] {
        transaction.replacements.map { store.string($0.range) }
    }
}

struct KillRing: Equatable, Sendable {
    private(set) var texts: [String] = []
    private var appends = false

    mutating func kill(_ killed: [String], backward: Bool) {
        defer { appends = true }
        guard appends, killed.count == texts.count else {
            texts = killed
            return
        }
        texts = zip(texts, killed).map { backward ? $1 + $0 : $0 + $1 }
    }

    mutating func interrupt() { appends = false }

    func yanking(_ set: SelectionSet, in store: TextStore) -> TextTransaction? {
        guard !texts.isEmpty else { return nil }
        let joined = texts.joined(separator: "\n")
        return TextCommands.inserting(texts.count == set.count ? texts : [joined], set, in: store, kind: .named("Yank"))
    }
}
