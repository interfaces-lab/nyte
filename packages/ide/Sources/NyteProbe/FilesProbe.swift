import AppKit
import NyteCore
@testable import NyteFiles
import NyteUI

@MainActor func runFilesProbe(_ arguments: [String]) async {
    guard arguments.first == "check" else { fail("NyteProbe files: unknown command; see NyteProbe --help") }
    let check = FilesCheck()
    check.savedState()
    check.savedStateMigration()
    await check.operations()
    await check.gitStatus()
    await check.navigatorMenu()
    check.cleanUp()
    print(check.failures == 0 ? "files check: all passed" : "files check: \(check.failures) failed")
    if check.failures > 0 { exit(1) }
}

@MainActor private final class FilesCheck {
    var failures = 0
    private let folder = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-files-check-\(UUID().uuidString)")
    private var trashed: [URL] = []
    private var log: [(FileOperation, Result<URL, FileOperationFailure>)] = []
    private let undo = UndoManager()
    private lazy var history = FileHistory(undoManager: { [undo] in undo }) { [weak self] operation, result in
        self?.log.append((operation, result))
        if case let .success(url) = result, case .trash = operation { self?.trashed.append(url) }
    }

    func expect(_ condition: Bool, _ name: String, _ saw: @autoclosure () -> String = "") {
        if condition { return print("ok    \(name)") }
        failures += 1
        let detail = saw()
        print("FAIL  \(name)\n      saw: \(detail.isEmpty ? "(nothing)" : detail)")
    }

    func savedState() {
        let current = try? JSONEncoder().encode(NavigatorState(expanded: ["Sources", "Sources/NyteFiles"]))
        let newer = try? JSONEncoder().encode(NavigatorState(version: NavigatorState.currentVersion + 1, expanded: ["x"]))
        let cases: [(String, Data?, [String]?, NavigatorState, Bool)] = [
            ("a stored value is read back", current, nil, NavigatorState(expanded: ["Sources", "Sources/NyteFiles"]), false),
            ("the old string array migrates", nil, ["packages", "packages/ide"], NavigatorState(expanded: ["packages", "packages/ide"]), false),
            ("a stored value wins over a leftover old array", current, ["old"], NavigatorState(expanded: ["Sources", "Sources/NyteFiles"]), false),
            ("nothing saved starts fresh", nil, nil, NavigatorState(), false),
            ("a newer version falls back to fresh", newer, nil, NavigatorState(), true),
            ("garbage falls back to fresh", Data("{not json".utf8), nil, NavigatorState(), true),
        ]
        for (name, data, legacy, want, unreadable) in cases {
            let got = NavigatorState.decode(data, legacy: legacy)
            let isUnreadable = if case .unreadable = got.origin { true } else { false }
            expect(got.state == want && isUnreadable == unreadable, "saved state: \(name)", "\(got.state) \(got.origin)")
        }
        let migrated = NavigatorState.decode(nil, legacy: ["a"]).origin
        expect(migrated == .migrated, "saved state: an old array is reported as migrated", "\(migrated)")
    }

    func savedStateMigration() {
        let suite = "ai.nyte.probe.files.\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else { return expect(false, "a scratch defaults domain opens") }
        defer { defaults.removePersistentDomain(forName: suite) }
        let root = "/tmp/workspace"
        defaults.set(["hub", "docs"], forKey: NavigatorState.legacyKey(for: root))
        let first = NavigatorState.load(root: root, from: defaults)
        let second = NavigatorState.load(root: root, from: defaults)
        expect(first.expanded == ["hub", "docs"] && second == first, "migration: the old array is read once and kept as the new value")
        expect(defaults.object(forKey: NavigatorState.legacyKey(for: root)) == nil, "migration: the old key is removed")
        expect(defaults.data(forKey: NavigatorState.key(for: root)) != nil, "migration: the new value is saved")
    }

    private func make(_ name: String, _ text: String = "") -> URL {
        let url = folder.appendingPathComponent(name)
        try? Data(text.utf8).write(to: url)
        return url
    }

    private func exists(_ name: String) -> Bool { FileManager.default.fileExists(atPath: folder.appendingPathComponent(name).path) }

