import Foundation
import NyteCore

public struct LaunchFailure: Sendable, Equatable {
    public var place: String
    public var message: String
    public var location: FileLocation?
    public var otherErrors: Int
    public var output: String
    public var install: ToolInstall?

    static let sourceExtensions: Set<String> = ["go", "ts", "mts", "cts", "tsx", "js", "mjs", "cjs", "jsx"]
    static let adapterBoilerplate = ["Failed to launch: Build error: Check the debug console for details.", "Build Error: "]

    public var headline: String { place.isEmpty ? message : place + "  " + message }

    static func parse(_ text: String, directory: URL) -> LaunchFailure {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: true).map(String.init)
        let found = lines.enumerated().compactMap { index, line in
            reference(in: line, directory: directory).map { (index, $0) }
        }
        guard let first = found.first else {
            let reason = lines.first { line in !adapterBoilerplate.contains { line.hasPrefix($0) } } ?? lines.first ?? text
            return LaunchFailure(place: "", message: reason, location: nil, otherErrors: 0, output: text)
        }
        let reference = first.1
        let message = reference.message.isEmpty
            ? lines[(first.0 + 1)...].first { $0.range(of: #"^\w*Error\b"#, options: .regularExpression) != nil } ?? ""
            : reference.message
        let place = reference.url.lastPathComponent + ":\(reference.line + 1)" + (reference.column.map { ":\($0 + 1)" } ?? "")
        let start = TextPosition(line: reference.line, column: reference.column ?? 0)
        return LaunchFailure(
            place: place, message: message.replacingOccurrences(of: " (exit status 1)", with: ""),
            location: FileLocation(url: reference.url, range: TextSpan(start: start, end: start)),
            otherErrors: found.dropFirst().filter { !$0.1.message.isEmpty }.count, output: text
        )
    }

    struct Reference {
        var url: URL
        var line: Int
        var column: Int?
        var message: String
    }

    static func reference(in line: String, directory: URL) -> Reference? {
        let pattern = #"((?:file://)?[\w./@~+-]+\.(\w+)):(\d+)(?::(\d+))?(?::\s*(.*))?$"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let text = line as NSString
        guard let match = regex.firstMatch(in: line, range: NSRange(location: 0, length: text.length)),
              sourceExtensions.contains(text.substring(with: match.range(at: 2))),
              let number = Int(text.substring(with: match.range(at: 3))), number > 0
        else { return nil }
        var path = text.substring(with: match.range(at: 1))
        if path.hasPrefix("file://") { path = String(path.dropFirst("file://".count)) }
        let url = path.hasPrefix("/") ? URL(fileURLWithPath: path) : directory.appendingPathComponent(path)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let column = match.range(at: 4).location == NSNotFound ? nil : Int(text.substring(with: match.range(at: 4))).map { $0 - 1 }
        let message = match.range(at: 5).location == NSNotFound ? "" : text.substring(with: match.range(at: 5))
        return Reference(url: url.standardizedFileURL, line: number - 1, column: column, message: message)
    }
}
