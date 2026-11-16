import Foundation
import NyteUI
import NyteCore

struct CompletionRanking {
    enum Match: UInt8, CaseIterable {
        case exactPrefix, prefix, wordStarts, subsequence
    }

    static let unmatched = UInt8.max

    private var units: [UInt16] = []
    private var starts: [Int] = [0]
    private var bySort: [Int32] = []
    private var classes: [UInt8] = []
    private var buckets = [Int](repeating: 0, count: Match.allCases.count)
    private(set) var visible: [Int32] = []

    init() {}

    init(filters: [String], sorts: [String]) {
        units.reserveCapacity(filters.reduce(0) { $0 + $1.utf16.count })
        starts.reserveCapacity(filters.count + 1)
        for filter in filters {
            units.append(contentsOf: filter.utf16)
            starts.append(units.count)
        }
        bySort = (0..<Int32(filters.count)).sorted { left, right in
            let a = sorts[Int(left)], b = sorts[Int(right)]
            return a != b ? a < b : left < right
        }
        classes = [UInt8](repeating: Self.unmatched, count: filters.count)
        visible.reserveCapacity(filters.count)
    }

    var count: Int { classes.count }

    func match(ofItem item: Int) -> Match? { Match(rawValue: classes[item]) }

    mutating func rank(_ query: [UInt16]) {
        for index in buckets.indices { buckets[index] = 0 }
        query.withUnsafeBufferPointer { query in
            units.withUnsafeBufferPointer { units in
                for item in classes.indices {
                    let candidate = UnsafeBufferPointer(rebasing: units[starts[item]..<starts[item + 1]])
                    let match = Self.classify(query, candidate)
                    classes[item] = match?.rawValue ?? Self.unmatched
                    if let match { buckets[Int(match.rawValue)] += 1 }
                }
            }
        }
        var total = 0
        for index in buckets.indices {
            let size = buckets[index]
            buckets[index] = total
            total += size
        }
        visible.removeAll(keepingCapacity: true)
        visible.append(contentsOf: repeatElement(0, count: total))
        for item in bySort {
            let match = classes[Int(item)]
            guard match != Self.unmatched else { continue }
            visible[buckets[Int(match)]] = item
            buckets[Int(match)] += 1
        }
    }

    static func classify(_ query: UnsafeBufferPointer<UInt16>, _ candidate: UnsafeBufferPointer<UInt16>) -> Match? {
        guard !query.isEmpty else { return .exactPrefix }
        if candidate.count >= query.count {
            var exact = true
            var folded = true
            for index in query.indices {
                if candidate[index] != query[index] { exact = false }
                if fold(candidate[index]) != fold(query[index]) { folded = false; break }
            }
            if exact { return .exactPrefix }
            if folded { return .prefix }
        }
        var path: [Int]?
        if wordStarts(query, candidate, from: 0, at: 0, path: &path) { return .wordStarts }
        var next = 0
        for unit in query {
            while next < candidate.count, fold(candidate[next]) != fold(unit) { next += 1 }
            guard next < candidate.count else { return nil }
            next += 1
        }
        return .subsequence
    }

    static func matchedRanges(of query: String, in label: String) -> [NSRange] {
        let query = Array(query.utf16)
        let label = Array(label.utf16)
        guard !query.isEmpty else { return [] }
        return query.withUnsafeBufferPointer { query in
            label.withUnsafeBufferPointer { label in
                switch classify(query, label) {
                case .exactPrefix, .prefix: return [NSRange(location: 0, length: query.count)]
                case .wordStarts:
                    var path: [Int]? = []
                    _ = wordStarts(query, label, from: 0, at: 0, path: &path)
                    return runs(path ?? [])
                case .subsequence:
                    var positions: [Int] = []
                    var next = 0
                    for unit in query {
                        while next < label.count, fold(label[next]) != fold(unit) { next += 1 }
                        guard next < label.count else { break }
                        positions.append(next)
                        next += 1
                    }
                    return runs(positions)
                case nil: return []
                }
            }
        }
    }

    private static func runs(_ positions: [Int]) -> [NSRange] {
        var ranges: [NSRange] = []
        for position in positions {
            if let last = ranges.last, NSMaxRange(last) == position {
                ranges[ranges.count - 1].length += 1
            } else {
                ranges.append(NSRange(location: position, length: 1))
            }
        }
        return ranges
    }

    private static func wordStarts(_ query: UnsafeBufferPointer<UInt16>, _ candidate: UnsafeBufferPointer<UInt16>,
                                   from next: Int, at position: Int, path: inout [Int]?) -> Bool {
        guard next < query.count else { return true }
        let wanted = fold(query[next])
        if next > 0, position < candidate.count, fold(candidate[position]) == wanted {
            path?.append(position)
            if wordStarts(query, candidate, from: next + 1, at: position + 1, path: &path) { return true }
            path?.removeLast()
        }
        var index = position
        while index < candidate.count {
            defer { index += 1 }
            guard next == 0 || index != position, fold(candidate[index]) == wanted, isWordStart(candidate, index) else { continue }
            path?.append(index)
            if wordStarts(query, candidate, from: next + 1, at: index + 1, path: &path) { return true }
            path?.removeLast()
        }
        return false
    }

