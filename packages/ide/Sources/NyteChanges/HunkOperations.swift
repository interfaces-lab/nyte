import Foundation
import NyteCore

enum HunkOperations {
    enum Undo: Sendable {
        case patch(Data, GitRepository.PatchTarget, reversed: Bool)
        case write(path: String, from: Data?, to: Data?)

        var inverted: Undo {
            switch self {
            case let .patch(data, target, reversed): .patch(data, target, reversed: !reversed)
            case let .write(path, from, to): .write(path: path, from: to, to: from)
            }
        }

        @concurrent func apply(in repository: GitRepository) async throws(GitFailure) {
            switch self {
            case let .patch(data, target, reversed):
                try await repository.apply(data, to: target, reversed: reversed)
            case let .write(path, from, to):
                try HunkOperations.write(path, expecting: from, to, in: repository)
            }
        }
    }

    static func reversed(_ hunks: [DiffHunk]) -> [DiffHunk] { hunks.map { DiffHunk(old: $0.new, new: $0.old) } }

    @concurrent static func perform(_ action: HunkAction, _ selection: DiffSelection, _ document: DiffDocument, path: String,
                                    in repository: GitRepository) async throws(GitFailure) -> Undo? {
        let hunks = document.diff.hunks
        let whole = selection == DiffSelection(hunks: hunks)
        let file = GitPatch.File(path: path)
        switch action {
        case .stage:
            if whole {
                try await repository.stage([path])
                return nil
            }
            if !document.oldExists { try await repository.markIntentToAdd([path]) }
            guard let patch = GitPatch.make(file, from: document.old, toward: document.new, hunks: hunks, selecting: selection) else {
                return nil
            }
            try await repository.apply(patch, to: .index)
            return nil
        case .unstage:
            if whole {
                try await repository.unstage([path] + [document.originalPath].compactMap { $0 }, headExists: document.headExists)
                return nil
            }
            guard let patch = GitPatch.make(file, from: document.new, toward: document.old, hunks: reversed(hunks),
                                            selecting: selection.reversed) else { return nil }
            try await repository.apply(patch, to: .index)
            return nil
        case .discard:
            if !document.oldExists, whole {
                let bytes = Data(document.new.bytes)
                try write(path, expecting: bytes, nil, in: repository)
                return .write(path: path, from: nil, to: bytes)
            }
            if !document.newExists {
                let restored = Data(selection.reversed.apply(from: document.new, toward: document.old, hunks: reversed(hunks)))
                try write(path, expecting: nil, restored, in: repository)
                return .write(path: path, from: restored, to: nil)
            }
            guard let patch = GitPatch.make(file, from: document.new, toward: document.old, hunks: reversed(hunks),
                                            selecting: selection.reversed) else { return nil }
            try await repository.apply(patch, to: .worktree)
            return .patch(patch, .worktree, reversed: true)
        case .revert:
            return nil
        }
    }

    static func write(_ path: String, expecting current: Data?, _ next: Data?, in repository: GitRepository) throws(GitFailure) {
        let url = repository.url(of: path)
        let disk = try? Data(contentsOf: url)
        guard disk == current else {
            throw GitFailure(.unreadable, command: "write \(path)", message: "\(path) changed on disk since it was compared. Nothing was written.")
        }
        do {
            if let next {
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                try next.write(to: url)
            } else {
                try FileManager.default.removeItem(at: url)
            }
        } catch {
            throw GitFailure(.unreadable, command: "write \(path)", message: error.localizedDescription)
        }
    }
}
