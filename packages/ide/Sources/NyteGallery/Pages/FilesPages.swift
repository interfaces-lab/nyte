import AppKit
import NyteCore
@testable import NyteFiles
@testable import NyteTerminal
@testable import NyteUI

@MainActor
private enum FilesSpeed {
    static let repository = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../../../../..").standardizedFileURL
    static let size = NSSize(width: Metric.sidebarWidth, height: 640)
    static let millisecond: Double = 1_000
    static let percentile = 0.95
    static let steps = 400
    static let timeout: Double = 10
    static let stride = 37
    static let revealed = ["packages/ide/Sources", "packages/app/src", "packages/core/src", "packages/host/src", "packages/ui/src"]

    static func descendants<View: NSView>(of view: NSView, as type: View.Type) -> View? {
        if let match = view as? View { return match }
        return view.subviews.lazy.compactMap { descendants(of: $0, as: type) }.first
    }

    static func summary(_ values: [Double]) -> String {
        let sorted = values.sorted()
        let mean = values.reduce(0, +) / Double(max(values.count, 1))
        return String(format: "mean %.2f ms, p95 %.2f ms, max %.2f ms", mean,
                      sorted[min(sorted.count - 1, Int(Double(sorted.count) * percentile))], sorted.last ?? 0)
    }

    static func expandable() -> [String] {
        var found: [String] = []
        for folder in revealed {
            guard let walker = FileManager.default.enumerator(atPath: repository.appendingPathComponent(folder).path) else { continue }
            found.append(folder)
            while let item = walker.nextObject() as? String {
                guard !item.split(separator: "/").contains(where: { $0.hasPrefix(".") || $0 == "node_modules" }) else { continue }
                var isDirectory: ObjCBool = false
                let path = folder + "/" + item
                if FileManager.default.fileExists(atPath: repository.appendingPathComponent(path).path, isDirectory: &isDirectory),
                   isDirectory.boolValue { found.append(path) }
            }
        }
        let parents = Set(found.flatMap { path in
            let parts = path.split(separator: "/")
            return (1 ..< parts.count).map { parts.prefix($0).joined(separator: "/") }
        })
        return Array(parents.union(found))
    }

    static func open(_ expanded: [String], in window: NSWindow) async -> (FileNavigatorViewController, Double, NSTableView?) {
        let workspace = Workspace(root: repository)
        NavigatorState(expanded: expanded).save(root: workspace.root.path, to: .standard)
        let start = CACurrentMediaTime()
        let navigator = FileNavigatorViewController(workspace: workspace)
        window.contentView = navigator.view
        navigator.view.frame = NSRect(origin: .zero, size: size)
        while (descendants(of: navigator.view, as: NSTableView.self)?.numberOfRows ?? 0) == 0 {
            guard await Wait.pause(.milliseconds(1)), CACurrentMediaTime() - start < timeout else { break }
        }
        window.displayIfNeeded()
        return (navigator, (CACurrentMediaTime() - start) * millisecond, descendants(of: navigator.view, as: NSTableView.self))
    }

    static func measure() async -> [String] {
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
        window.alphaValue = 0
        window.orderBack(nil)
        let (_, cold, _) = await open([], in: window)
        let folders = expandable()
        let (navigator, warm, found) = await open(folders, in: window)
        guard let table = found, let scroll = table.enclosingScrollView else { return ["no table"] }
        _ = navigator
        let rows = table.numberOfRows
        let clip = scroll.contentView
        let height = max(0, table.bounds.height - clip.bounds.height)
        var steady: [Double] = []
        for step in 0 ..< steps {
            let begin = CACurrentMediaTime()
            clip.scroll(to: NSPoint(x: 0, y: min(CGFloat(step) * Metric.row * 2, height)))
            scroll.reflectScrolledClipView(clip)
            window.displayIfNeeded()
            steady.append((CACurrentMediaTime() - begin) * millisecond)
        }
        var jumps: [Double] = []
        for step in 0 ..< steps {
            let begin = CACurrentMediaTime()
            clip.scroll(to: NSPoint(x: 0, y: CGFloat((step * stride) % max(rows, 1)) / CGFloat(max(rows, 1)) * height))
            scroll.reflectScrolledClipView(clip)
            window.displayIfNeeded()
            jumps.append((CACurrentMediaTime() - begin) * millisecond)
        }
        window.orderOut(nil)
        UserDefaults.standard.removeObject(forKey: NavigatorState.key(for: repository.path))
        return [
            "navigator over \(repository.lastPathComponent), \(Int(size.width)) by \(Int(size.height)), offscreen",
            String(format: "cold open, nothing expanded, to first rows drawn: %.1f ms", cold),
            String(format: "open with %d folders expanded (%d rows) to first rows drawn: %.1f ms", folders.count, rows, warm),
            "steady scroll two rows a frame: " + summary(steady),
            "jumps across the tree: " + summary(jumps),
        ]
    }
}

