import Foundation

struct ConsoleBuffer: Sendable {
    enum Stream: UInt8, Sendable {
        case stdout, stderr, console, input, prompt, result

        var isCode: Bool { self == .prompt || self == .result }
    }

    struct Match: Sendable {
        var text: String
        var runs: [(length: Int, stream: Stream)]
        var lines: Int
    }

    let limit: Int
    let slack: Int
    private(set) var bytes: [UInt8] = []
    private(set) var starts: [Int] = []
    private(set) var ends: [Int] = []
    private(set) var streams: [Stream] = []
    private(set) var isLastOpen = false
    private(set) var dropped = 0
    private var base = 0

    init(limit: Int, slack: Int) {
        self.limit = limit
        self.slack = slack
    }

    var count: Int { starts.count }

    func line(_ index: Int) -> String {
        String(decoding: bytes[(starts[index] - base)..<(ends[index] - base)], as: UTF8.self)
    }

    mutating func append(_ text: String, stream: Stream) -> Bool {
        var utf8 = Array(text.utf8)[...]
        var broke = false
        if isLastOpen {
            isLastOpen = false
            if streams.last == stream {
                let newline = utf8.firstIndex(of: UInt8(ascii: "\n"))
                bytes.append(contentsOf: utf8[..<(newline ?? utf8.endIndex)])
                ends[count - 1] = base + bytes.count
                guard let newline else {
                    isLastOpen = true
                    return false
                }
                utf8 = utf8[(newline + 1)...]
            } else {
                broke = true
            }
        }
        while !utf8.isEmpty {
            let newline = utf8.firstIndex(of: UInt8(ascii: "\n"))
            starts.append(base + bytes.count)
            bytes.append(contentsOf: utf8[..<(newline ?? utf8.endIndex)])
            ends.append(base + bytes.count)
            streams.append(stream)
            guard let newline else {
                isLastOpen = true
                break
            }
            utf8 = utf8[(newline + 1)...]
        }
        return broke
    }

    mutating func trim() -> Int {
        guard count > limit + slack else { return 0 }
        let drop = count - limit
        let cut = starts[drop] - base
        bytes.removeFirst(cut)
        base += cut
        starts.removeFirst(drop)
        ends.removeFirst(drop)
        streams.removeFirst(drop)
        dropped += drop
        return drop
    }

    mutating func removeAll() {
        bytes = []
        starts = []
        ends = []
        streams = []
        isLastOpen = false
        dropped = 0
        base = 0
    }

    func text(of lines: Range<Int>) -> String {
        lines.map(line).joined(separator: "\n")
    }

    func matching(_ query: String) -> Match {
        let needle = Array(query.lowercased().utf8)
        var text = ""
        var runs: [(length: Int, stream: Stream)] = []
        var lines = 0
        for index in 0..<count where contains(index, needle) {
            let line = line(index) + "\n"
            text += line
            let length = line.utf16.count
            if let last = runs.last, last.stream == streams[index] {
                runs[runs.count - 1].length += length
            } else {
                runs.append((length, streams[index]))
            }
            lines += 1
        }
        return Match(text: text, runs: runs, lines: lines)
    }

    private func contains(_ index: Int, _ needle: [UInt8]) -> Bool {
        guard !needle.isEmpty else { return true }
        let slice = bytes[(starts[index] - base)..<(ends[index] - base)]
        guard slice.count >= needle.count else { return false }
        let first = needle[0]
        var position = slice.startIndex
        while position <= slice.endIndex - needle.count {
            if Self.lower(slice[position]) == first {
                var matched = true
                for offset in 1..<needle.count where Self.lower(slice[position + offset]) != needle[offset] {
                    matched = false
                    break
                }
                if matched { return true }
            }
            position += 1
        }
        return false
    }

    private static func lower(_ byte: UInt8) -> UInt8 {
        byte >= UInt8(ascii: "A") && byte <= UInt8(ascii: "Z") ? byte + 32 : byte
    }
}
