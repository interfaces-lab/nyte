import Foundation
import NyteUI

struct FoldRegion: Equatable, Sendable {
    enum Kind: Equatable, Sendable { case block, comment, imports }

    let first: Int
    let last: Int
    let kind: Kind

    var hidden: ClosedRange<Int> { (first + 1)...last }
}

enum FoldRegions {
    private static let opens = Array("{([".utf16)
    private static let closes = Array("})]".utf16)
    private static let importWord = Array("import".utf16)
    private static let commentStates: UInt8 = 1

    static func detect(in units: [UInt16], language: Language) -> [FoldRegion] {
        guard language.family == .code else { return [] }
        var scan = Scan(language: language)
        units.withUnsafeBufferPointer { buffer in
            var start = 0
            var line = 0
            while start <= buffer.count {
                let end = buffer[start...].firstIndex(of: LineIndex.newline) ?? buffer.count
                scan.line(line, UnsafeBufferPointer(rebasing: buffer[start..<end]), offset: start)
                start = end + 1
                line += 1
            }
        }
        scan.finish()
        var seen = Set<Int>()
        return scan.regions
            .sorted { ($0.first, -$0.last) < ($1.first, -$1.last) }
            .filter { seen.insert($0.first).inserted }
    }

    private struct Scan {
        let language: Language
        var regions: [FoldRegion] = []
        var state = LexState.normal
        var tokens: [UInt64] = []
        var stack: [(unit: UInt16, line: Int, isImport: Bool)] = []
        var commentStart: Int?
        var lineCommentRun: (first: Int, last: Int)?
        var importRun: (first: Int, last: Int)?

        init(language: Language) {
            self.language = language
        }

        mutating func line(_ line: Int, _ units: UnsafeBufferPointer<UInt16>, offset: Int) {
            let entry = state
            tokens.removeAll(keepingCapacity: true)
            state = Lexer.line(units, state: entry, language: language, offset: offset, tokens: &tokens, emit: true)
            let firstVisible = units.firstIndex { $0 != UInt16(UInt8(ascii: " ")) && $0 != UInt16(UInt8(ascii: "\t")) }
            let depthAtStart = stack.count
            let startsImport = depthAtStart == 0 && entry >> 5 != FoldRegions.commentStates && firstVisible.map { start in
                units.count - start >= FoldRegions.importWord.count
                    && Array(units[start..<start + FoldRegions.importWord.count]) == FoldRegions.importWord
            } == true
            let continuesImport = depthAtStart > 0 && stack.first?.isImport == true
            brackets(units, offset: offset, line: line, isImport: startsImport)
            blockComment(line, entry: entry)
            lineComments(line, firstVisible: firstVisible.map { $0 + offset }, end: offset + units.count)
            imports(line, isImport: startsImport || continuesImport, isBlank: firstVisible == nil)
        }

        mutating func finish() {
            if let run = lineCommentRun, run.last > run.first { regions.append(FoldRegion(first: run.first, last: run.last, kind: .comment)) }
            if let run = importRun, run.last > run.first { regions.append(FoldRegion(first: run.first, last: run.last, kind: .imports)) }
        }

        private mutating func brackets(_ units: UnsafeBufferPointer<UInt16>, offset: Int, line: Int, isImport: Bool) {
            var token = 0
            for index in units.indices {
                let unit = units[index]
                guard FoldRegions.opens.contains(unit) || FoldRegions.closes.contains(unit) else { continue }
                let at = offset + index
                while token < tokens.count, NSMaxRange(Token.range(tokens[token])) <= at { token += 1 }
                if token < tokens.count, NSLocationInRange(at, Token.range(tokens[token])), Self.isQuoted(Token.kind(tokens[token])) { continue }
                if let open = FoldRegions.opens.firstIndex(of: unit) {
                    stack.append((FoldRegions.closes[open], line, isImport))
                    continue
                }
                guard let match = stack.lastIndex(where: { $0.unit == unit }) else { continue }
                let opened = stack[match]
                stack.removeSubrange(match...)
                if opened.line < line { regions.append(FoldRegion(first: opened.line, last: line, kind: opened.isImport ? .imports : .block)) }
            }
        }

        private mutating func blockComment(_ line: Int, entry: UInt8) {
            let wasInside = entry >> 5 == FoldRegions.commentStates
            let isInside = state >> 5 == FoldRegions.commentStates
            if !wasInside, isInside { commentStart = line }
            if wasInside, !isInside, let start = commentStart {
                if line > start { regions.append(FoldRegion(first: start, last: line, kind: .comment)) }
                commentStart = nil
            }
        }

        private mutating func lineComments(_ line: Int, firstVisible: Int?, end: Int) {
            let isCommentLine = language.lineComment != nil && firstVisible.map { start in
                tokens.contains { Token.kind($0) == .comment && Token.range($0).location == start && NSMaxRange(Token.range($0)) == end }
            } == true
            if isCommentLine, let run = lineCommentRun, run.last == line - 1 {
                lineCommentRun = (run.first, line)
                return
            }
            if let run = lineCommentRun, run.last > run.first { regions.append(FoldRegion(first: run.first, last: run.last, kind: .comment)) }
            lineCommentRun = isCommentLine ? (line, line) : nil
        }

        private mutating func imports(_ line: Int, isImport: Bool, isBlank: Bool) {
            if isImport {
                importRun = (importRun?.first ?? line, line)
                return
            }
            if isBlank { return }
            if let run = importRun, run.last > run.first { regions.append(FoldRegion(first: run.first, last: run.last, kind: .imports)) }
            importRun = nil
        }

        private static func isQuoted(_ kind: SyntaxColor) -> Bool {
            kind == .string || kind == .comment || kind == .escape
        }
    }
}
