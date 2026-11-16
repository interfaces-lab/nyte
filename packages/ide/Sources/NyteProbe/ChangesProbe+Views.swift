import AppKit
@testable import NyteChanges
@testable import NyteCore
@testable import NyteUI

@MainActor final class ChangesProbeWindow: NSWindow {
    init(size: NSSize) {
        super.init(contentRect: NSRect(origin: NSPoint(x: -30_000, y: -30_000), size: size), styleMask: [.borderless],
                   backing: .buffered, defer: false)
        isReleasedWhenClosed = false
        alphaValue = 0
        orderBack(nil)
    }

    override var isKeyWindow: Bool { true }
    override var canBecomeKey: Bool { true }

    func host(_ view: NSView) {
        view.translatesAutoresizingMaskIntoConstraints = true
        view.frame = NSRect(origin: .zero, size: frame.size)
        view.autoresizingMask = [.width, .height]
        contentView = view
        view.layoutSubtreeIfNeeded()
    }
}

extension ChangesCheck {
    func key(_ text: String, code: UInt16, _ modifiers: NSEvent.ModifierFlags = [], in window: NSWindow) {
        var flags = modifiers
        if let scalar = text.unicodeScalars.first?.value, scalar >= 0xF700 { flags.insert(.function) }
        let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
                                     windowNumber: window.windowNumber, context: nil, characters: text, charactersIgnoringModifiers: text,
                                     isARepeat: false, keyCode: code)
        if let event { window.sendEvent(event) }
    }

    func settle(_ seconds: TimeInterval = 0.05) { RunLoop.main.run(until: Date(timeIntervalSinceNow: seconds)) }

    func labels(in view: NSView) -> [String] {
        let own = (view as? NSTextField)?.stringValue
        return [own].compactMap { $0 } + view.subviews.flatMap(labels)
    }

    func interface() async {
        NSApplication.shared.setActivationPolicy(.prohibited)
        await listInterface()
        await diffInterface()
        await reviewInterface()
        await commentInterface()
        await bufferInterface()
        await roundThree()
    }

    func listInterface() async {
        let repository = await makeRepository("list", files: ["hub.go": "package hub\n", "docs/readme.md": "# Hub\n"])
        write("package hub\n\nfunc Run() {}\n", to: "hub.go", in: repository.root)
        write("# Hub\nMore.\n", to: "docs/readme.md", in: repository.root)
        await shell(["add", "docs/readme.md"], in: repository.root)
        let window = ChangesProbeWindow(size: NSSize(width: Metric.sidebarWidth, height: 640))
        let changes = ChangesViewController(workspace: Workspace(root: repository.root), environment: Self.isolated)
        var announced: [ChangedFiles] = []
        changes.onChangedFilesChange = { announced.append($0) }
        var opened: [DiffViewController] = []
        changes.onOpenDiff = { opened.append($0) }
        window.host(changes.view)
        let ready = await Patience.until(.seconds(10)) { changes.rows.count == 4 }
        expect("list: Staged and Changes groups with one file each", ready && changes.rows.groups == [.staged, .staged, .changes, .changes],
               "\(changes.rows.groups)")
        expect("branch line: the name, nothing for a missing upstream, the head's subject as the tooltip",
               changes.branch.stringValue == "main" && changes.tracking.isHidden && changes.branch.toolTip == "start",
               "\(changes.branch.stringValue) \(changes.tracking.stringValue) \(String(describing: changes.branch.toolTip))")
        let root = repository.root.resolvingSymlinksInPath().standardizedFileURL
        let changed = changes.changedFiles
        func paths(_ urls: [URL]) -> [String] { urls.map { $0.resolvingSymlinksInPath().path.replacingOccurrences(of: root.path + "/", with: "") } }
        expect("changed files: staged, unstaged and searchable paths, announced once",
               paths(changed.staged) == ["docs/readme.md"] && paths(changed.unstaged) == ["hub.go"]
                   && paths(changed.searchable) == ["docs/readme.md", "hub.go"] && announced.count == 1,
               "\(paths(changed.staged)) \(paths(changed.unstaged)) \(paths(changed.searchable)) \(announced.count)")
        let table = changes.list.table
        let staged = table.rowView(atRow: 1, makeIfNecessary: true)
        let label = staged?.accessibilityLabel() ?? ""
        expect("list: a row reads its name, state, counts and folder", label == "readme.md, modified, staged, 1 added, 0 removed, in docs", label)
        expect("list: rows are accessibility rows", staged?.accessibilityRole() == .row)
        let narrow = changes.row(3)
        expect("list: rows at the sidebar's width keep coloured counts", narrow.diff.map { $0.added == 2 && $0.removed == 0 } == true
            && narrow.meta.isEmpty, "\(String(describing: narrow.diff)) \(narrow.meta)")
        expect("list: Staged and Changes headers pin with their own title", changes.row(0).isGroupHeader && changes.row(2).isGroupHeader)
        window.makeFirstResponder(table)
        changes.list.selectedRow = 3
        key(" ", code: 49, in: window)
        let moved = await Patience.until(.seconds(10)) { changes.rows.groups.filter { $0 == .staged }.count == 3 }
        let state = await porcelain(repository)
        expect("list: Space stages the selected file", moved && state == "M  docs/readme.md|M  hub.go", state)
        changes.list.selectedRow = 1
        key("\r", code: 36, in: window)
        expect("list: Return opens the file's diff", opened.last.map { if case let .repository(_, path, kind) = $0.source { path == "docs/readme.md" && kind == .staged } else { false } } ?? false)
        let menu = changes.list.withActions(changes.menu(for: IndexSet(integer: 1)), row: 1, targets: IndexSet(integer: 1))
        let titles = menu?.items.map(\.title) ?? []
        expect("list: the context menu offers the file commands", titles == ["Unstage", "Discard Changes…", "", "Show Diff", "Open File", "Reveal in Finder",
                                                                              "Copy Path"], "\(titles)")
        expect("list: commit is blocked with its reason until there is a message", changes.commitBox.hint.stringValue == "Write a commit message"
            && !changes.commitBox.commit.isEnabled, changes.commitBox.hint.stringValue)
        changes.commitBox.field.string = String(repeating: "x", count: 80)
        expect("list: a first line past 72 characters shows its length", changes.commitBox.count.stringValue == "80/72" && !changes.commitBox.count.isHidden)
        changes.commitBox.field.string = "Run the hub"
        expect("list: commit enables with a message and staged files", changes.commitBox.commit.isEnabled)
        window.makeFirstResponder(changes.commitBox.field.textView)
        key("\r", code: 36, .command, in: window)
        let committed = await Patience.until(.seconds(15)) { changes.rows.count == 0 && changes.snapshot != nil }
        let log = await shell(["log", "-1", "--format=%s"], in: repository.root).text
        expect("list: ⌘Return in the message commits", committed && log == "Run the hub\n", log)
        expect("list: a clean tree shows the clean state", labels(in: changes.view).contains("No changes"))

        let plain = scratch.appendingPathComponent("plain")
        try? FileManager.default.createDirectory(at: plain, withIntermediateDirectories: true)
        let outside = ChangesViewController(workspace: Workspace(root: plain), environment: Self.isolated)
        window.host(outside.view)
        let shown = await Patience.until(.seconds(10)) { self.labels(in: outside.view).contains("Not a Git repository") }
        expect("list: a plain folder shows the not-a-repository state", shown)
        let missing = ChangesViewController(workspace: Workspace(root: plain), environment: Self.isolated,
                                            git: URL(fileURLWithPath: "/nonexistent/git"))
        window.host(missing.view)
        expect("list: no git shows the git-missing state", await Patience.until(.seconds(10)) { self.labels(in: missing.view).contains("Git isn’t available") })
        window.orderOut(nil)
    }

    func diffInterface() async {
        let before = (1...200).map { "line \($0)\n" }.joined()
        var lines = (1...200).map { "line \($0)\n" }
        lines[9] = "line ten\n"
        lines[99] = "line one hundred\n"
        lines.insert("inserted\n", at: 150)
        let after = lines.joined()
        let repository = await makeRepository("diffview", files: ["list.txt": before])
        write(after, to: "list.txt", in: repository.root)
        let window = ChangesProbeWindow(size: NSSize(width: 1_200, height: 600))
        let diff = DiffViewController(source: .repository(repository, path: "list.txt", comparison: .worktree))
        var changed = 0
        diff.onRepositoryChange = { changed += 1 }
        window.host(diff.view)
        expect("diff: loads", await Patience.until(.seconds(10)) { diff.document != nil })
        let canvas = diff.pane.canvas
        window.makeFirstResponder(canvas)
        canvas.cursor = -1
        key("\u{F70A}", code: 98, in: window)
        expect("diff: F7 goes to the first change", canvas.cursorHunk == 0 && canvas.rows.kinds[canvas.cursor] == .header)
        key("j", code: 38, in: window)
        expect("diff: J goes to the next change", canvas.cursorHunk == 1)
        key("k", code: 40, in: window)
        expect("diff: K goes back", canvas.cursorHunk == 0)
        key("\u{F70A}", code: 98, .shift, in: window)
        expect("diff: ⇧F7 at the first change stays", canvas.cursorHunk == 0)
        let folds = canvas.rows.kinds.indices.filter { canvas.rows.kinds[$0] == .fold }
        expect("diff: unchanged runs fold, three lines of context each side", folds.count == 4 && canvas.rows.hiddenLines(ofFold: folds[1]) == 83,
               "\(folds.map { canvas.rows.hiddenLines(ofFold: $0) })")
        canvas.move(to: folds[1], extending: false)
        key("\r", code: 36, in: window)
        let stepped = canvas.rows.kinds.indices.filter { canvas.rows.kinds[$0] == .fold }.map { canvas.rows.hiddenLines(ofFold: $0) }
        expect("diff: Return on a fold shows 20 more lines", stepped.count == 4 && stepped[1] == 63, "\(stepped)")
        canvas.move(to: canvas.rows.kinds.firstIndex(of: .fold) ?? 0, extending: false)
        key("\r", code: 36, .option, in: window)
        expect("diff: ⌥Return shows the whole run", canvas.rows.kinds.filter { $0 == .fold }.count == 3)
        canvas.showHunk(at: Int(canvas.rows.headers[1]))
        let removed = canvas.rows.kinds.indices.first { canvas.rows.kinds[$0] == .removed && canvas.rows.owner[$0] == 1 } ?? 0
        canvas.move(to: removed, extending: false)
        key("\u{F701}", code: 125, .shift, in: window)
        expect("diff: ⇧↓ selects the removed and added line", canvas.linesChosen
            && canvas.rows.selection(canvas.selectedRows) == DiffSelection(old: IndexSet(integer: 99), new: IndexSet(integer: 99)))
        expect("diff: the hunk buttons name the line action", diff.pane.canvas.primaryButton.title == "Stage Lines"
            && !diff.pane.canvas.primaryButton.isHidden, diff.pane.canvas.primaryButton.title)
        let item = NSMenuItem(title: "", action: #selector(DiffViewController.stageSelection(_:)), keyEquivalent: "")
        expect("diff: the stage command validates with a title", diff.validateMenuItem(item) && item.title == "Stage Lines", item.title)
        key("s", code: 1, in: window)
        let staged = await Patience.until(.seconds(10)) { changed > 0 }
        let index = await blob(":list.txt", in: repository)
        expect("diff: S stages only the selected lines", staged && index == before.replacingOccurrences(of: "line 100\n", with: "line one hundred\n"))
        _ = await Patience.until(.seconds(10)) { diff.document?.diff.hunks.count == 2 }
        let children = canvas.accessibilityChildren()?.compactMap { $0 as? NSAccessibilityElement } ?? []
        let roles = Set(children.compactMap { $0.accessibilityRole() })
        let texts = children.compactMap { $0.accessibilityLabel() }
        expect("diff: visible rows are accessibility rows", canvas.accessibilityRole() == .table && roles == [.row], "\(roles)")
        expect("diff: a hunk reads its place and counts", texts.contains { $0.hasPrefix("Change 1 of 2, 1 added, 1 removed, at line 10") }, texts.first ?? "")
        expect("diff: lines read their kind, number and text", texts.contains("Removed line 10: line 10") && texts.contains("Added line 10: line ten"))
        let header = children.first { $0.accessibilityLabel()?.hasPrefix("Change 1") == true }
        expect("diff: a hunk offers its actions to VoiceOver", header?.accessibilityCustomActions()?.map(\.name) == ["Stage Hunk", "Discard Hunk"])
        key("\u{F70A}", code: 98, in: window)
        diff.isSideBySide = true
        expect("diff: side by side pairs the changed lines", canvas.rows.kinds.contains(.changed) && !canvas.rows.kinds.contains(.added))
        let long = "let message = \"" + String(repeating: "wide ", count: 60) + "\"\n"
        let wide = DiffViewController(source: .texts(path: "wide.swift", before: DiffText(title: "Before", text: "a\n" + long + "b\n"),
                                                     after: DiffText(title: "After", text: "a\n" + long.replacingOccurrences(of: "message", with: "note") + "b\n")))
        window.host(wide.view)
        _ = await Patience.until(.seconds(5)) { wide.document != nil }
        let wideCanvas = wide.pane.canvas, clip = wide.pane.scroll.contentView
        expect("unified: a long line widens the document instead of wrapping", wideCanvas.frame.width >= wideCanvas.sideWidth
            && wideCanvas.frame.width > clip.bounds.width && wideCanvas.rows.count == wideCanvas.rows.kinds.count)
        wide.isSideBySide = true
        wide.pane.layoutSubtreeIfNeeded()
        let unscrolled = (old: wideCanvas.textStart(.old, wideCanvas.visibleRect) - wideCanvas.halves(wideCanvas.visibleRect).old,
                      new: wideCanvas.textStart(.new, wideCanvas.visibleRect) - wideCanvas.halves(wideCanvas.visibleRect).new)
        expect("side by side: the document is wider than the view by the longest side's overflow",
               wideCanvas.frame.width == clip.bounds.width + wideCanvas.sideWidth - (clip.bounds.width / 2).rounded(),
               "\(wideCanvas.frame.width) vs clip \(clip.bounds.width), side \(wideCanvas.sideWidth)")
        clip.scroll(to: NSPoint(x: 200, y: 0))
        wide.pane.scroll.reflectScrolledClipView(clip)
        let visible = wideCanvas.visibleRect
        let scrolled = (old: wideCanvas.textStart(.old, visible) - wideCanvas.halves(visible).old,
                     new: wideCanvas.textStart(.new, visible) - wideCanvas.halves(visible).new)
        expect("side by side: scrolling moves both sides' text together while the halves and gutters stay",
               visible.minX == 200 && unscrolled.old - scrolled.old == 200 && unscrolled.new - scrolled.new == 200
                   && wideCanvas.halves(visible).old == visible.minX, "\(unscrolled) → \(scrolled)")
        await densitySwitch(canvas: canvas, root: repository.root, before: before, after: after)
        let text = DiffViewController(source: .texts(path: "a.go", before: DiffText(title: "Before", text: nil), after: DiffText(title: "After", text: "package a\n")))
        window.host(text.view)
        _ = await Patience.until(.seconds(5)) { text.document != nil }
        expect("diff: two texts, one absent, read as a new file", text.document?.isNew == true && text.document?.diff.addedLines == 1)
        window.orderOut(nil)
    }

    func reviewInterface() async {
        let root = scratch.appendingPathComponent("review", isDirectory: true)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let hub = "package hub\n\nfunc Run() {\n\tstart()\n}\n\nfunc Stop() {\n\tstop()\n}\n"
        let edited = hub.replacingOccurrences(of: "\tstart()", with: "\tstart()\n\tlisten()").replacingOccurrences(of: "\tstop()", with: "\thalt()")
        write(edited, to: "hub.go", in: root)
        write("export const a = 1\n", to: "new.ts", in: root)
        let set = AgentChangeSet(session: "s", scope: .step(part: "p"), title: "Edited hub.go", root: root, files: [
            .init(path: "hub.go", status: .modified, content: .texts(before: hub, after: edited), added: 2, removed: 1),
            .init(path: "new.ts", status: .added, content: .texts(before: "", after: "export const a = 1\n"), added: 1, removed: 0),
        ])
        let review = ReviewViewController(changes: set)
        var written: [ReviewRevert] = []
        review.onRevert = { revert in
            written.append(revert)
            if let text = revert.text { try Data(text.utf8).write(to: revert.url) } else { try FileManager.default.removeItem(at: revert.url) }
        }
        let window = ChangesProbeWindow(size: NSSize(width: 1300, height: 700))
        window.host(review.view)
        _ = await Patience.until(.seconds(5)) { review.counts.allSatisfy { $0 != nil } }
        let shared = set.files.map(Diff.counts(of:)).reduce((0, 0)) { ($0.0 + $1.added, $0.1 + $1.removed) }
        expect("review: overall counts sum the files, by the same count the agent pane uses",
               review.summary.stringValue == "This step  2 files  +\(shared.0) \u{2212}\(shared.1)", review.summary.stringValue)
        _ = await Patience.until(.seconds(5)) { review.diffs[0]?.document != nil }
        review.focusDiff()
        guard let first = review.diffs[0] else { return expect("review: shows the first file", false) }
        first.pane.canvas.cursor = -1
        key("j", code: 38, in: window)
        key("j", code: 38, in: window)
        expect("review: J walks the first file's changes", first.pane.canvas.cursorHunk == 1)
        key("j", code: 38, in: window)
        let crossed = await Patience.until(.seconds(5)) { review.shown == 1 && review.diffs[1]?.document != nil }
        expect("review: J past the last change opens the next file", crossed && review.selectedPath == "new.ts")
        key("k", code: 40, in: window)
        expect("review: K before the first change goes back to the previous file's last change", review.shown == 0)
        guard let document = first.document else { return }
        let failure = await review.revert(0, DiffSelection(hunks: [document.diff.hunks[1]]), document)
        expect("review: reverting a hunk writes the file with that hunk undone", failure == nil
            && written.last?.text == hub.replacingOccurrences(of: "\tstart()", with: "\tstart()\n\tlisten()"), written.last?.text ?? "nil")
        let second = review.diffs[1]
        review.select(path: "new.ts")
        _ = await Patience.until(.seconds(5)) { second?.document != nil }
        if let added = review.diffs[1]?.document {
            _ = await review.revert(1, DiffSelection(hunks: added.diff.hunks), added)
        }
        expect("review: reverting a file the run created removes it", written.last?.text == nil
            && !FileManager.default.fileExists(atPath: root.appendingPathComponent("new.ts").path))
        expect("review: a fully reverted file is marked", review.reverted.contains(1) && review.row(1).meta == "reverted")
        window.orderOut(nil)
    }

    func densitySwitch(canvas: DiffCanvas, root: URL, before: String, after: String) async {
        let review = ReviewViewController(changes: AgentChangeSet(session: "d", scope: .step(part: "p"), title: "Density", root: root, files: [
            .init(path: "list.txt", status: .modified, content: .texts(before: before, after: after), added: 3, removed: 2),
        ]))
        let window = ChangesProbeWindow(size: NSSize(width: 1_300, height: 600))
        window.host(review.view)
        _ = await Patience.until(.seconds(5)) { review.diffs[0]?.document != nil }
        func headerHeights() -> [CGFloat] {
            [canvas, review.diffs[0]?.pane.canvas].compactMap { canvas in
                canvas.flatMap { canvas in canvas.rows.kinds.firstIndex(of: .header).map { canvas.rows.rect(of: $0, width: 0).height } }
            }
        }
        let compact = (headers: headerHeights(), list: review.list.table.rowHeight, frame: canvas.rows.height)
        Density.apply(.standard)
        settle()
        let standard = (headers: headerHeights(), list: review.list.table.rowHeight, frame: canvas.rows.height)
        Density.apply(.compact)
        settle()
        let grew = standard.headers.count == 2 && standard.headers.allSatisfy { $0 > Metric.rowCompact }
        let followed = grew && standard.list > compact.list && standard.frame > compact.frame
        let returned = headerHeights() == compact.headers && review.list.table.rowHeight == compact.list
        expect("density: diff headers, the review list and the document height follow a live switch and come back",
               compact.headers == [Metric.rowCompact, Metric.rowCompact] && followed && returned,
               "\(compact) → \(standard) → \(headerHeights())")
        expect("density: the diff's scroll view keeps overlay scrollers hidden until the user scrolls",
               canvas.enclosingScrollView is QuietScrollView)
        window.orderOut(nil)
    }
}
