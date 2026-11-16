import Foundation
@testable import NyteChanges
@testable import NyteCore

extension ChangesCheck {
    func makeRepository(_ name: String, files: [String: String] = [:]) async -> GitRepository {
        let folder = scratch.appendingPathComponent(name, isDirectory: true)
        try? FileManager.default.removeItem(at: folder)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        await shell(["init", "-q", "-b", "main"], in: folder)
        for (path, text) in files { write(text, to: path, in: folder) }
        if !files.isEmpty {
            await shell(["add", "-A"], in: folder)
            await shell(["commit", "-q", "-m", "start"], in: folder)
        }
        return GitRepository(root: folder, environment: Self.isolated)
    }

    func write(_ text: String, to path: String, in folder: URL) {
        let url = folder.appendingPathComponent(path)
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? Data(text.utf8).write(to: url)
    }

    func read(_ path: String, in repository: GitRepository) -> String? {
        (try? Data(contentsOf: repository.url(of: path))).map { String(decoding: $0, as: UTF8.self) }
    }

    func porcelain(_ repository: GitRepository) async -> String {
        let output = await shell(["status", "--porcelain=v1", "--untracked-files=all"], in: repository.root)
        return output.text.replacingOccurrences(of: "\"", with: "").split(separator: "\n").sorted().joined(separator: "|")
    }

    func blob(_ spec: String, in repository: GitRepository) async -> String {
        await shell(["show", spec], in: repository.root).text
    }

    func statusStates() async {
        let names = ["a.txt", "space name.txt", "quote\"d.txt", "café/ünï.txt", "rename-me.txt", "mode.sh", "del.txt", "both.txt"]
        let repository = await makeRepository("status", files: Dictionary(uniqueKeysWithValues: names.map { ($0, "\($0)\nline\n") }))
        let root = repository.root
        write("changed\n", to: "a.txt", in: root)
        write("staged\n", to: "space name.txt", in: root)
        await shell(["add", "space name.txt"], in: root)
        await shell(["mv", "rename-me.txt", "renamed.txt"], in: root)
        try? FileManager.default.removeItem(at: root.appendingPathComponent("del.txt"))
        try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: root.appendingPathComponent("mode.sh").path)
        write("new\n", to: "ünï new.txt", in: root)
        write("added\n", to: "added.txt", in: root)
        await shell(["add", "added.txt"], in: root)
        write("quoted edit\n", to: "quote\"d.txt", in: root)
        write("café edit\n", to: "café/ünï.txt", in: root)
        write("staged\n", to: "both.txt", in: root)
        await shell(["add", "both.txt"], in: root)
        write("then unstaged\n", to: "both.txt", in: root)
        let report: GitStatusReport
        do { report = try await repository.status() } catch {
            return expect("status: reads", false, error.message)
        }
        func entry(_ path: String) -> GitEntry? { report.entries.first { $0.path == path } }
        let table: [(String, Bool)] = [
            ("worktree modified", entry("a.txt").map { $0.index == .unmodified && $0.worktree == .modified } ?? false),
            ("staged modification of a path with a space", entry("space name.txt").map { $0.index == .modified && $0.worktree == .unmodified } ?? false),
            ("staged rename keeps its source", entry("renamed.txt").map { $0.index == .renamed && $0.originalPath == "rename-me.txt" } ?? false),
            ("worktree deletion", entry("del.txt")?.worktree == .deleted),
            ("mode change reads both modes", entry("mode.sh").map { $0.indexMode == 0o100644 && $0.worktreeMode == 0o100755 } ?? false),
            ("untracked non-ASCII path with a space", entry("ünï new.txt")?.isUntracked == true),
            ("staged new file", entry("added.txt").map { $0.index == .added && $0.isStaged } ?? false),
            ("path with a double quote", entry("quote\"d.txt")?.worktree == .modified),
            ("non-ASCII folder and name", entry("café/ünï.txt")?.worktree == .modified),
            ("staged and unstaged at once", entry("both.txt").map { $0.isStaged && $0.isUnstaged } ?? false),
            ("branch head and commit", report.branch.name == "main" && report.branch.commit?.count == 40),
            ("every changed path and nothing else", report.entries.count == 10),
        ]
        for (name, holds) in table { expect("status \(name)", holds, report.entries.map { "\($0.path) \($0.index) \($0.worktree)" }.joined(separator: "; ")) }

