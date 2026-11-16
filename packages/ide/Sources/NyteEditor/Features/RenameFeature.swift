import AppKit
import NyteCore
import NyteUI

@MainActor
final class RenameFeature: EditorFeature {
    static let smallEdit = 40
    static let boxPadding = Space.x05 + Space.hair
    static let hintInset = Space.x2
    static let hintGap = Space.x15

    private struct Session {
        let url: URL
        let position: TextPosition
        let original: String
        let caretBefore: NSRange
        let undo: UndoManager
        var box: NSRange
        var others: [NSRange]
        var isSubmitting = false
    }

    private unowned let editor: EditorViewController
    private let hint = FloatingPanel(radius: Radius.control, presentation: .hover)
    private let hintRow = NSStackView()
    private let title = Label("", style: .sm, color: Palette.contentSecondary)
    private let note = QuietNote()
    private var session: Session?
    private var request: Task<Void, Never>?
    private var isRewriting = false
    private var isMirrorQueued = false

    init(editor: EditorViewController) {
        self.editor = editor
        hintRow.orientation = .horizontal
        hintRow.alignment = .centerY
        hintRow.spacing = Self.hintGap
        hintRow.edgeInsets = NSEdgeInsets(top: 0, left: Self.hintInset, bottom: 0, right: Self.hintInset)
        for view in [title, Kbd("↩"), Label("Rename", style: .sm, color: Palette.contentTertiary), Kbd("esc"),
                     Label("Cancel", style: .sm, color: Palette.contentTertiary)] as [NSView] {
            hintRow.addArrangedSubview(view)
        }
        hintRow.setCustomSpacing(Self.hintGap * 2, after: title)
        hint.content = hintRow
        hint.onDismiss = { [weak self] in self?.hintDismissed() }
        hintRow.setAccessibilityLabel("Rename")
    }

    func documentDidChange() { cancel() }
    func focusDidLeave() { cancel() }

    func canPerform(_ command: EditorCommand) -> Bool {
        command == .rename && editor.isAssisted
    }

    func perform(_ command: EditorCommand) -> Bool {
        guard command == .rename, editor.isAssisted, let url = editor.url, let intelligence = editor.intelligence else { return false }
        cancel()
        let caret = editor.caretRange
        guard let position = editor.position(at: caret.location) else { return false }
        let revision = editor.revision
        request = Task { [weak self] in
            let answer = await intelligence.renameTarget(at: position, in: url)
            guard let self, !Task.isCancelled, editor.revision == revision, editor.url == url else { return }
            guard let answer, let box = editor.range(of: answer.range), box.length > 0 else {
                if let rect = editor.caretRect(at: caret.location) { note.show("This symbol can’t be renamed", at: rect, in: editor.textView) }
                return
            }
            let spans = await intelligence.highlights(at: answer.range.start, in: url)
            guard !Task.isCancelled, editor.revision == revision, editor.url == url else { return }
            let others = spans.compactMap(editor.range(of:)).filter { $0.length == box.length && NSIntersectionRange($0, box).length == 0 }
            begin(Session(url: url, position: answer.range.start, original: editor.shownText.substring(with: box),
                          caretBefore: caret, undo: editor.currentUndoManager, box: box, others: others))
        }
        return true
    }

    func handleKey(_ event: NSEvent) -> Bool {
        guard let session, event.modifierFlags.intersection([.command, .option, .control]).isEmpty else { return false }
        switch event.specialKey {
        case .carriageReturn?, .enter?:
            if !session.isSubmitting { submit() }
            return true
        case .tab?, .backTab?:
            return true
        default:
            guard event.charactersIgnoringModifiers == "\u{1B}" else { return session.isSubmitting }
            cancel()
            return true
        }
    }

    func textDidChange(in range: NSRange, delta: Int) {
        guard !isRewriting, var current = session else { return }
        let oldEnd = NSMaxRange(range) - delta
        guard range.location >= current.box.location, oldEnd <= NSMaxRange(current.box) else {
            session = nil
            Task { @MainActor [weak self] in self?.abandon(current) }
            return
        }
        current.box.length += delta
        current.others = current.others.map { $0.location >= oldEnd ? NSRange(location: $0.location + delta, length: $0.length) : $0 }
        session = current
        showHint(title: "Rename \(current.original)", isError: false)
        guard !isMirrorQueued else { return }
        isMirrorQueued = true
        // AppKit: A storage must not be edited again while it processes an edit, so the occurrences follow on the next turn.
        Task { @MainActor [weak self] in self?.mirror() }
    }

    func selectionDidChange() {
        guard !isRewriting, let session else { return }
        let caret = editor.caretRange
        if caret.location < session.box.location || NSMaxRange(caret) > NSMaxRange(session.box) { cancel() }
    }

    func drawUnderText(in rect: NSRect) {
        guard let session else { return }
        for range in session.others {
            for box in editor.rects(for: range) where box.intersects(rect) {
                Draw.fill(box, radius: Radius.indicator, color: Palette.fillSecondary)
            }
        }
        let field = editor.rects(for: session.box).first
            ?? editor.caretRect(at: session.box.location)
            ?? .zero
        let rim = NSRect(x: field.minX - Self.boxPadding, y: field.minY,
                         width: max(field.width, Metric.hairline) + Self.boxPadding * 2, height: field.height)
        if rim.intersects(rect) { Draw.ring(rim, radius: Radius.indicator, color: Palette.focus) }
    }

