import Foundation
import NyteCore

struct DiscardPlan: Sendable, Equatable {
    struct Kept: Sendable, Equatable {
        var path: String
        var bytes: Data
        var permissions: Int
    }

    var restoreWorktree: [String] = []
    var restoreFromHead: [String] = []
    var deleteUntracked: [String] = []
    var lost: [String] = []
    var skipped: [String] = []

    static let largestKeptFile = 16 << 20
    static let largestKeptTotal = 64 << 20

    var paths: [String] { restoreWorktree + restoreFromHead + deleteUntracked }
    var isEmpty: Bool { paths.isEmpty }

    static func make(_ entries: [GitEntry], group: ChangeGroup, root: URL) -> DiscardPlan {
        var plan = DiscardPlan()
        var kept = 0
        for entry in entries {
            if entry.conflict != nil || entry.submodule != nil {
                plan.skipped.append(entry.path)
                continue
            }
            switch group {
            case .conflicts:
                plan.skipped.append(entry.path)
            case .staged:
                plan.restoreFromHead.append(entry.path)
                if let original = entry.originalPath { plan.restoreFromHead.append(original) }
            case .changes:
                guard entry.isUntracked else {
                    plan.restoreWorktree.append(entry.path)
                    continue
                }
                plan.deleteUntracked.append(entry.path)
                let size = (try? root.appendingPathComponent(entry.path).resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                if size > largestKeptFile || kept + size > largestKeptTotal {
                    plan.lost.append(entry.path)
                } else {
                    kept += size
                }
            }
        }
        return plan
    }
}

struct DiscardUndo: Sendable {
    var unstagedPatch: Data?
    var stagedPatch: Data?
    var files: [DiscardPlan.Kept]

    var isEmpty: Bool { unstagedPatch == nil && stagedPatch == nil && files.isEmpty }

    @concurrent static func perform(_ plan: DiscardPlan, in repository: GitRepository) async throws(GitFailure) -> DiscardUndo {
        var undo = DiscardUndo(files: [])
        if !plan.restoreFromHead.isEmpty {
            let staged = try await repository.patch(staged: true, paths: plan.restoreFromHead)
            let unstaged = try await repository.patch(staged: false, paths: plan.restoreFromHead)
            undo.stagedPatch = staged.isEmpty ? nil : staged
            undo.unstagedPatch = unstaged.isEmpty ? nil : unstaged
        }
        if !plan.restoreWorktree.isEmpty {
            let unstaged = try await repository.patch(staged: false, paths: plan.restoreWorktree)
            if !unstaged.isEmpty { undo.unstagedPatch = (undo.unstagedPatch ?? Data()) + unstaged }
        }
        for path in plan.deleteUntracked where !plan.lost.contains(path) {
            let url = repository.url(of: path)
            guard let bytes = try? Data(contentsOf: url) else { continue }
            let permissions = (try? FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as? Int) ?? 0o644
            undo.files.append(DiscardPlan.Kept(path: path, bytes: bytes, permissions: permissions))
        }
        try await repository.restoreFromHead(plan.restoreFromHead)
        try await repository.restoreWorktree(plan.restoreWorktree)
        for path in plan.deleteUntracked {
            do {
                try FileManager.default.removeItem(at: repository.url(of: path))
            } catch {
                throw GitFailure(.unreadable, command: "delete \(path)", message: error.localizedDescription)
            }
        }
        return undo
    }

    @concurrent func restore(in repository: GitRepository) async throws(GitFailure) {
        if let stagedPatch { try await repository.apply(stagedPatch, to: .indexAndWorktree) }
        if let unstagedPatch { try await repository.apply(unstagedPatch, to: .worktree) }
        for file in files {
            let url = repository.url(of: file.path)
            guard !FileManager.default.fileExists(atPath: url.path) else {
                throw GitFailure(.unreadable, command: "restore \(file.path)", message: "\(file.path) exists again; it was left as it is.")
            }
            do {
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                try file.bytes.write(to: url)
                try FileManager.default.setAttributes([.posixPermissions: file.permissions], ofItemAtPath: url.path)
            } catch {
                throw GitFailure(.unreadable, command: "restore \(file.path)", message: error.localizedDescription)
            }
        }
    }
}
