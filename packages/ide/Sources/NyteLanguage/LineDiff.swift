import Foundation
import NyteCore

enum LineDiff {
    static let effortLimit = 4_000

    static func applying(_ edits: [TextEdit], to text: String) -> String {
        let source = text as NSString
        let starts = lineStarts(source)
        let ordered = edits.indices.sorted { left, right in
            edits[left].range.start == edits[right].range.start ? left > right : edits[right].range.start < edits[left].range.start
        }
        let result = NSMutableString(string: text)
        for index in ordered {
            let edit = edits[index]
            let start = offset(edit.range.start, starts, length: source.length)
            let end = max(start, offset(edit.range.end, starts, length: source.length))
            result.replaceCharacters(in: NSRange(location: start, length: end - start), with: edit.text)
        }
        return result as String
    }

    static func edits(from old: String, to new: String) -> [TextEdit] {
        guard old != new else { return [] }
        let before = lines(old)
        let after = lines(new)
        var head = 0
        while head < before.count, head < after.count, before[head] == after[head] { head += 1 }
        var tail = 0
        while tail < before.count - head, tail < after.count - head, before[before.count - 1 - tail] == after[after.count - 1 - tail] {
            tail += 1
        }
        let hunks = script(Array(before[head..<before.count - tail]), Array(after[head..<after.count - tail]))
            ?? [(0..<before.count - head - tail, 0..<after.count - head - tail)]
        return hunks.map { hunk in
            TextEdit(
                range: TextSpan(start: position(head + hunk.old.lowerBound, in: before), end: position(head + hunk.old.upperBound, in: before)),
                text: after[(head + hunk.new.lowerBound)..<(head + hunk.new.upperBound)].joined()
            )
        }
    }

    private static func script(_ before: [Substring], _ after: [Substring]) -> [(old: Range<Int>, new: Range<Int>)]? {
        let count = before.count
        let other = after.count
        let width = count + other
        guard width > 0 else { return [] }
        var frontier = [Int](repeating: 0, count: 2 * width + 2)
        var trace: [[Int]] = []
        var found = false
        search: for depth in 0...width {
            guard depth <= effortLimit else { return nil }
            trace.append(frontier)
            for diagonal in stride(from: -depth, through: depth, by: 2) {
                let slot = diagonal + width
                var x = diagonal == -depth || (diagonal != depth && frontier[slot - 1] < frontier[slot + 1])
                    ? frontier[slot + 1] : frontier[slot - 1] + 1
                var y = x - diagonal
                while x < count, y < other, before[x] == after[y] {
                    x += 1
                    y += 1
                }
                frontier[slot] = x
                if x >= count, y >= other {
                    found = true
                    break search
                }
            }
        }
        guard found else { return nil }
        var pairs: [(Int, Int)] = []
        var x = count
        var y = other
        for depth in stride(from: trace.count - 1, through: 0, by: -1) {
            let previous = trace[depth]
            let diagonal = x - y
            let slot = diagonal + width
            let down = diagonal == -depth || (diagonal != depth && previous[slot - 1] < previous[slot + 1])
            let priorDiagonal = down ? diagonal + 1 : diagonal - 1
            let priorX = depth == 0 ? 0 : previous[priorDiagonal + width]
            let priorY = priorX - priorDiagonal
            while x > priorX, y > priorY {
                x -= 1
                y -= 1
                pairs.append((x, y))
            }
            if depth > 0 {
                x = priorX
                y = priorY
            }
        }
        pairs.reverse()
        var hunks: [(old: Range<Int>, new: Range<Int>)] = []
        var oldCursor = 0
        var newCursor = 0
        for (oldLine, newLine) in pairs + [(count, other)] {
            if oldLine > oldCursor || newLine > newCursor { hunks.append((oldCursor..<oldLine, newCursor..<newLine)) }
            oldCursor = oldLine + 1
            newCursor = newLine + 1
        }
        return hunks
    }

    static func lines(_ text: String) -> [Substring] {
        var result: [Substring] = []
        var start = text.startIndex
        while start < text.endIndex {
            let end = text[start...].firstIndex(of: "\n").map { text.index(after: $0) } ?? text.endIndex
            result.append(text[start..<end])
            start = end
        }
        return result
    }

    private static func position(_ line: Int, in lines: [Substring]) -> TextPosition {
        guard line >= lines.count, let last = lines.last, !last.hasSuffix("\n") else { return TextPosition(line: line, column: 0) }
        return TextPosition(line: lines.count - 1, column: last.utf16.count)
    }

    private static func lineStarts(_ text: NSString) -> [Int] {
        var starts = [0]
        var searched = NSRange(location: 0, length: text.length)
        while true {
            let found = text.range(of: "\n", options: .literal, range: searched)
            guard found.location != NSNotFound else { break }
            starts.append(found.location + 1)
            searched = NSRange(location: found.location + 1, length: text.length - found.location - 1)
        }
        return starts
    }

    private static func offset(_ position: TextPosition, _ starts: [Int], length: Int) -> Int {
        guard position.line < starts.count else { return length }
        let lineEnd = position.line + 1 < starts.count ? starts[position.line + 1] - 1 : length
        return min(starts[position.line] + position.column, lineEnd)
    }
}