    static func isWordStart(_ text: UnsafeBufferPointer<UInt16>, _ index: Int) -> Bool {
        guard index > 0 else { return true }
        let unit = text[index], previous = text[index - 1]
        if isSeparator(unit) { return false }
        if isSeparator(previous) { return true }
        if isUpper(unit) {
            if !isUpper(previous) { return true }
            return index + 1 < text.count && isLower(text[index + 1])
        }
        if isDigit(unit) { return !isDigit(previous) }
        return isDigit(previous) && isLower(unit)
    }

    private static let upperA = UInt16(UInt8(ascii: "A")), upperZ = UInt16(UInt8(ascii: "Z"))
    private static let lowerA = UInt16(UInt8(ascii: "a")), lowerZ = UInt16(UInt8(ascii: "z"))
    private static let zero = UInt16(UInt8(ascii: "0")), nine = UInt16(UInt8(ascii: "9"))
    private static let separators: Set<UInt16> = Set("_$-./ ".utf16)

    static func fold(_ unit: UInt16) -> UInt16 { isUpper(unit) ? unit - upperA + lowerA : unit }
    private static func isUpper(_ unit: UInt16) -> Bool { unit >= upperA && unit <= upperZ }
    private static func isLower(_ unit: UInt16) -> Bool { unit >= lowerA && unit <= lowerZ }
    private static func isDigit(_ unit: UInt16) -> Bool { unit >= zero && unit <= nine }
    private static func isSeparator(_ unit: UInt16) -> Bool { separators.contains(unit) }
}

struct SnippetStops: Equatable {
    private(set) var ranges: [NSRange]
    private(set) var current = 0

    init?(base: Int, length: Int, stops: [CompletionItem.Stop]) {
        var ranges = stops.map { NSRange(location: base + $0.utf16Offset, length: $0.utf16Length) }
        if ranges.last?.length != 0 { ranges.append(NSRange(location: base + length, length: 0)) }
        guard ranges.count > 1 else { return nil }
        self.ranges = ranges
    }

    var selection: NSRange { ranges[current] }
    var isAtLast: Bool { current == ranges.count - 1 }
    var final: NSRange { ranges[ranges.count - 1] }

    var span: NSRange {
        let start = ranges.map(\.location).min() ?? 0
        let end = ranges.map(NSMaxRange).max() ?? start
        return NSRange(location: start, length: end - start)
    }

    mutating func move(by step: Int) -> NSRange? {
        let next = current + step
        guard ranges.indices.contains(next) else { return nil }
        current = next
        return ranges[current]
    }

    mutating func follow(edit range: NSRange, delta: Int) -> Bool {
        let stop = ranges[current]
        let oldEnd = NSMaxRange(range) - delta
        guard range.location >= stop.location, oldEnd <= NSMaxRange(stop) else { return false }
        for index in ranges.indices where index != current && ranges[index].location >= NSMaxRange(stop) {
            ranges[index].location += delta
        }
        ranges[current].length += delta
        return true
    }

    func contains(_ selection: NSRange) -> Bool {
        let span = span
        return selection.location >= span.location && NSMaxRange(selection) <= NSMaxRange(span)
    }
}

enum CompletionInsert: Equatable {
    case snippet
    case plain(String)
    case call(name: String, takesArguments: Bool)

    static func decide(_ item: CompletionItem, committing: Bool) -> CompletionInsert {
        let text = item.text
        let paren = text.firstIndex(of: "(")
        let name = paren.map { String(text[..<$0]) } ?? text
        let callable = item.kind == .function || item.kind == .method || item.kind == .constructor
            || (paren != nil && text.hasSuffix(")") && !item.stops.contains { $0.utf16Length > 0 })
        guard callable, !name.isEmpty, Identifier.isPart(name.utf16.last ?? 0) else {
            if committing { return .plain(text) }
            return item.stops.isEmpty ? .plain(text) : .snippet
        }
        if committing { return .plain(name) }
        let inside = (text as NSString).length - 1
        let emptyCall = text.hasSuffix("()") && !item.stops.contains { $0.utf16Offset == inside }
        let takesArguments = !(item.tail.hasPrefix("()") || emptyCall)
        return .call(name: name, takesArguments: takesArguments)
    }
}

enum SnippetIndent {
    static func indented(_ text: String, stops: [CompletionItem.Stop], by indentation: String)
        -> (text: String, stops: [CompletionItem.Stop]) {
        guard !indentation.isEmpty, text.contains("\n") else { return (text, stops) }
        let width = (indentation as NSString).length
        let units = Array(text.utf16)
        let newlines = units.indices.filter { units[$0] == LineIndex.newline }
        let shift = { (offset: Int) in newlines.count { $0 < offset } * width }
        let moved = stops.map { stop in
            let start = stop.utf16Offset + shift(stop.utf16Offset)
            let end = stop.utf16Offset + stop.utf16Length
            return CompletionItem.Stop(utf16Offset: start, utf16Length: end + shift(end) - start)
        }
        return (text.replacingOccurrences(of: "\n", with: "\n" + indentation), moved)
    }
}

enum CompletionCommit: Equatable {
    case keepTyping
    case acceptAsTextThenType

    static func decide(_ item: CompletionItem, typed: String) -> CompletionCommit {
        typed.count == 1 && item.commitCharacters.contains(typed) ? .acceptAsTextThenType : .keepTyping
    }
}
