import Foundation

enum TerminalLinks {
    enum Target: Equatable, Sendable {
        case url(String)
        case file(path: String, line: Int?, column: Int?)
    }

    struct Link: Equatable, Sendable {
        var range: Range<Int>
        var target: Target
    }

    private static let trailing = CharacterSet(charactersIn: ".,;:!?)]}>")

    static func detect(in line: String) -> [Link] {
        let url = /https?:\/\/[^\s<>"'`]+/
        let quoted = /(["'])([^"'\n]*[\/.][^"'\n]*)\1(?:[:(](\d+)(?:[:,](\d+))?\)?)?/
        let parenthesised = /([A-Za-z0-9_.~\/\\-]*[A-Za-z0-9_\-]\.[A-Za-z][A-Za-z0-9]*)\((\d+),(\d+)\)/
        let plain =
            /((?:~|\.{1,2})?\/?(?:[A-Za-z0-9_.@+-]+\/)*[A-Za-z0-9_@+-][A-Za-z0-9_.@+-]*\.[A-Za-z][A-Za-z0-9]*)(?::(\d+))?(?::(\d+))?/
        var links: [Link] = []
        var taken: [Range<String.Index>] = []
        func claim(_ range: Range<String.Index>, _ target: Target) {
            guard !taken.contains(where: { $0.overlaps(range) }) else { return }
            taken.append(range)
            let start = line.utf16.distance(from: line.utf16.startIndex, to: range.lowerBound)
            links.append(Link(range: start ..< start + line.utf16.distance(from: range.lowerBound, to: range.upperBound), target: target))
        }
        for match in line.matches(of: url) {
            var text = String(match.output)
            while let last = text.unicodeScalars.last, trailing.contains(last) { text.removeLast() }
            let end = line.index(match.range.lowerBound, offsetBy: text.count)
            claim(match.range.lowerBound ..< end, .url(text))
        }
        for match in line.matches(of: quoted) {
            claim(match.range, .file(path: String(match.output.2), line: match.output.3.flatMap { Int($0) },
                                     column: match.output.4.flatMap { Int($0) }))
        }
        for match in line.matches(of: parenthesised) {
            claim(match.range, .file(path: String(match.output.1), line: Int(match.output.2), column: Int(match.output.3)))
        }
        for match in line.matches(of: plain) {
            claim(match.range, .file(path: String(match.output.1), line: match.output.2.flatMap { Int($0) },
                                     column: match.output.3.flatMap { Int($0) }))
        }
        return links.sorted { $0.range.lowerBound < $1.range.lowerBound }
    }

    static func resolve(_ path: String, against directory: URL?) -> URL? {
        if path.hasPrefix("/") { return URL(fileURLWithPath: path).standardizedFileURL }
        if path.hasPrefix("~/") { return URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(String(path.dropFirst(2))) }
        return directory.map { $0.appendingPathComponent(path).standardizedFileURL }
    }

    @concurrent static func existingFile(at url: URL) async -> Bool {
        var isDirectory: ObjCBool = false
        return FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) && !isDirectory.boolValue
    }
}
