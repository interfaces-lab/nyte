import AppKit
import NyteCore
import NyteUI

@MainActor
enum SymbolMarks {
    private static let words = [
        "file", "module", "namespace", "package", "class", "method", "property", "field", "constructor", "enum", "interface",
        "function", "variable", "constant", "string", "number", "boolean", "array", "object", "key", "null", "enum member",
        "struct", "event", "operator", "type parameter",
    ]

    static func mark(_ kind: SymbolKind) -> RowContent.Leading {
        let mark = kind.mark
        return .mark(.code(letter: mark.letter, semanticType: "\(mark.token)"))
    }

    static func word(_ kind: SymbolKind) -> String { words[Int(kind.rawValue)] }
}

@MainActor
enum SeverityMarks {
    private static let table: [(symbol: String, ink: RowContent.Ink, tone: Tone?, word: String)] = [
        ("xmark.octagon.fill", .tone(.danger), .danger, "Error"),
        ("exclamationmark.triangle.fill", .tone(.warning), .warning, "Warning"),
        ("info.circle.fill", .secondary, nil, "Note"),
        ("info.circle", .tertiary, nil, "Hint"),
    ]

    static func leading(_ severity: Diagnostic.Severity) -> RowContent.Leading {
        let entry = table[Int(severity.rawValue)]
        return .symbol(entry.symbol, entry.ink)
    }

    static func symbol(_ severity: Diagnostic.Severity) -> String { table[Int(severity.rawValue)].symbol }
    static func tone(_ severity: Diagnostic.Severity) -> Tone? { table[Int(severity.rawValue)].tone }
    static func word(_ severity: Diagnostic.Severity) -> String { table[Int(severity.rawValue)].word }
}

enum Counted {
    static func phrase(_ count: Int, _ one: String, _ many: String) -> String {
        "\(count.formatted()) \(count == 1 ? one : many)"
    }
}

@MainActor
enum FileGroups {
    static func row(_ url: URL, in workspace: Workspace, count: String, open: Bool, appearance: NSAppearance) -> RowContent {
        let relative = workspace.relativePath(of: url)
        let folder = (relative as NSString).deletingLastPathComponent
        var row = RowContent(title: url.lastPathComponent, detail: folder, meta: count,
                             leading: .image(FileIcon.forFile(named: url.lastPathComponent).image(for: appearance)),
                             disclosure: open ? .open : .closed)
        row.titleWeight = .medium
        row.isGroupHeader = true
        row.detailTruncation = .path
        row.toolTip = relative
        return row
    }

    static func ordered(_ urls: [URL], in workspace: Workspace) -> [URL] {
        urls.map { (url: $0, path: workspace.relativePath(of: $0)) }
            .sorted { $0.path.localizedStandardCompare($1.path) == .orderedAscending }
            .map(\.url)
    }
}

@MainActor
enum ListSplice {
    static func replace(_ list: ListView, at start: Int, removing old: Int, inserting new: Int, animated: Bool) {
        let kept = min(old, new)
        if kept > 0 { list.reloadRows(IndexSet(integersIn: start..<start + kept)) }
        if old > new { list.removeRows(IndexSet(integersIn: start + kept..<start + old), animated: animated) }
        if new > old { list.insertRows(IndexSet(integersIn: start + kept..<start + new), animated: animated) }
    }
}

struct LineRequest: Sendable {
    var line: Int32
    var column: Int32
}

struct LineArena: Sendable {
    static let window = 240
    static let lead = 60
    static let newline = UInt16(UInt8(ascii: "\n"))
    static let carriageReturn = UInt16(UInt8(ascii: "\r"))
    static let space = UInt16(UInt8(ascii: " "))
    static let tab = UInt16(UInt8(ascii: "\t"))

    var units: [UInt16] = []
    var starts: [Int32] = []
    var lengths: [Int32] = []
    var columns: [Int32] = []
    var colorStarts: [Int32] = []
    var colorRuns: [UInt64] = []

    func colors(_ index: Int) -> [(range: NSRange, color: SyntaxColor)] {
        tokens(index).map { (Token.range($0), Token.kind($0)) }
    }

    func tokens(_ index: Int) -> [UInt64] {
        guard index < colorStarts.count else { return [] }
        let end = index + 1 < colorStarts.count ? Int(colorStarts[index + 1]) : colorRuns.count
        return Array(colorRuns[Int(colorStarts[index])..<end])
    }

    var count: Int { starts.count }

    func text(_ index: Int) -> String {
        guard index < starts.count else { return "" }
        let start = Int(starts[index])
        return String(decoding: units[start..<start + Int(lengths[index])], as: UTF16.self)
    }

    static func read(_ files: [(url: URL, requests: [LineRequest])], buffers: [URL: String] = [:]) async -> LineArena {
        await Task.detached(priority: .userInitiated) { build(files, buffers: buffers) }.value
    }

    private static func build(_ files: [(url: URL, requests: [LineRequest])], buffers: [URL: String]) -> LineArena {
        var arena = LineArena()
        let total = files.reduce(0) { $0 + $1.requests.count }
        arena.starts.reserveCapacity(total)
        arena.lengths.reserveCapacity(total)
        arena.columns.reserveCapacity(total)
        for file in files {
            let units = Array((buffers[file.url] ?? String(decoding: (try? Data(contentsOf: file.url, options: .mappedIfSafe)) ?? Data(),
                                                           as: UTF8.self)).utf16)
            var lineStarts: [Int] = [0]
            for index in units.indices where units[index] == newline { lineStarts.append(index + 1) }
            let colored = LineColors.tokens(of: Set(file.requests.map { Int($0.line) }), in: units, lineStarts: lineStarts,
                                            language: Language.detect(file.url))
            for request in file.requests {
                arena.colorStarts.append(Int32(arena.colorRuns.count))
                arena.append(request, from: units, lineStarts: lineStarts)
                let index = arena.starts.count - 1
                arena.colorRuns += LineColors.slice(colored[Int(request.line)] ?? [], from: Int(arena.columns[index]),
                                                    length: Int(arena.lengths[index]))
            }
        }
        return arena
    }

    private mutating func append(_ request: LineRequest, from source: [UInt16], lineStarts: [Int]) {
        let line = Int(request.line)
        guard line >= 0, line < lineStarts.count else {
            starts.append(Int32(units.count))
            lengths.append(0)
            columns.append(0)
            return
        }
        let lineStart = lineStarts[line]
        var lineEnd = line + 1 < lineStarts.count ? lineStarts[line + 1] - 1 : source.count
        while lineEnd > lineStart, source[lineEnd - 1] == Self.carriageReturn { lineEnd -= 1 }
        var first = lineStart
        while first < lineEnd, source[first] == Self.space || source[first] == Self.tab { first += 1 }
        let column = Int(request.column)
        if lineEnd - first > Self.window, column - Self.lead > first - lineStart {
            first = lineStart + column - Self.lead
        }
        let last = min(lineEnd, first + Self.window)
        starts.append(Int32(units.count))
        lengths.append(Int32(last - first))
        columns.append(Int32(first - lineStart))
        units.append(contentsOf: source[first..<last].lazy.map { $0 == Self.tab ? Self.space : $0 })
    }
}
