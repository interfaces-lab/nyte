import Foundation

extension Diff {
    public static func counts(of file: AgentChangeSet.File) -> (added: Int, removed: Int) {
        switch file.content {
        case let .texts(before, after):
            let old = TextLines(file.status == .added || file.status == .untracked ? "" : before)
            let new = TextLines(file.status == .deleted ? "" : after)
            guard !old.isBinary, !new.isBinary else { return (file.added, file.removed) }
            let diff = Diff(from: old, to: new)
            return (diff.addedLines, diff.removedLines)
        case let .patches(patches):
            return counts(ofPatches: patches)
        case .unavailable:
            return (file.added, file.removed)
        }
    }

    public static func counts(ofPatches patches: [String]) -> (added: Int, removed: Int) {
        var added = 0, removed = 0
        var inHunk = false
        for patch in patches {
            for line in patch.split(separator: "\n", omittingEmptySubsequences: false) {
                if line.hasPrefix("@@ ") {
                    inHunk = true
                } else if line.hasPrefix("diff ") {
                    inHunk = false
                } else if inHunk, line.hasPrefix("+") {
                    added += 1
                } else if inHunk, line.hasPrefix("-") {
                    removed += 1
                }
            }
            inHunk = false
        }
        return (added, removed)
    }
}
