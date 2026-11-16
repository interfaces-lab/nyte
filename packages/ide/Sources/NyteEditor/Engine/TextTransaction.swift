import Foundation

struct TextReplacement: Equatable, Sendable {
    var range: NSRange
    var text: [UInt16]

    init(range: NSRange, text: [UInt16]) {
        self.range = range
        self.text = text
    }

    init(range: NSRange, _ string: String) {
        self.init(range: range, text: Array(string.utf16))
    }
}

enum EditKind: Equatable, Sendable {
    case typing
    case deletion
    case named(String)

    var coalesces: Bool { self == .typing || self == .deletion }

    var title: String {
        switch self {
        case .typing, .deletion: "Typing"
        case .named(let name): name
        }
    }
}

struct TextTransaction: Equatable, Sendable {
    var replacements: [TextReplacement]
    var before: SelectionSet
    var after: SelectionSet
    var kind: EditKind

    init(_ replacements: [TextReplacement], before: SelectionSet, after: SelectionSet, kind: EditKind) {
        self.replacements = replacements.sorted { $0.range.location < $1.range.location }
        self.before = before
        self.after = after
        self.kind = kind
    }

    var changesText: Bool { replacements.contains { $0.range.length > 0 || !$0.text.isEmpty } }

    func inverse(reading store: TextStore) -> TextTransaction {
        var shift = 0
        let undone = replacements.map { replacement -> TextReplacement in
            let restored = TextReplacement(range: NSRange(location: replacement.range.location + shift, length: replacement.text.count),
                                           text: store.units(replacement.range))
            shift += replacement.text.count - replacement.range.length
            return restored
        }
        return TextTransaction(undone, before: after, after: before, kind: kind)
    }

    @discardableResult
    func apply(to store: inout TextStore) -> [TextChange] {
        replacements.reversed().map { store.replace($0.range, with: $0.text) }
    }

    func mapped(_ offset: Int, stickingRight: Bool = true) -> Int {
        var shift = 0
        for replacement in replacements {
            let end = NSMaxRange(replacement.range)
            if offset < replacement.range.location || (!stickingRight && offset == replacement.range.location && replacement.range.length == 0) {
                break
            }
            if offset < end { return replacement.range.location + shift + (stickingRight ? replacement.text.count : 0) }
            shift += replacement.text.count - replacement.range.length
        }
        return offset + shift
    }
}

struct EditHistory: Sendable {
    struct Step: Equatable, Sendable {
        let id: Int
        var forward: [TextTransaction]
        var backward: [TextTransaction]
        var isOpen: Bool

        var title: String { forward.first?.kind.title ?? "" }
    }

    enum Recorded: Equatable {
        case opened(Step)
        case coalesced(Step)
    }

    private(set) var undoSteps: [Step] = []
    private(set) var redoSteps: [Step] = []
    private var nextID = 0

    var canUndo: Bool { !undoSteps.isEmpty }
    var canRedo: Bool { !redoSteps.isEmpty }

    @discardableResult
    mutating func record(_ transaction: TextTransaction, inverse: TextTransaction) -> Recorded {
        redoSteps.removeAll()
        if let last = undoSteps.last, last.isOpen, transaction.kind.coalesces, last.forward.last?.kind.coalesces == true {
            undoSteps[undoSteps.count - 1].forward.append(transaction)
            undoSteps[undoSteps.count - 1].backward.append(inverse)
            return .coalesced(undoSteps[undoSteps.count - 1])
        }
        breakCoalescing()
        let step = Step(id: nextID, forward: [transaction], backward: [inverse], isOpen: transaction.kind.coalesces)
        nextID += 1
        undoSteps.append(step)
        return .opened(step)
    }

    mutating func breakCoalescing() {
        guard !undoSteps.isEmpty else { return }
        undoSteps[undoSteps.count - 1].isOpen = false
    }

    mutating func undo() -> Step? {
        guard var step = undoSteps.popLast() else { return nil }
        step.isOpen = false
        redoSteps.append(step)
        return step
    }

    mutating func redo() -> Step? {
        guard var step = redoSteps.popLast() else { return nil }
        step.isOpen = false
        undoSteps.append(step)
        return step
    }

    static func undoing(_ step: Step) -> [TextTransaction] { step.backward.reversed() }
    static func redoing(_ step: Step) -> [TextTransaction] { step.forward }
}
