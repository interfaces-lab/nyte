import Foundation

enum WordRule: Sendable {
    case identifier
    case natural
}

enum TextUnits {
    static let clusterWindow = 64
    static let naturalWindow = 2_048
    private static let firstCombining: UInt16 = 0x300
    private static let ascii: UInt16 = 0x80
    private static let identifierExtras = Set("_$".utf16)
    private static let underscore = UInt16(UInt8(ascii: "_"))

    static func clusterEnd(after offset: Int, in store: TextStore) -> Int {
        let length = store.length
        guard offset < length else { return length }
        if store[offset] < ascii, offset + 1 == length || store[offset + 1] < firstCombining { return offset + 1 }
        let window = NSRange(location: offset, length: min(clusterWindow, length - offset))
        let first = store.buffer.withUnits(window) { String(decoding: $0, as: UTF16.self).first }
        return offset + (first.map { $0.utf16.count } ?? 1)
    }

    static func clusterStart(before offset: Int, in store: TextStore) -> Int {
        guard offset > 0 else { return 0 }
        if store[offset - 1] < ascii, offset == store.length || store[offset] < firstCombining { return offset - 1 }
        let start = max(0, offset - clusterWindow)
        let last = store.buffer.withUnits(NSRange(location: start, length: offset - start)) { String(decoding: $0, as: UTF16.self).last }
        return offset - (last.map { $0.utf16.count } ?? 1)
    }

    static func isIdentifierPart(_ unit: UInt16) -> Bool {
        if identifierExtras.contains(unit) { return true }
        if unit < ascii {
            return (unit >= 0x30 && unit <= 0x39) || (unit >= 0x41 && unit <= 0x5A) || (unit >= 0x61 && unit <= 0x7A)
        }
        guard let scalar = Unicode.Scalar(unit) else { return false }
        return CharacterSet.alphanumerics.contains(scalar)
    }

    static func wordEnd(after offset: Int, in store: TextStore, rule: WordRule) -> Int {
        switch rule {
        case .identifier:
            var index = offset
            while index < store.length, !isIdentifierPart(store[index]) { index += 1 }
            while index < store.length, isIdentifierPart(store[index]) { index += 1 }
            return index
        case .natural:
            return naturalBoundary(from: offset, forward: true, in: store)
        }
    }

    static func wordStart(before offset: Int, in store: TextStore, rule: WordRule) -> Int {
        switch rule {
        case .identifier:
            var index = offset
            while index > 0, !isIdentifierPart(store[index - 1]) { index -= 1 }
            while index > 0, isIdentifierPart(store[index - 1]) { index -= 1 }
            return index
        case .natural:
            return naturalBoundary(from: offset, forward: false, in: store)
        }
    }

    static func word(at offset: Int, in store: TextStore, rule: WordRule) -> NSRange? {
        switch rule {
        case .identifier:
            var start = min(offset, store.length)
            while start > 0, isIdentifierPart(store[start - 1]) { start -= 1 }
            var end = max(0, offset)
            while end < store.length, isIdentifierPart(store[end]) { end += 1 }
            return end > start ? NSRange(location: start, length: end - start) : nil
        case .natural:
            return naturalWord(at: offset, in: store)
        }
    }

    static func subwordEnd(after offset: Int, in store: TextStore) -> Int {
        var index = offset
        let length = store.length
        while index < length, !isIdentifierPart(store[index]) || store[index] == underscore { index += 1 }
        guard index < length else { return index }
        switch Shape(store[index]) {
        case .digit:
            while index < length, Shape(store[index]) == .digit { index += 1 }
        case .upper:
            let start = index
            while index < length, Shape(store[index]) == .upper { index += 1 }
            if index - start > 1, index < length, Shape(store[index]) == .lower { index -= 1 }
            if index - start <= 1 { while index < length, Shape(store[index]) == .lower { index += 1 } }
        case .lower, .other:
            while index < length, isLowerPart(store[index]) { index += 1 }
        }
        return index
    }

    static func subwordStart(before offset: Int, in store: TextStore) -> Int {
        var index = offset
        while index > 0, !isIdentifierPart(store[index - 1]) || store[index - 1] == underscore { index -= 1 }
        guard index > 0 else { return 0 }
        switch Shape(store[index - 1]) {
        case .digit:
            while index > 0, Shape(store[index - 1]) == .digit { index -= 1 }
        case .upper:
            while index > 0, Shape(store[index - 1]) == .upper { index -= 1 }
        case .lower, .other:
            while index > 0, isLowerPart(store[index - 1]) { index -= 1 }
            if index > 0, Shape(store[index - 1]) == .upper { index -= 1 }
        }
        return index
    }

    private static func isLowerPart(_ unit: UInt16) -> Bool {
        let shape = Shape(unit)
        return shape == .lower || (shape == .other && unit != underscore && isIdentifierPart(unit))
    }

    private enum Shape: Equatable {
        case lower, upper, digit, other

        init(_ unit: UInt16) {
            switch unit {
            case 0x61...0x7A: self = .lower
            case 0x41...0x5A: self = .upper
            case 0x30...0x39: self = .digit
            default: self = .other
            }
        }
    }

    private static func naturalBoundary(from offset: Int, forward: Bool, in store: TextStore) -> Int {
        let line = store.line(at: offset)
        let span = store.lineRange(line)
        if forward, offset >= NSMaxRange(span) {
            return line + 1 < store.lineCount ? naturalBoundary(from: store.lineRange(line + 1).location, forward: true, in: store) : offset
        }
        if !forward, offset <= span.location {
            return line > 0 ? NSMaxRange(store.lineRange(line - 1)) : 0
        }
        let start = max(span.location, offset - naturalWindow)
        let window = NSRange(location: start, length: min(NSMaxRange(span), offset + naturalWindow) - start)
        let words = naturalWords(in: window, of: store)
        let local = offset - start
        if forward { return start + (words.first { NSMaxRange($0) > local }.map(NSMaxRange) ?? window.length) }
        return start + (words.last { $0.location < local }?.location ?? 0)
    }

    private static func naturalWord(at offset: Int, in store: TextStore) -> NSRange? {
        let span = store.lineRange(store.line(at: offset))
        let start = max(span.location, offset - naturalWindow)
        let window = NSRange(location: start, length: min(NSMaxRange(span), offset + naturalWindow) - start)
        let local = offset - start
        let hit = naturalWords(in: window, of: store).first { $0.location <= local && local <= NSMaxRange($0) }
        return hit.map { NSRange(location: start + $0.location, length: $0.length) }
    }

    private static func naturalWords(in window: NSRange, of store: TextStore) -> [NSRange] {
        let text = store.string(window) as CFString
        let tokenizer = CFStringTokenizerCreate(nil, text, CFRange(location: 0, length: window.length), kCFStringTokenizerUnitWord, nil)
        var words: [NSRange] = []
        while CFStringTokenizerAdvanceToNextToken(tokenizer) != [] {
            let range = CFStringTokenizerGetCurrentTokenRange(tokenizer)
            words.append(NSRange(location: range.location, length: range.length))
        }
        return words
    }
}
