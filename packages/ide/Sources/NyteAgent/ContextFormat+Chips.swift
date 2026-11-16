import Foundation
import NyteCore

extension ContextFormat {
    static func chip(_ item: AgentContext, root: URL) -> Chip {
        switch item {
        case let .file(url):
            return Chip(kind: .file, label: url.lastPathComponent, path: path(url, root: root), preview: path(url, root: root))
        case let .lines(lines):
            return Chip(kind: .lines, label: location(lines.file.lastPathComponent, lines.range), detail: clipped(lines.clip, "first", "lines"),
                        path: path(lines.file, root: root), line: lines.range.first, preview: preview(lines.text))
        case let .diagnostic(diagnostic):
            return Chip(kind: .diagnostic(diagnostic.severity), label: "\(diagnostic.file.lastPathComponent):\(diagnostic.start.line)",
                        path: path(diagnostic.file, root: root), line: diagnostic.start.line,
                        preview: line(diagnostic, root: root))
        case let .review(review):
            return Chip(kind: .review, label: location(review.file.lastPathComponent, review.range), detail: clipped(review.clip, "first", "lines"),
                        path: path(review.file, root: root), line: review.range.first,
                        preview: review.comment + "\n\n" + preview(review.lines))
        case let .terminal(terminal):
            let count = terminal.text.split(separator: "\n", omittingEmptySubsequences: false).count
            return Chip(kind: .terminal, label: "Terminal",
                        detail: terminal.clip.map { _ in clipped(terminal.clip, "last", "lines") } ?? (count == 1 ? "1 line" : "\(count) lines"),
                        preview: (terminal.directory.map { $0.path + "\n\n" } ?? "") + preview(terminal.text))
        case let .stop(stop):
            return Chip(kind: .stop, label: "\(stop.file.lastPathComponent):\(stop.line)", detail: clipped(stop.clip, "first", "locals"),
                        path: path(stop.file, root: root), line: stop.line,
                        preview: stop.function + "\n" + stop.locals.prefix(previewLines).map { "\($0.name) = \($0.value)" }.joined(separator: "\n"))
        }
    }

    static func sent(_ items: [Wire.Prompt.Item]) -> (prompt: String, chips: [Chip]) {
        var prompt: [String] = []
        var chips: [Chip] = []
        var terminalNote: String?
        var index = 0
        while index < items.count {
            let item = items[index]
            index += 1
            switch item {
            case let .text(text) where prompt.isEmpty && chips.isEmpty:
                prompt.append(text)
            case let .text(text):
                if let chip = parse(text) {
                    chips.append(chip)
                } else if text.hasPrefix("terminal"), index < items.count, case .excerpt(.terminal, _) = items[index] {
                    terminalNote = text
                } else {
                    prompt.append(text)
                }
            case let .reference(path):
                chips.append(Chip(kind: .file, label: (path as NSString).lastPathComponent, path: path, preview: path))
            case let .file(name):
                chips.append(Chip(kind: .file, label: name, preview: name))
            case let .skill(name):
                chips.append(Chip(kind: .file, label: "/" + name, preview: name))
            case let .excerpt(.diff(path, _, start, end), text):
                var comment = ""
                if index < items.count, case let .text(next) = items[index], next.hasPrefix("review ") {
                    comment = next.split(separator: ":", maxSplits: 2).last.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
                    index += 1
                }
                let range = AgentContext.LineRange(first: start, last: end)
                chips.append(Chip(kind: comment.isEmpty ? .lines : .review, label: location((path as NSString).lastPathComponent, range),
                                  path: path, line: start, preview: (comment.isEmpty ? "" : comment + "\n\n") + preview(text)))
            case let .excerpt(_, text):
                let count = text.split(separator: "\n", omittingEmptySubsequences: false).count
                chips.append(Chip(kind: .terminal, label: "Terminal", detail: count == 1 ? "1 line" : "\(count) lines",
                                  preview: (terminalNote.map { $0 + "\n\n" } ?? "") + preview(text)))
                terminalNote = nil
            case .unknown:
                continue
            }
        }
        return (prompt.joined(separator: "\n\n"), chips)
    }

    private static func parse(_ text: String) -> Chip? {
        if text.hasPrefix("diagnostic ") {
            let rest = text.dropFirst("diagnostic ".count)
            let place = rest.prefix { $0 != " " }
            let parts = place.split(separator: ":")
            guard parts.count >= 2, let line = Int(parts[1]) else { return nil }
            let file = String(parts[0])
            let severity = AgentContext.Diagnostic.Severity(rawValue: String(rest.dropFirst(place.count + 1).prefix { $0 != " " && $0 != ":" }))
            return Chip(kind: .diagnostic(severity ?? .error), label: "\((file as NSString).lastPathComponent):\(line)", path: file, line: line,
                        preview: text)
        }
        guard text.hasPrefix("```") else { return nil }
        let info = text.drop { $0 == "`" }.prefix { $0 != "\n" }
        let body = text.split(separator: "\n", omittingEmptySubsequences: false).dropFirst().dropLast().joined(separator: "\n")
        if info.hasPrefix("stopped ") {
            let place = info.dropFirst("stopped ".count).prefix { $0 != " " }
            let parts = place.split(separator: ":")
            guard parts.count == 2, let line = Int(parts[1]) else { return nil }
            return Chip(kind: .stop, label: "\((String(parts[0]) as NSString).lastPathComponent):\(line)", path: String(parts[0]), line: line,
                        preview: String(info) + "\n" + preview(body))
        }
        let place = info.prefix { $0 != " " }
        guard let colon = place.lastIndex(of: ":") else { return nil }
        let file = String(place[..<colon])
        let numbers = place[place.index(after: colon)...].split(separator: "-").compactMap { Int($0) }
        guard let first = numbers.first else { return nil }
        let range = AgentContext.LineRange(first: first, last: numbers.last ?? first)
        let rest = info.dropFirst(place.count).trimmingCharacters(in: .whitespaces)
        return Chip(kind: .lines, label: location((file as NSString).lastPathComponent, range), detail: rest, path: file, line: first,
                    preview: preview(body))
    }

    private static func clipped(_ clip: AgentContext.Clip?, _ end: String, _ unit: String) -> String {
        guard let clip else { return "" }
        return "\(end) \(clip.kept.formatted()) of \(clip.total.formatted()) \(unit)"
    }

    private static func preview(_ text: String) -> String {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
        let shown = lines.prefix(previewLines).joined(separator: "\n")
        return lines.count > previewLines ? shown + "\n\u{2026}" : shown
    }
}