    private func act(_ operation: FileOperation) async -> Result<URL, FileOperationFailure> {
        undo.beginUndoGrouping()
        let task = history.start(operation)
        undo.endUndoGrouping()
        return await task.value
    }

    private func settle(after count: Int) async -> Result<URL, FileOperationFailure>? {
        let deadline = ContinuousClock.now + .seconds(5)
        while log.count <= count, ContinuousClock.now < deadline {
            try? await Task.sleep(for: .milliseconds(10))
            guard !Task.isCancelled else { return nil }
        }
        return log.count > count ? log.last?.1 : nil
    }

    private func undoLast() async -> Result<URL, FileOperationFailure>? {
        let count = log.count
        undo.undo()
        return await settle(after: count)
    }

    private func redoLast() async -> Result<URL, FileOperationFailure>? {
        let count = log.count
        undo.redo()
        return await settle(after: count)
    }

    func operations() async {
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        undo.groupsByEvent = false

        let doomed = make("a.txt", "a")
        let trashResult = await act(.trash(doomed))
        let inTrash = (try? trashResult.get()).map { FileManager.default.fileExists(atPath: $0.path) } ?? false
        expect(!exists("a.txt") && inTrash && undo.undoActionName == "Move to Trash",
               "Move to Trash moves the file and offers Undo Move to Trash", "undo name \(undo.undoActionName)")
        _ = await undoLast()
        expect(exists("a.txt") && !inTrashStill(trashResult), "undo puts the file back where it was")
        expect(undo.redoActionName == "Move to Trash", "redo is offered as Redo Move to Trash", undo.redoActionName)
        _ = await redoLast()
        expect(!exists("a.txt"), "redo moves it to the Trash again")
        _ = await undoLast()
        expect(exists("a.txt"), "undo after redo puts it back again")

        let original = make("b.txt", "b")
        _ = await act(.rename(original, to: "c.txt"))
        expect(!exists("b.txt") && exists("c.txt") && undo.undoActionName == "Rename", "rename renames and offers Undo Rename")
        _ = await undoLast()
        expect(exists("b.txt") && !exists("c.txt"), "undo renames it back")
        _ = await redoLast()
        expect(!exists("b.txt") && exists("c.txt"), "redo renames it again")

        let source = make("d.txt", "d")
        _ = await act(.duplicate(source))
        expect(exists("d copy.txt") && undo.undoActionName == "Duplicate", "duplicate makes “d copy.txt” and offers Undo Duplicate")
        _ = await undoLast()
        expect(!exists("d copy.txt") && exists("d.txt"), "undo moves the copy to the Trash and keeps the original")
        _ = await redoLast()
        expect(exists("d copy.txt"), "redo puts the copy back")

        _ = await act(.createFile(in: folder))
        expect(exists("untitled") && undo.undoActionName == "New File", "New File makes “untitled” and offers Undo New File")
        _ = await undoLast()
        expect(!exists("untitled"), "undo removes the new file")
        _ = await redoLast()
        expect(exists("untitled"), "redo brings the new file back")

        _ = await act(.createFolder(in: folder))
        expect(exists("untitled folder") && undo.undoActionName == "New Folder", "New Folder makes “untitled folder”")
        _ = await undoLast()
        expect(!exists("untitled folder"), "undo removes the new folder")

        let kept = make("e.txt", "old")
        let keptTrash = await act(.trash(kept))
        _ = make("e.txt", "new")
        let refused = await undoLast()
        let text = (try? String(contentsOf: folder.appendingPathComponent("e.txt"), encoding: .utf8)) ?? ""
        let refusal = if case let .failure(failure) = refused { failure.title } else { "no failure" }
        expect(text == "new" && inTrashStill(keptTrash), "putting back refuses when the name is taken and keeps both files",
               "\(refusal), e.txt holds \(text)")
        print("      the refusal reads: \(refusal)")
        expect(!undo.canRedo, "a refused put-back leaves nothing to redo")
    }

    private func inTrashStill(_ result: Result<URL, FileOperationFailure>) -> Bool {
        (try? result.get()).map { FileManager.default.fileExists(atPath: $0.path) } ?? false
    }

    private let repository = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-files-git-\(UUID().uuidString)")
    private static let quietGit = ["GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1", "GIT_TERMINAL_PROMPT": "0"]

