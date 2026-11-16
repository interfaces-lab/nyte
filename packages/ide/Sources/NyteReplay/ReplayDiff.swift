import CryptoKit
import Foundation

enum ReplayDiff {
    struct Patch {
        let text: String
        let added: Int
        let removed: Int
        let digest: String
    }

    private enum Step {
        case keep(String)
        case remove(String)
        case add(String)
    }

    static let context = 3

    static func patch(path: String, before: String?, after: String) -> Patch {
        let old = lines(before ?? "")
        let new = lines(after)
        let steps = diff(old, new)
        var hunks: [String] = []
        var index = 0
        var oldLine = 0
        var newLine = 0
        var positions: [(old: Int, new: Int)] = []
        for step in steps {
            positions.append((oldLine, newLine))
            switch step {
            case .keep:
                oldLine += 1
                newLine += 1
            case .remove: oldLine += 1
            case .add: newLine += 1
            }
        }
        while index < steps.count {
            guard case .keep = steps[index] else {
                let start = max(0, index - context)
                var end = index
                var scan = index
                while scan < steps.count {
                    if case .keep = steps[scan] {
                        var after = scan
                        while after < steps.count, case .keep = steps[after] { after += 1 }
                        guard after < steps.count, after - scan <= context * 2 else { break }
                        scan = after
                    } else {
                        end = scan
                        scan += 1
                    }
                }
                let stop = min(steps.count, end + 1 + context)
                let slice = steps[start ..< stop]
                let oldCount = slice.filter { if case .add = $0 { false } else { true } }.count
                let newCount = slice.filter { if case .remove = $0 { false } else { true } }.count
                let oldStart = oldCount == 0 ? positions[start].old : positions[start].old + 1
                let newStart = newCount == 0 ? positions[start].new : positions[start].new + 1
                var body = ["@@ -\(oldStart),\(oldCount) +\(newStart),\(newCount) @@"]
                for step in slice {
                    switch step {
                    case let .keep(line): body.append(" " + line)
                    case let .remove(line): body.append("-" + line)
                    case let .add(line): body.append("+" + line)
                    }
                }
                hunks += body
                index = stop
                continue
            }
            index += 1
        }
        let header = ["diff --git a/\(path) b/\(path)", before == nil ? "--- /dev/null" : "--- a/\(path)", "+++ b/\(path)"]
        let added = steps.filter { if case .add = $0 { true } else { false } }.count
        let removed = steps.filter { if case .remove = $0 { true } else { false } }.count
        let digest = SHA256.hash(data: Data(((before ?? "") + "\u{0}" + after).utf8)).map { String(format: "%02x", $0) }.joined()
        return Patch(text: (header + hunks).joined(separator: "\n") + "\n", added: added, removed: removed, digest: digest)
    }

    private static func lines(_ text: String) -> [String] {
        guard !text.isEmpty else { return [] }
        var parts = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        if text.hasSuffix("\n") { parts.removeLast() }
        return parts
    }

    private static func diff(_ old: [String], _ new: [String]) -> [Step] {
        var table = [[Int]](repeating: [Int](repeating: 0, count: new.count + 1), count: old.count + 1)
        for i in stride(from: old.count - 1, through: 0, by: -1) {
            for j in stride(from: new.count - 1, through: 0, by: -1) {
                table[i][j] = old[i] == new[j] ? table[i + 1][j + 1] + 1 : max(table[i + 1][j], table[i][j + 1])
            }
        }
        var steps: [Step] = []
        var i = 0
        var j = 0
        while i < old.count || j < new.count {
            if i < old.count, j < new.count, old[i] == new[j] {
                steps.append(.keep(old[i]))
                i += 1
                j += 1
            } else if j < new.count, i == old.count || table[i][j + 1] >= table[i + 1][j] {
                steps.append(.add(new[j]))
                j += 1
            } else {
                steps.append(.remove(old[i]))
                i += 1
            }
        }
        return steps
    }
}
