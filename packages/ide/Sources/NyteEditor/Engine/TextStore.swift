import Foundation
import NyteCore
import NyteUI

struct TextChange: Equatable, Sendable {
    let range: NSRange
    let inserted: [UInt16]
    let start: TextPosition
    let oldEnd: TextPosition
    let lines: LineIndex.Change
    let relexedThrough: Int

    var insertedLength: Int { inserted.count }
    var delta: Int { inserted.count - range.length }
    var newRange: NSRange { NSRange(location: range.location, length: inserted.count) }
}

struct TextStore: Sendable {
    static let longestLexedLine = 20_000

    private(set) var buffer: TextBuffer
    private(set) var lines: LineIndex
    let language: Language
    private(set) var revision = 0
    private var scratch: [UInt64] = []

    init(_ string: String = "", language: Language = .plain) {
        let units = Array(string.utf16)
        self = units.withUnsafeBufferPointer { TextStore($0, language: language) }
    }

    init(_ units: UnsafeBufferPointer<UInt16>, language: Language) {
        buffer = TextBuffer(units)
        var lines = LineIndex(units)
        Self.lexStates(units, into: &lines, language: language)
        self.lines = lines
        self.language = language
    }

    init(buffer: TextBuffer, lines: LineIndex, language: Language) {
        self.buffer = buffer
        self.lines = lines
        self.language = language
        guard language.family != .plain else { return }
        var state = LexState.normal
        for line in 0..<lines.count {
            self.lines.setEntryState(state, of: line)
            let range = lines.range(of: line, length: buffer.count)
            guard range.length <= Self.longestLexedLine else { continue }
            state = buffer.withUnits(range) { units in
                Lexer.line(units, state: state, language: language, offset: 0, tokens: &scratch, emit: false)
            }
        }
    }

    var length: Int { buffer.count }
    var lineCount: Int { lines.count }
    var string: String { buffer.string }

    func lineRange(_ line: Int) -> NSRange { lines.range(of: line, length: buffer.count) }
    func line(at offset: Int) -> Int { lines.line(at: offset) }
    func string(_ range: NSRange) -> String { buffer.string(range) }
    func units(_ range: NSRange) -> [UInt16] { buffer.units(range) }
    subscript(offset: Int) -> UInt16 { buffer[offset] }

    func lineEnd(at offset: Int) -> Int { NSMaxRange(lineRange(line(at: offset))) }
    func lineStart(at offset: Int) -> Int { lines.start(of: line(at: offset)) }

    func withLine<Result>(_ line: Int, _ body: (UnsafeBufferPointer<UInt16>) throws -> Result) rethrows -> Result {
        try buffer.withUnits(lineRange(line), body)
    }

    @discardableResult
    mutating func replace(_ range: NSRange, with inserted: [UInt16]) -> TextChange {
        let start = lines.position(at: range.location)
        let oldEnd = lines.position(at: NSMaxRange(range))
        let change = inserted.withUnsafeBufferPointer { units in
            buffer.replace(range, with: units)
            return lines.replace(location: range.location, oldLength: range.length, inserted: units)
        }
        revision += 1
        let reach = relex(from: change.line, through: change.line + change.inserted)
        return TextChange(range: range, inserted: inserted, start: start, oldEnd: oldEnd, lines: change, relexedThrough: reach)
    }

    private mutating func relex(from first: Int, through last: Int) -> Int {
        guard language.family != .plain else { return last }
        let count = lines.count
        var line = first
        var state = lines.entryState(of: first)
        while line + 1 < count {
            let range = lineRange(line)
            state = range.length > Self.longestLexedLine ? state : buffer.withUnits(range) { units in
                Lexer.line(units, state: state, language: language, offset: 0, tokens: &scratch, emit: false)
            }
            line += 1
            if line > last, lines.entryState(of: line) == state { return line - 1 }
            lines.setEntryState(state, of: line)
        }
        return line
    }

    static func lexStates(_ units: UnsafeBufferPointer<UInt16>, into lines: inout LineIndex, language: Language) {
        guard language.family != .plain else { return }
        var state = LexState.normal
        var tokens: [UInt64] = []
        for line in 0..<lines.count {
            lines.setEntryState(state, of: line)
            let range = lines.range(of: line, length: units.count)
            guard range.length <= longestLexedLine else { continue }
            state = Lexer.line(UnsafeBufferPointer(rebasing: units[range.location..<NSMaxRange(range)]), state: state,
                               language: language, offset: 0, tokens: &tokens, emit: false)
        }
    }
}
