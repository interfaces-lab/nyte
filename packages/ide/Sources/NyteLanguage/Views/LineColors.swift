import Foundation
import NyteUI

enum LineColors {
    static let carriedLimit = 1 << 22

    static func tokens(of lines: Set<Int>, in units: [UInt16], lineStarts: [Int], language: Language) -> [Int: [UInt64]] {
        guard language.family != .plain, let last = lines.max() else { return [:] }
        let carries = units.count <= carriedLimit
        var found: [Int: [UInt64]] = [:]
        var state = LexState.normal
        units.withUnsafeBufferPointer { buffer in
            for line in carries ? Array(0...min(last, lineStarts.count - 1)) : lines.sorted() where line < lineStarts.count {
                let start = lineStarts[line]
                var end = line + 1 < lineStarts.count ? lineStarts[line + 1] - 1 : buffer.count
                if end > start, buffer[end - 1] == LineArena.carriageReturn { end -= 1 }
                let wanted = lines.contains(line)
                var tokens: [UInt64] = []
                let entry = carries ? state : LexState.normal
                state = Lexer.line(UnsafeBufferPointer(rebasing: buffer[start..<max(start, end)]), state: entry, language: language,
                                   offset: 0, tokens: &tokens, emit: wanted)
                if wanted { found[line] = tokens.filter { Token.kind($0) != .plain } }
            }
        }
        return found
    }

    static func slice(_ tokens: [UInt64], from first: Int, length: Int) -> [UInt64] {
        tokens.compactMap { token in
            let range = NSIntersectionRange(Token.range(token), NSRange(location: first, length: length))
            return range.length > 0 ? Token.pack(range.location - first, range.length, Token.kind(token)) : nil
        }
    }

    static func moved(_ tokens: [UInt64], through segments: [(source: Int, target: Int, length: Int)]) -> [UInt64] {
        segments.flatMap { segment in
            slice(tokens, from: segment.source, length: segment.length).map { token in
                Token.pack(Token.range(token).location + segment.target, Token.range(token).length, Token.kind(token))
            }
        }
    }

    static func shown(_ tokens: [UInt64], shift: Int) -> [(range: NSRange, color: SyntaxColor)] {
        let kept = shift > 0 ? slice(tokens, from: shift + 1, length: Int(Int32.max)).map { token in
            Token.pack(Token.range(token).location + 1, Token.range(token).length, Token.kind(token))
        } : tokens
        return kept.map { (Token.range($0), Token.kind($0)) }
    }
}
