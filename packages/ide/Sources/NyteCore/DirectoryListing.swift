import Darwin
import Foundation

public struct DirectoryListing: Sendable {
    let names: [UInt8]
    let starts: [UInt32]
    let lengths: [UInt16]
    let kinds: [FileTree.Flags]

    public var count: Int { starts.count }

    @concurrent public static func read(_ path: String) async -> DirectoryListing? {
        guard let stream = opendir(path) else { return nil }
        defer { closedir(stream) }
        let nameOffset = MemoryLayout<dirent>.offset(of: \dirent.d_name) ?? 0
        var names: [UInt8] = []
        var starts: [UInt32] = []
        var lengths: [UInt16] = []
        var kinds: [FileTree.Flags] = []
        while let entry = readdir(stream) {
            let name = UnsafeRawBufferPointer(
                start: UnsafeRawPointer(entry).advanced(by: nameOffset), count: Int(entry.pointee.d_namlen)
            )
            guard !skipped.contains(where: { name.elementsEqual($0) }) else { continue }
            let kind = kind(of: entry.pointee.d_type, at: path, name: name)
            starts.append(UInt32(names.count))
            lengths.append(UInt16(name.count))
            names.append(contentsOf: name)
            kinds.append(name.first == UInt8(ascii: ".") ? kind.union(.hidden) : kind)
        }
        let order = names.withUnsafeBufferPointer { arena in
            starts.indices.sorted { left, right in
                FileTree.compare(
                    UnsafeBufferPointer(rebasing: arena[Int(starts[left])..<Int(starts[left]) + Int(lengths[left])]),
                    kinds[left].contains(.directory),
                    UnsafeBufferPointer(rebasing: arena[Int(starts[right])..<Int(starts[right]) + Int(lengths[right])]),
                    kinds[right].contains(.directory)
                ) < 0
            }
        }
        var sortedNames: [UInt8] = []
        sortedNames.reserveCapacity(names.count)
        let sortedStarts = order.map { index in
            let start = UInt32(sortedNames.count)
            sortedNames.append(contentsOf: names[Int(starts[index])..<Int(starts[index]) + Int(lengths[index])])
            return start
        }
        return DirectoryListing(
            names: sortedNames, starts: sortedStarts, lengths: order.map { lengths[$0] }, kinds: order.map { kinds[$0] }
        )
    }

    private static let skipped: [[UInt8]] = [".", "..", ".git", ".DS_Store"].map { Array($0.utf8) }

    private static func kind(of type: UInt8, at directory: String, name: UnsafeRawBufferPointer) -> FileTree.Flags {
        switch Int32(type) {
        case DT_DIR: return .directory
        case DT_REG: return []
        case DT_LNK:
            return isDirectory(directory, name, follow: true) ? [.symlink, .directory] : .symlink
        default:
            return isDirectory(directory, name, follow: false) ? .directory : []
        }
    }

    private static func isDirectory(_ directory: String, _ name: UnsafeRawBufferPointer, follow: Bool) -> Bool {
        let path = directory + "/" + String(decoding: name, as: UTF8.self)
        var info = stat()
        let result = follow ? stat(path, &info) : lstat(path, &info)
        return result == 0 && (info.st_mode & S_IFMT) == S_IFDIR
    }
}

extension FileTree {
    static func compare(
        _ left: UnsafeBufferPointer<UInt8>, _ leftDirectory: Bool,
        _ right: UnsafeBufferPointer<UInt8>, _ rightDirectory: Bool
    ) -> Int {
        if leftDirectory != rightDirectory { return leftDirectory ? -1 : 1 }
        var i = 0
        var j = 0
        while i < left.count, j < right.count {
            let a = left[i]
            let b = right[j]
            if isDigit(a), isDigit(b) {
                let leftRun = digitRun(left, from: i)
                let rightRun = digitRun(right, from: j)
                let leftLength = leftRun.end - leftRun.significant
                let rightLength = rightRun.end - rightRun.significant
                if leftLength != rightLength { return leftLength < rightLength ? -1 : 1 }
                for offset in 0..<leftLength where left[leftRun.significant + offset] != right[rightRun.significant + offset] {
                    return left[leftRun.significant + offset] < right[rightRun.significant + offset] ? -1 : 1
                }
                i = leftRun.end
                j = rightRun.end
                continue
            }
            let foldedA = fold(a)
            let foldedB = fold(b)
            if foldedA != foldedB { return foldedA < foldedB ? -1 : 1 }
            i += 1
            j += 1
        }
        if left.count - i != right.count - j { return left.count - i < right.count - j ? -1 : 1 }
        return left.lexicographicallyPrecedes(right) ? -1 : (right.lexicographicallyPrecedes(left) ? 1 : 0)
    }

    private static func isDigit(_ byte: UInt8) -> Bool { byte >= 0x30 && byte <= 0x39 }

    private static func fold(_ byte: UInt8) -> UInt8 { byte >= 0x41 && byte <= 0x5A ? byte + 0x20 : byte }

    private static func digitRun(_ bytes: UnsafeBufferPointer<UInt8>, from start: Int) -> (significant: Int, end: Int) {
        var significant = start
        while significant < bytes.count, bytes[significant] == 0x30 { significant += 1 }
        var end = significant
        while end < bytes.count, isDigit(bytes[end]) { end += 1 }
        return (significant, end)
    }
}
