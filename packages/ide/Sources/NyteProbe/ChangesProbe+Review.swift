import AppKit
@testable import NyteChanges
@testable import NyteCore
@testable import NyteUI

extension ChangesCheck {
    func roundThree() async {
        await patchReview()
        await comparisons()
        contrast()
        await openDiffMark()
        await fileListFolding()
        await wholeRun()
    }

    func wholeRun() async {
        let root = scratch.appendingPathComponent("whole-run", isDirectory: true)
        write("new\n", to: "a.txt", in: root)
        write("on disk now\n", to: "old.txt", in: root)
        let set = AgentChangeSet(session: "s", scope: .session, title: "All changes", root: root, files: [
            .init(path: "a.txt", status: .modified, content: .texts(before: "old\n", after: "new\n"), added: 1, removed: 1),
            .init(path: "old.txt", status: .modified, content: .unavailable("This edit is older than the loaded history."), added: 7,
                  removed: 2),
        ])
        let review = ReviewViewController(changes: set)
        let window = ChangesProbeWindow(size: NSSize(width: 1_300, height: 600))
        window.host(review.view)
        _ = await Patience.until(.seconds(5)) { review.counts.allSatisfy { $0 != nil } }
        review.select(path: "old.txt")
        _ = await Patience.until(.seconds(5)) { review.diffs[1]?.document?.shape == .unavailable("This edit is older than the loaded history.") }
        let shape = review.diffs[1]?.document?.shape
        expect("whole run: the review is named This run", review.summary.stringValue.hasPrefix("This run  2 files"), review.summary.stringValue)
        expect("whole run: an unloaded file keeps its reason and the host's counts, never a guessed diff",
               shape == .unavailable("This edit is older than the loaded history.") && review.row(1).diff.map { $0 == (7, 2) } == true
                   && review.row(1).toolTip == "This edit is older than the loaded history."
                   && review.summary.stringValue == "This run  2 files  +8 \u{2212}3", "\(String(describing: shape)) \(review.summary.stringValue)")
        window.orderOut(nil)
    }

    func patchReview() async {
        let root = scratch.appendingPathComponent("patch-review", isDirectory: true)
        write("package hub\n\nfunc Unrelated() {}\n", to: "hub/hub.go", in: root)
        let patch = """
        diff --git a/hub/hub.go b/hub/hub.go
        --- a/hub/hub.go
        +++ b/hub/hub.go
        @@ -10,4 +10,5 @@ func (h *Hub) Submit() error {
         \tchannel := h.pick()
        -\terr := channel.Send()
        +\terr := channel.Send(ctx)
        +\tretry(err)
         \treturn err
         }
        @@ -40,3 +41,3 @@ func (h *Hub) Stats() Stats {
         \th.mu.Lock()
        -\treturn h.stats
        +\treturn h.stats.clone()
         }
        """
        let file = AgentChangeSet.File(path: "hub/hub.go", status: .modified, content: .patches([patch]), added: 3, removed: 2)
        let set = AgentChangeSet(session: "s", scope: .step(part: "p"), title: "Edited hub.go", root: root, files: [file])
        let review = ReviewViewController(changes: set)
        review.onRevert = { _ in }
        let window = ChangesProbeWindow(size: NSSize(width: 1_300, height: 700))
        window.host(review.view)
        _ = await Patience.until(.seconds(5)) { review.diffs[0]?.document != nil && review.counts[0] != nil }
        guard let diff = review.diffs[0], let document = diff.document else { return expect("patch review: shows the file", false) }
        let shared = Diff.counts(of: file)
        expect("patch review: a patch-only file is drawn from its patch, not rebuilt from a disk that differs",
               document.patch != nil && document.new.count == 8 && document.old.count == 7)
        expect("patch review: lines carry the patch's own numbers", document.number(.new, 0) == 10 && document.number(.new, 4) == 14
            && document.number(.new, 5) == 41 && document.number(.old, 4) == 40)
        let gaps = diff.pane.canvas.rows.kinds.indices.filter { diff.pane.canvas.rows.kinds[$0] == .gap }.map(diff.pane.canvas.gapLabel)
        expect("patch review: lines outside the patch are named, never expandable", gaps == ["Lines 1–9 are not in the patch",
                                                                                            "Lines 15–40 are not in the patch"]
            && !diff.pane.canvas.rows.kinds.contains(.fold), "\(gaps)")
        let letter = review.row(0).status?.letter
        let badges = diff.pane.header.subviews.flatMap(self.badges)
        expect("patch review: the list letter and the header agree it was modified, not new", letter == "M" && !badges.contains("New")
            && !document.isNew, "\(String(describing: letter)) \(badges)")
        expect("patch review: list, summary and the agent pane count from one place",
               review.row(0).diff.map { $0 == (shared.added, shared.removed) } == true && shared == (3, 2)
                   && review.summary.stringValue == "This step  1 file  +3 \u{2212}2", review.summary.stringValue)
        expect("patch review: the header names the comparison and that it is a patch",
               diff.pane.comparison.stringValue == "Before this step \u{2192} After this step (patch)", diff.pane.comparison.stringValue)
        expect("patch review: reverting is off for a patch-only file, with the reason", !review.revertButton.isEnabled
            && review.revertButton.toolTip == ReviewViewController.patchOnly && diff.pane.canvas.actions == .none)
        expect("patch review: the hunk header shows the patch's line numbers and function",
               diff.pane.canvas.headerStart(.new, document.diff.hunks[0].new) == 11 && diff.pane.canvas.heading(of: 0) == "func (h *Hub) Submit() error {")
        var sent: [AgentContext] = []
        review.onSendComments = { sent = $0 }
        let canvas = diff.pane.canvas
        let added = canvas.rows.kinds.indices.first { canvas.rows.kinds[$0] == .added && canvas.rows.new[$0] == 2 } ?? 0
        canvas.move(to: added, extending: false)
        canvas.openComposer()
        canvas.composer?.field.string = "Why retry here?"
        canvas.commitComposer()
        review.sendComments(nil)
        let range: AgentContext.LineRange? = if case let .review(review)? = sent.first { review.range } else { nil }
        expect("patch review: a comment names the file's real line", range == AgentContext.LineRange(first: 12, last: 12), "\(sent)")
        let turn = ReviewViewController(changes: AgentChangeSet(session: "s", scope: .run(turn: "t"), title: "Run", root: root, files: [file]))
        _ = turn.view
        expect("patch review: a turn's review says so", turn.summary.stringValue.hasPrefix("This turn  "), turn.summary.stringValue)
        window.orderOut(nil)
    }

