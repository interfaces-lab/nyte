import AppKit
import NyteCore
import NyteUI

@MainActor
final class NavigationFeature: EditorFeature {
    private unowned let editor: EditorViewController
    private let note = QuietNote()
    private(set) var underlined: NSRange?
    private var probed: (range: NSRange, revision: Int, found: Bool)?
    private var probe: Task<Void, Never>?
    private var going: Task<Void, Never>?

    init(editor: EditorViewController) {
        self.editor = editor
    }

    func pointerMoved(to point: NSPoint, offset: Int?, modifiers: NSEvent.ModifierFlags) {
        guard modifiers.contains(.command), editor.isAssisted, let offset, offset < editor.shownText.length,
              Identifier.isPart(editor.shownText.character(at: offset)),
              let range = Identifier.range(at: offset, in: editor.shownText)
        else { return clearUnderline() }
        let revision = editor.revision
        if let probed, probed.range == range, probed.revision == revision {
            return probed.found ? underline(range) : clearUnderline()
        }
        clearUnderline()
        probed = (range, revision, false)
        guard let url = editor.url, let intelligence = editor.intelligence, let position = editor.position(at: offset) else { return }
        probe?.cancel()
        probe = Task { [weak self] in
            let targets = await intelligence.locations(.definition, at: position, in: url)
            guard let self, !Task.isCancelled, editor.revision == revision, probed?.range == range else { return }
            probed = (range, revision, !targets.isEmpty)
            if !targets.isEmpty, NSEvent.modifierFlags.contains(.command) { underline(range) }
        }
    }

    func pointerExited() { clearUnderline() }
    func documentDidChange() { reset() }
    func textDidChange(in range: NSRange, delta: Int) { reset() }
    func viewportDidChange() { clearUnderline() }
    func focusDidLeave() { clearUnderline() }

    func handleClick(at offset: Int, event: NSEvent) -> Bool {
        guard event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command, editor.isAssisted,
              Identifier.range(at: offset, in: editor.shownText) != nil
        else { return false }
        clearUnderline()
        go(.definition, at: offset)
        return true
    }

    func drawOverText(in rect: NSRect) {
        guard let underlined else { return }
        let font = editor.textView.metrics.font
        let offset = editor.textView.metrics.baseline
        let thickness = max(Metric.hairline, font.underlineThickness)
        Palette.accentInk.setFill()
        for box in editor.rects(for: underlined) {
            let line = NSRect(x: box.minX, y: box.minY + offset - font.underlinePosition, width: box.width, height: thickness)
            if line.intersects(rect) { line.fill() }
        }
    }

    private func underline(_ range: NSRange) {
        NSCursor.pointingHand.set()
        guard underlined != range else { return }
        clearUnderline()
        underlined = range
        invalidate(range)
    }

    private func clearUnderline() {
        guard let underlined else { return }
        self.underlined = nil
        invalidate(underlined)
        NSCursor.iBeam.set()
    }

    private func invalidate(_ range: NSRange) {
        for box in editor.rects(for: range) { editor.textView.setNeedsDisplay(box) }
    }

    private func reset() {
        clearUnderline()
        probe?.cancel()
        probed = nil
        note.dismiss()
    }

    func canPerform(_ command: EditorCommand) -> Bool {
        Self.query(for: command) != nil && editor.isAssisted
    }

    func perform(_ command: EditorCommand) -> Bool {
        guard let query = Self.query(for: command), editor.isAssisted else { return false }
        go(query, at: editor.caretRange.location)
        return true
    }

    private static func query(for command: EditorCommand) -> LocationQuery? {
        switch command {
        case .goToDefinition: .definition
        case .goToTypeDefinition: .typeDefinition
        case .goToImplementations: .implementations
        case .findUsages: .references(includeDeclaration: false)
        default: nil
        }
    }

    private func go(_ query: LocationQuery, at offset: Int) {
        guard let url = editor.url, let intelligence = editor.intelligence, let position = editor.position(at: offset) else { return }
        let revision = editor.revision
        let name = editor.symbolName(at: offset)
        going?.cancel()
        going = Task { [weak self] in
            var query = query
            var targets = await intelligence.locations(query, at: position, in: url)
            guard let self, !Task.isCancelled, editor.revision == revision, editor.url == url else { return }
            if query == .definition, targets.count == 1, targets[0].url.standardizedFileURL == url.standardizedFileURL,
               targets[0].range.start <= position, position <= targets[0].range.end {
                query = .references(includeDeclaration: false)
                targets = await intelligence.locations(query, at: position, in: url)
                guard !Task.isCancelled, editor.revision == revision, editor.url == url else { return }
            }
            land(on: Self.unique(targets), query: query, name: name, offset: offset)
        }
    }

    private func land(on targets: [FileLocation], query: LocationQuery, name: String, offset: Int) {
        if targets.count == 1 { return editor.reveal(targets[0], asJump: true) }
        guard targets.isEmpty else { return editor.present(targets, title: Self.title(query, name: name)) }
        guard let rect = editor.caretRect(at: offset) else { return }
        note.show(Self.empty(query), at: rect, in: editor.textView)
    }

    private static func unique(_ targets: [FileLocation]) -> [FileLocation] {
        var seen = Set<FileLocation>()
        return targets.filter { seen.insert(FileLocation(url: $0.url.standardizedFileURL, range: $0.range)).inserted }
    }

    private static func title(_ query: LocationQuery, name: String) -> String {
        let subject = name.isEmpty ? "Symbol" : name
        return switch query {
        case .definition: "Definitions of \(subject)"
        case .typeDefinition: "Type definitions of \(subject)"
        case .implementations: "Implementations of \(subject)"
        case .references: "Usages of \(subject)"
        }
    }

    private static func empty(_ query: LocationQuery) -> String {
        switch query {
        case .definition: "No definition found"
        case .typeDefinition: "No type definition found"
        case .implementations: "No implementations found"
        case .references: "No usages found"
        }
    }
}