@MainActor
private enum FilesSpecimens {
    static let fixture = FilesSpeed.repository.appendingPathComponent("packages/ide/Fixtures/notifyhub-go")
    static let gap = Space.x5
    static let terminalSize = NSSize(width: 720, height: 360)
    static var navigators: [FileNavigatorViewController] = []
    static var terminals: [TerminalViewController] = []
    static var copies: [URL] = []

    enum State { case inactive, active, keyboard, renaming }

    struct Plan {
        var root: URL
        var expanded: [String]
        var selected: String
        var hovered: Int?
        var showsGuides = false
        var state: State
    }

    static func git(_ arguments: [String], in folder: URL) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = ["-C", folder.path, "-c", "user.name=Nyte", "-c", "user.email=nyte@example.com"] + arguments
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try? process.run()
        process.waitUntilExit()
    }

    static func changedFixture() -> URL {
        let copy = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-gallery-\(UUID().uuidString)/notifyhub-go")
        try? FileManager.default.createDirectory(at: copy.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? FileManager.default.copyItem(at: fixture, to: copy)
        copies.append(copy.deletingLastPathComponent())
        try? Data("build/\n".utf8).write(to: copy.appendingPathComponent(".gitignore"))
        git(["init", "-q"], in: copy)
        git(["add", "-A"], in: copy)
        git(["commit", "-q", "-m", "fixture"], in: copy)
        let hub = copy.appendingPathComponent("hub")
        try? (String(contentsOf: hub.appendingPathComponent("hub.go"), encoding: .utf8) + "\n// changed\n")
            .write(to: hub.appendingPathComponent("hub.go"), atomically: true, encoding: .utf8)
        try? FileManager.default.removeItem(at: hub.appendingPathComponent("stats.go"))
        git(["mv", "hub/email.go", "hub/mailer.go"], in: copy)
        try? Data("package hub\n".utf8).write(to: hub.appendingPathComponent("sms.go"))
        git(["add", "hub/sms.go"], in: copy)
        try? FileManager.default.createDirectory(at: copy.appendingPathComponent("docs"), withIntermediateDirectories: true)
        try? Data("# Notes\n".utf8).write(to: copy.appendingPathComponent("docs/notes.md"))
        try? FileManager.default.createDirectory(at: copy.appendingPathComponent("build"), withIntermediateDirectories: true)
        try? Data().write(to: copy.appendingPathComponent("build/notifyhub"))
        return copy
    }

    static func navigator(_ plan: Plan) -> NSView {
        let workspace = Workspace(root: plan.root)
        NavigatorState(expanded: plan.expanded).save(root: workspace.root.path, to: .standard)
        let navigator = FileNavigatorViewController(workspace: workspace)
        navigators.append(navigator)
        let view = navigator.view
        navigator.list.showsFocusAlways = plan.state == .active || plan.state == .keyboard
        Task { @MainActor in
            _ = await Wait.until { navigator.tree.rowCount > 0 }
            navigator.reveal(plan.root.appendingPathComponent(plan.selected))
            _ = await Wait.until { navigator.list.selectedRow != nil }
            _ = await Wait.pause(.milliseconds(400))
            if let hovered = plan.hovered { navigator.list.setHoveredRow(hovered) }
            navigator.list.setPointerInside(plan.showsGuides)
            if plan.state == .renaming, let row = navigator.list.selectedRow { navigator.beginRename(row: row) }
        }
        return Gallery.sized(view, width: FilesSpeed.size.width, height: FilesSpeed.size.height)
    }

    static func terminal() -> NSView {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-gallery-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? FileManager.default.copyItem(at: fixture, to: folder.appendingPathComponent("notifyhub-go"))
        copies.append(folder)
        let controller = TerminalViewController(workspace: Workspace(root: folder.appendingPathComponent("notifyhub-go")))
        terminals.append(controller)
        let card = PaneCard()
        card.embed(controller.view)
        return Gallery.sized(card, width: terminalSize.width, height: terminalSize.height)
    }

    static func driveTerminals() async {
        for controller in terminals {
            let view = controller.terminalView
            let pump: @MainActor () -> Void = { view.session?.enqueue { $0.produceFrame() } }
            _ = await Wait.until(.seconds(15)) {
                pump()
                return view.session != nil && view.cursor.visible
            }
            _ = await Wait.pause(.seconds(1))
            pump()
            view.session?.enqueue { $0.text("clear; ls -G; ls -G hub; echo '中文 wide characters ✓ 漢字'; echo './hub/hub.go:42:7: undefined: upgrader'\r") }
            _ = await Wait.until(.seconds(10)) {
                pump()
                return view.screenText.contains("✓ 漢字") && view.screenText.components(separatedBy: "✓ 漢字").count > 2
            }
            _ = await Wait.until(.seconds(5)) {
                pump()
                return view.screenText.contains("undefined: upgrader\n") || view.screenText.hasSuffix("undefined: upgrader")
                    || view.screenText.components(separatedBy: "undefined: upgrader").count > 2
            }
            pump()
            _ = await Wait.pause(.milliseconds(300))
            if let row = view.layouts.lastIndex(where: { $0?.source.plainText.hasPrefix("./hub/hub.go:42:7") == true }) {
                let cell = view.cellRect(column: 4, row: row)
                view.updateLinkHover(at: view.convert(NSPoint(x: cell.midX, y: cell.midY), to: nil), commandDown: true)
                _ = await Wait.until(.seconds(3)) { view.hoverLink != nil }
            }
            view.display()
        }
    }

    static func teardown() async {
        for controller in terminals { controller.terminalView.session?.enqueue { $0.shutdown() } }
        terminals = []
        navigators = []
        _ = await Wait.pause(.seconds(1))
        for copy in copies { try? FileManager.default.removeItem(at: copy) }
        copies = []
    }

    static func treeRows() -> [RowContent] {
        func row(_ name: String, depth: Int, folder: RowContent.Disclosure = .none, status: (Character, Hue)? = nil,
                 dot: Bool = false, ignored: Bool = false) -> RowContent {
            var row = RowContent(title: name, depth: depth, disclosure: folder)
            row.layout = .tree
            row.titleTruncation = .keepingExtension(preferEnd: false)
            if folder != .none { row.leading = .symbol("folder", ignored ? .tertiary : .secondary) }
            row.titleInk = status.map { .hue($0.1) } ?? (ignored ? .tertiary : .secondary)
            if folder == .none {
                let image = FileIcon.forFile(named: name).image(for: NSApp.effectiveAppearance)
                row.leading = status.map { .tinted(image, RowContent.Ink.hue($0.1).color) }
                    ?? (ignored ? .tinted(image, Palette.fileIconNeutral) : .image(image))
            }
            row.status = status.map { RowContent.Status($0.0, ink: .hue($0.1)) }
            if dot { row.changeDot = Palette.gitContainsChange }
            return row
        }
        return [
            row("hub", depth: 0, folder: .open, dot: true),
            row("hub.go", depth: 1, status: ("M", .blue)),
            row("mailer.go", depth: 1, status: ("R", .orange)),
            row("sms.go", depth: 1, status: ("A", .green)),
            row("webhook.go", depth: 1),
            row("docs", depth: 0, folder: .open, dot: true),
            row("notes.md", depth: 1, status: ("U", .green)),
            row("build", depth: 0, folder: .closed, ignored: true),
            row("main.go", depth: 0),
        ]
    }
}

