import CryptoKit
import Foundation
import NyteCore

enum ChangeReview {
    struct Edit: Sendable {
        let entry: Wire.PatchEntry
        let written: String?
    }

    enum RunState: Sendable, Equatable {
        case loading
        case host([Wire.RunFile])
        case unavailable
    }

    struct Entry: Sendable {
        let path: String
        let status: AgentChangeSet.Status
        let added: Int
        let removed: Int
        let edits: [Edit]
        let fromHost: Bool
    }

    struct Tally: Equatable {
        var files = 0
        var added = 0
        var removed = 0
    }

    static let turnTitle = "This turn"
    static let runTitle = "This run"

    static func sessionKey(_ session: String) -> String { "session:" + session }
    static let stepTitle = "This step"

    static func edit(_ state: Wire.ToolState) -> Edit? {
        guard case let .ok(_, entry?, _)? = state.outcome else { return nil }
        return Edit(entry: entry, written: state.written)
    }

    static func entries(_ run: RunState?, edits: [Edit]) -> [Entry]? {
        switch run {
        case nil, .loading?: return nil
        case let .host(files)?:
            return files.map { file in
                Entry(path: file.path, status: file.status, added: file.added ?? 0, removed: file.removed ?? 0,
                      edits: edits.filter { $0.entry.path == file.path }, fromHost: true)
            }
        case .unavailable?: return entries(edits)
        }
    }

    static func entries(_ edits: [Edit]) -> [Entry] {
        var order: [String] = []
        var byPath: [String: [Edit]] = [:]
        for edit in edits {
            if byPath[edit.entry.path] == nil { order.append(edit.entry.path) }
            byPath[edit.entry.path, default: []].append(edit)
        }
        return order.map { path in
            let mine = byPath[path] ?? []
            let counts = mine.reduce(into: (added: 0, removed: 0)) { total, edit in
                guard case let .text(_, plus, minus) = edit.entry.body else { return }
                total.added += plus
                total.removed += minus
            }
            let status = mine.first?.entry.status == .added ? .added : mine.last?.entry.status ?? .modified
            return Entry(path: path, status: status, added: counts.added, removed: counts.removed, edits: mine, fromHost: false)
        }
    }

    static func tally(_ set: AgentChangeSet) -> Tally {
        set.files.reduce(into: Tally()) { total, file in
            let counts = Diff.counts(of: file)
            total.files += 1
            total.added += counts.added
            total.removed += counts.removed
        }
    }

    static func build(session: String, scope: AgentChangeSet.Scope, title: String, root: URL, entries: [Entry],
                      read: (URL) -> String?) -> AgentChangeSet {
        let files = entries.map { entry in
            AgentChangeSet.File(path: entry.path, status: entry.status, content: content(entry, root: root, read: read),
                                added: entry.added, removed: entry.removed)
        }
        return AgentChangeSet(session: session, scope: scope, title: title, root: root, files: files)
    }

    private static func content(_ entry: Entry, root: URL, read: (URL) -> String?) -> AgentChangeSet.Content {
        var patches: [String] = []
        var added = 0
        var removed = 0
        var problem: String?
        for edit in entry.edits {
            switch edit.entry.body {
            case let .text(patch, plus, minus):
                patches.append(patch)
                added += plus
                removed += minus
            case .binary: problem = "A binary file changed."
            case .empty: break
            case let .tooLarge(limit): problem = "The change passed the host's \(limit)-byte limit."
            case let .failed(reason): problem = reason.isEmpty ? "The host could not diff this file." : reason
            case .unknown: problem = "The host reported a change this IDE can't read."
            }
        }
        if problem == nil, let texts = texts(entry.path, entry.edits, root: root, read: read) {
            let proven = AgentChangeSet.Content.texts(before: texts.before, after: texts.after)
            let counted = Diff.counts(of: AgentChangeSet.File(path: entry.path, status: entry.status, content: proven,
                                                             added: entry.added, removed: entry.removed))
            if !entry.fromHost || (counted.added == entry.added && counted.removed == entry.removed) { return proven }
        }
        if entry.edits.isEmpty, entry.fromHost {
            return .unavailable("Changed outside the agent's edit tools, so this IDE has no patch for it.")
        }
        guard !patches.isEmpty else { return .unavailable(problem ?? "The file did not change.") }
        guard !entry.fromHost || (added == entry.added && removed == entry.removed) else {
            return .unavailable("Edited more than once in this turn, and the edits don't add up to the turn's change.")
        }
        return .patches(patches)
    }