    private var gitEnvironment: [String: String] {
        ProcessInfo.processInfo.environment.merging(Self.quietGit) { $1 }
    }

    private func git(_ arguments: [String]) {
        let process = Process()
        process.executableURL = GitRepository.systemGit
        process.arguments = ["-C", repository.path, "-c", "user.name=Nyte", "-c", "user.email=nyte@example.com",
                             "-c", "init.defaultBranch=main"] + arguments
        process.environment = gitEnvironment
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            expect(false, "git \(arguments.first ?? "") starts", error.localizedDescription)
        }
    }

    private func write(_ path: String, _ text: String) {
        let url = repository.appendingPathComponent(path)
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? Data(text.utf8).write(to: url)
    }

    func gitStatus() async {
        try? FileManager.default.createDirectory(at: repository, withIntermediateDirectories: true)
        git(["init", "-q"])
        for name in ["modified.txt", "staged.txt", "deleted.txt", "gone.txt", "old.txt", "conflict.txt", "sub/inner.txt"] {
            write(name, "\(name)\n")
        }
        write(".gitignore", "build/\n*.log\n")
        git(["add", "-A"])
        git(["commit", "-q", "-m", "base"])
        git(["checkout", "-q", "-b", "other"])
        write("conflict.txt", "theirs\n")
        git(["commit", "-q", "-am", "theirs"])
        git(["checkout", "-q", "main"])
        write("conflict.txt", "ours\n")
        git(["commit", "-q", "-am", "ours"])
        git(["merge", "-q", "other"])
        write("modified.txt", "changed\n")
        write("staged.txt", "changed\n")
        git(["add", "staged.txt"])
        write("added.txt", "new\n")
        git(["add", "added.txt"])
        try? FileManager.default.removeItem(at: repository.appendingPathComponent("deleted.txt"))
        git(["rm", "-q", "gone.txt"])
        git(["mv", "old.txt", "new.txt"])
        write("untracked.txt", "loose\n")
        write("sub/inner.txt", "changed\n")
        write("build/out.bin", "")
        write("debug.log", "")

        guard case let .repository(found) = await GitRepository.locate(repository, environment: gitEnvironment) else {
            return expect(false, "git: the temporary repository is found")
        }
        let status: GitStatus
        do {
            status = try await GitStatus.read(found, workspace: repository)
        } catch {
            return expect(false, "git: status reads", "\(error.command): \(error.message)")
        }
        let byPath = Dictionary(status.changes.map { ($0.path, $0.status) }, uniquingKeysWith: { first, _ in first })
        let expected: [(String, FileTree.Status)] = [
            ("modified.txt", .modified), ("staged.txt", .modified), ("added.txt", .added), ("deleted.txt", .deleted),
            ("gone.txt", .deleted), ("new.txt", .renamed), ("untracked.txt", .untracked), ("conflict.txt", .conflicted),
            ("sub/inner.txt", .modified),
        ]
        for (path, want) in expected {
            let got = byPath[path]
            expect(got == want, "git: \(path) maps to \(want) and shows \(NavigatorChange.letter(want))",
                   "\(got.map { "\($0)" } ?? "absent")")
        }
        expect(byPath["old.txt"] == nil, "git: a rename's source path is not marked", "\(String(describing: byPath["old.txt"]))")
        expect(status.ignored.contains("build") && status.ignored.contains("debug.log"),
               "git: ignored paths are read (build, debug.log)", status.ignored.joined(separator: ", "))

        do {
            let nested = try await GitStatus.read(found, workspace: repository.appendingPathComponent("sub"))
            expect(nested.changes.map(\.path) == ["inner.txt"] && nested.changes.first?.status == .modified,
                   "git: a workspace inside the repository sees its own paths only", nested.changes.map(\.path).joined(separator: ", "))
        } catch {
            expect(false, "git: status reads for a nested workspace", error.message)
        }
        let outside = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-files-plain-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: outside) }
        let plain = await GitRepository.locate(outside, environment: gitEnvironment)
        expect(plain == .notRepository(outside), "git: a folder outside any repository is not a repository", "\(plain)")

        let letters = FileTree.Status.allStatuses.map { NavigatorChange.letter($0) }.joined()
        expect(letters == "MADRUC", "git: the status column takes the kit's letters (M A D R U C)", letters)
    }

    func navigatorMenu() async {
        let root = folder.appendingPathComponent("menu", isDirectory: true)
        try? FileManager.default.createDirectory(at: root.appendingPathComponent("sub"), withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: root.appendingPathComponent("f.txt").path, contents: Data())
        let navigator = FileNavigatorViewController(workspace: Workspace(root: root))
        navigator.view.frame = NSRect(x: 0, y: 0, width: 256, height: 400)
        let deadline = ContinuousClock.now + .seconds(5)
        while navigator.tree.rowCount < 2, ContinuousClock.now < deadline {
            try? await Task.sleep(for: .milliseconds(10))
            guard !Task.isCancelled else { return }
        }
        let ready = navigator.tree.rowCount >= 2
        let rows = (0 ..< navigator.tree.rowCount).map { navigator.tree.name(of: navigator.tree.node(atRow: $0)) }
        guard ready, let sub = rows.firstIndex(of: "sub"), let file = rows.firstIndex(of: "f.txt") else {
            return expect(false, "navigator menu: the folder loads", rows.joined(separator: ", "))
        }
        let find = NSMenuItem(title: "", action: #selector(FileNavigatorCommands.findInFolder(_:)), keyEquivalent: "")
        let ask = NSMenuItem(title: "", action: #selector(FileNavigatorCommands.askNyte(_:)), keyEquivalent: "")
        navigator.list.selectedRow = file
        func titles(_ rows: IndexSet) -> [String] { navigator.menu(for: rows)?.items.map(\.title) ?? [] }
        let bare = titles([sub])
        expect(!bare.contains("Find in Folder…") && !bare.contains("Ask Nyte About…")
            && !navigator.validateUserInterfaceItem(find) && !navigator.validateUserInterfaceItem(ask),
            "navigator menu: without their closures neither item shows nor validates", bare.joined(separator: ", "))
        var found: [URL] = []
        var asked: [[URL]] = []
        navigator.onFindInFolder = { found.append($0) }
        navigator.onAskAgent = { asked.append($0) }
        func choose(_ title: String, _ rows: IndexSet) {
            guard let menu = navigator.menu(for: rows), let index = menu.items.firstIndex(where: { $0.title == title }) else { return }
            if menu.items[index].isEnabled { menu.performActionForItem(at: index) }
        }
        choose("Find in Folder…", [sub])
        choose("Find in Folder…", [file])
        choose("Ask Nyte About…", [sub, file])
        let paths = found.map { $0.standardizedFileURL.path }
        let want = [root.appendingPathComponent("sub").path, root.path].map { URL(fileURLWithPath: $0).standardizedFileURL.path }
        expect(paths == want, "navigator menu: Find in Folder takes a folder, and a file's parent", paths.joined(separator: ", "))
        expect(asked.map { $0.map(\.lastPathComponent) } == [["sub", "f.txt"]], "navigator menu: Ask Nyte About takes every target row",
            "\(asked.map { $0.map(\.lastPathComponent) })")
        expect(navigator.validateUserInterfaceItem(find) && navigator.validateUserInterfaceItem(ask),
            "navigator menu: with their closures both responder actions validate")
        navigator.findInFolder(nil)
        navigator.askNyte(nil)
        expect(found.last.map { $0.standardizedFileURL.path } == URL(fileURLWithPath: root.path).standardizedFileURL.path
            && asked.last?.map(\.lastPathComponent) == ["f.txt"],
            "navigator menu: the responder actions act on the selected row", "\(found.last?.path ?? "nil") \(asked.last ?? [])")
    }

    func cleanUp() {
        try? FileManager.default.removeItem(at: repository)
        for url in trashed where FileManager.default.fileExists(atPath: url.path) { try? FileManager.default.removeItem(at: url) }
        try? FileManager.default.removeItem(at: folder)
    }
}

@MainActor private enum NavigatorChange {
    static func letter(_ status: FileTree.Status) -> String {
        FileNavigatorViewController.change(status).map { String($0.letter) } ?? "-"
    }
}

private extension FileTree.Status {
    static let allStatuses: [FileTree.Status] = [.modified, .added, .deleted, .renamed, .untracked, .conflicted]
}
