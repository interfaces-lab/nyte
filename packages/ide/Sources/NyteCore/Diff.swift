import Foundation

public struct TextLines: Sendable {
    public let bytes: [UInt8]
    public let bounds: [Int32]

    static let newline = UInt8(ascii: "\n")
    static let carriageReturn = UInt8(ascii: "\r")
    static let binaryProbe = 8_000

    public init(bytes: [UInt8]) {
        var bounds: [Int32] = [0]
        bounds.reserveCapacity(bytes.count / 24 + 2)
        bytes.withUnsafeBufferPointer { buffer in
            guard let base = buffer.baseAddress else { return }
            var cursor = 0
            while cursor < buffer.count {
                guard let found = memchr(base + cursor, Int32(Self.newline), buffer.count - cursor) else { break }
                cursor = base.distance(to: found.assumingMemoryBound(to: UInt8.self)) + 1
                bounds.append(Int32(cursor))
            }
        }
        if Int(bounds[bounds.count - 1]) != bytes.count { bounds.append(Int32(bytes.count)) }
        self.bytes = bytes
        self.bounds = bounds
    }

    public init(_ text: String) {
        self.init(bytes: Array(text.utf8))
    }

    public init(bytes: [UInt8], bounds: [Int32]) {
        assert(bounds.first == 0 && Int(bounds.last ?? 0) == bytes.count, "line bounds must cover the bytes")
        self.bytes = bytes
        self.bounds = bounds
    }

    public static let empty = TextLines(bytes: [])

    public var count: Int { bounds.count - 1 }

    public func range(of line: Int) -> Range<Int> { Int(bounds[line])..<Int(bounds[line + 1]) }

    public func contentRange(of line: Int) -> Range<Int> {
        var range = range(of: line)
        if range.upperBound > range.lowerBound, bytes[range.upperBound - 1] == Self.newline {
            range = range.lowerBound..<range.upperBound - 1
            if range.upperBound > range.lowerBound, bytes[range.upperBound - 1] == Self.carriageReturn {
                range = range.lowerBound..<range.upperBound - 1
            }
        }
        return range
    }

    public func content(of line: Int) -> ArraySlice<UInt8> { bytes[contentRange(of: line)] }

    public func string(of line: Int) -> String { String(decoding: content(of: line), as: UTF8.self) }

    public func endsWithNewline(_ line: Int) -> Bool {
        let range = range(of: line)
        return range.upperBound > range.lowerBound && bytes[range.upperBound - 1] == Self.newline
    }

    public func endsWithCarriageReturn(_ line: Int) -> Bool {
        let content = contentRange(of: line)
        return content.upperBound < range(of: line).upperBound - 1
    }

    public var isBinary: Bool { bytes.prefix(Self.binaryProbe).contains(0) }

    public func sameLine(_ line: Int, as other: TextLines, _ otherLine: Int) -> Bool {
        let left = range(of: line), right = other.range(of: otherLine)
        guard left.count == right.count else { return false }
        return bytes.withUnsafeBufferPointer { mine in
            other.bytes.withUnsafeBufferPointer { theirs in
                guard let a = mine.baseAddress, let b = theirs.baseAddress else { return left.isEmpty }
                return memcmp(a + left.lowerBound, b + right.lowerBound, left.count) == 0
            }
        }
    }
}

public struct DiffHunk: Sendable, Hashable {
    public var old: Range<Int>
    public var new: Range<Int>

    public init(old: Range<Int>, new: Range<Int>) {
        self.old = old
        self.new = new
    }
}

public struct DiffSpans: Sendable, Hashable {
    public var removed: [Range<Int>]
    public var added: [Range<Int>]

    public init(removed: [Range<Int>], added: [Range<Int>]) {
        self.removed = removed
        self.added = added
    }
}

public struct Diff: Sendable {
    public struct Effort: Sendable, Hashable {
        public enum Cost: Sendable, Hashable {
            case minimal
            case scaled
            case bounded(Int)
        }

        public var cost: Cost
        public var workLimit: Int

        public init(cost: Cost, workLimit: Int) {
            self.cost = cost
            self.workLimit = workLimit
        }

        public static let standard = Effort(cost: .scaled, workLimit: 400_000_000)
        public static let minimal = Effort(cost: .minimal, workLimit: 4_000_000_000)
    }

    public enum Quality: Sendable, Hashable {
        case minimal, approximate, wholeFile
    }

    public let hunks: [DiffHunk]
    public let quality: Quality

    public var addedLines: Int { hunks.reduce(0) { $0 + $1.new.count } }
    public var removedLines: Int { hunks.reduce(0) { $0 + $1.old.count } }

    public init(hunks: [DiffHunk], quality: Quality) {
        self.hunks = hunks
        self.quality = quality
    }

    public init(from old: String, to new: String, effort: Effort = .standard) {
        self.init(from: TextLines(old), to: TextLines(new), effort: effort)
    }

    public init(from old: TextLines, to new: TextLines, effort: Effort = .standard) {
        let classes = LineClasses(old, new)
        var changedOld = [Bool](repeating: false, count: old.count + 2)
        var changedNew = [Bool](repeating: false, count: new.count + 2)
        let quality = Self.mark(classes, changedOld: &changedOld, changedNew: &changedNew, effort: effort)
        if quality != .wholeFile {
            Self.compact(classes.old, &changedOld, against: changedNew)
            Self.compact(classes.new, &changedNew, against: changedOld)
        }
        self.init(hunks: Self.hunks(changedOld, changedNew, oldCount: old.count, newCount: new.count), quality: quality)
    }