        let conflicted = await makeRepository("conflict", files: ["c.txt": "base\n", "gone.txt": "base\n"])
        await shell(["checkout", "-q", "-b", "other"], in: conflicted.root)
        write("theirs\n", to: "c.txt", in: conflicted.root)
        await shell(["rm", "-q", "gone.txt"], in: conflicted.root)
        await shell(["commit", "-q", "-am", "theirs"], in: conflicted.root)
        await shell(["checkout", "-q", "main"], in: conflicted.root)
        write("ours\n", to: "c.txt", in: conflicted.root)
        write("ours too\n", to: "gone.txt", in: conflicted.root)
        await shell(["commit", "-q", "-am", "ours"], in: conflicted.root)
        await shell(["merge", "-q", "other"], in: conflicted.root)
        let merge = try? await conflicted.status()
        expect("status conflict: both modified", merge?.entries.first { $0.path == "c.txt" }?.conflict == .bothModified,
               merge.map { "\($0.entries)" } ?? "nil")
        expect("status conflict: deleted by them", merge?.entries.first { $0.path == "gone.txt" }?.conflict == .deletedByThem)
        let document = await DiffDocument.load(.repository(conflicted, path: "c.txt", comparison: .worktree))
        expect("diff of a conflict compares ours with the marked file", document.conflict == .bothModified && document.shape == .text
            && document.new.string(of: 0).hasPrefix("<<<<<<<"))

        let inner = await makeRepository("inner", files: ["lib.txt": "v1\n"])
        let outer = await makeRepository("outer", files: ["readme.txt": "hi\n"])
        await shell(["-c", "protocol.file.allow=always", "submodule", "add", "-q", inner.root.path, "lib"], in: outer.root)
        await shell(["commit", "-q", "-m", "submodule"], in: outer.root)
        write("v2\n", to: "lib/lib.txt", in: outer.root)
        await shell(["commit", "-q", "-am", "inner change"], in: outer.root.appendingPathComponent("lib"))
        let withSubmodule = try? await outer.status()
        let submodule = withSubmodule?.entries.first { $0.path == "lib" }
        expect("status submodule: a new commit inside reads as a changed submodule", submodule?.submodule?.contains(.commitChanged) == true,
               "\(String(describing: submodule))")

        let clone = scratch.appendingPathComponent("clone")
        try? FileManager.default.removeItem(at: clone)
        await shell(["clone", "-q", inner.root.path, clone.path], in: scratch)
        write("ahead\n", to: "lib.txt", in: clone)
        await shell(["commit", "-q", "-am", "ahead"], in: clone)
        let tracked = try? await GitRepository(root: clone, environment: Self.isolated).status()
        expect("status branch: upstream and one commit ahead",
               tracked?.branch.upstream == "origin/main" && tracked?.branch.ahead == 1 && tracked?.branch.behind == 0,
               "\(String(describing: tracked?.branch))")

        let ignoring = await makeRepository("ignoring", files: [".gitignore": "*.log\nbuild/\n", "kept.txt": "k\n"])
        write("noise\n", to: "debug.log", in: ignoring.root)
        write("object\n", to: "build/out.o", in: ignoring.root)
        write("edit\n", to: "kept.txt", in: ignoring.root)
        let plainReport = try? await ignoring.status()
        let withIgnored = try? await ignoring.status(includingIgnored: true)
        expect("status ignored: left out unless asked", plainReport?.ignored == [] && plainReport?.entries.map(\.path) == ["kept.txt"])
        expect("status ignored: reported apart from the entries, folders without their slash",
               withIgnored?.ignored.sorted() == ["build", "debug.log"] && withIgnored?.entries.map(\.path) == ["kept.txt"],
               "\(String(describing: withIgnored?.ignored)) \(String(describing: withIgnored?.entries.map(\.path)))")

