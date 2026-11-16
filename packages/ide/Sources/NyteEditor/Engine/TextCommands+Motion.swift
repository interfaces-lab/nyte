import Foundation

extension TextCommands {
    enum Motion: CaseIterable, Sendable {
        case left, right, wordLeft, wordRight, subwordLeft, subwordRight
        case lineStart, lineEnd, paragraphBackward, paragraphForward
        case up, down, pageUp, pageDown, documentStart, documentEnd

        var isBackward: Bool {
            switch self {
            case .left, .wordLeft, .subwordLeft, .lineStart, .paragraphBackward, .up, .pageUp, .documentStart: true
            default: false
            }
        }

        var isVertical: Bool { self == .up || self == .down || self == .pageUp || self == .pageDown }
    }

    static func moved(_ set: SelectionSet, _ motion: Motion, extending: Bool, in store: TextStore, context: EditContext,
                      measure: ColumnMeasure) -> SelectionSet {
        set.mapping { selection in
            if !extending, !selection.isEmpty, motion == .left || motion == .right {
                return Selection(caret: motion == .left ? selection.lower : selection.upper)
            }
            let from = extending ? selection.head : (motion.isBackward ? selection.lower : selection.upper)
            let goal = motion.isVertical ? selection.goal ?? measure.x(store.line(at: from), from - store.lineStart(at: from)) : nil
            let to = target(motion, from: from, goal: goal, in: store, context: context, measure: measure)
            return Selection(anchor: extending ? selection.anchor : to, head: to, goal: goal)
        }
    }

    static func target(_ motion: Motion, from offset: Int, goal: CGFloat?, in store: TextStore, context: EditContext,
                       measure: ColumnMeasure) -> Int {
        switch motion {
        case .left: return TextUnits.clusterStart(before: offset, in: store)
        case .right: return TextUnits.clusterEnd(after: offset, in: store)
        case .wordLeft: return TextUnits.wordStart(before: offset, in: store, rule: context.words)
        case .wordRight: return TextUnits.wordEnd(after: offset, in: store, rule: context.words)
        case .subwordLeft: return TextUnits.subwordStart(before: offset, in: store)
        case .subwordRight: return TextUnits.subwordEnd(after: offset, in: store)
        case .lineStart: return store.lineStart(at: offset)
        case .lineEnd: return store.lineEnd(at: offset)
        case .paragraphBackward:
            let line = store.line(at: offset)
            let start = store.lineRange(line).location
            return offset > start || line == 0 ? start : store.lineRange(line - 1).location
        case .paragraphForward:
            let line = store.line(at: offset)
            let end = NSMaxRange(store.lineRange(line))
            return offset < end || line + 1 >= store.lineCount ? end : NSMaxRange(store.lineRange(line + 1))
        case .documentStart: return 0
        case .documentEnd: return store.length
        case .up, .down, .pageUp, .pageDown:
            let rows = motion == .pageUp || motion == .pageDown ? max(1, measure.pageRows) : 1
            guard let line = measure.step(store.line(at: offset), motion.isBackward ? -rows : rows) else {
                return motion.isBackward ? 0 : store.length
            }
            let span = store.lineRange(line)
            return span.location + min(span.length, measure.column(line, goal ?? 0))
        }
    }

    static func column(from start: (line: Int, x: CGFloat), to end: (line: Int, x: CGFloat), in store: TextStore,
                       measure: ColumnMeasure) -> SelectionSet {
        let lines = min(start.line, end.line)...max(start.line, end.line)
        let selections = lines.map { line -> Selection in
            let span = store.lineRange(line)
            let anchor = span.location + min(span.length, measure.column(line, start.x))
            let head = span.location + min(span.length, measure.column(line, end.x))
            return Selection(anchor: anchor, head: head, goal: end.x)
        }
        return SelectionSet(selections, primary: end.line < start.line ? 0 : selections.count - 1)
    }

    static func addingCaret(to set: SelectionSet, below: Bool, in store: TextStore, measure: ColumnMeasure) -> SelectionSet? {
        let edge = below ? set.selections[set.count - 1] : set.selections[0]
        guard let line = measure.step(store.line(at: edge.head), below ? 1 : -1) else { return nil }
        let goal = edge.goal ?? measure.x(store.line(at: edge.head), edge.head - store.lineStart(at: edge.head))
        let span = store.lineRange(line)
        return set.adding(Selection(caret: span.location + min(span.length, measure.column(line, goal)), goal: goal))
    }

    static func addingNextOccurrence(to set: SelectionSet, in store: TextStore, context: EditContext) -> SelectionSet? {
        let current = set.primarySelection
        if current.isEmpty {
            guard let word = TextUnits.word(at: current.head, in: store, rule: .identifier) else { return nil }
            var selections = set.selections
            selections[set.primary] = Selection(anchor: word.location, head: NSMaxRange(word))
            return SelectionSet(selections, primary: set.primary)
        }
        let needle = store.units(current.range)
        let last = set.selections[set.count - 1].upper
        guard let found = TextSearch.next(needle, in: store, from: last) ?? TextSearch.next(needle, in: store, from: 0),
              !set.selections.contains(where: { $0.range == found })
        else { return nil }
        return set.adding(Selection(anchor: found.location, head: NSMaxRange(found)))
    }

    static func selectingAllOccurrences(of set: SelectionSet, in store: TextStore) -> SelectionSet? {
        let current = set.primarySelection
        let range = current.isEmpty ? TextUnits.word(at: current.head, in: store, rule: .identifier) : current.range
        guard let range else { return nil }
        let needle = store.units(range)
        var found: [Selection] = []
        var from = 0
        while let hit = TextSearch.next(needle, in: store, from: from) {
            found.append(Selection(anchor: hit.location, head: NSMaxRange(hit)))
            from = NSMaxRange(hit)
        }
        let primary = found.firstIndex { $0.lower == range.location } ?? 0
        return found.isEmpty ? nil : SelectionSet(found, primary: primary)
    }

    static func selectingLines(_ set: SelectionSet, in store: TextStore) -> SelectionSet {
        set.mapping { selection in
            let first = store.line(at: selection.lower)
            let last = store.line(at: selection.upper)
            let end = last + 1 < store.lineCount ? store.lineRange(last + 1).location : store.length
            return Selection(anchor: store.lineRange(first).location, head: end)
        }
    }

    static func selectingWords(_ set: SelectionSet, in store: TextStore, context: EditContext) -> SelectionSet {
        set.mapping { selection in
            guard let word = TextUnits.word(at: selection.head, in: store, rule: context.words) else { return selection }
            return Selection(anchor: min(word.location, selection.lower), head: max(NSMaxRange(word), selection.upper))
        }
    }
}

enum TextSearch {
    static func next(_ needle: [UInt16], in store: TextStore, from start: Int) -> NSRange? {
        guard let first = needle.first, start <= store.length - needle.count else { return nil }
        let buffer = store.buffer
        var slot = buffer.chunk(containing: min(start, max(0, store.length - 1)))
        while slot < buffer.chunks.count {
            let base = buffer.start(ofChunk: slot)
            let chunk = buffer.chunks[slot]
            var local = max(0, start - base)
            while local < chunk.count, let hit = chunk[local...].firstIndex(of: first) {
                let location = base + hit
                if location + needle.count > store.length { return nil }
                if buffer.withUnits(NSRange(location: location, length: needle.count), { $0.elementsEqual(needle) }) {
                    return NSRange(location: location, length: needle.count)
                }
                local = hit + 1
            }
            slot += 1
        }
        return nil
    }
}
