import AppKit

@MainActor
public final class FieldCompletion {
    public static let visibleRows = 8
    public static let inset = Space.x1

    public var onAccept: ((String) -> Void)?
    public var onCommand: ((Selector) -> Bool)?
    public private(set) var candidates: [String] = []
    public var isShown: Bool { panel.isShown }

    private weak var input: Input?
    private let panel = FloatingPanel(radius: Radius.control)
    private let list = ListView()

    public init(input: Input) {
        self.input = input
        list.rowHeight = Metric.rowCompact
        list.verticalInset = Self.inset
        list.showsFocusAlways = true
        list.acceptsFocus = false
        list.activatesOnClick = true
        list.rowCount = { [weak self] in self?.candidates.count ?? 0 }
        list.content = { [weak self] in
            var row = RowContent(title: self?.candidates[$0] ?? "")
            row.monospace = true
            if let typed = self?.input?.stringValue { row.emphasizeMatches(of: typed) }
            return row
        }
        list.onActivate = { [weak self] in self?.accept($0) }
        panel.content = list
        input.onCommand = { [weak self] in self?.handle($0) ?? false }
    }

    public func show(_ candidates: [String]) {
        self.candidates = candidates
        guard let input, !candidates.isEmpty else { return close() }
        list.reload()
        list.selectedRow = 0
        let rows = CGFloat(min(candidates.count, Self.visibleRows))
        panel.show(size: NSSize(width: input.bounds.width, height: rows * Metric.rowCompact + Self.inset * 2),
                   anchoredTo: input.bounds, in: input)
        list.updateFocus()
    }

    public func close() {
        candidates = []
        panel.dismiss()
    }

    public var selectedCandidate: String? { list.selectedRow.flatMap { candidates.indices.contains($0) ? candidates[$0] : nil } }

    static func commonPrefix(_ candidates: [String]) -> String {
        guard var prefix = candidates.first else { return "" }
        for candidate in candidates.dropFirst() {
            prefix = String(prefix.commonPrefix(with: candidate))
        }
        return prefix
    }

    func handle(_ command: Selector) -> Bool {
        guard isShown else { return onCommand?(command) ?? false }
        switch command {
        case #selector(NSResponder.moveDown(_:)): list.moveSelection(by: 1)
        case #selector(NSResponder.moveUp(_:)): list.moveSelection(by: -1)
        case #selector(NSResponder.insertNewline(_:)): accept(list.selectedRow ?? 0)
        case #selector(NSResponder.cancelOperation(_:)): close()
        case #selector(NSResponder.insertTab(_:)): complete()
        default: return onCommand?(command) ?? false
        }
        return true
    }

    private func complete() {
        let typed = input?.stringValue ?? ""
        let prefix = Self.commonPrefix(candidates)
        guard prefix.count > typed.count, prefix.hasPrefix(typed) else { return accept(list.selectedRow ?? 0) }
        input?.stringValue = prefix
        show(candidates)
    }

    private func accept(_ index: Int) {
        guard candidates.indices.contains(index) else { return close() }
        let chosen = candidates[index]
        input?.stringValue = chosen
        close()
        onAccept?(chosen)
    }
}
