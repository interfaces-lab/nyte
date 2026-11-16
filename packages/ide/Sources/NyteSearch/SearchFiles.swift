import Darwin
import Foundation
import os

public struct SearchFiles: Sendable {
    public enum Source: Sendable, Equatable {
        case git, walk, given
    }

    public let root: String
    public let source: Source
    private let arena: [UInt8]
    private let starts: [UInt32]

    public var count: Int { starts.count - 1 }

    init(root: String, source: Source, paths: [ArraySlice<UInt8>]) {
        self.root = root
        self.source = source
        var order = Array(paths.indices)
        order.sort { Self.precedes(paths[$0], paths[$1]) }
        var arena: [UInt8] = []
        arena.reserveCapacity(paths.reduce(0) { $0 + $1.count })
        var starts: [UInt32] = [0]
        starts.reserveCapacity(paths.count + 1)
        var previous: ArraySlice<UInt8>?
        for index in order where previous.map({ !$0.elementsEqual(paths[index]) }) ?? true {
            arena.append(contentsOf: paths[index])
            starts.append(UInt32(arena.count))
            previous = paths[index]
        }
        self.arena = arena
        self.starts = starts
    }

    public init(root: URL, paths: [String]) {
        self.init(root: root.standardizedFileURL.path, source: .given, paths: paths.map { Array($0.utf8)[...] })
    }

    public func path(_ index: Int) -> String {
        String(decoding: arena[Int(starts[index])..<Int(starts[index + 1])], as: UTF8.self)
    }

    public var paths: [String] { (0..<count).map(path) }

    func withPath<Result>(_ index: Int, _ body: (UnsafeBufferPointer<UInt8>) -> Result) -> Result {
        arena.withUnsafeBufferPointer { body(UnsafeBufferPointer(rebasing: $0[Int(starts[index])..<Int(starts[index + 1])])) }
    }

    func contains(_ path: String) -> Bool {
        let wanted = Array(path.utf8)[...]
        var low = 0, high = count
        while low < high {
            let middle = (low + high) / 2
            let here = arena[Int(starts[middle])..<Int(starts[middle + 1])]
            if here.elementsEqual(wanted) { return true }
            if Self.precedes(here, wanted) { low = middle + 1 } else { high = middle }
        }
        return false
    }

    func merging(_ extra: [String]) -> SearchFiles {
        let missing = extra.filter { !contains($0) }
        guard !missing.isEmpty else { return self }
        return SearchFiles(root: root, source: source, paths: (paths + missing).map { Array($0.utf8)[...] })
    }

    static func precedes(_ left: ArraySlice<UInt8>, _ right: ArraySlice<UInt8>) -> Bool {
        left.withUnsafeBufferPointer { a in
            right.withUnsafeBufferPointer { b in
                let order = memcmp(a.baseAddress, b.baseAddress, min(a.count, b.count))
                return order != 0 ? order < 0 : a.count < b.count
            }
        }
    }

    public static func load(root: URL, includingIgnored: Bool) -> SearchFiles {
        load(root: root, includingIgnored: includingIgnored, sources: .user)
    }

    static func load(root: URL, includingIgnored: Bool, sources: IgnoreSources) -> SearchFiles {
        let path = root.standardizedFileURL.path
        if let listed = gitListing(root: root, includingIgnored: includingIgnored) {
            return SearchFiles(root: path, source: .git, paths: listed)
        }
        return SearchFiles(root: path, source: .walk, paths: walk(root: path, includingIgnored: includingIgnored, sources: sources))
    }

    static func gitListing(root: URL, includingIgnored: Bool) -> [ArraySlice<UInt8>]? {
        guard let listed = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], in: root) else { return nil }
        var paths = entries(listed)
        if includingIgnored, let ignored = git(["ls-files", "-z", "--others", "--ignored", "--exclude-standard"], in: root) {
            paths += entries(ignored)
        }
        guard let deleted = git(["ls-files", "-z", "--deleted"], in: root), !deleted.isEmpty else { return paths }
        let gone = Set(entries(deleted).map { Array($0) })
        return paths.filter { !gone.contains(Array($0)) }
    }

    private static func entries(_ data: [UInt8]) -> [ArraySlice<UInt8>] {
        data.split(separator: 0).filter { $0.last != UInt8(ascii: "/") }
    }

    private static func git(_ arguments: [String], in root: URL) -> [UInt8]? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = ["-C", root.path] + arguments
        let output = Pipe()
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
        } catch {
            Logger.search.error("git \(arguments.first ?? "", privacy: .public) failed: \(error.localizedDescription, privacy: .public)")
            return nil
        }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return process.terminationStatus == 0 ? Array(data) : nil
    }

    static func walk(root: String, includingIgnored: Bool, sources: IgnoreSources = .user) -> [ArraySlice<UInt8>] {
        var found: [ArraySlice<UInt8>] = []
        var rules = includingIgnored ? IgnoreRules() : sources.base(for: root)
        visit(root: root, relative: [], rules: &rules, includingIgnored: includingIgnored, into: &found)
        return found
    }

    private static func visit(root: String, relative: [UInt8], rules: inout IgnoreRules, includingIgnored: Bool,
                              into found: inout [ArraySlice<UInt8>]) {
        let directory = relative.isEmpty ? root : root + "/" + String(decoding: relative, as: UTF8.self)
        guard let handle = opendir(directory) else { return }
        defer { closedir(handle) }
        let prefix = relative.isEmpty ? [] : relative + [UInt8(ascii: "/")]
        let mark = rules.count
        if !includingIgnored, let text = FileManager.default.contents(atPath: directory + "/.gitignore") {
            rules.add(Array(text), base: prefix)
        }
        var directories: [[UInt8]] = []
        while let entry = readdir(handle) {
            let name = withUnsafeBytes(of: entry.pointee.d_name) { raw in
                Array(raw.prefix(Int(entry.pointee.d_namlen)))
            }
            if name == [UInt8(ascii: ".")] || name == [UInt8(ascii: "."), UInt8(ascii: ".")] || name == Array(".git".utf8) { continue }
            let path = prefix + name
            let type = Int32(entry.pointee.d_type)
            let isDirectory = type == DT_DIR
            guard isDirectory || type == DT_REG || type == DT_LNK else { continue }
            let ignored = !includingIgnored && path.withUnsafeBufferPointer { rules.isIgnored($0, isDirectory: isDirectory) }
            guard !ignored else { continue }
            if isDirectory { directories.append(path) } else { found.append(path[...]) }
        }
        for child in directories {
            visit(root: root, relative: child, rules: &rules, includingIgnored: includingIgnored, into: &found)
        }
        rules.truncate(to: mark)
    }
}
