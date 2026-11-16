import Foundation

struct Selection: Equatable, Sendable {
    var anchor: Int
    var head: Int
    var goal: CGFloat?

    init(anchor: Int, head: Int, goal: CGFloat? = nil) {
        self.anchor = anchor
        self.head = head
        self.goal = goal
    }

    init(caret: Int, goal: CGFloat? = nil) {
        self.init(anchor: caret, head: caret, goal: goal)
    }

    init(_ range: NSRange) {
        self.init(anchor: range.location, head: NSMaxRange(range))
    }

    var lower: Int { min(anchor, head) }
    var upper: Int { max(anchor, head) }
    var isEmpty: Bool { anchor == head }
    var range: NSRange { NSRange(location: lower, length: upper - lower) }
    var isReversed: Bool { head < anchor }

    func clamped(to length: Int) -> Selection {
        Selection(anchor: min(max(0, anchor), length), head: min(max(0, head), length), goal: goal)
    }
}

struct SelectionSet: Equatable, Sendable {
    private(set) var selections: [Selection]
    private(set) var primary: Int

    init(_ selections: [Selection], primary: Int = 0) {
        let given = selections.isEmpty ? [Selection(caret: 0)] : selections
        let chosen = min(max(primary, 0), given.count - 1)
        let order = given.indices.sorted { (given[$0].lower, given[$0].upper) < (given[$1].lower, given[$1].upper) }
        self.selections = order.map { given[$0] }
        self.primary = order.firstIndex(of: chosen) ?? 0
        merge()
    }

    init(caret: Int) {
        self.init([Selection(caret: caret)])
    }

    init(ranges: [NSRange], primary: Int = 0) {
        self.init(ranges.map(Selection.init), primary: primary)
    }

    var count: Int { selections.count }
    var primarySelection: Selection { selections[primary] }
    var ranges: [NSRange] { selections.map(\.range) }
    var hasSeveral: Bool { selections.count > 1 }
    var isAllEmpty: Bool { selections.allSatisfy(\.isEmpty) }

    func clamped(to length: Int) -> SelectionSet {
        SelectionSet(selections.map { $0.clamped(to: length) }, primary: primary)
    }

    func mapping(_ transform: (Selection) -> Selection) -> SelectionSet {
        SelectionSet(selections.map(transform), primary: primary)
    }

    func adding(_ selection: Selection) -> SelectionSet {
        SelectionSet(selections + [selection], primary: selections.count)
    }

    func removing(caretAt offset: Int) -> SelectionSet? {
        guard selections.count > 1, let index = selections.firstIndex(where: { $0.isEmpty && $0.head == offset }) else { return nil }
        var rest = selections
        rest.remove(at: index)
        return SelectionSet(rest, primary: index <= primary ? max(0, primary - 1) : primary)
    }

    var primaryOnly: SelectionSet { SelectionSet([primarySelection]) }

    private mutating func merge() {
        guard selections.count > 1 else { return }
        var merged = [selections[0]]
        var mergedPrimary = 0
        for index in 1..<selections.count {
            let next = selections[index]
            let last = merged[merged.count - 1]
            if next.lower <= last.upper {
                let lower = min(last.lower, next.lower)
                let upper = max(last.upper, next.upper)
                let reversed = index == primary ? next.isReversed : last.isReversed
                merged[merged.count - 1] = reversed ? Selection(anchor: upper, head: lower) : Selection(anchor: lower, head: upper)
                if index == primary { mergedPrimary = merged.count - 1 }
                continue
            }
            if index == primary { mergedPrimary = merged.count }
            merged.append(next)
        }
        selections = merged
        primary = mergedPrimary
    }
}
