import Foundation

public struct SearchResults: Sendable {
    public private(set) var paths: [String] = []
    public private(set) var fileMatches: [Range<Int32>] = []
    public private(set) var fileTruncated: [Bool] = []
    public private(set) var fileOrder: [Int32] = []

    public private(set) var matchFile: [Int32] = []
    public private(set) var matchLine: [Int32] = []
    public private(set) var matchColumn: [Int32] = []
    public private(set) var matchEndLine: [Int32] = []
    public private(set) var matchEndColumn: [Int32] = []
    public private(set) var matchBytes: [Range<Int64>] = []
    public private(set) var matchSlot: [Int32] = []

    public private(set) var slotText: [Range<Int32>] = []
    public private(set) var slotColumn: [Int32] = []
    public private(set) var slotByte: [Int64] = []
    public private(set) var slotStartsLine: [Bool] = []
    public private(set) var arena: [UInt8] = []

    public init() {}

    public var fileCount: Int { paths.count }
    public var matchCount: Int { matchFile.count }
    public var isEmpty: Bool { matchFile.isEmpty }

    public func text(ofSlot slot: Int) -> String {
        let range = slotText[slot]
        return String(decoding: arena[Int(range.lowerBound)..<Int(range.upperBound)], as: UTF8.self)
    }

    public func span(of match: Int) -> (start: (line: Int, column: Int), end: (line: Int, column: Int)) {
        ((Int(matchLine[match]), Int(matchColumn[match])), (Int(matchEndLine[match]), Int(matchEndColumn[match])))
    }

    public var byteCount: Int {
        paths.reduce(0) { $0 + $1.utf8.count } + fileMatches.capacity * MemoryLayout<Range<Int32>>.stride
            + fileTruncated.capacity + matchFile.capacity * MemoryLayout<Int32>.stride * 6
            + matchBytes.capacity * MemoryLayout<Range<Int64>>.stride
            + slotText.capacity * MemoryLayout<Range<Int32>>.stride + slotColumn.capacity * MemoryLayout<Int32>.stride
            + slotByte.capacity * MemoryLayout<Int64>.stride + slotStartsLine.capacity + arena.capacity
    }

    mutating func beginFile(_ path: String, order: Int) {
        paths.append(path)
        fileOrder.append(Int32(order))
        fileMatches.append(Int32(matchFile.count)..<Int32(matchFile.count))
        fileTruncated.append(false)
    }

    mutating func markTruncated() {
        fileTruncated[fileTruncated.count - 1] = true
    }

    mutating func addSlot(_ text: UnsafeBufferPointer<UInt8>, column: Int, byte: Int, startsLine: Bool) -> Int32 {
        let start = Int32(arena.count)
        arena.append(contentsOf: text)
        slotText.append(start..<Int32(arena.count))
        slotColumn.append(Int32(column))
        slotByte.append(Int64(byte))
        slotStartsLine.append(startsLine)
        return Int32(slotText.count - 1)
    }

    mutating func addMatch(line: Int, column: Int, endLine: Int, endColumn: Int, bytes: Range<Int>, slot: Int32) {
        matchFile.append(Int32(paths.count - 1))
        matchLine.append(Int32(line))
        matchColumn.append(Int32(column))
        matchEndLine.append(Int32(endLine))
        matchEndColumn.append(Int32(endColumn))
        matchBytes.append(Int64(bytes.lowerBound)..<Int64(bytes.upperBound))
        matchSlot.append(slot)
        let last = fileMatches.count - 1
        fileMatches[last] = fileMatches[last].lowerBound..<Int32(matchFile.count)
    }

    public mutating func append(_ other: SearchResults) {
        let files = Int32(paths.count), matches = Int32(matchFile.count), slots = Int32(slotText.count)
        let bytes = Int32(arena.count)
        paths += other.paths
        fileMatches += other.fileMatches.map { $0.lowerBound + matches..<$0.upperBound + matches }
        fileTruncated += other.fileTruncated
        fileOrder += other.fileOrder
        matchFile += other.matchFile.map { $0 + files }
        matchLine += other.matchLine
        matchColumn += other.matchColumn
        matchEndLine += other.matchEndLine
        matchEndColumn += other.matchEndColumn
        matchBytes += other.matchBytes
        matchSlot += other.matchSlot.map { $0 + slots }
        slotText += other.slotText.map { $0.lowerBound + bytes..<$0.upperBound + bytes }
        slotColumn += other.slotColumn
        slotByte += other.slotByte
        slotStartsLine += other.slotStartsLine
        arena += other.arena
    }

    public func prefix(matches limit: Int) -> SearchResults {
        guard limit < matchCount else { return self }
        var kept = SearchResults()
        for file in paths.indices {
            let range = fileMatches[file]
            guard Int(range.lowerBound) < limit else { break }
            kept.beginFile(paths[file], order: Int(fileOrder[file]))
            let end = min(Int(range.upperBound), limit)
            var slotMap: [Int32: Int32] = [:]
            for match in Int(range.lowerBound)..<end {
                let slot = Int(matchSlot[match])
                let newSlot = slotMap[Int32(slot)] ?? arena.withUnsafeBufferPointer { buffer in
                    kept.addSlot(UnsafeBufferPointer(rebasing: buffer[Int(slotText[slot].lowerBound)..<Int(slotText[slot].upperBound)]),
                                 column: Int(slotColumn[slot]), byte: Int(slotByte[slot]), startsLine: slotStartsLine[slot])
                }
                slotMap[Int32(slot)] = newSlot
                kept.addMatch(line: Int(matchLine[match]), column: Int(matchColumn[match]), endLine: Int(matchEndLine[match]),
                              endColumn: Int(matchEndColumn[match]),
                              bytes: Int(matchBytes[match].lowerBound)..<Int(matchBytes[match].upperBound), slot: newSlot)
            }
            if end < Int(range.upperBound) || fileTruncated[file] { kept.markTruncated() }
        }
        return kept
    }
}
