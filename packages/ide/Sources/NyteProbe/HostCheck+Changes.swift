import Foundation
import NyteCore
@testable import NyteAgent

extension HostCheck {
    @MainActor enum ChangeCheck {
        static func run(messages: [Wire.Message], root: URL, check: HostCheck) {
            var kinds: [String: Int] = [:]
            var broken: [String] = []
            var byTurn: [String: [ChangeReview.Edit]] = [:]
            var turns: [String] = []
            var seen: Set<String> = []
            let read = { (url: URL) in try? String(contentsOf: url, encoding: .utf8) }
            for message in messages where seen.insert(message.id).inserted {
                guard case let .part(part) = message.body, case let .tool(state) = part.body.content,
                      let edit = ChangeReview.edit(state) else { continue }
                let set = ChangeReview.build(session: "recorded", scope: .step(part: message.id), title: "step", root: root,
                                             entries: ChangeReview.entries([edit]), read: read)
                broken += problems(set, edits: [edit])
                for file in set.files { kinds["\(file.status) \(label(file.content))", default: 0] += 1 }
                let turn = message.turn ?? message.id
                if byTurn[turn] == nil { turns.append(turn) }
                byTurn[turn, default: []].append(edit)
            }
            for turn in turns {
                let edits = byTurn[turn] ?? []
                let entries = ChangeReview.entries(edits)
                let set = ChangeReview.build(session: "recorded", scope: .run(turn: turn), title: "run", root: root, entries: entries, read: read)
                broken += problems(set, edits: edits)
                let tally = ChangeReview.tally(set)
                let counted = set.files.map { Diff.counts(of: $0) }
                let total = (files: set.files.count, added: counted.reduce(0) { $0 + $1.added }, removed: counted.reduce(0) { $0 + $1.removed })
                if total != (tally.files, tally.added, tally.removed) {
                    broken.append("\(turn): the summary reads \(tally.files) +\(tally.added) -\(tally.removed), the change set \(total)")
                }
            }
            let steps = byTurn.values.reduce(0) { $0 + $1.count }
            let summary = kinds.sorted { $0.key < $1.key }.map { "\($0.value) \($0.key)" }.joined(separator: ", ")
            check.expect(steps > 0 && broken.isEmpty,
                         "change sets: \(steps) edit steps in \(turns.count) runs from the recorded stream; files: \(summary)"
                             + (broken.isEmpty ? "" : "; \(broken)"))
        }

        private static func problems(_ set: AgentChangeSet, edits: [ChangeReview.Edit]) -> [String] {
            let paths = Set(edits.map(\.entry.path))
            var found: [String] = []
            if Set(set.files.map(\.path)) != paths { found.append("\(set.scope): files differ from the edits") }
            for file in set.files {
                let patches = edits.filter { $0.entry.path == file.path }.compactMap { edit -> String? in
                    if case let .text(patch, _, _) = edit.entry.body { return patch }
                    return nil
                }
                let counted = patches.map(lineCounts).reduce((0, 0)) { ($0.0 + $1.0, $0.1 + $1.1) }
                if counted.0 != file.added || counted.1 != file.removed {
                    found.append("\(file.path): reported +\(file.added) -\(file.removed), patches hold +\(counted.0) -\(counted.1)")
                }
                if case let .texts(before, after) = file.content, file.status == .added, !before.isEmpty || after.isEmpty {
                    found.append("\(file.path): an added file needs an empty before and a whole after")
                }
            }
            return found
        }

        private static func lineCounts(_ patch: String) -> (Int, Int) {
            var inHunk = false
            var added = 0
            var removed = 0
            for line in patch.split(separator: "\n", omittingEmptySubsequences: false) {
                if line.hasPrefix("@@") {
                    inHunk = true
                } else if inHunk, line.hasPrefix("+") {
                    added += 1
                } else if inHunk, line.hasPrefix("-") {
                    removed += 1
                }
            }
            return (added, removed)
        }

        private static func label(_ content: AgentChangeSet.Content) -> String {
            switch content {
            case .texts: "with both texts"
            case .patches: "as patches only"
            case .unavailable: "unavailable"
            }
        }
    }
}