    public static func spans(_ old: ArraySlice<UInt8>, _ new: ArraySlice<UInt8>) -> DiffSpans? {
        Words.spans(old, new)
    }

    static func hunks(_ changedOld: [Bool], _ changedNew: [Bool], oldCount: Int, newCount: Int) -> [DiffHunk] {
        var hunks: [DiffHunk] = []
        var i1 = 0, i2 = 0
        while i1 < oldCount || i2 < newCount {
            guard changedOld[i1 + 1] || changedNew[i2 + 1] else {
                i1 += 1
                i2 += 1
                continue
            }
            let start1 = i1, start2 = i2
            while i1 < oldCount, changedOld[i1 + 1] { i1 += 1 }
            while i2 < newCount, changedNew[i2 + 1] { i2 += 1 }
            hunks.append(DiffHunk(old: start1..<i1, new: start2..<i2))
        }
        return hunks
    }
}

struct LineClasses {
    var old: [Int32]
    var new: [Int32]
    var count: Int

    init(_ left: TextLines, _ right: TextLines) {
        let total = left.count + right.count
        var capacity = 16
        while capacity < total * 2 { capacity <<= 1 }
        var slots = [Int32](repeating: 0, count: capacity)
        var hashes: [UInt64] = []
        var sides: [UInt8] = []
        var lines: [Int32] = []
        hashes.reserveCapacity(total)
        sides.reserveCapacity(total)
        lines.reserveCapacity(total)
        let mask = capacity - 1
        let texts = [left, right]
        var result: [[Int32]] = [[Int32](repeating: 0, count: left.count), [Int32](repeating: 0, count: right.count)]
        for side in 0..<2 {
            let text = texts[side]
            text.bytes.withUnsafeBufferPointer { buffer in
                for line in 0..<text.count {
                    let range = text.range(of: line)
                    var hash: UInt64 = 0xcbf2_9ce4_8422_2325
                    for index in range { hash = (hash ^ UInt64(buffer[index])) &* 0x0000_0100_0000_01b3 }
                    var slot = Int(truncatingIfNeeded: hash ^ (hash >> 29)) & mask
                    while true {
                        let entry = Int(slots[slot])
                        if entry == 0 {
                            hashes.append(hash)
                            sides.append(UInt8(side))
                            lines.append(Int32(line))
                            slots[slot] = Int32(hashes.count)
                            result[side][line] = Int32(hashes.count - 1)
                            break
                        }
                        let candidate = entry - 1
                        if hashes[candidate] == hash,
                           text.sameLine(line, as: texts[Int(sides[candidate])], Int(lines[candidate])) {
                            result[side][line] = Int32(candidate)
                            break
                        }
                        slot = (slot + 1) & mask
                    }
                }
            }
        }
        old = result[0]
        new = result[1]
        count = hashes.count
    }
}

extension TextLines {
    static let declarationWords: Set<String> = [
        "func", "function", "class", "struct", "enum", "interface", "type", "protocol", "extension", "def", "fn", "impl",
        "trait", "module", "namespace", "actor", "init", "constructor", "object",
    ]
    static let modifierWords: Set<String> = [
        "export", "default", "public", "private", "protected", "internal", "fileprivate", "open", "static", "async", "abstract",
        "override", "final", "pub", "declare", "readonly", "mutating", "nonisolated", "unsafe", "extern",
    ]
    static let controlWords: Set<String> = [
        "if", "else", "for", "while", "switch", "catch", "try", "do", "return", "case", "select", "defer", "go", "guard",
    ]
    static let declarationScan = 4_000
    static let tabWidth = 4

    public func declarationLine(before line: Int) -> Int? {
        guard line > 0, line <= count else { return nil }
        var reference = Int.max
        for probe in line..<min(count, line + 8) {
            if let indent = indentation(of: probe) {
                reference = indent
                break
            }
        }
        var probe = line - 1
        let floor = max(0, line - Self.declarationScan)
        while probe >= floor {
            defer { probe -= 1 }
            guard let indent = indentation(of: probe), indent < reference || (indent == 0 && reference == 0) else { continue }
            if isDeclaration(probe) { return probe }
        }
        return nil
    }

    func indentation(of line: Int) -> Int? {
        var width = 0
        for byte in content(of: line) {
            switch byte {
            case UInt8(ascii: " "): width += 1
            case UInt8(ascii: "\t"): width += Self.tabWidth
            default: return width
            }
        }
        return nil
    }

    func isDeclaration(_ line: Int) -> Bool {
        let text = string(of: line).trimmingCharacters(in: .whitespaces)
        guard let first = text.unicodeScalars.first, CharacterSet.letters.contains(first) || first == "_" || first == "$" else {
            return false
        }
        let words = text.split(whereSeparator: { !($0.isLetter || $0.isNumber || $0 == "_") }).map(String.init)
        guard let word = words.first(where: { !Self.modifierWords.contains($0) }) else { return false }
        if Self.declarationWords.contains(word) { return true }
        guard !Self.controlWords.contains(word), text.contains("(") else { return false }
        return text.hasSuffix("{") || text.hasSuffix("=> {") || text.hasSuffix(":")
    }
}