    func comparisons() async {
        let repository = await makeRepository("compare", files: ["c.txt": "one\n"])
        write("two\n", to: "c.txt", in: repository.root)
        let window = ChangesProbeWindow(size: NSSize(width: 900, height: 400))
        var labels: [String] = []
        for (comparison, buffer) in [(DiffComparison.worktree, nil), (.worktree, "three\n"), (.staged, nil)] as [(DiffComparison, String?)] {
            if comparison == .staged { await shell(["add", "c.txt"], in: repository.root) }
            let diff = DiffViewController(source: .repository(repository, path: "c.txt", comparison: comparison))
            if let buffer { diff.openText = { _ in buffer } }
            window.host(diff.view)
            _ = await Patience.until(.seconds(5)) { diff.document != nil }
            labels.append(diff.pane.comparison.stringValue)
        }
        expect("header names the comparison: index to working tree, to an unsaved buffer, HEAD to index",
               labels == ["Index \u{2192} Working Tree", "Index \u{2192} Unsaved", "HEAD \u{2192} Index"], "\(labels)")
        let wide = DiffViewController(source: .texts(path: "w.go", before: DiffText(title: "Before", text: "a\nb\n"),
                                                     after: DiffText(title: "After", text: "a\nc\n")))
        wide.isSideBySide = true
        window.setContentSize(NSSize(width: 900, height: 400))
        window.host(wide.view)
        _ = await Patience.until(.seconds(5)) { wide.document != nil }
        wide.pane.layoutSubtreeIfNeeded()
        let refused = wide.pane.canvas.mode == .unified && !wide.pane.narrow.isHidden && wide.isSideBySide
        window.setContentSize(NSSize(width: 1_300, height: 400))
        wide.view.frame = NSRect(origin: .zero, size: NSSize(width: 1_300, height: 400))
        wide.pane.layoutSubtreeIfNeeded()
        wide.pane.applyMode()
        expect("side by side falls back to unified with a note under 60 columns a half, and returns when wide",
               refused && wide.pane.canvas.mode == .split && wide.pane.narrow.isHidden)
        window.orderOut(nil)
    }