    private static func texts(_ path: String, _ edits: [Edit], root: URL, read: (URL) -> String?) -> (before: String, after: String)? {
        let url = path.hasPrefix("/") ? URL(fileURLWithPath: path) : root.appending(path: path)
        guard let last = edits.last, let after = last.written ?? read(url) else { return nil }
        var current = after
        for edit in edits.reversed() {
            guard case let .text(patch, _, _) = edit.entry.body, let before = reverse(patch, from: current),
                  digest(before: before, after: current) == edit.entry.digest
            else { return nil }
            current = before
        }
        return (current, after)
    }

    static func digest(before: String, after: String) -> String {
        SHA256.hash(data: Data((before + "\u{0}" + after).utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private struct Line {
        let text: Substring
        let end: String
    }

    private struct Header {
        let oldCount: Int
        let newStart: Int
        let newCount: Int
    }

    static func reverse(_ patch: String, from after: String) -> String? {
        let lines = split(after)
        let rows = patch.split(separator: "\n", omittingEmptySubsequences: false)
        var old: [Substring] = []
        var cursor = 0
        var index = 0
        while index < rows.count {
            guard let header = header(rows[index]) else {
                index += 1
                continue
            }
            index += 1
            let start = header.newCount == 0 ? header.newStart : header.newStart - 1
            guard start >= cursor, start <= lines.count else { return nil }
            for line in lines[cursor ..< start] { old += [line.text, Substring(line.end)] }
            cursor = start
            var oldLeft = header.oldCount
            var newLeft = header.newCount
            while oldLeft > 0 || newLeft > 0 {
                guard index < rows.count, let mark = rows[index].first else { return nil }
                let text = rows[index].dropFirst()
                index += 1
                let clipped = index < rows.count && rows[index].hasPrefix("\\")
                if clipped { index += 1 }
                let end: Substring = clipped ? "" : "\n"
                switch mark {
                case " ":
                    guard cursor < lines.count, lines[cursor].text == text else { return nil }
                    old += [text, end]
                    cursor += 1
                    oldLeft -= 1
                    newLeft -= 1
                case "-":
                    old += [text, end]
                    oldLeft -= 1
                case "+":
                    guard cursor < lines.count, lines[cursor].text == text else { return nil }
                    cursor += 1
                    newLeft -= 1
                default:
                    return nil
                }
            }
        }
        for line in lines[cursor...] { old += [line.text, Substring(line.end)] }
        return old.joined()
    }

    private static func split(_ text: String) -> [Line] {
        guard !text.isEmpty else { return [] }
        var parts = text.split(separator: "\n", omittingEmptySubsequences: false)
        let closed = text.hasSuffix("\n")
        if closed { parts.removeLast() }
        return parts.enumerated().map { Line(text: $0.element, end: closed || $0.offset < parts.count - 1 ? "\n" : "") }
    }

    private static func header(_ row: Substring) -> Header? {
        guard row.hasPrefix("@@ -"), let close = row.dropFirst(4).range(of: " @@") else { return nil }
        let ranges = row[row.index(row.startIndex, offsetBy: 4) ..< close.lowerBound].split(separator: " ")
        guard ranges.count == 2, ranges[1].hasPrefix("+") else { return nil }
        let old = ranges[0].split(separator: ",")
        let new = ranges[1].dropFirst().split(separator: ",")
        guard let newStart = Int(new.first ?? "") else { return nil }
        return Header(oldCount: old.count > 1 ? Int(old[1]) ?? 0 : 1, newStart: newStart, newCount: new.count > 1 ? Int(new[1]) ?? 0 : 1)
    }
}
