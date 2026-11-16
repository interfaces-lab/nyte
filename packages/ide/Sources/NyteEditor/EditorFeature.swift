import AppKit
import NyteUI
import NyteCore

@MainActor
protocol EditorFeature: AnyObject {
    func documentDidChange()
    func textDidChange(in range: NSRange, delta: Int)
    func selectionDidChange()
    func viewportDidChange()
    func intelligenceDidReport(_ event: IntelligenceEvent)
    func outlineDidChange()

    func handleKey(_ event: NSEvent) -> Bool
    func didType(_ text: String)
    func pointerMoved(to point: NSPoint, offset: Int?, modifiers: NSEvent.ModifierFlags)
    func pointerExited()
    func handleClick(at offset: Int, event: NSEvent) -> Bool
    func handleClick(at point: NSPoint, event: NSEvent) -> Bool
    func focusDidLeave()

    func drawUnderText(in rect: NSRect)
    func drawOverText(in rect: NSRect)
    func inlineBoxes(forLine line: Int) -> [InlineBox]
    func colourRuns(forLine line: Int) -> [(range: NSRange, color: NSColor)]
    func trailingNotes(forLine line: Int) -> [TrailingNote]

    func canPerform(_ command: EditorCommand) -> Bool
    func perform(_ command: EditorCommand) -> Bool
}

extension EditorFeature {
    func documentDidChange() {}
    func textDidChange(in range: NSRange, delta: Int) {}
    func selectionDidChange() {}
    func viewportDidChange() {}
    func intelligenceDidReport(_ event: IntelligenceEvent) {}
    func outlineDidChange() {}
    func handleKey(_ event: NSEvent) -> Bool { false }
    func didType(_ text: String) {}
    func pointerMoved(to point: NSPoint, offset: Int?, modifiers: NSEvent.ModifierFlags) {}
    func pointerExited() {}
    func handleClick(at offset: Int, event: NSEvent) -> Bool { false }
    func handleClick(at point: NSPoint, event: NSEvent) -> Bool { false }
    func focusDidLeave() {}
    func drawUnderText(in rect: NSRect) {}
    func drawOverText(in rect: NSRect) {}
    func inlineBoxes(forLine line: Int) -> [InlineBox] { [] }
    func colourRuns(forLine line: Int) -> [(range: NSRange, color: NSColor)] { [] }
    func trailingNotes(forLine line: Int) -> [TrailingNote] { [] }
    func canPerform(_ command: EditorCommand) -> Bool { false }
    func perform(_ command: EditorCommand) -> Bool { false }
}

public enum EditorCommand: String, Sendable, CaseIterable {
    case goToDefinition, goToTypeDefinition, goToImplementations, findUsages
    case rename, showContextActions, formatDocument
    case showCompletions, showDocumentation, showParameterInfo
    case nextProblem, previousProblem
    case toggleBreakpoint
}

public struct ProblemCounts: Sendable, Equatable {
    public var errors = 0
    public var warnings = 0
    public var notes = 0

    public init(errors: Int = 0, warnings: Int = 0, notes: Int = 0) {
        self.errors = errors
        self.warnings = warnings
        self.notes = notes
    }

    public var total: Int { errors + warnings + notes }
}

public struct SymbolCrumb: Sendable, Equatable {
    public var name: String
    public var kind: SymbolKind
    public var selection: TextSpan

    public init(name: String, kind: SymbolKind, selection: TextSpan) {
        self.name = name
        self.kind = kind
        self.selection = selection
    }
}
