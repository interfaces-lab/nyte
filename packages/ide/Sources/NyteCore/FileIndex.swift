import Foundation
public struct FileIndex: Sendable {
    public struct Match: Sendable, Equatable {
        public let path: Int32
        public let score: Int32
    }

    private let bytes: [UInt8]
    private let starts: [UInt32]

    public var count: Int { max(0, starts.count - 1) }

    public init() {
        bytes = []
        starts = [0]
    }
    public init(nulSeparated data: Data, excluding excluded: Data = Data()) {
        let skip = Set(excluded.split(separator: 0))
        var bytes: [UInt8] = []
        var starts: [UInt32] = [0]
        bytes.reserveCapacity(data.count)
        for path in data.split(separator: 0) where skip.isEmpty || !skip.contains(path) {
            bytes.append(contentsOf: path)
            starts.append(UInt32(bytes.count))
        }
        self.bytes = bytes
        self.starts = starts
    }

    public func path(at index: Int32) -> String {
        let range = Int(starts[Int(index)])..<Int(starts[Int(index) + 1])
        return String(decoding: bytes[range], as: UTF8.self)
    }
    public static func load(root: URL) -> FileIndex {
        if let listed = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], in: root) {
            return FileIndex(nulSeparated: listed, excluding: git(["ls-files", "-z", "--deleted"], in: root) ?? Data())
        }
        return FileIndex(nulSeparated: walk(root))
    }
    public func search(_ query: String, limit: Int) -> [Match] {
        let needle = query.utf8.filter { $0 != 0x20 }.map(Self.lowercased)
        guard !needle.isEmpty else { return [] }
        var best: [Match] = []
        best.reserveCapacity(limit + 1)
        bytes.withUnsafeBufferPointer { buffer in
            for index in 0..<count {
                let start = Int(starts[index]), end = Int(starts[index + 1])
                guard let score = Self.score(needle, in: buffer, start, end) else { continue }
                if best.count == limit, score <= best[limit - 1].score { continue }
                let slot = best.firstIndex { $0.score < score } ?? best.count
                best.insert(Match(path: Int32(index), score: score), at: slot)
                if best.count > limit { best.removeLast() }
            }
        }
        return best
    }

    private static func score(_ needle: [UInt8], in buffer: UnsafeBufferPointer<UInt8>, _ start: Int, _ end: Int) -> Int32? {
        var name = start
        for offset in stride(from: end - 1, through: start, by: -1) where buffer[offset] == 0x2F {
            name = offset + 1
            break
        }
        if let inName = run(needle, buffer, name, end) {
            return inName + 1000 - Int32(min(end - start, 400))
        }
        return run(needle, buffer, start, end).map { $0 - Int32(min(end - start, 400)) }
    }

    private static func run(_ needle: [UInt8], _ buffer: UnsafeBufferPointer<UInt8>, _ start: Int, _ end: Int) -> Int32? {
        var score: Int32 = 0
        var cursor = start
        var previous = -2
        for wanted in needle {
            var found = -1
            while cursor < end {
                if lowercased(buffer[cursor]) == wanted {
                    found = cursor
                    break
                }
                cursor += 1
            }
            guard found >= 0 else { return nil }
            if found == previous + 1 { score += 16 }
            if found == start || isBoundary(buffer[found - 1], buffer[found]) { score += 24 }
            score -= Int32(min(found - max(previous, start - 1) - 1, 8))
            previous = found
            cursor = found + 1
        }
        return score
    }

    private static func isBoundary(_ before: UInt8, _ byte: UInt8) -> Bool {
        switch before {
        case 0x2F, 0x2D, 0x5F, 0x2E, 0x20: true
        default: before >= 0x61 && before <= 0x7A && byte >= 0x41 && byte <= 0x5A
        }
    }

    private static func lowercased(_ byte: UInt8) -> UInt8 {
        byte >= 0x41 && byte <= 0x5A ? byte + 32 : byte
    }

    private static func git(_ arguments: [String], in root: URL) -> Data? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = ["-C", root.path] + arguments
        let output = Pipe()
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        guard (try? process.run()) != nil else { return nil }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return process.terminationStatus == 0 ? data : nil
    }

    private static func walk(_ root: URL) -> Data {
        var data = Data()
        let prefix = root.path.hasSuffix("/") ? root.path : root.path + "/"
        let walker = FileManager.default.enumerator(
            at: root, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsPackageDescendants]
        )
        while let url = walker?.nextObject() as? URL {
            let name = url.lastPathComponent
            if name == ".git" || name == "node_modules" || name == ".build" {
                walker?.skipDescendants()
                continue
            }
            guard (try? url.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true else { continue }
            data.append(contentsOf: url.path.dropFirst(prefix.count).utf8)
            data.append(0)
        }
        return data
    }
}
