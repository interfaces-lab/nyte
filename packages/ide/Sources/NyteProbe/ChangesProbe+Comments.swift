import AppKit
@testable import NyteChanges
@testable import NyteCore
@testable import NyteUI

extension ChangesCheck {
    func commentInterface() async {
        let before = (1...40).map { "line \($0)\n" }.joined()
        var lines = (1...40).map { "line \($0)\n" }
        lines[4] = "line five\n"
        lines[29] = "line thirty\n"
        let after = lines.joined()
        let window = ChangesProbeWindow(size: NSSize(width: 900, height: 700))
        let diff = DiffViewController(source: .texts(path: "notes.txt", before: DiffText(title: "Before", text: before),
                                                     after: DiffText(title: "After", text: after)))
        var sent: [AgentContext] = []
        diff.root = scratch
        diff.onSendComments = { sent = $0 }
        window.host(diff.view)
        _ = await Patience.until(.seconds(5)) { diff.document != nil }
        let canvas = diff.pane.canvas
        window.makeFirstResponder(canvas)
        let added = canvas.rows.kinds.indices.first { canvas.rows.kinds[$0] == .added && canvas.rows.new[$0] == 4 } ?? 0
        canvas.move(to: added, extending: false)
        key("c", code: 8, in: window)
        let field = canvas.composer?.field.textView
        expect("comments: C opens a field under the chosen line", canvas.rows.kinds[added + 1] == .composer && field != nil
            && window.firstResponder === field)
        canvas.composer?.field.string = "Name this with a word, not a number"
        key("\r", code: 36, in: window)
        expect("comments: Return adds the comment and pins it under its line", canvas.notes.count == 1
            && canvas.rows.kinds[added + 1] == .note && canvas.composer == nil && window.firstResponder === canvas)
        let pinned = canvas.noteViews.values.first
        expect("comments: a pinned comment offers Edit and Remove", pinned?.edit.title == "Edit" && pinned?.remove.title == "Remove"
            && pinned?.words.stringValue == "Name this with a word, not a number")
        key("c", code: 8, in: window)
        key("\u{1b}", code: 53, in: window)
        expect("comments: Escape cancels without adding", canvas.notes.count == 1 && !canvas.rows.kinds.contains(.composer)
            && window.firstResponder === canvas)
        let header = Int(canvas.rows.headers[1])
        canvas.move(to: header, extending: false)
        key("c", code: 8, in: window)
        key("\r", code: 36, in: window)
        let pointer = canvas.notes.last
        expect("comments: C on a hunk with no words points at the hunk", canvas.notes.count == 2 && pointer?.comment == ""
            && pointer?.lines == 29..<30 && pointer?.side == .new, "\(String(describing: pointer))")
        let removed = canvas.rows.kinds.indices.first { canvas.rows.kinds[$0] == .removed && canvas.rows.old[$0] == 29 } ?? 0
        canvas.move(to: removed, extending: false)
        key("c", code: 8, in: window)
        canvas.composer?.field.string = "Why did this go?"
        key("\r", code: 36, in: window)
        expect("comments: a removed line is commented on the old side", canvas.notes.last?.side == .old && canvas.notes.last?.lines == 29..<30)
        canvas.noteViews[canvas.notes[2].id]?.remove.press()
        expect("comments: Remove drops the comment", canvas.notes.count == 2)
        canvas.editNote(canvas.notes[0].id)
        canvas.composer?.field.string = "Name this with a word"
        canvas.commitComposer()
        expect("comments: Edit changes the comment in place", canvas.notes.count == 2 && canvas.notes[0].comment == "Name this with a word")
        let element = canvas.accessibilityChildren()?.compactMap { $0 as? NSAccessibilityElement }
            .first { $0.accessibilityLabel()?.hasPrefix("Comment on line 5") == true }
        expect("comments: a pinned comment reads as a row with its line and words", element?.accessibilityRole() == .row
            && element?.accessibilityLabel() == "Comment on line 5: Name this with a word")
        expect("comments: the header offers Send to Agent with the count", !diff.pane.sendButton.isHidden && diff.pane.sendButton.detail == "2")

        let shifted = "new top\nnew top 2\n" + after.replacingOccurrences(of: "line thirty\n", with: "line 30\n")
        diff.replace(.texts(path: "notes.txt", before: DiffText(title: "Before", text: before), after: DiffText(title: "After", text: shifted)))
        _ = await Patience.until(.seconds(5)) { diff.document?.new.count == 42 }
        expect("comments: a refresh keeps a comment whose lines moved, on their new place", canvas.notes.count == 1
            && canvas.notes[0].lines == 6..<7 && canvas.rows.kinds.contains(.note), "\(canvas.notes.map(\.lines))")
        expect("comments: a refresh drops a comment whose lines are gone", !canvas.notes.contains { $0.comment.isEmpty })
        diff.sendComments(nil)
        let expected = AgentContext.review(AgentContext.Review(file: scratch.appendingPathComponent("notes.txt"), side: .new,
                                                               range: AgentContext.LineRange(first: 7, last: 7), lines: "line five",
                                                               comment: "Name this with a word"))
        expect("comments: Send hands the agent pane its review context: file, side, 1-based lines, their text and the words",
               sent == [expected], "\(sent)")
        expect("comments: sending clears them and hides Send", canvas.notes.isEmpty && diff.pane.sendButton.isHidden)

        let root = scratch.appendingPathComponent("comment-review", isDirectory: true)
        let set = AgentChangeSet(session: "s", scope: .run(turn: "t"), title: "Two files", root: root, files: [
            .init(path: "a.txt", status: .modified, content: .texts(before: before, after: after), added: 2, removed: 2),
            .init(path: "b.txt", status: .modified, content: .texts(before: "x\n", after: "y\n"), added: 1, removed: 1),
        ])
        let review = ReviewViewController(changes: set)
        var reviewed: [AgentContext.Review] = []
        review.onSendComments = { contexts in
            reviewed = contexts.compactMap { context in
                guard case let .review(review) = context else { return nil }
                return review
            }
        }
        window.host(review.view)
        _ = await Patience.until(.seconds(5)) { review.diffs[0]?.document != nil }
        guard let first = review.diffs[0] else { return expect("comments in review: the first file shows", false) }
        first.pane.canvas.move(to: Int(first.pane.canvas.rows.headers[0]), extending: false)
        first.pane.canvas.openComposer()
        first.pane.canvas.commitComposer()
        review.select(path: "b.txt")
        _ = await Patience.until(.seconds(5)) { review.diffs[1]?.document != nil }
        if let second = review.diffs[1] {
            second.pane.canvas.move(to: Int(second.pane.canvas.rows.headers[0]), extending: false)
            second.pane.canvas.openComposer()
            second.pane.canvas.composer?.field.string = "Keep x"
            second.pane.canvas.commitComposer()
        }
        expect("comments in review: the file list counts each file's comments", review.row(0).badge?.text == "1" && review.row(1).badge?.text == "1",
               "\(String(describing: review.row(0).badge?.text))")
        expect("comments in review: Send to Agent counts every file", !review.sendButton.isHidden && review.sendButton.detail == "2")
        review.sendComments(nil)
        expect("comments in review: Send hands out every file's comments with the run's root", reviewed.map(\.file) == ["a.txt", "b.txt"].map(root.appendingPathComponent)
            && reviewed[1].comment == "Keep x" && reviewed[1].lines == "y" && review.comments.isEmpty, "\(reviewed)")
        window.orderOut(nil)
    }

