import Foundation
import NyteCore

struct GitStatus: Sendable {
    let changes: [FileTree.StatusEntry]
    let ignored: [String]

    static func read(_ repository: GitRepository, workspace: URL) async throws(GitFailure) -> GitStatus {
        let prefix = prefix(of: workspace, in: repository.root)
        let report = try await repository.status(of: prefix.isEmpty ? [] : [String(prefix.dropLast())], includingIgnored: true)
        let changes = report.entries.compactMap { entry -> FileTree.StatusEntry? in
            guard entry.path.hasPrefix(prefix), let status = status(of: entry) else { return nil }
            let path = String(entry.path.dropFirst(prefix.count))
            return FileTree.StatusEntry(path: path.hasSuffix("/") ? String(path.dropLast()) : path, status: status)
        }
        let ignored = report.ignored.filter { $0.hasPrefix(prefix) }.map { String($0.dropFirst(prefix.count)) }
        return GitStatus(changes: changes, ignored: ignored)
    }

    static func status(of entry: GitEntry) -> FileTree.Status? {
        if entry.conflict != nil || entry.index == .unmerged || entry.worktree == .unmerged { return .conflicted }
        if entry.isUntracked { return .untracked }
        if entry.index == .ignored { return nil }
        if entry.index == .deleted || entry.worktree == .deleted { return .deleted }
        if entry.index == .renamed { return .renamed }
        if entry.index == .added || entry.index == .copied { return .added }
        if entry.index == .unmodified, entry.worktree == .unmodified, entry.submodule == nil { return nil }
        return .modified
    }

    static func prefix(of workspace: URL, in root: URL) -> String {
        let real = realPath(workspace.path)
        let top = realPath(root.path)
        return real.hasPrefix(top + "/") ? String(real.dropFirst(top.count + 1)) + "/" : ""
    }

    private static func realPath(_ path: String) -> String {
        guard let resolved = realpath(path, nil) else { return path }
        defer { free(resolved) }
        return String(cString: resolved)
    }
}
