import Foundation

enum GitHead {
    private static let shortCommit = 7

    static func branch(in root: URL) -> String? {
        let dotGit = root.appendingPathComponent(".git")
        var directory = dotGit
        if let pointer = try? String(contentsOf: dotGit, encoding: .utf8), pointer.hasPrefix("gitdir:") {
            let path = pointer.dropFirst("gitdir:".count).trimmingCharacters(in: .whitespacesAndNewlines)
            directory = URL(fileURLWithPath: path, relativeTo: root)
        }
        guard let head = try? String(contentsOf: directory.appendingPathComponent("HEAD"), encoding: .utf8) else {
            return root.path == "/" ? nil : branch(in: root.deletingLastPathComponent())
        }
        let trimmed = head.trimmingCharacters(in: .whitespacesAndNewlines)
        let prefix = "ref: refs/heads/"
        return trimmed.hasPrefix(prefix) ? String(trimmed.dropFirst(prefix.count)) : String(trimmed.prefix(shortCommit))
    }
}
