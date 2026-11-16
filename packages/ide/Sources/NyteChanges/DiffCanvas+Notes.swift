import AppKit
import NyteCore
import NyteUI

extension DiffCanvas {
    struct Composing: Equatable {
        var editing: Int?
        var side: ReviewComment.Side
        var lines: Range<Int>
        var draft: String
    }

    var noteWidth: CGFloat {
        let room = mode == .split ? halves(visibleRect).width - textX - Self.gutterPadding : visibleRect.width - textX - Space.x4
        return max(NoteView.narrowest, min(NoteView.measure, room))
    }

    func noteAnchors() -> [DiffRows.Anchor] {
        let width = noteWidth
        var anchors = notes.filter { $0.id != composing?.editing }.map { note in
            DiffRows.Anchor(side: note.side, line: note.last, height: NoteView.height(note, width: width) + Space.x2, note: note.id)
        }
        if let composing {
            anchors.append(DiffRows.Anchor(side: composing.side, line: composing.lines.upperBound - 1,
                                           height: NoteComposer.height + Space.x2, note: -1))
        }
        return anchors
    }

    func openComposer() {
        guard acceptsNotes, let target = DiffNote.target(rows: rows, selected: selectedRows, document: document) else {
            return NSSound.beep()
        }
        composing = Composing(editing: nil, side: target.side, lines: target.lines, draft: "")
        rebuild(keepingCursor: true)
        focusComposer()
    }

    func editNote(_ id: Int) {
        guard let note = notes.first(where: { $0.id == id }) else { return }
        composing = Composing(editing: id, side: note.side, lines: note.lines, draft: note.comment)
        rebuild(keepingCursor: true)
        focusComposer()
    }

    func removeNote(_ id: Int) {
        notes.removeAll { $0.id == id }
        noteViews.removeValue(forKey: id)?.removeFromSuperview()
        rebuild(keepingCursor: true)
        onNotesChange?()
    }

    func commitComposer() {
        guard let composing else { return }
        let words = (composer?.field.string ?? composing.draft).trimmingCharacters(in: .whitespacesAndNewlines)
        if let id = composing.editing, let index = notes.firstIndex(where: { $0.id == id }) {
            notes[index].comment = words
        } else if var note = DiffNote.make(id: nextNote, side: composing.side, lines: composing.lines, in: document) {
            nextNote += 1
            note.comment = words
            notes.append(note)
        }
        closeComposer()
        onNotesChange?()
    }

    func closeComposer() {
        composing = nil
        composer?.removeFromSuperview()
        composer = nil
        rebuild(keepingCursor: true)
        window?.makeFirstResponder(self)
    }

    private func focusComposer() {
        guard let composer else { return }
        window?.makeFirstResponder(composer.field.textView)
    }

    func layoutNotes() {
        let visible = visibleRect
        let width = noteWidth
        var live = Set<Int>()
        for row in 0..<rows.count where rows.kinds[row] == .note || rows.kinds[row] == .composer {
            let rect = rows.rect(of: row, width: bounds.width)
            let side: ReviewComment.Side = rows.kinds[row] == .composer ? composing?.side ?? .new
                : notes.first { $0.id == Int(rows.old[row]) }?.side ?? .new
            let x = (mode == .split ? (side == .old ? halves(visible).old : halves(visible).new) : visible.minX) + textX
            let frame = NSRect(x: x.rounded(), y: rect.minY, width: width, height: rect.height - Space.x2)
            if rows.kinds[row] == .composer {
                let view = composer ?? makeComposer()
                view.frame = frame
                continue
            }
            let id = Int(rows.old[row])
            guard let note = notes.first(where: { $0.id == id }) else { continue }
            live.insert(id)
            let view = noteViews[id] ?? makeNoteView(id)
            view.show(note, numbered: numbered(note))
            view.frame = frame
        }
        for (id, view) in noteViews where !live.contains(id) {
            view.removeFromSuperview()
            noteViews[id] = nil
        }
        if composing == nil, let composer {
            composer.removeFromSuperview()
            self.composer = nil
        }
    }

    private func makeNoteView(_ id: Int) -> NoteView {
        let view = NoteView()
        view.edit.onPress = { [weak self] in self?.editNote(id) }
        view.remove.onPress = { [weak self] in self?.removeNote(id) }
        addSubview(view)
        noteViews[id] = view
        return view
    }

    private func makeComposer() -> NoteComposer {
        let view = NoteComposer()
        view.field.string = composing?.draft ?? ""
        view.field.returnKey = .submit
        view.field.onSubmit = { [weak self] _ in self?.commitComposer() }
        view.field.onCommand = { [weak self] command in
            guard command == #selector(NSResponder.cancelOperation(_:)) else { return false }
            self?.closeComposer()
            return true
        }
        view.add.onPress = { [weak self] in self?.commitComposer() }
        view.cancel.onPress = { [weak self] in self?.closeComposer() }
        addSubview(view)
        composer = view
        return view
    }

    func numbered(_ note: DiffNote) -> ClosedRange<Int> {
        let first = document.number(note.side, note.lines.lowerBound), last = document.number(note.side, note.lines.upperBound - 1)
        return first...max(first, last)
    }

    func describeNote(_ row: Int) -> String {
        guard rows.kinds[row] == .note, let note = notes.first(where: { $0.id == Int(rows.old[row]) }) else { return "New comment" }
        let lines = numbered(note)
        let range = lines.count == 1 ? "line \(lines.lowerBound)" : "lines \(lines.lowerBound) to \(lines.upperBound)"
        return "Comment on \(range): " + (note.comment.isEmpty ? NoteView.pointing : note.comment)
    }
}
