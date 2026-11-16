import Foundation

extension TextCommands {
    enum Pairing: Equatable {
        case insert
        case insertPair(close: UInt16)
        case stepOver
    }

    private static let closers: [UInt16: UInt16] = [0x28: 0x29, 0x5B: 0x5D, 0x7B: 0x7D]
    private static let quotes: Set<UInt16> = Set("\"'`".utf16)
    private static let closing: Set<UInt16> = Set(")]}".utf16)
    private static let followers: Set<UInt16> = Set(")]},;:. \t\n".utf16)

    static func pairing(typed: [UInt16], at selection: Selection, in store: TextStore) -> Pairing {
        guard typed.count == 1, selection.isEmpty else { return .insert }
        let unit = typed[0]
        let caret = selection.head
        let after: UInt16? = caret < store.length ? store[caret] : nil
        let before: UInt16? = caret > 0 ? store[caret - 1] : nil
        if closing.contains(unit) || quotes.contains(unit), after == unit { return .stepOver }
        let freeAfter = after.map(followers.contains) ?? true
        if let close = closers[unit] { return freeAfter ? .insertPair(close: close) : .insert }
        guard quotes.contains(unit), freeAfter else { return .insert }
        if let before, TextUnits.isIdentifierPart(before) || quotes.contains(before) { return .insert }
        return .insertPair(close: unit)
    }

    static func deletesPair(at selection: Selection, in store: TextStore) -> Bool {
        let caret = selection.head
        guard selection.isEmpty, caret > 0, caret < store.length else { return false }
        let before = store[caret - 1]
        let after = store[caret]
        return closers[before] == after || (quotes.contains(before) && before == after)
    }

    static func typing(_ text: String, _ set: SelectionSet, in store: TextStore, context: EditContext) -> TextTransaction {
        let typed = Array(text.utf16)
        return perSelection(store, set, kind: .typing) { selection in
            let decision = context.pairsBrackets ? pairing(typed: typed, at: selection, in: store) : .insert
            switch decision {
            case .insert: return .caret(after: selection.range, inserting: typed)
            case .insertPair(let close):
                return Piece(range: selection.range, text: typed + [close], anchor: typed.count, head: typed.count)
            case .stepOver:
                return Piece(range: NSRange(location: selection.head, length: 0), text: [], anchor: typed.count, head: typed.count)
            }
        }
    }

    static func inserting(_ texts: [String], _ set: SelectionSet, in store: TextStore, kind: EditKind) -> TextTransaction {
        let order = Dictionary(uniqueKeysWithValues: set.selections.enumerated().map { ($1.lower, $0) })
        return perSelection(store, set, kind: kind) { selection in
            let index = order[selection.lower] ?? 0
            return .caret(after: selection.range, inserting: Array(texts[texts.count == set.count ? index : 0].utf16))
        }
    }

    static func pasting(_ text: String, _ set: SelectionSet, in store: TextStore) -> TextTransaction {
        let lines = text.components(separatedBy: "\n")
        let trimmed = lines.last == "" ? Array(lines.dropLast()) : lines
        let texts = set.hasSeveral && trimmed.count == set.count ? trimmed : [text]
        return inserting(texts, set, in: store, kind: .named("Paste"))
    }

    static func newline(_ set: SelectionSet, in store: TextStore, context: EditContext) -> TextTransaction {
        let unit = Array(context.indent.unit.utf16)
        return perSelection(store, set, kind: .typing) { selection in
            let caret = selection.lower
            let indent = leadingWhitespace(ofLine: store.line(at: caret), upTo: caret, in: store)
            let before: UInt16? = caret > 0 ? store[caret - 1] : nil
            let after: UInt16? = selection.upper < store.length ? store[selection.upper] : nil
            guard context.pairsBrackets, let before, let close = closers[before] else {
                return .caret(after: selection.range, inserting: [newline] + indent)
            }
            let opened = [newline] + indent + unit
            guard after == close else { return .caret(after: selection.range, inserting: opened) }
            return Piece(range: selection.range, text: opened + [newline] + indent, anchor: opened.count, head: opened.count)
        }
    }

    static func tab(_ set: SelectionSet, in store: TextStore, context: EditContext) -> TextTransaction {
        if set.selections.contains(where: { store.line(at: $0.lower) != store.line(at: $0.upper) }) {
            return shiftingLines(set, right: true, in: store, context: context)
        }
        return perSelection(store, set, kind: .typing) { selection in
            guard !context.indent.usesTabs else { return .caret(after: selection.range, inserting: [tab]) }
            let column = selection.lower - store.lineStart(at: selection.lower)
            let width = context.indent.width
            return .caret(after: selection.range, inserting: Array(repeating: space, count: width - column % width))
        }
    }

    static func transposing(_ set: SelectionSet, in store: TextStore) -> TextTransaction {
        perSelection(store, set, kind: .named("Transpose")) { selection in
            guard selection.isEmpty else { return nil }
            let span = store.lineRange(store.line(at: selection.head))
            var caret = selection.head
            guard caret > span.location, span.length >= 2 else { return nil }
            if caret == NSMaxRange(span) { caret = TextUnits.clusterStart(before: caret, in: store) }
            let start = TextUnits.clusterStart(before: caret, in: store)
            let end = TextUnits.clusterEnd(after: caret, in: store)
            guard start >= span.location, end <= NSMaxRange(span) else { return nil }
            let left = store.units(NSRange(location: start, length: caret - start))
            let right = store.units(NSRange(location: caret, length: end - caret))
            return .caret(after: NSRange(location: start, length: end - start), inserting: right + left)
        }
    }
}