        if let branch = tracked?.branch {
            let line = BranchLine.make(branch, subject: "ahead")
            expect("branch line: one ahead of its upstream reads ↑1", line.tracking == "\u{2191}1" && line.tip == "ahead"
                && line.spoken == "Branch main, 1 ahead, ahead", "\(line)")
        }

        let unborn = await makeRepository("unborn")
        write("first\n", to: "first.txt", in: unborn.root)
        let fresh = try? await unborn.status()
        expect("status unborn branch: no commit yet, the file is untracked", fresh?.branch.isUnborn == true
            && fresh?.entries.first?.isUntracked == true)
        switch await GitRepository.locate(scratch, environment: Self.isolated) {
        case .notRepository: expect("locate: a plain folder is not a repository", true)
        default: expect("locate: a plain folder is not a repository", false)
        }
        switch await GitRepository.locate(scratch, executable: URL(fileURLWithPath: "/nonexistent/git"), environment: Self.isolated) {
        case .gitMissing: expect("locate: a missing git reads as git missing", true)
        default: expect("locate: a missing git reads as git missing", false)
        }
        switch await GitRepository.locate(conflicted.root.appendingPathComponent("."), environment: Self.isolated) {
        case let .repository(found): expect("locate: finds the top level", found.root.path == conflicted.root.path, found.root.path)
        default: expect("locate: finds the top level", false)
        }
    }

    func writes() async {
        let repository = await makeRepository("writes", files: ["a.txt": "a\n", "b c.txt": "b\n", "keep.txt": "k\n"])
        let root = repository.root
        write("a2\n", to: "a.txt", in: root)
        write("b2\n", to: "b c.txt", in: root)
        write("new\n", to: "new file.txt", in: root)
        try? await repository.stage(["a.txt", "new file.txt"])
        var state = await porcelain(repository)
        expect("stage files: git reports them staged", state == " M b c.txt|A  new file.txt|M  a.txt", state)
        try? await repository.unstage(["a.txt"], headExists: true)
        state = await porcelain(repository)
        expect("unstage a file: git reports it unstaged again", state == " M a.txt| M b c.txt|A  new file.txt", state)
        let entries = (try? await repository.status().entries) ?? []
        let plan = DiscardPlan.make(entries.filter { $0.path == "b c.txt" || $0.path == "a.txt" }, group: .changes, root: root)
        let undo = try? await DiscardUndo.perform(plan, in: repository)
        state = await porcelain(repository)
        expect("discard files: the working tree matches the index", read("b c.txt", in: repository) == "b\n"
            && read("a.txt", in: repository) == "a\n" && state == "A  new file.txt", state)
        try? await undo?.restore(in: repository)
        expect("undo discard: the discarded edits come back", read("b c.txt", in: repository) == "b2\n"
            && read("a.txt", in: repository) == "a2\n")
        write("scratch\n", to: "loose.txt", in: root)
        let loose = DiscardPlan.make([GitEntry(path: "loose.txt", index: .untracked, worktree: .untracked)], group: .changes, root: root)
        let looseUndo = try? await DiscardUndo.perform(loose, in: repository)
        expect("discard an untracked file: it is deleted", read("loose.txt", in: repository) == nil)
        try? await looseUndo?.restore(in: repository)
        expect("undo: the untracked file comes back", read("loose.txt", in: repository) == "scratch\n")
        let staged = (try? await repository.status().entries.filter { $0.path == "new file.txt" }) ?? []
        let stagedPlan = DiscardPlan.make(staged, group: .staged, root: root)
        let stagedUndo = try? await DiscardUndo.perform(stagedPlan, in: repository)
        state = await porcelain(repository)
        expect("discard a staged new file: it leaves the index and the disk", read("new file.txt", in: repository) == nil
            && !state.contains("new file.txt"), state)
        try? await stagedUndo?.restore(in: repository)
        state = await porcelain(repository)
        expect("undo: the staged new file is staged again", state.contains("A  new file.txt"), state)
        do {
            let head = try await repository.commit(message: "Second commit\n\nBody line.", amend: false)
            let log = await shell(["log", "-1", "--format=%H %s"], in: root).text
            expect("commit: the new HEAD and subject are what git logs", log.hasPrefix(head + " Second commit"), log)
            let amended = try await repository.commit(message: "Second commit, amended", amend: true)
            let count = await shell(["rev-list", "--count", "HEAD"], in: root).text.trimmingCharacters(in: .whitespacesAndNewlines)
            expect("amend: HEAD is replaced, not added to", amended != head && count == "2", count)
            let message = try await repository.headMessage()
            expect("amend: the head message reads back", message == "Second commit, amended", message)
        } catch {
            expect("commit", false, error.message)
        }
        do {
            _ = try await repository.commit(message: "nothing", amend: false)
            expect("commit with nothing staged fails with git's message", false)
        } catch {
            expect("commit with nothing staged fails with git's own message", error.message.contains("nothing") || error.message.contains("no changes"),
                   error.message)
        }
        let hooked = scratch.appendingPathComponent("writes/.git/hooks/pre-commit")
        try? Data("#!/bin/sh\necho 'lint: 3 problems' >&2\nexit 1\n".utf8).write(to: hooked)
        try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: hooked.path)
        try? await repository.stage(["b c.txt"])
        do {
            _ = try await repository.commit(message: "hooked", amend: false)
            expect("a failing hook fails the commit", false)
        } catch {
            expect("a failing pre-commit hook fails the commit and carries its stderr", error.message.contains("lint: 3 problems"), error.message)
        }
    }

    func lineWrites() async {
        let base = (1...12).map { "line \($0)\n" }.joined()
        let repository = await makeRepository("lines", files: ["f.txt": base, "quote\"s é.txt": "x\ny\n"])
        var edited = base.replacingOccurrences(of: "line 2\n", with: "line two\n")
        edited = edited.replacingOccurrences(of: "line 9\n", with: "line nine\nline nine and a half\n") + "line 13"
        write(edited, to: "f.txt", in: repository.root)
        func document(_ comparison: DiffComparison, _ path: String = "f.txt") async -> DiffDocument {
            await DiffDocument.load(.repository(repository, path: path, comparison: comparison))
        }
        var index = ""
        var worktree = await document(.worktree)
        expect("hunks: the working tree diff has three hunks", worktree.diff.hunks.count == 3, "\(worktree.diff.hunks)")
        _ = try? await HunkOperations.perform(.stage, DiffSelection(hunks: [worktree.diff.hunks[1]]), worktree, path: "f.txt", in: repository)
        let afterHunk = base.replacingOccurrences(of: "line 9\n", with: "line nine\nline nine and a half\n")
        index = await blob(":f.txt", in: repository)
        expect("stage a hunk: the index holds that hunk only", index == afterHunk, index)
        worktree = await document(.worktree)
        let last = worktree.diff.hunks[worktree.diff.hunks.count - 1]
        _ = try? await HunkOperations.perform(.stage, DiffSelection(new: IndexSet(integer: last.new.lowerBound)), worktree,
                                              path: "f.txt", in: repository)
        index = await blob(":f.txt", in: repository)
        expect("stage one added line with no newline at the end of the file", index == afterHunk + "line 13", index)
        var staged = await document(.staged)
        let half = staged.diff.hunks.first { $0.new.count == 2 }
        if let half {
            _ = try? await HunkOperations.perform(.unstage, DiffSelection(new: IndexSet(integer: half.new.lowerBound + 1)), staged,
                                                  path: "f.txt", in: repository)
        }
        let unstagedHalf = base.replacingOccurrences(of: "line 9\n", with: "line nine\n") + "line 13"
        index = await blob(":f.txt", in: repository)
        expect("unstage one staged line", index == unstagedHalf, index)
        staged = await document(.staged)
        _ = try? await HunkOperations.perform(.unstage, DiffSelection(hunks: staged.diff.hunks), staged, path: "f.txt", in: repository)
        index = await blob(":f.txt", in: repository)
        expect("unstage the whole file: the index matches HEAD", index == base, index)
        worktree = await document(.worktree)
        let undo = try? await HunkOperations.perform(.discard, DiffSelection(old: IndexSet(integer: 1), new: IndexSet(integer: 1)), worktree,
                                                     path: "f.txt", in: repository)
        let discarded = edited.replacingOccurrences(of: "line two\n", with: "line 2\n")
        expect("discard lines: only the chosen change leaves the working tree", read("f.txt", in: repository) == discarded,
               read("f.txt", in: repository) ?? "nil")
        try? await undo?.apply(in: repository)
        expect("undo discard lines: the change comes back", read("f.txt", in: repository) == edited)
        try? await undo?.inverted.apply(in: repository)
        expect("redo discard lines", read("f.txt", in: repository) == discarded)

        write("one\ntwo\nthree\n", to: "brand new.txt", in: repository.root)
        let untracked = await document(.worktree, "brand new.txt")
        _ = try? await HunkOperations.perform(.stage, DiffSelection(new: IndexSet([0, 2])), untracked, path: "brand new.txt", in: repository)
        index = await blob(":brand new.txt", in: repository)
        expect("stage lines of an untracked file", index == "one\nthree\n", index)
        write("x\nY\n", to: "quote\"s é.txt", in: repository.root)
        let quoted = await document(.worktree, "quote\"s é.txt")
        _ = try? await HunkOperations.perform(.stage, DiffSelection(old: IndexSet(integer: 1), new: IndexSet(integer: 1)), quoted,
                                              path: "quote\"s é.txt", in: repository)
        index = await blob(":quote\"s é.txt", in: repository)
        expect("stage a line in a path with a quote and an accent", index == "x\nY\n", index)
        try? FileManager.default.removeItem(at: repository.url(of: "f.txt"))
        await shell(["checkout", "--", "brand new.txt"], in: repository.root)
        let deleted = await document(.worktree)
        expect("a deleted file diffs as all removed", deleted.isDeleted && deleted.diff.addedLines == 0)
        _ = try? await HunkOperations.perform(.discard, DiffSelection(old: IndexSet(integer: 0)), deleted, path: "f.txt", in: repository)
        expect("discard one line of a deletion restores that line", read("f.txt", in: repository) == "line 1\n",
               read("f.txt", in: repository) ?? "nil")

        let crlf = "a\r\nb\r\nc\r\n"
        let binary = await makeRepository("special", files: ["w.txt": crlf, "logo.png": "\u{89}PNG\0\0\0", "same.txt": "same\n"])
        write("a\r\nB\r\nc\r\n", to: "w.txt", in: binary.root)
        let windows = await DiffDocument.load(.repository(binary, path: "w.txt", comparison: .worktree))
        expect("CRLF lines diff by content and keep their line ending", windows.diff.hunks == [DiffHunk(old: 1..<2, new: 1..<2)]
            && windows.new.string(of: 1) == "B")
        write("\u{89}PNG\0\0\0more", to: "logo.png", in: binary.root)
        let image = await DiffDocument.load(.repository(binary, path: "logo.png", comparison: .worktree))
        if case .binary = image.shape { expect("a binary file has the binary state", true) } else { expect("a binary file has the binary state", false) }
        await shell(["mv", "same.txt", "moved.txt"], in: binary.root)
        let moved = await DiffDocument.load(.repository(binary, path: "moved.txt", comparison: .staged))
        expect("a rename without edits has the identical state and its source", moved.shape == .identical && moved.originalPath == "same.txt")
    }
}
