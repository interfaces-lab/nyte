import Foundation

struct Glob: Sendable, Hashable {
    let pattern: [UInt8]
    let isAnchored: Bool
    let isDirectoryOnly: Bool

    init(_ text: String) {
        var bytes = Array(text.utf8)
        isDirectoryOnly = bytes.last == UInt8(ascii: "/")
        while bytes.last == UInt8(ascii: "/") { bytes.removeLast() }
        isAnchored = bytes.contains(UInt8(ascii: "/"))
        if bytes.first == UInt8(ascii: "/") { bytes.removeFirst() }
        pattern = bytes
    }

    func matchesPathOrParent(_ path: UnsafeBufferPointer<UInt8>) -> Bool {
        if !isAnchored {
            var start = 0
            for index in 0...path.count where index == path.count || path[index] == UInt8(ascii: "/") {
                let isFile = index == path.count
                if !(isDirectoryOnly && isFile), Self.matches(pattern[...], UnsafeBufferPointer(rebasing: path[start..<index])) {
                    return true
                }
                start = index + 1
            }
            return false
        }
        for index in 0...path.count where index == path.count || path[index] == UInt8(ascii: "/") {
            if isDirectoryOnly, index == path.count { continue }
            if Self.matches(pattern[...], UnsafeBufferPointer(rebasing: path[0..<index])) { return true }
        }
        return false
    }

    static func matches(_ pattern: String, _ path: String) -> Bool {
        let bytes = Array(path.utf8)
        return bytes.withUnsafeBufferPointer { matches(Array(pattern.utf8)[...], $0) }
    }

    static func matches(_ pattern: ArraySlice<UInt8>, _ text: UnsafeBufferPointer<UInt8>) -> Bool {
        match(pattern, pattern.startIndex, text, 0)
    }

    private static let star = UInt8(ascii: "*")
    private static let slash = UInt8(ascii: "/")
    private static let question = UInt8(ascii: "?")
    private static let open = UInt8(ascii: "[")
    private static let close = UInt8(ascii: "]")
    private static let backslash = UInt8(ascii: "\\")

    private static func match(_ p: ArraySlice<UInt8>, _ start: Int, _ t: UnsafeBufferPointer<UInt8>, _ from: Int) -> Bool {
        var pi = start
        var ti = from
        while pi < p.endIndex {
            let c = p[pi]
            switch c {
            case question:
                guard ti < t.count, t[ti] != slash else { return false }
                pi += 1
                ti += 1
            case star:
                var end = pi
                while end < p.endIndex, p[end] == star { end += 1 }
                guard end - pi >= 2 else {
                    var k = ti
                    while true {
                        if match(p, end, t, k) { return true }
                        guard k < t.count, t[k] != slash else { return false }
                        k += 1
                    }
                }
                let atSegmentStart = pi == p.startIndex || p[pi - 1] == slash
                if atSegmentStart, end < p.endIndex, p[end] == slash {
                    if match(p, end + 1, t, ti) { return true }
                    for k in ti..<t.count where t[k] == slash {
                        if match(p, end + 1, t, k + 1) { return true }
                    }
                    return false
                }
                for k in ti...t.count where match(p, end, t, k) { return true }
                return false
            case open:
                guard let (matched, next) = matchClass(p, pi, t, ti) else {
                    guard ti < t.count, t[ti] == c else { return false }
                    pi += 1
                    ti += 1
                    continue
                }
                guard matched else { return false }
                pi = next
                ti += 1
            case backslash where pi + 1 < p.endIndex:
                guard ti < t.count, t[ti] == p[pi + 1] else { return false }
                pi += 2
                ti += 1
            default:
                guard ti < t.count, t[ti] == c else { return false }
                pi += 1
                ti += 1
            }
        }
        return ti == t.count
    }

    private static func matchClass(_ p: ArraySlice<UInt8>, _ start: Int, _ t: UnsafeBufferPointer<UInt8>, _ ti: Int)
        -> (Bool, Int)? {
        var i = start + 1
        let negated = i < p.endIndex && (p[i] == UInt8(ascii: "!") || p[i] == UInt8(ascii: "^"))
        if negated { i += 1 }
        var found = false
        var first = true
        let byte: UInt8? = ti < t.count ? t[ti] : nil
        while i < p.endIndex {
            if p[i] == close, !first { break }
            first = false
            var low = p[i]
            if low == backslash, i + 1 < p.endIndex {
                i += 1
                low = p[i]
            }
            var high = low
            if i + 2 < p.endIndex, p[i + 1] == UInt8(ascii: "-"), p[i + 2] != close {
                high = p[i + 2]
                i += 2
            }
            if let byte, byte >= low, byte <= high { found = true }
            i += 1
        }
        guard i < p.endIndex else { return nil }
        guard let byte, byte != slash else { return (false, i + 1) }
        return (found != negated, i + 1)
    }
}

struct PathFilter: Sendable {
    let include: [Glob]
    let exclude: [Glob]
    let folder: [UInt8]?

    init(_ query: SearchQuery) {
        include = query.include.map(Glob.init)
        exclude = query.exclude.map(Glob.init)
        if case let .folder(path) = query.scope {
            let trimmed = path.hasSuffix("/") ? String(path.dropLast()) : path
            folder = trimmed.isEmpty ? nil : Array((trimmed + "/").utf8)
        } else {
            folder = nil
        }
    }

    var isEmpty: Bool { include.isEmpty && exclude.isEmpty && folder == nil }

    func admits(_ path: UnsafeBufferPointer<UInt8>) -> Bool {
        if let folder {
            guard path.count > folder.count, folder.withUnsafeBufferPointer({ memcmp($0.baseAddress, path.baseAddress, folder.count) == 0 })
            else { return false }
        }
        if !include.isEmpty, !include.contains(where: { $0.matchesPathOrParent(path) }) { return false }
        return !exclude.contains { $0.matchesPathOrParent(path) }
    }
}
