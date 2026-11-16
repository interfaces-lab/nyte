import Darwin
import Foundation
import NyteCore

enum Probe {
    struct Row {
        var pid: Int32
        var parent: Int32
        var rss: Int
        var command: String
    }

    static func position(_ text: String) -> TextPosition {
        let parts = text.split(separator: ":").compactMap { Int($0) }
        return TextPosition(line: max((parts.first ?? 1) - 1, 0), column: max((parts.dropFirst().first ?? 1) - 1, 0))
    }

    static func show(_ range: TextSpan) -> String {
        "\(range.start.line + 1):\(range.start.column + 1)-\(range.end.line + 1):\(range.end.column + 1)"
    }

    static func place(_ location: FileLocation, _ folder: URL) -> String {
        Workspace(root: folder).relativePath(of: location.url) + ":" + show(location.range)
    }

    static func lines(_ text: String) -> [Substring] {
        text.split(separator: "\n", omittingEmptySubsequences: false)
    }

    static func sources(in root: URL) -> [URL] {
        let names = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil)?.compactMap { $0 as? URL } ?? []
        return names.filter { ["go", "ts"].contains($0.pathExtension) && !$0.path.contains("node_modules") }
            .map { URL(fileURLWithPath: $0.standardizedFileURL.path) }.sorted { $0.path < $1.path }
    }

    static func processes() -> [Row] {
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/bin/ps")
        process.arguments = ["-A", "-o", "pid=,ppid=,rss=,comm="]
        process.standardOutput = pipe
        guard (try? process.run()) != nil else { return [] }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return String(decoding: data, as: UTF8.self).split(separator: "\n").compactMap { line in
            let fields = line.split(separator: " ", maxSplits: 3, omittingEmptySubsequences: true)
            guard fields.count == 4, let pid = Int32(fields[0]), let parent = Int32(fields[1]), let rss = Int(fields[2]) else { return nil }
            return Row(pid: pid, parent: parent, rss: rss, command: String(fields[3]))
        }.filter { !$0.command.hasSuffix("/ps") && $0.command != "ps" }
    }

    static func descendants(of pid: Int32) -> [Row] {
        let rows = processes()
        var found: [Row] = []
        var frontier = [pid]
        while let next = frontier.popLast() {
            let children = rows.filter { $0.parent == next }
            found += children
            frontier += children.map(\.pid)
        }
        return found
    }

    static func residentTree(_ pid: Int32) -> String {
        let rows = processes()
        let own = rows.first { $0.pid == pid }
        let below = descendants(of: pid)
        let parts = ([own].compactMap { $0 } + below).map { "\(URL(fileURLWithPath: $0.command).lastPathComponent) pid \($0.pid) \($0.rss / 1024) MB" }
        return parts.joined(separator: ", ")
    }
}