    private func begin(_ new: Session) {
        new.undo.disableUndoRegistration()
        editor.textView.breakUndoCoalescing()
        session = new
        editor.isEditingInPlace = true
        editor.textView.setSelectedRange(new.box)
        editor.textView.needsDisplay = true
        showHint(title: "Rename \(new.original)", isError: false)
    }

    private func submit() {
        guard var current = session, let intelligence = editor.intelligence else { return }
        let name = editor.shownText.substring(with: current.box).trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty, name != current.original else { return cancel() }
        current.isSubmitting = true
        session = current
        rewrite(to: current.original)
        request = Task { [weak self] in
            let result = await intelligence.rename(at: current.position, in: current.url, to: name)
            guard let self, !Task.isCancelled, session != nil else { return }
            switch result {
            case .failure(let failure):
                rewrite(to: name)
                session?.isSubmitting = false
                if let box = session?.box { editor.textView.setSelectedRange(NSRange(location: NSMaxRange(box), length: 0)) }
                showHint(title: plainMessage(failure.message, name: name), isError: true)
            case .success(let edit):
                end(restoringCaret: true)
                guard !edit.isEmpty else { return }
                if edit.files.allSatisfy({ $0.edits.isEmpty || $0.url.standardizedFileURL == current.url.standardizedFileURL }),
                   edit.editCount <= Self.smallEdit, editor.url == current.url {
                    _ = await editor.apply(edit)
                } else {
                    editor.preview(edit, title: "Rename \(current.original) to \(name)")
                }
            }
        }
    }

    private func plainMessage(_ server: String, name: String) -> String {
        let language = editor.shown?.language
        return RenameMessage.plain(server, name: name, language: language?.name ?? "", keywords: language?.keywords ?? [])
    }

    private func cancel() {
        request?.cancel()
        request = nil
        guard let session else { return }
        rewrite(to: session.original)
        end(restoringCaret: true)
    }

    private func abandon(_ abandoned: Session) {
        session = abandoned
        end(restoringCaret: false)
    }

    private func end(restoringCaret: Bool) {
        guard let finished = session else { return }
        session = nil
        editor.textView.breakUndoCoalescing()
        finished.undo.enableUndoRegistration()
        editor.isEditingInPlace = false
        if restoringCaret, editor.url == finished.url { editor.textView.setSelectedRange(finished.caretBefore) }
        if hint.isShown { hint.dismiss() }
        editor.textView.needsDisplay = true
    }

    private func mirror() {
        isMirrorQueued = false
        guard let current = session, !current.others.isEmpty, !current.isSubmitting else { return }
        let name = editor.shownText.substring(with: current.box)
        let rewritten = rewriting(current.others, current.box, to: name, includingBox: false)
        session?.others = rewritten.others
        session?.box = rewritten.box
    }

    private func rewrite(to name: String) {
        guard let current = session else { return }
        let caret = editor.caretRange
        let rewritten = rewriting(current.others, current.box, to: name, includingBox: true)
        session?.others = rewritten.others
        session?.box = rewritten.box
        if caret.location > rewritten.box.location { editor.textView.setSelectedRange(NSRange(location: NSMaxRange(rewritten.box), length: 0)) }
    }

    private func rewriting(_ others: [NSRange], _ box: NSRange, to name: String, includingBox: Bool)
        -> (others: [NSRange], box: NSRange) {
        isRewriting = true
        defer { isRewriting = false }
        let length = (name as NSString).length
        let targets = (others.map { ($0, false) } + (includingBox ? [(box, true)] : []))
            .sorted { $0.0.location > $1.0.location }
        for (range, _) in targets { editor.replaceUntracked(range, with: name) }
        var shift = 0
        var moved: [NSRange] = []
        var movedBox = box
        let ascending = (others.map { ($0, false) } + [(box, true)]).sorted { $0.0.location < $1.0.location }
        for (range, isBox) in ascending {
            let rewritten = isBox ? includingBox : true
            let location = range.location + shift
            let newLength = rewritten ? length : range.length
            if isBox { movedBox = NSRange(location: location, length: newLength) } else { moved.append(NSRange(location: location, length: newLength)) }
            shift += newLength - range.length
        }
        return (moved, movedBox)
    }

    private func showHint(title text: String, isError: Bool) {
        guard let session, let line = editor.rects(for: session.box).first else { return }
        title.stringValue = text
        title.textColor = isError ? Palette.dangerInk : Palette.contentSecondary
        let size = NSSize(width: ceil(hintRow.fittingSize.width), height: Metric.rowCompact)
        if hint.isShown { return hint.resize(to: size) }
        let anchor = NSRect(x: line.minX - Self.boxPadding - Self.hintInset, y: line.minY, width: 0, height: line.height)
        hint.show(size: size, anchoredTo: anchor, in: editor.textView)
    }

    private func hintDismissed() {
        guard !hint.isShown, session != nil else { return }
        cancel()
    }
}
