import Foundation
import NyteCore

enum ContextFormat {
    static let lineCap = 400
    static let characterCap = 40_000
    static let localCap = 100
    static let previewLines = 24

    struct Chip: Sendable, Equatable {
        enum Kind: Sendable, Equatable {
            case file, lines, review, terminal, stop
            case diagnostic(AgentContext.Diagnostic.Severity)
        }

        let kind: Kind
        let label: String
        var detail = ""
        var path: String?
        var line: Int?
        var preview = ""
    }

    static func content(prompt: String, context: [AgentContext], root: URL) -> [Wire.Outgoing] {
        var items: [Wire.Outgoing] = [.text(prompt)]
        let reviews = context.compactMap { item -> AgentContext.Review? in
            if case let .review(review) = item { return review }
            return nil
        }
        let grouped = reviews.enumerated().sorted { left, right in
            let (a, b) = (path(left.element.file, root: root), path(right.element.file, root: root))
            if a != b { return a < b }
            if left.element.range.first != right.element.range.first { return left.element.range.first < right.element.range.first }
            return left.offset < right.offset
        }.map(\.element)
        var reviewed = false
        for item in context {
            switch item {
            case let .file(url):
                items.append(.reference(path: path(url, root: root)))
            case let .lines(lines):
                let shown = AgentContext.LineRange(first: lines.range.first, last: lines.range.first + (lines.clip?.kept ?? lines.range.count) - 1)
                items.append(.text(fence(location(path(lines.file, root: root), shown) + note(lines.clip, unit: "lines", from: "first"),
                                         lines.text)))
            case let .diagnostic(diagnostic):
                items.append(.text(line(diagnostic, root: root)))
            case .review:
                guard !reviewed else { continue }
                reviewed = true
                for review in grouped {
                    let file = path(review.file, root: root)
                    items.append(.excerpt(.diff(path: file, side: review.side.rawValue, start: review.range.first, end: review.range.last),
                                          text: review.lines))
                    items.append(.text("review \(location(file, review.range)) \(review.side.rawValue): " + oneLine(review.comment)))
                }
            case let .terminal(terminal):
                let place = terminal.directory.map { " in " + $0.path } ?? ""
                let clipped = note(terminal.clip, unit: "lines", from: "last")
                if !place.isEmpty || !clipped.isEmpty { items.append(.text("terminal" + place + clipped)) }
                items.append(.excerpt(.terminal(command: nil), text: terminal.text))
            case let .stop(stop):
                let info = "stopped \(path(stop.file, root: root)):\(stop.line) in \(stop.function)" + note(stop.clip, unit: "locals", from: "first")
                items.append(.text(fence(info, stop.locals.map { local in
                    local.type.isEmpty ? "\(local.name) = \(local.value)" : "\(local.name) \(local.type) = \(local.value)"
                }.joined(separator: "\n"))))
            }
        }
        return items
    }

    static func capped(_ item: AgentContext) -> AgentContext {
        switch item {
        case .file, .diagnostic: return item
        case var .lines(lines):
            guard let (text, clip) = clip(lines.text, fromEnd: false) else { return item }
            lines = AgentContext.Lines(file: lines.file, range: lines.range, text: text)
            lines.clip = clip
            return .lines(lines)
        case let .review(review):
            guard let (text, clip) = clip(review.lines, fromEnd: false) else { return item }
            var kept = AgentContext.Review(file: review.file, side: review.side, range: review.range, lines: text, comment: review.comment)
            kept.clip = clip
            return .review(kept)
        case let .terminal(terminal):
            guard let (text, clip) = clip(terminal.text, fromEnd: true) else { return item }
            var kept = AgentContext.Terminal(text: text, directory: terminal.directory)
            kept.clip = clip
            return .terminal(kept)
        case let .stop(stop):
            guard stop.locals.count > localCap else { return item }
            var kept = AgentContext.Stop(file: stop.file, line: stop.line, function: stop.function, locals: Array(stop.locals.prefix(localCap)))
            kept.clip = AgentContext.Clip(kept: localCap, total: stop.locals.count)
            return .stop(kept)
        }
    }

    private static func clip(_ text: String, fromEnd: Bool) -> (String, AgentContext.Clip)? {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
        guard lines.count > lineCap || text.utf8.count > characterCap else { return nil }
        var kept = fromEnd ? Array(lines.suffix(lineCap)) : Array(lines.prefix(lineCap))
        while kept.count > 1, kept.reduce(0, { $0 + $1.utf8.count + 1 }) > characterCap {
            if fromEnd { kept.removeFirst() } else { kept.removeLast() }
        }
        return (kept.joined(separator: "\n"), AgentContext.Clip(kept: kept.count, total: lines.count))
    }

    static func path(_ url: URL, root: URL) -> String {
        let full = url.standardizedFileURL.path
        let base = root.standardizedFileURL.path
        guard full.hasPrefix(base + "/") else { return full }
        return String(full.dropFirst(base.count + 1))
    }

    static func location(_ path: String, _ range: AgentContext.LineRange) -> String {
        range.first == range.last ? "\(path):\(range.first)" : "\(path):\(range.first)-\(range.last)"
    }

    private static func note(_ clip: AgentContext.Clip?, unit: String, from end: String) -> String {
        guard let clip else { return "" }
        return " \(end) \(clip.kept.formatted()) of \(clip.total.formatted()) \(unit)"
    }

    private static func oneLine(_ text: String) -> String {
        text.split(whereSeparator: \.isNewline).joined(separator: " ")
    }

    static func line(_ diagnostic: AgentContext.Diagnostic, root: URL) -> String {
        let span = "\(diagnostic.start.line):\(diagnostic.start.column)-\(diagnostic.end.line):\(diagnostic.end.column)"
        let origin = diagnostic.source.isEmpty ? "" : " " + diagnostic.source + (diagnostic.code.isEmpty ? "" : "(\(diagnostic.code))")
        return "diagnostic \(path(diagnostic.file, root: root)):\(span) \(diagnostic.severity.rawValue)\(origin): " + oneLine(diagnostic.message)
    }

    private static func fence(_ info: String, _ body: String) -> String {
        var longest = 0
        var run = 0
        for character in body {
            run = character == "`" ? run + 1 : 0
            longest = max(longest, run)
        }
        let ticks = String(repeating: "`", count: max(3, longest + 1))
        let trimmed = body.hasSuffix("\n") ? String(body.dropLast()) : body
        return ticks + info + "\n" + trimmed + "\n" + ticks
    }
}
