import AppKit
import NyteUI

@MainActor
final class ChipFlow: NSView {
    var onRemove: ((Int) -> Void)?
    var onOpen: ((ContextFormat.Chip) -> Void)?
    var onLeave: (() -> Void)?
    private(set) var chips: [ContextFormat.Chip] = []
    private var views: [Chip] = []
    private var more: Chip?
    private var removable = false
    private let singleLine: Bool
    private let row: ChipRow?
    private let peek = FloatingPanel(radius: Radius.control)
    private var laidHeight: CGFloat = 0

    static let gap = Space.x1
    static let peekWidth: CGFloat = 480
    static let peekPadding = Space.x2

    init(singleLine: Bool) {
        self.singleLine = singleLine
        row = nil
        super.init(frame: .zero)
        configure()
    }

    init(maximumLines: Int) {
        singleLine = false
        let row = ChipRow(maximumLines: maximumLines)
        self.row = row
        super.init(frame: .zero)
        addSubview(row)
        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: leadingAnchor),
            row.trailingAnchor.constraint(equalTo: trailingAnchor),
            row.topAnchor.constraint(equalTo: topAnchor),
            row.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        configure()
    }

    private func configure() {
        translatesAutoresizingMaskIntoConstraints = false
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("Context")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isFlipped: Bool { true }

    func show(_ chips: [ContextFormat.Chip], removable: Bool) {
        guard chips != self.chips || removable != self.removable else { return }
        peek.dismiss()
        if removable == self.removable, let gone = Self.removal(from: self.chips, to: chips) {
            self.chips = chips
            let held = window?.firstResponder === views[gone]
            views.remove(at: gone).removeFromSuperview()
            row?.chips = views
            needsLayout = true
            invalidateIntrinsicContentSize()
            guard held else { return }
            guard !views.isEmpty else {
                onLeave?()
                return
            }
            window?.makeFirstResponder(views[min(gone, views.count - 1)])
            return
        }
        self.chips = chips
        self.removable = removable
        views.forEach { $0.removeFromSuperview() }
        more?.removeFromSuperview()
        more = nil
        views = chips.map { chip in
            let view = Chip(chip.label, detail: chip.detail, image: Self.image(chip), symbol: Self.symbol(chip))
            view.symbolTone = Self.tone(chip)
            view.alwaysFocusable = removable
            view.toolTip = chip.path
            if removable {
                view.onRemove = { [weak self, weak view] in
                    guard let self, let view, let index = views.firstIndex(of: view) else { return }
                    onRemove?(index)
                }
            }
            view.onPress = { [weak self] in self?.onOpen?(chip) }
            view.onPeek = { [weak self, weak view] shown in
                guard let self, let view else { return }
                shown ? showPeek(chip, from: view) : peek.dismiss()
            }
            view.translatesAutoresizingMaskIntoConstraints = true
            if row == nil { addSubview(view) }
            return view
        }
        row?.chips = views
        needsLayout = true
        invalidateIntrinsicContentSize()
    }

    static func removal(from old: [ContextFormat.Chip], to new: [ContextFormat.Chip]) -> Int? {
        guard old.count == new.count + 1 else { return nil }
        let index = new.indices.first { old[$0] != new[$0] } ?? new.count
        return Array(old[..<index]) + old[(index + 1)...] == new ? index : nil
    }

    override var intrinsicContentSize: NSSize {
        guard row == nil else { return NSSize(width: NSView.noIntrinsicMetric, height: NSView.noIntrinsicMetric) }
        return NSSize(width: NSView.noIntrinsicMetric, height: chips.isEmpty ? 0 : max(Chip.height, laidHeight))
    }

    override func layout() {
        super.layout()
        guard row == nil else { return }
        var x: CGFloat = 0
        var y: CGFloat = 0
        var hidden = 0
        for (index, view) in views.enumerated() {
            let size = view.intrinsicContentSize
            let width = min(size.width, bounds.width)
            if x > 0, x + width > bounds.width {
                if singleLine {
                    hidden = views.count - index
                    break
                }
                x = 0
                y += Chip.height + Self.gap
            }
            view.isHidden = false
            view.frame = NSRect(x: x, y: y, width: width, height: Chip.height)
            x += width + Self.gap
        }
        if singleLine { placeMore(hidden: hidden, x: x) }
        let height = y + Chip.height
        guard height != laidHeight else { return }
        laidHeight = height
        invalidateIntrinsicContentSize()
    }

    private func placeMore(hidden: Int, x: CGFloat) {
        more?.removeFromSuperview()
        more = nil
        guard hidden > 0 else { return }
        for view in views.suffix(hidden) { view.isHidden = true }
        let chip = Chip("+\(hidden)")
        chip.setAccessibilityLabel("\(hidden) more")
        chip.toolTip = views.suffix(hidden).map(\.title).joined(separator: ", ")
        var start = x
        while start + chip.intrinsicContentSize.width > bounds.width, let last = views.last(where: { !$0.isHidden }) {
            last.isHidden = true
            start = last.frame.minX
            chip.title = "+\(views.filter(\.isHidden).count)"
        }
        chip.frame = NSRect(x: start, y: 0, width: chip.intrinsicContentSize.width, height: Chip.height)
        chip.translatesAutoresizingMaskIntoConstraints = true
        addSubview(chip)
        more = chip
    }

    func focusLast() -> Bool {
        guard let last = views.last(where: { !$0.isHidden }) else { return false }
        return window?.makeFirstResponder(last) ?? false
    }

    override func keyDown(with event: NSEvent) {
        let shown = views.filter { !$0.isHidden }
        guard let focused = window?.firstResponder as? Chip, let index = shown.firstIndex(of: focused) else { return super.keyDown(with: event) }
        switch event.specialKey {
        case .leftArrow?:
            if index > 0 { window?.makeFirstResponder(shown[index - 1]) }
        case .rightArrow?:
            if index + 1 < shown.count { window?.makeFirstResponder(shown[index + 1]) } else { onLeave?() }
        case .tab?:
            onLeave?()
        default:
            super.keyDown(with: event)
        }
    }

    override func cancelOperation(_ sender: Any?) {
        onLeave?()
    }

    func showPeek(at index: Int) {
        guard index < views.count else { return }
        showPeek(chips[index], from: views[index])
    }

    private func showPeek(_ chip: ContextFormat.Chip, from view: NSView) {
        guard !chip.preview.isEmpty else { return }
        let text = NSTextField(wrappingLabelWithString: chip.preview)
        text.font = TextStyle.code.font()
        text.textColor = Palette.contentSecondary
        text.maximumNumberOfLines = ContextFormat.previewLines + 1
        text.preferredMaxLayoutWidth = Self.peekWidth - Self.peekPadding * 2
        text.translatesAutoresizingMaskIntoConstraints = false
        let holder = NSView()
        holder.addSubview(text)
        NSLayoutConstraint.activate([
            text.leadingAnchor.constraint(equalTo: holder.leadingAnchor, constant: Self.peekPadding),
            text.trailingAnchor.constraint(equalTo: holder.trailingAnchor, constant: -Self.peekPadding),
            text.topAnchor.constraint(equalTo: holder.topAnchor, constant: Self.peekPadding),
        ])
        peek.content = holder
        let size = text.fittingSize
        peek.show(size: NSSize(width: Self.peekWidth, height: size.height + Self.peekPadding * 2), anchoredTo: view.bounds, in: view,
                  prefersAbove: true)
    }

    func hidePeek() { peek.dismiss() }

    static func image(_ chip: ContextFormat.Chip) -> NSImage? {
        switch chip.kind {
        case .file, .lines: FileIcon.forFile(named: chip.label.split(separator: ":").first.map(String.init) ?? chip.label)
            .image(for: NSApp.effectiveAppearance)
        case .review, .terminal, .stop, .diagnostic: nil
        }
    }

    static func symbol(_ chip: ContextFormat.Chip) -> String? {
        switch chip.kind {
        case .file, .lines: nil
        case .review: "text.bubble"
        case .terminal: "apple.terminal"
        case .stop: "pause.circle"
        case let .diagnostic(severity): severity == .error ? "xmark.octagon" : (severity == .warning ? "exclamationmark.triangle" : "info.circle")
        }
    }

    static func tone(_ chip: ContextFormat.Chip) -> Tone? {
        guard case let .diagnostic(severity) = chip.kind else { return nil }
        return severity == .error ? .danger : (severity == .warning ? .warning : nil)
    }
}