    func contrast() {
        func components(_ color: NSColor, _ name: NSAppearance.Name) -> (Double, Double, Double, Double) {
            var result = (0.0, 0.0, 0.0, 1.0)
            (NSAppearance(named: name) ?? NSAppearance.currentDrawing()).performAsCurrentDrawingAppearance {
                let srgb = color.usingColorSpace(.sRGB) ?? color
                result = (Double(srgb.redComponent), Double(srgb.greenComponent), Double(srgb.blueComponent), Double(srgb.alphaComponent))
            }
            return result
        }
        func luminance(_ c: (Double, Double, Double)) -> Double {
            func channel(_ v: Double) -> Double { v <= 0.039_28 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
            return 0.2126 * channel(c.0) + 0.7152 * channel(c.1) + 0.0722 * channel(c.2)
        }
        func over(_ top: (Double, Double, Double, Double), _ base: (Double, Double, Double, Double)) -> (Double, Double, Double) {
            (top.0 * top.3 + base.0 * (1 - top.3), top.1 * top.3 + base.1 * (1 - top.3), top.2 * top.3 + base.2 * (1 - top.3))
        }
        var worst = Double.infinity
        var report: [String] = []
        for name in [NSAppearance.Name.aqua, .darkAqua] {
            let base = components(Palette.bgBase, name)
            let ink = over(components(DiffCanvas.numberInk, name), base)
            for (label, ground) in [("unchanged", Palette.bgBase), ("added", Palette.diffAddedLine), ("removed", Palette.diffRemovedLine)] {
                let back = over(components(ground, name), base)
                let (light, dark) = (max(luminance(ink), luminance(back)), min(luminance(ink), luminance(back)))
                let ratio = (light + 0.05) / (dark + 0.05)
                worst = min(worst, ratio)
                report.append("\(name == .aqua ? "light" : "dark") \(label) \(String(format: "%.2f", ratio))")
            }
        }
        expect("line numbers reach 4.5:1 on every ground: " + report.joined(separator: ", "),
               worst >= 4.5, report.joined(separator: ", "))
    }

    func openDiffMark() async {
        let repository = await makeRepository("mark", files: ["a.txt": "a\n", "b.txt": "b\n"])
        write("a2\n", to: "a.txt", in: repository.root)
        write("b2\n", to: "b.txt", in: repository.root)
        await shell(["add", "b.txt"], in: repository.root)
        write("b3\n", to: "b.txt", in: repository.root)
        let window = ChangesProbeWindow(size: NSSize(width: Metric.sidebarWidth, height: 500))
        let changes = ChangesViewController(workspace: Workspace(root: repository.root), environment: Self.isolated)
        window.host(changes.view)
        _ = await Patience.until(.seconds(10)) { changes.rows.count == 5 }
        changes.showOpenDiff(path: "b.txt", comparison: .staged)
        let stagedRow = changes.row(of: "b.txt", .staged)
        let marked = changes.list.selectedRows == IndexSet(integer: stagedRow ?? -1)
        changes.showOpenDiff(path: "b.txt", comparison: .worktree)
        let changesRow = changes.row(of: "b.txt", .worktree)
        let moved = changes.list.selectedRows == IndexSet(integer: changesRow ?? -1) && changesRow != stagedRow
        let checks = changes.row(changesRow ?? 0).check
        changes.showOpenDiff(path: nil, comparison: .worktree)
        expect("open diff: its row takes the ordinary selection, staged or not, apart from the checkbox; closing clears it",
               marked && moved && checks == .off && changes.list.selectedRows.isEmpty)
        let row = changes.row(changesRow ?? 0)
        expect("hover actions: a Changes row offers Stage and Discard, a staged row Unstage",
               row.actions.map(\.id) == ["stage", "discard"] && changes.row(stagedRow ?? 0).actions.first?.id == "unstage")
        changes.list.onAction?("stage", IndexSet(integer: changes.row(of: "a.txt", .worktree) ?? 0))
        _ = await Patience.until(.seconds(10)) { changes.row(of: "a.txt", .staged) != nil }
        expect("hover actions: Stage stages the row", changes.row(of: "a.txt", .staged) != nil)
        window.orderOut(nil)
    }

    func fileListFolding() async {
        let root = scratch.appendingPathComponent("fold-review", isDirectory: true)
        let set = AgentChangeSet(session: "s", scope: .run(turn: "t"), title: "Fold", root: root, files: [
            .init(path: "a.txt", status: .modified, content: .texts(before: "a\n", after: "b\n"), added: 1, removed: 1),
        ])
        let review = ReviewViewController(changes: set)
        var focused = 0
        review.onFocusReview = { focused += 1 }
        let window = ChangesProbeWindow(size: NSSize(width: 1_300, height: 600))
        window.host(review.view)
        review.view.layoutSubtreeIfNeeded()
        let shownAtFirst = review.fileList == .shown && !review.side.isHidden
        review.split.setPosition(100, ofDividerAt: 0)
        review.split.layoutSubtreeIfNeeded()
        let narrowest = review.side.frame.width
        review.toggleFileList(nil)
        let folded = review.fileList == .folded(byUser: true) && review.side.isHidden
        review.focusDiff()
        key("l", code: 37, in: window)
        let back = review.fileList == .shown
        review.view.frame.size.width = 600
        review.view.layoutSubtreeIfNeeded()
        review.viewDidLayout()
        let autoFolded = review.fileList == .folded(byUser: false)
        review.view.frame.size.width = 1_300
        review.view.layoutSubtreeIfNeeded()
        review.viewDidLayout()
        expect("review files: shown, narrowing no further than 160 pt", shownAtFirst && narrowest >= ReviewViewController.listMinimum,
               "\(narrowest)")
        expect("review files: the toggle and the L key fold and unfold the list", folded && back)
        expect("review files: under 520 pt of diff the list folds by itself and returns when there is room",
               autoFolded && review.fileList == .shown)
        review.focusButton.press()
        expect("Focus Review: the header button calls the shell's closure", !review.focusButton.isHidden && focused == 1)
        window.orderOut(nil)
    }
}