@MainActor
let filesPages: [GalleryPage] = [
    GalleryPage(name: "files-speed", settle: 0.1, prepare: {
        let report = await FilesSpeed.measure()
        report.forEach { print("speed:", $0) }
    }) {
        Gallery.page([Gallery.section("Navigator speed", note: "Printed by the gallery run.", [])])
    },
    GalleryPage(name: "list-tree", settle: 0.3) {
        Gallery.page([
            Specimens.states("Tree rows", note: "Each level steps 16 pt, so a child's chevron sits under its parent's icon. Guides show while the pointer is in the list.",
                             FilesSpecimens.treeRows(), outline: true, hovered: 4, selected: [1]),
            Gallery.section("Indent guides", [Gallery.row([
                Gallery.specimen("pointer in the list", {
                    let list = ListView()
                    let rows = FilesSpecimens.treeRows()
                    list.isOutline = true
                    list.rowCount = { rows.count }
                    list.content = { rows[$0] }
                    list.verticalInset = Space.x1
                    list.reload()
                    list.setPointerInside(true)
                    let card = PaneCard()
                    card.embed(list)
                    return Gallery.sized(card, width: Specimens.listWidth, height: CGFloat(rows.count) * Metric.row + Space.x1 * 2)
                }()),
            ])]),
        ])
    },
    GalleryPage(name: "files-navigator", settle: 3.5, teardown: { await FilesSpecimens.teardown() }) {
        let repository = FilesSpeed.repository
        let open = ["packages", "packages/ide", "packages/ide/Sources", "packages/ide/Sources/NyteFiles", "packages/ide/Sources/NyteUI",
                    "packages/ide/Sources/NyteUI/Lists"]
        let fixture = FilesSpecimens.changedFixture()
        let fixtureOpen = ["hub", "docs"]
        return Gallery.page([
            Gallery.section("This repository", note: "256 by 640, the sidebar's real size, with live git status.", [Gallery.row([
                Gallery.specimen("not focused: typing goes elsewhere", FilesSpecimens.navigator(FilesSpecimens.Plan(
                    root: repository, expanded: open, selected: "packages/ide/Sources/NyteFiles/FileOperations.swift", state: .inactive))),
                Gallery.specimen("focused after a click, pointer in the tree", FilesSpecimens.navigator(FilesSpecimens.Plan(
                    root: repository, expanded: open, selected: "packages/ide/Sources/NyteUI/Lists/RowRenderer.swift", hovered: 6,
                    showsGuides: true, state: .active))),
            ], spacing: FilesSpecimens.gap)]),
            Gallery.section("notifyhub-go with changes", note: "Modified, renamed, added, untracked and ignored.",
                            [Gallery.row([
                Gallery.specimen("focused after an arrow key", FilesSpecimens.navigator(FilesSpecimens.Plan(
                    root: fixture, expanded: fixtureOpen, selected: "hub/mailer.go", state: .keyboard))),
                Gallery.specimen("renaming after Return", FilesSpecimens.navigator(FilesSpecimens.Plan(
                    root: fixture, expanded: fixtureOpen, selected: "hub/webhook.go", showsGuides: true, state: .renaming))),
            ], spacing: FilesSpecimens.gap)]),
        ])
    },
    GalleryPage(name: "terminal", settle: 0.5, prepare: { await FilesSpecimens.driveTerminals() },
                teardown: { await FilesSpecimens.teardown() }) {
        Gallery.page([Gallery.section("Terminal", note: "The login shell after a few commands, drawn by the pane's own Core Text renderer.",
                                      [FilesSpecimens.terminal()])])
    },
]
