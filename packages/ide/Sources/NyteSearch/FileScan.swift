import Darwin
import Foundation

struct FileRecorder {
    static let shortLine = 2_048
    static let leadBytes = 160
    static let tailBytes = 320

    let base: UnsafePointer<UInt8>
    let count: Int
    var results = SearchResults()
    private(set) var matches = 0
    private var line = 0
    private var lineStart = 0
    private var counted = 0
    private var lineEnd = -1
    private var lineSlot: Int32 = -1
    private var columnByte = 0
    private var columnUnits = 0

    init(base: UnsafePointer<UInt8>, count: Int, path: String, order: Int) {
        self.base = base
        self.count = count
        results.beginFile(path, order: order)
    }

    mutating func record(_ range: Range<Int>) {
        let start = range.lowerBound, end = range.upperBound
        if start > counted {
            let newlines = ByteScan.countNewlines(base, from: counted, to: start)
            if newlines > 0 {
                line += newlines
                lineStart = (ByteScan.lastNewline(base, before: start, notBefore: counted) ?? counted - 1) + 1
                lineEnd = -1
                lineSlot = -1
                columnByte = lineStart
                columnUnits = 0
            }
            counted = start
        }
        if lineEnd < 0 { lineEnd = ByteScan.nextNewline(base, from: start, count: count) }
        var shownEnd = lineEnd
        if shownEnd > lineStart, base[shownEnd - 1] == UInt8(ascii: "\r") { shownEnd -= 1 }
        let column = units(to: start)
        var endLine = line, endColumn: Int
        if end > lineEnd {
            let inside = ByteScan.countNewlines(base, from: start, to: end)
            endLine = line + inside
            let lastBreak = ByteScan.lastNewline(base, before: end, notBefore: start) ?? start
            endColumn = ByteScan.utf16Count(base, from: lastBreak + 1, to: end)
        } else {
            endColumn = column + ByteScan.utf16Count(base, from: start, to: end)
        }
        let slot: Int32
        if shownEnd - lineStart <= Self.shortLine {
            if lineSlot < 0 {
                lineSlot = results.addSlot(UnsafeBufferPointer(start: base + lineStart, count: shownEnd - lineStart), column: 0,
                                           byte: lineStart, startsLine: true)
            }
            slot = lineSlot
        } else {
            var from = max(lineStart, start - Self.leadBytes)
            while from > lineStart, base[from] & 0xC0 == 0x80 { from -= 1 }
            var to = min(shownEnd, max(min(end, start + Self.shortLine), start) + Self.tailBytes)
            while to < shownEnd, base[to] & 0xC0 == 0x80 { to += 1 }
            slot = results.addSlot(UnsafeBufferPointer(start: base + from, count: to - from),
                                   column: column - ByteScan.utf16Count(base, from: from, to: start), byte: from,
                                   startsLine: from == lineStart)
        }
        results.addMatch(line: line, column: column, endLine: endLine, endColumn: endColumn, bytes: range, slot: slot)
        matches += 1
    }

    private mutating func units(to offset: Int) -> Int {
        if offset < columnByte {
            columnByte = lineStart
            columnUnits = 0
        }
        columnUnits += ByteScan.utf16Count(base, from: columnByte, to: offset)
        columnByte = offset
        return columnUnits
    }
}

struct FileScanner {
    static let window = 64 << 10

    let plan: MatchPlan
    private let regex: NSRegularExpression?

    init(_ plan: MatchPlan) {
        self.plan = plan
        if case let .regex(expression) = plan.kind {
            regex = try? NSRegularExpression(pattern: expression.pattern,
                                             options: MatchPlan.options(caseInsensitive: expression.caseInsensitive))
        } else {
            regex = nil
        }
    }

    func scan(_ base: UnsafePointer<UInt8>, count: Int, path: String, order: Int, isCancelled: () -> Bool) -> SearchResults? {
        var recorder = FileRecorder(base: base, count: count, path: path, order: order)
        switch plan.kind {
        case let .literal(scanner):
            literal(&recorder, reach: scanner.needle.count, isCancelled: isCancelled) { scanner.find(base, count: $0, from: $1).map { $0..<$0 + scanner.needle.count } }
        case let .folded(scanner):
            let reach = scanner.classes.reduce(0) { $0 + ($1.map(\.count).max() ?? 0) }
            literal(&recorder, reach: reach, isCancelled: isCancelled) { scanner.find(base, count: $0, from: $1) }
        case let .regex(expression):
            if let prefilter = expression.prefilter, !prefilter.occurs(in: base, count: count) { return nil }
            guard let regex else { return nil }
            guard let text = NSString(bytes: base, length: count, encoding: String.Encoding.utf8.rawValue) else {
                let repaired = Array(String(decoding: UnsafeBufferPointer(start: base, count: count), as: UTF8.self).utf8)
                return repaired.withUnsafeBufferPointer { buffer in
                    guard let start = buffer.baseAddress else { return nil }
                    return scan(start, count: buffer.count, path: path, order: order, isCancelled: isCancelled)
                }
            }
            expressions(&recorder, regex, text, multiline: expression.isMultiline, isCancelled: isCancelled)
        }
        return recorder.matches == 0 ? nil : recorder.results
    }