    func bufferInterface() async {
        let repository = await makeRepository("buffer", files: ["open.go": "package open\n\nfunc A() {}\n"])
        write("package open\n\nfunc A() {}\n\nfunc Saved() {}\n", to: "open.go", in: repository.root)
        let unsavedText = "package open\n\nfunc A() {}\n\nfunc Saved() {}\n\nfunc Typed() {}\n"
        let window = ChangesProbeWindow(size: NSSize(width: 900, height: 500))
        let disk = DiffViewController(source: .repository(repository, path: "open.go", comparison: .worktree))
        window.host(disk.view)
        _ = await Patience.until(.seconds(5)) { disk.document != nil }
        expect("buffer: with no open buffer the diff shows the file on disk", disk.document?.new.count == 5 && disk.document?.unsaved == false)
        let open = DiffViewController(source: .repository(repository, path: "open.go", comparison: .worktree))
        var asked: [URL] = []
        open.openText = { url in
            asked.append(url)
            return unsavedText
        }
        window.host(open.view)
        _ = await Patience.until(.seconds(5)) { open.document != nil }
        let badges = labels(in: open.pane.header)
        expect("buffer: an open buffer replaces the disk text", asked == [repository.url(of: "open.go")]
            && open.document?.new.count == 7 && open.document?.unsaved == true)
        expect("buffer: the header marks it unsaved", open.pane.header.subviews.contains { self.badges(in: $0).contains("Unsaved") }, "\(badges)")
        expect("buffer: stage and discard wait for a save", open.pane.canvas.actions == .none)
        let same = DiffViewController(source: .repository(repository, path: "open.go", comparison: .worktree))
        same.openText = { _ in "package open\n\nfunc A() {}\n\nfunc Saved() {}\n" }
        window.host(same.view)
        _ = await Patience.until(.seconds(5)) { same.document != nil }
        expect("buffer: a buffer equal to the disk is not unsaved", same.document?.unsaved == false
            && same.pane.canvas.actions == HunkActions(primary: .stage, destructive: .discard))
        let changes = ChangesViewController(workspace: Workspace(root: repository.root), environment: Self.isolated)
        changes.openText = { _ in unsavedText }
        var opened: DiffViewController?
        changes.onOpenDiff = { opened = $0 }
        window.host(changes.view)
        _ = await Patience.until(.seconds(10)) { changes.rows.count == 2 }
        changes.openDiff(row: 1)
        expect("buffer: the Changes list hands its buffer reader to the diffs it opens", opened?.openText?(repository.url(of: "open.go")) == unsavedText)
        window.orderOut(nil)
    }

    func badges(in view: NSView) -> [String] {
        ((view as? Badge).map { [$0.text] } ?? []) + view.subviews.flatMap(badges)
    }
}
