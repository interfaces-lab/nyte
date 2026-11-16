import AppKit
import NyteCore
import NyteUI

public struct LineNote: Sendable, Equatable {
    public var zeroBasedLine: Int
    public var text: String
    public var isChanged: Bool
    public var isQuiet: Bool
    public var action: String?
    public var order: Int
    public var syntax: [(range: NSRange, color: SyntaxColor)]

    public init(zeroBasedLine: Int, text: String, isChanged: Bool = false, isQuiet: Bool = false, action: String? = nil, order: Int = 0,
                syntax: [(range: NSRange, color: SyntaxColor)] = []) {
        self.zeroBasedLine = zeroBasedLine
        self.text = text
        self.isChanged = isChanged
        self.isQuiet = isQuiet
        self.action = action
        self.order = order
        self.syntax = syntax
    }

    public static func == (left: LineNote, right: LineNote) -> Bool {
        left.zeroBasedLine == right.zeroBasedLine && left.text == right.text && left.isChanged == right.isChanged
            && left.isQuiet == right.isQuiet && left.action == right.action && left.order == right.order
            && left.syntax.count == right.syntax.count
            && zip(left.syntax, right.syntax).allSatisfy { $0.range == $1.range && $0.color == $1.color }
    }
}

enum LineNoteLayout {
    struct Segment: Equatable {
        let x: CGFloat
        let width: CGFloat
        let isCut: Bool
    }

    static let gap = TrailingNote.gap
    static let cap = TrailingNote.cap

    static func place(after codeEnd: CGFloat, edge: CGFloat, widths: [CGFloat], separator: CGFloat) -> [Segment?] {
        TrailingNote.place(after: codeEnd, edge: edge, widths: widths, separator: separator).map { placed in
            placed.map { Segment(x: $0.x, width: $0.width, isCut: $0.isCut) }
        }
    }
}

@MainActor
final class LineNotesFeature: EditorFeature {
    static let separator = " · "
    static let style = TextStyle.code

    private unowned let editor: EditorViewController
    private var notes: [LineNote] = []
    private var hitRects: [NSRect] = []
    private var hitNotes: [Int] = []
    private var hovered: Int?

    init(editor: EditorViewController) {
        self.editor = editor
    }

    var shown: [LineNote] { notes }
    var actionRects: [NSRect] { hitRects }

    func documentDidChange() { reload() }

    func reload() {
        let provided = editor.url.flatMap { url in editor.lineNotes?(url) } ?? []
        let next = provided.enumerated()
            .sorted { ($0.element.zeroBasedLine, $0.element.order, $0.offset) < ($1.element.zeroBasedLine, $1.element.order, $1.offset) }
            .map(\.element)
        guard next != notes else { return }
        notes = next
        hovered = nil
        editor.textView.needsDisplay = true
    }

    func textDidChange(in range: NSRange, delta: Int) {
        let change = editor.lastLineChange
        guard !notes.isEmpty, change.inserted != change.removed else { return }
        notes = notes.compactMap { note in
            if note.zeroBasedLine > change.line, note.zeroBasedLine <= change.line + change.removed { return nil }
            var moved = note
            if note.zeroBasedLine > change.line { moved.zeroBasedLine += change.inserted - change.removed }
            return moved
        }
    }

    func pointerMoved(to point: NSPoint, offset: Int?, modifiers: NSEvent.ModifierFlags) {
        let target = hitRects.indices.first { hitRects[$0].contains(point) }.map { hitNotes[$0] }
        guard target != hovered else {
            if target != nil { NSCursor.pointingHand.set() }
            return
        }
        hovered = target
        if target != nil { NSCursor.pointingHand.set() } else { NSCursor.iBeam.set() }
        editor.textView.needsDisplay = true
    }

    func pointerExited() {
        guard hovered != nil else { return }
        hovered = nil
        editor.textView.needsDisplay = true
    }

    func handleClick(at point: NSPoint, event: NSEvent) -> Bool {
        guard let slot = hitRects.indices.first(where: { hitRects[$0].contains(point) }) else { return false }
        activate(hitNotes[slot])
        return true
    }

    func actionableNote(onLine line: Int) -> Int? {
        notes.indices.first { notes[$0].zeroBasedLine == line && notes[$0].action != nil }
    }

    func activate(_ index: Int) {
        guard notes.indices.contains(index), notes[index].action != nil, let url = editor.url else { return }
        editor.onLineNote?(url, notes[index])
    }

    func trailingNotes(forLine line: Int) -> [TrailingNote] {
        var slot = lowerBound(line)
        var shown: [TrailingNote] = []
        while slot < notes.count, notes[slot].zeroBasedLine == line {
            shown.append(trailing(notes[slot], hovered: hovered == slot))
            slot += 1
        }
        return shown
    }

    func drawOverText(in rect: NSRect) {
        hitRects.removeAll(keepingCapacity: true)
        hitNotes.removeAll(keepingCapacity: true)
        guard !notes.isEmpty, let index = editor.lineIndex else { return }
        let visible = editor.textView.visibleLines
        var slot = lowerBound(visible.lowerBound)
        while slot < notes.count, notes[slot].zeroBasedLine <= visible.upperBound {
            let line = notes[slot].zeroBasedLine
            var end = slot
            while end < notes.count, notes[end].zeroBasedLine == line { end += 1 }
            defer { slot = end }
            guard line < index.count, (slot..<end).contains(where: { notes[$0].action != nil }) else { continue }
            let frames = editor.textView.trailingNoteFrames(forLine: line, notes: (slot..<end).map { trailing(notes[$0], hovered: false) })
            for (offset, frame) in frames.enumerated() {
                guard let frame else { break }
                guard notes[slot + offset].action != nil else { continue }
                hitRects.append(frame)
                hitNotes.append(slot + offset)
            }
        }
    }

    private func trailing(_ note: LineNote, hovered: Bool) -> TrailingNote {
        let ink = note.isChanged ? Palette.accentInk : (note.isQuiet ? Palette.contentTertiary : Palette.contentSecondary)
        guard !note.syntax.isEmpty, !note.isQuiet else { return TrailingNote([TrailingNote.Segment(note.text)], ink: ink, isUnderlined: hovered) }
        let text = note.text as NSString
        var segments: [TrailingNote.Segment] = []
        var cursor = 0
        for (range, color) in note.syntax.sorted(by: { $0.range.location < $1.range.location })
        where range.location >= cursor && NSMaxRange(range) <= text.length {
            if range.location > cursor { segments.append(TrailingNote.Segment(text.substring(with: NSRange(location: cursor, length: range.location - cursor)))) }
            segments.append(TrailingNote.Segment(text.substring(with: range), color: color))
            cursor = NSMaxRange(range)
        }
        if cursor < text.length { segments.append(TrailingNote.Segment(text.substring(from: cursor))) }
        return TrailingNote(segments, ink: ink, isUnderlined: hovered)
    }

    private func lowerBound(_ line: Int) -> Int {
        var low = 0
        var high = notes.count
        while low < high {
            let middle = (low + high) / 2
            if notes[middle].zeroBasedLine < line { low = middle + 1 } else { high = middle }
        }
        return low
    }
}
