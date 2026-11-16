import Foundation

extension GitRepository {
    public enum PatchTarget: Sendable {
        case index
        case worktree
        case indexAndWorktree
    }

    public func stage(_ paths: [String]) async throws(GitFailure) {
        guard !paths.isEmpty else { return }
        _ = try await run(["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"], input: Self.pathList(paths),
                          timeout: Self.writeTimeout)
    }

    public func markIntentToAdd(_ paths: [String]) async throws(GitFailure) {
        guard !paths.isEmpty else { return }
        _ = try await run(["add", "-N", "--pathspec-from-file=-", "--pathspec-file-nul"], input: Self.pathList(paths),
                          timeout: Self.writeTimeout)
    }

    public func unstage(_ paths: [String], headExists: Bool) async throws(GitFailure) {
        guard !paths.isEmpty else { return }
        let arguments = headExists
            ? ["restore", "--staged", "--pathspec-from-file=-", "--pathspec-file-nul"]
            : ["rm", "--cached", "-r", "-q", "--pathspec-from-file=-", "--pathspec-file-nul"]
        _ = try await run(arguments, input: Self.pathList(paths), timeout: Self.writeTimeout)
    }

    public func restoreWorktree(_ paths: [String]) async throws(GitFailure) {
        guard !paths.isEmpty else { return }
        _ = try await run(["restore", "--worktree", "--pathspec-from-file=-", "--pathspec-file-nul"], input: Self.pathList(paths),
                          timeout: Self.writeTimeout)
    }

    public func restoreFromHead(_ paths: [String]) async throws(GitFailure) {
        guard !paths.isEmpty else { return }
        _ = try await run(["restore", "--source=HEAD", "--staged", "--worktree", "--pathspec-from-file=-", "--pathspec-file-nul"],
                          input: Self.pathList(paths), timeout: Self.writeTimeout)
    }

    public func removeFromIndex(_ paths: [String]) async throws(GitFailure) {
        guard !paths.isEmpty else { return }
        _ = try await run(["rm", "--cached", "-f", "-q", "--pathspec-from-file=-", "--pathspec-file-nul"], input: Self.pathList(paths),
                          timeout: Self.writeTimeout)
    }

    public func apply(_ patch: Data, to target: PatchTarget, reversed: Bool = false) async throws(GitFailure) {
        var arguments = ["apply", "--whitespace=nowarn"]
        switch target {
        case .index: arguments.append("--cached")
        case .indexAndWorktree: arguments.append("--index")
        case .worktree: break
        }
        if reversed { arguments.append("-R") }
        arguments.append("-")
        _ = try await run(arguments, input: patch, timeout: Self.writeTimeout)
    }

    public func patch(staged: Bool, paths: [String]) async throws(GitFailure) -> Data {
        var arguments = ["diff", "--binary", "--no-ext-diff", "--no-color", "--no-renames", "--full-index"]
        if staged { arguments.append("--cached") }
        return try await run(arguments + ["--"] + paths, reading: true)
    }

    public func commit(message: String, amend: Bool) async throws(GitFailure) -> String {
        var arguments = ["commit", "-q", "--cleanup=strip", "-F", "-"]
        if amend { arguments.append("--amend") }
        _ = try await run(arguments, input: Data(message.utf8), timeout: Self.commitTimeout)
        let head = try await run(["rev-parse", "HEAD"], reading: true)
        return String(decoding: head, as: UTF8.self).trimmingCharacters(in: .newlines)
    }

    static func pathList(_ paths: [String]) -> Data {
        var data = Data()
        for path in paths {
            data.append(contentsOf: path.utf8)
            data.append(0)
        }
        return data
    }
}
