import Foundation
import NyteUI

struct EditSession: Sendable {
    struct Applied: Equatable, Sendable {
        let changes: [TextChange]
        let recorded: EditHistory.Recorded?
    }

    private(set) var store: TextStore
    private(set) var selections: SelectionSet
    private(set) var history = EditHistory()
    var kills = KillRing()
    var context: EditContext

    init(_ store: TextStore, context: EditContext? = nil) {
        self.store = store
        selections = SelectionSet(caret: 0)
        self.context = context ?? EditContext(language: store.language)
    }

    mutating func select(_ set: SelectionSet) {
        let clamped = set.clamped(to: store.length)
        guard clamped != selections else { return }
        selections = clamped
        history.breakCoalescing()
        kills.interrupt()
    }

    @discardableResult
    mutating func apply(_ transaction: TextTransaction, recording: Bool = true) -> Applied {
        guard transaction.changesText else {
            selections = transaction.after.clamped(to: store.length)
            return Applied(changes: [], recorded: nil)
        }
        kills.interrupt()
        let inverse = transaction.inverse(reading: store)
        let changes = transaction.apply(to: &store)
        selections = transaction.after.clamped(to: store.length)
        let recorded = recording ? history.record(transaction, inverse: inverse) : nil
        return Applied(changes: changes, recorded: recorded)
    }

    mutating func breakCoalescing() { history.breakCoalescing() }

    mutating func forgetHistory() { history = EditHistory() }

    mutating func record(_ transaction: TextTransaction, inverse: TextTransaction) -> EditHistory.Recorded {
        history.record(transaction, inverse: inverse)
    }

    mutating func undo() -> [TextChange]? {
        guard let step = history.undo() else { return nil }
        return replay(EditHistory.undoing(step))
    }

    mutating func redo() -> [TextChange]? {
        guard let step = history.redo() else { return nil }
        return replay(EditHistory.redoing(step))
    }

    private mutating func replay(_ transactions: [TextTransaction]) -> [TextChange] {
        var changes: [TextChange] = []
        for transaction in transactions {
            changes += transaction.apply(to: &store)
            selections = transaction.after.clamped(to: store.length)
        }
        kills.interrupt()
        return changes
    }

    mutating func kill(_ deletion: TextCommands.Deletion) -> Applied {
        let transaction = TextCommands.deleting(selections, deletion, in: store, context: context)
        let killed = TextCommands.killedText(transaction, in: store)
        let appends = kills
        let applied = apply(transaction)
        kills = appends
        if !killed.isEmpty { kills.kill(killed, backward: deletion == .toLineStart || deletion == .toParagraphStart) }
        return applied
    }
}