    private func literal(_ recorder: inout FileRecorder, reach: Int, isCancelled: () -> Bool,
                         find: (_ count: Int, _ from: Int) -> Range<Int>?) {
        let base = recorder.base, count = recorder.count
        let limit = plan.limits.matchesPerFile
        var from = 0
        while from < count {
            let windowEnd = min(count, from + Self.window)
            guard let found = find(min(count, windowEnd + reach - 1), from), found.lowerBound < windowEnd else {
                from = windowEnd
                if isCancelled() { return }
                continue
            }
            if plan.wholeWord, !WordBoundary.admits(base, count: count, found) {
                from = found.lowerBound + 1
                continue
            }
            guard recorder.matches < limit else { return recorder.results.markTruncated() }
            recorder.record(found)
            from = max(found.upperBound, found.lowerBound + 1)
        }
    }

    private func expressions(_ recorder: inout FileRecorder, _ regex: NSRegularExpression, _ text: NSString, multiline: Bool,
                             isCancelled: () -> Bool) {
        let base = recorder.base, count = recorder.count
        let limit = plan.limits.matchesPerFile
        var cursor = (byte: 0, unit: 0)
        var skipUntil = 0
        var skipByte = 0
        func bytes(of unit: Int) -> Int {
            if unit < cursor.unit { cursor = (0, 0) }
            while cursor.unit < unit, cursor.byte < count {
                let lead = base[cursor.byte]
                let length = lead < 0x80 ? 1 : lead >= 0xF0 ? 4 : lead >= 0xE0 ? 3 : lead >= 0xC0 ? 2 : 1
                cursor.unit += length == 4 ? 2 : 1
                cursor.byte += length
            }
            return cursor.byte
        }
        var stopped = false
        func take(_ range: Range<Int>) {
            guard !stopped, !range.isEmpty else { return }
            guard recorder.matches < limit else {
                recorder.results.markTruncated()
                stopped = true
                return
            }
            recorder.record(range)
        }
        var held: [Range<Int>] = []
        var heldLineEnd = -1
        func release() {
            held.forEach(take)
            held.removeAll(keepingCapacity: true)
        }
        regex.enumerateMatches(in: text as String, options: [.reportProgress], range: NSRange(location: 0, length: text.length)) {
            result, _, stop in
            if stopped || isCancelled() {
                stop.pointee = true
                return
            }
            guard let range = result?.range, range.length > 0, NSMaxRange(range) > skipUntil else { return }
            let resumes = range.location < skipUntil
            let start = bytes(of: max(range.location, skipUntil))
            let end = bytes(of: NSMaxRange(range))
            guard !multiline else { return take(start..<end) }
            if !resumes {
                if start > heldLineEnd {
                    release()
                    heldLineEnd = ByteScan.nextNewline(base, from: start, count: count)
                }
                guard memchr(base + start, Int32(ByteScan.newline), end - start) != nil else { return held.append(start..<end) }
            }
            held.removeAll(keepingCapacity: true)
            let firstLine = resumes ? skipByte : (ByteScan.lastNewline(base, before: start, notBefore: 0) ?? -1) + 1
            let lastLineEnd = base[end - 1] == ByteScan.newline ? end - 1 : ByteScan.nextNewline(base, from: end, count: count)
            var lineByte = firstLine
            var lineUnit = resumes ? skipUntil : range.location - ByteScan.utf16Count(base, from: firstLine, to: start)
            while lineByte <= lastLineEnd, !stopped {
                let lineEnd = ByteScan.nextNewline(base, from: lineByte, count: count)
                let units = ByteScan.utf16Count(base, from: lineByte, to: lineEnd)
                cursor = (lineByte, lineUnit)
                for found in regex.matches(in: text as String, range: NSRange(location: lineUnit, length: units)) {
                    let foundStart = bytes(of: found.range.location)
                    take(foundStart..<bytes(of: NSMaxRange(found.range)))
                }
                lineUnit += units + 1
                lineByte = lineEnd + 1
            }
            skipUntil = lineUnit
            skipByte = lineByte
            heldLineEnd = lineByte - 1
            cursor = (min(lineByte - 1, count), lineUnit - 1)
            if stopped { stop.pointee = true }
        }
        release()
    }
}
