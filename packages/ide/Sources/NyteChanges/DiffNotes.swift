import Foundation
import NyteCore

struct ReviewComment: Sendable, Hashable {
    enum Side: Sendable, Hashable {
        case new
        case old
    }

    var path: String
    var side: Side
    var lines: ClosedRange<Int>
    var text: String
    var comment: String

    init(path: String, side: Side, lines: ClosedRange<Int>, text: String, comment: String) {
        self.path = path
        self.side = side
        self.lines = lines
        self.text = text
        self.comment = comment
    }

    var pointsWithoutWords: Bool { comment.isEmpty }

    func context(file: URL) -> AgentContext {
        .review(AgentContext.Review(file: file, side: side == .new ? .new : .old,
                                    range: AgentContext.LineRange(first: lines.lowerBound, last: lines.upperBound), lines: text,
                                    comment: comment))
    }
}

struct DiffNote: Sendable, Hashable {
    static let search = 2_000

    var id: Int
    var side: ReviewComment.Side
    var lines: Range<Int>
    var quoted: [String]
    var comment: String

    var last: Int { lines.upperBound - 1 }

    func comment(path: String, in document: DiffDocument) -> ReviewComment {
        let first = document.number(side, lines.lowerBound), last = document.number(side, lines.upperBound - 1)
        return ReviewComment(path: path, side: side, lines: first...max(first, last), text: quoted.joined(separator: "\n"), comment: comment)
    }

    static func make(id: Int, side: ReviewComment.Side, lines: Range<Int>, in document: DiffDocument) -> DiffNote? {
        let text = side == .new ? document.new : document.old
        guard !lines.isEmpty, lines.lowerBound >= 0, lines.upperBound <= text.count else { return nil }
        return DiffNote(id: id, side: side, lines: lines, quoted: lines.map(text.string(of:)), comment: "")
    }

    func reanchored(in document: DiffDocument) -> DiffNote? {
        let text = side == .new ? document.new : document.old
        func matches(_ start: Int) -> Bool {
            guard start >= 0, start + quoted.count <= text.count else { return false }
            return quoted.indices.allSatisfy { text.string(of: start + $0) == quoted[$0] }
        }
        for distance in 0...Self.search {
            for start in [lines.lowerBound + distance, lines.lowerBound - distance] where matches(start) {
                var moved = self
                moved.lines = start..<start + quoted.count
                return moved
            }
        }
        return nil
    }

    static func target(rows: DiffRows, selected: IndexSet, document: DiffDocument) -> (side: ReviewComment.Side, lines: Range<Int>)? {
        if selected.count == 1, let row = selected.first, row < rows.count, rows.kinds[row] == .header {
            let hunk = document.diff.hunks[Int(rows.owner[row])]
            return hunk.new.isEmpty ? (.old, hunk.old) : (.new, hunk.new)
        }
        let news = selected.filter { $0 < rows.count && rows.new[$0] >= 0 && rows.kinds[$0] != .fold }.map { Int(rows.new[$0]) }
        if let low = news.min(), let high = news.max() { return (.new, low..<high + 1) }
        let olds = selected.filter { $0 < rows.count && rows.old[$0] >= 0 && rows.kinds[$0] != .fold }.map { Int(rows.old[$0]) }
        if let low = olds.min(), let high = olds.max() { return (.old, low..<high + 1) }
        return nil
    }
}

extension DiffFolds {
    func revealing(_ notes: [DiffNote], in document: DiffDocument) -> DiffFolds {
        let hunks = document.diff.hunks
        var folds = self
        for note in notes {
            let gap = hunks.firstIndex { hunk in (note.side == .new ? hunk.new.lowerBound : hunk.old.lowerBound) > note.last } ?? hunks.count
            let inside = hunks.contains { hunk in (note.side == .new ? hunk.new : hunk.old).contains(note.last) }
            if !inside { folds = folds.expanded(gap, fully: true) }
        }
        return folds
    }
}
