import Foundation

extension TextCommands {
    static func shiftingLines(_ set: SelectionSet, right: Bool, in store: TextStore, context: EditContext) -> TextTransaction {
        let unit = Array(context.indent.unit.utf16)
        var replacements: [TextReplacement] = []
        for block in lineBlocks(store, set, joiningAdjacent: false) {
            for line in block {
                let span = store.lineRange(line)
                if right {
                    if span.length > 0 { replacements.append(TextReplacement(range: NSRange(location: span.location, length: 0), text: unit)) }
                    continue
                }
                let width = leadingIndentWidth(span, in: store, context: context)
                if width > 0 { replacements.append(TextReplacement(range: NSRange(location: span.location, length: width), text: [])) }
            }
        }
        return through(replacements, store, set, kind: .named(right ? "Indent" : "Outdent"))
    }

    private static func leadingIndentWidth(_ span: NSRange, in store: TextStore, context: EditContext) -> Int {
        guard span.length > 0 else { return 0 }
        if store[span.location] == tab { return 1 }
        var width = 0
        while width < context.indent.width, width < span.length, store[span.location + width] == space { width += 1 }
        return width
    }

    static func movingLines(_ set: SelectionSet, up: Bool, in store: TextStore) -> TextTransaction? {
        let blocks = lineBlocks(store, set, joiningAdjacent: true)
        guard let first = blocks.first, let last = blocks.last else { return nil }
        if up ? first.lowerBound == 0 : last.upperBound + 1 >= store.lineCount { return nil }
        var replacements: [TextReplacement] = []
        var shifts: [(range: ClosedRange<Int>, delta: Int)] = []
        for block in blocks {
            let start = store.lineRange(block.lowerBound).location
            let end = NSMaxRange(store.lineRange(block.upperBound))
            let moving = store.units(NSRange(location: start, length: end - start))
            let neighbour = store.lineRange(up ? block.lowerBound - 1 : block.upperBound + 1)
            let other = store.units(neighbour)
            if up {
                replacements.append(TextReplacement(range: NSRange(location: neighbour.location, length: end - neighbour.location),
                                                    text: moving + [newline] + other))
                shifts.append((start...end, -(other.count + 1)))
            } else {
                replacements.append(TextReplacement(range: NSRange(location: start, length: NSMaxRange(neighbour) - start),
                                                    text: other + [newline] + moving))
                shifts.append((start...end, other.count + 1))
            }
        }
        let after = set.mapping { selection in
            let delta = shifts.first { $0.range.contains(selection.lower) }?.delta ?? 0
            return Selection(anchor: selection.anchor + delta, head: selection.head + delta, goal: selection.goal)
        }
        return TextTransaction(replacements, before: set, after: after, kind: .named(up ? "Move Line Up" : "Move Line Down"))
    }

    static func duplicatingLines(_ set: SelectionSet, in store: TextStore) -> TextTransaction {
        let blocks = lineBlocks(store, set, joiningAdjacent: false)
        let replacements = blocks.map { block -> TextReplacement in
            let start = store.lineRange(block.lowerBound).location
            let end = NSMaxRange(store.lineRange(block.upperBound))
            return TextReplacement(range: NSRange(location: start, length: 0), text: store.units(NSRange(location: start, length: end - start)) + [newline])
        }
        return through(replacements, store, set, kind: .named("Duplicate Lines"))
    }

    static func deletingLines(_ set: SelectionSet, in store: TextStore) -> TextTransaction {
        let replacements = lineBlocks(store, set, joiningAdjacent: true).map { block -> TextReplacement in
            let start = store.lineRange(block.lowerBound).location
            if block.upperBound + 1 < store.lineCount {
                return TextReplacement(range: NSRange(location: start, length: store.lineRange(block.upperBound + 1).location - start), text: [])
            }
            let from = block.lowerBound > 0 ? start - 1 : start
            return TextReplacement(range: NSRange(location: from, length: store.length - from), text: [])
        }
        return through(replacements, store, set, kind: .named("Delete Lines"))
    }

    static func togglingComment(_ set: SelectionSet, in store: TextStore, context: EditContext) -> TextTransaction? {
        let blocks = lineBlocks(store, set, joiningAdjacent: false)
        let lines = blocks.flatMap { Array($0) }.filter { !isBlank($0, in: store) }
        guard !lines.isEmpty else { return nil }
        if let marker = context.lineComment.map({ Array($0.utf16) }) {
            return through(lineCommentEdits(lines, marker: marker, blocks: blocks, in: store), store, set, kind: .named("Comment"))
        }
        guard let block = context.blockComment else { return nil }
        return through(blockCommentEdits(lines, open: Array(block.open.utf16), close: Array(block.close.utf16), in: store),
                       store, set, kind: .named("Comment"))
    }

    private static func lineCommentEdits(_ lines: [Int], marker: [UInt16], blocks: [ClosedRange<Int>], in store: TextStore) -> [TextReplacement] {
        let commented = lines.allSatisfy { line in
            let start = store.lineRange(line).location + leadingWhitespace(ofLine: line, in: store).count
            return hasPrefix(marker, at: start, in: store)
        }
        if commented {
            return lines.map { line in
                let start = store.lineRange(line).location + leadingWhitespace(ofLine: line, in: store).count
                let end = start + marker.count
                let spaced = end < NSMaxRange(store.lineRange(line)) && store[end] == space
                return TextReplacement(range: NSRange(location: start, length: marker.count + (spaced ? 1 : 0)), text: [])
            }
        }
        return blocks.flatMap { block -> [TextReplacement] in
            let filled = block.filter { !isBlank($0, in: store) }
            let column = filled.map { leadingWhitespace(ofLine: $0, in: store).count }.min() ?? 0
            return filled.map { line in
                TextReplacement(range: NSRange(location: store.lineRange(line).location + column, length: 0), text: marker + [space])
            }
        }
    }

    private static func blockCommentEdits(_ lines: [Int], open: [UInt16], close: [UInt16], in store: TextStore) -> [TextReplacement] {
        let commented = lines.allSatisfy { line in
            let span = store.lineRange(line)
            let start = span.location + leadingWhitespace(ofLine: line, in: store).count
            return hasPrefix(open, at: start, in: store) && NSMaxRange(span) - close.count >= start + open.count
                && hasPrefix(close, at: NSMaxRange(span) - close.count, in: store)
        }
        return lines.flatMap { line -> [TextReplacement] in
            let span = store.lineRange(line)
            let start = span.location + leadingWhitespace(ofLine: line, in: store).count
            let end = NSMaxRange(span)
            guard commented else {
                return [TextReplacement(range: NSRange(location: start, length: 0), text: open + [space]),
                        TextReplacement(range: NSRange(location: end, length: 0), text: [space] + close)]
            }
            let openEnd = start + open.count + (start + open.count < end - close.count && store[start + open.count] == space ? 1 : 0)
            let closeStart = end - close.count - (end - close.count - 1 >= openEnd && store[end - close.count - 1] == space ? 1 : 0)
            return [TextReplacement(range: NSRange(location: start, length: openEnd - start), text: []),
                    TextReplacement(range: NSRange(location: closeStart, length: end - closeStart), text: [])]
        }
    }

    private static func hasPrefix(_ marker: [UInt16], at offset: Int, in store: TextStore) -> Bool {
        guard offset + marker.count <= store.length else { return false }
        return store.buffer.withUnits(NSRange(location: offset, length: marker.count)) { $0.elementsEqual(marker) }
    }

    private static func isBlank(_ line: Int, in store: TextStore) -> Bool {
        leadingWhitespace(ofLine: line, in: store).count == store.lineRange(line).length
    }
}
