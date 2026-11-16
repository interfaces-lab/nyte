import AppKit
import NyteUI

@MainActor
final class RequestCard: SurfaceView {
    var onAnswer: ((AgentRequest, RequestAnswer) -> Void)?
    private(set) var request: AgentRequest?
    private var step = 0
    private var answers: [[String]] = []
    private var writing = false
    private var other: Input?
    static let otherWord = "Other\u{2026}"
    private var accepting = true
    private var choices: [(label: String, description: String)] = []
    private var wrapping: [NSTextField] = []
    private var blocks: [(view: NSView, leading: CGFloat, trailing: CGFloat, gap: CGFloat)] = []
    private var tight = false
    private let options = ListView()
    private lazy var optionsHeight = options.heightAnchor.constraint(equalToConstant: 0)
    private var measuredWidth: CGFloat = 0

    private static let padding = Space.x3
    private static let commandPadding = NSSize(width: Space.x2, height: Space.x15)
    private static let commandLines = 6
    private static let textLines = 4
    private static let visibleOptions = 5
    private static var optionsMaxHeight: CGFloat { Metric.rowDouble * CGFloat(visibleOptions) }

    private static func content(_ choice: (label: String, description: String)) -> RowContent {
        var content = RowContent(title: choice.label)
        content.description = choice.description
        content.descriptionInk = .tertiary
        content.descriptionWraps = true
        return content
    }

    private func sizeOptions() {
        measuredWidth = options.bounds.width
        let total = (0 ..< choices.count).reduce(0) { $0 + (options.heightOfRow?($1) ?? Metric.row) }
        optionsHeight.constant = min(total, Self.optionsMaxHeight)
    }

    init() {
        super.init(fill: Palette.bgElevated, ring: Palette.strokeTertiary, radius: Radius.card)
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        options.rowCount = { [weak self] in self?.choices.count ?? 0 }
        options.content = { [weak self] row in
            guard let self, row < choices.count else { return RowContent() }
            return Self.content(choices[row])
        }
        options.heightOfRow = { [weak self] row in
            guard let self, row < choices.count else { return Metric.row }
            return RowCell.Geometry.height(Self.content(choices[row]), width: options.bounds.width)
        }
        options.onActivate = { [weak self] row in self?.pick(row) }
        options.showsFocusAlways = true
        Density.observe(self) { [weak self] in
            guard let self, case .question? = request else { return }
            sizeOptions()
            options.reload()
        }
        options.setAccessibilityLabel("Options")
        optionsHeight.isActive = true
    }

    override func updateLayer() {
        super.updateLayer()
        guard let layer else { return }
        Elevation.md.apply(to: layer)
        layer.shadowPath = Shape.rounded(bounds, radius: Radius.card).cgPath
    }

    override func layout() {
        super.layout()
        if case .question? = request, options.bounds.width != measuredWidth {
            sizeOptions()
            options.reload()
        }
        let width = bounds.width - Self.padding * 2
        for field in wrapping {
            let inset = field.superview === self ? 0 : Self.commandPadding.width * 2
            guard field.preferredMaxLayoutWidth != width - inset else { continue }
            field.preferredMaxLayoutWidth = width - inset
            field.invalidateIntrinsicContentSize()
        }
        layer?.shadowPath = Shape.rounded(bounds, radius: Radius.card).cgPath
    }

    func show(_ request: AgentRequest) {
        accepting = true
        setAccessibilityElement(true)
        guard request != self.request else { return }
        self.request = request
        step = 0
        answers = []
        writing = false
        build()
    }

    func retire() {
        accepting = false
        request = nil
        setAccessibilityElement(false)
        if window?.firstResponder.map({ ($0 as? NSView)?.isDescendant(of: self) ?? false }) == true {
            window?.makeFirstResponder(nil)
        }
    }

    override func hitTest(_ point: NSPoint) -> NSView? { accepting ? super.hitTest(point) : nil }

    func primary() -> Bool {
        guard accepting, let request else { return false }
        switch request {
        case .approval: onAnswer?(request, .allowOnce)
        case .question: writing ? answerOther() : pick(options.selectedRow ?? 0)
        }
        return true
    }

    func decline() -> Bool {
        guard accepting, let request else { return false }
        if writing {
            write(false)
            return true
        }
        let answer: RequestAnswer = if case .approval = request { .deny } else { .skip }
        onAnswer?(request, answer)
        return true
    }

    func move(by delta: Int) -> Bool {
        guard accepting, !writing, case .question? = request, !choices.isEmpty else { return false }
        options.moveSelection(by: delta)
        return true
    }

    private func pick(_ row: Int) {
        guard row >= 0, row < choices.count else { return }
        give(choices[row].label)
    }

    private func answerOther() {
        let text = other?.stringValue.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !text.isEmpty else { return }
        give(text)
    }

    func write(_ on: Bool) {
        guard accepting, case .question? = request, on != writing else { return }
        writing = on
        build()
        if let other, on { window?.makeFirstResponder(other.field) }
    }

    private func give(_ answer: String) {
        guard accepting, let current = request, case let .question(question) = current else { return }
        writing = false
        answers.append([answer])
        step += 1
        guard step >= question.items.count else {
            build()
            return
        }
        onAnswer?(current, .choose(answers))
    }

    private func build() {
        blocks.forEach { $0.view.removeFromSuperview() }
        blocks = []
        wrapping = []
        guard let request else { return }
        switch request {
        case let .approval(approval):
            if approval.subagent { heading("From a subagent") }
            add(Label(approval.title, style: .base, color: Palette.contentPrimary, weight: .medium))
            if approval.command {
                add(commandBox(approval.detail))
            } else if !approval.detail.isEmpty {
                add(wrap(approval.detail, style: .base, color: Palette.contentSecondary, lines: Self.textLines))
            }
            add(wrap(Self.grantScope(approval), style: .sm, color: Palette.contentTertiary, lines: Self.textLines), gap: Space.x2)
            let session = Button("Allow for Session", variant: .outline, size: .sm) { [weak self] in
                guard let self, accepting, let request = self.request else { return }
                onAnswer?(request, .allowForSession)
            }
            let deny = Button("Deny", variant: .outline, size: .sm) { [weak self] in _ = self?.decline() }
            deny.shortcut = "Esc"
            let once = Button("Allow Once", variant: .solid, tone: .primary, size: .sm) { [weak self] in _ = self?.primary() }
            once.shortcut = "\u{21A9}"
            add(buttons(leading: [session], trailing: [deny, once]), gap: Space.x3)
            setAccessibilityLabel([approval.title, approval.detail].filter { !$0.isEmpty }.joined(separator: " "))
        case let .question(question):
            guard step < question.items.count else { return }
            let item = question.items[step]
            let count = question.items.count > 1 ? "\(step + 1) of \(question.items.count)" : ""
            let heading = [question.subagent ? "From a subagent" : "", item.header, count].filter { !$0.isEmpty }
            if !heading.isEmpty { self.heading(heading.joined(separator: " \u{00B7} ")) }
            add(wrap(item.question, style: .base, color: Palette.contentPrimary, lines: Self.textLines, weight: .medium))
            choices = item.options
            other = nil
            if writing {
                let field = Input(placeholder: "Your answer", size: .md)
                field.field.setAccessibilityLabel("Your answer to: " + item.question)
                field.onSubmit = { [weak self] _ in self?.answerOther() }
                field.onCancel = { [weak self] in self?.write(false) }
                other = field
                add(field)
                let back = Button("Back", variant: .outline, size: .sm) { [weak self] in self?.write(false) }
                back.shortcut = "Esc"
                let answer = Button("Answer", variant: .solid, tone: .primary, size: .sm) { [weak self] in self?.answerOther() }
                answer.shortcut = "\u{21A9}"
                add(buttons(leading: [], trailing: [back, answer]), gap: Space.x3)
            } else {
                add(options, inset: Self.padding - RowCell.Geometry.inset - RowCell.Geometry.padding)
                options.reload()
                sizeOptions()
                options.selectedRow = choices.isEmpty ? nil : 0
                let own = Button(Self.otherWord, variant: .ghost, size: .sm) { [weak self] in self?.write(true) }
                own.setAccessibilityLabel("Answer in your own words")
                let skip = Button("Skip", variant: .outline, size: .sm) { [weak self] in _ = self?.decline() }
                skip.shortcut = "Esc"
                let choose = Button("Choose", variant: .solid, tone: .primary, size: .sm) { [weak self] in _ = self?.primary() }
                choose.shortcut = "\u{21A9}"
                choose.isEnabled = !choices.isEmpty
                add(buttons(leading: [own], trailing: [skip, choose]), gap: Space.x3)
            }
            setAccessibilityLabel(item.question)
        }
        place()
        needsLayout = true
    }

    static func grantScope(_ approval: Approval) -> String {
        guard !approval.tool.isEmpty else { return "Allow for Session stops asking about this tool until the session ends." }
        let what = approval.command ? "command" : "call"
        return "Allow for Session runs every \(approval.tool) \(what) in this session without asking, not only this one."
    }

    private func heading(_ text: String) {
        add(Label(text, style: .sm, color: Palette.contentTertiary))
        tight = true
    }

    private func add(_ view: NSView, inset: CGFloat = RequestCard.padding, leading: CGFloat? = nil, gap: CGFloat = Space.x2) {
        blocks.append((view, leading ?? inset, inset, tight ? Space.x05 : gap))
        tight = false
    }

    private func place() {
        var previous: NSView?
        var constraints: [NSLayoutConstraint] = []
        for block in blocks {
            block.view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(block.view)
            constraints += [
                block.view.leadingAnchor.constraint(equalTo: leadingAnchor, constant: block.leading),
                block.view.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -block.trailing),
                block.view.topAnchor.constraint(equalTo: previous?.bottomAnchor ?? topAnchor, constant: previous == nil ? Self.padding : block.gap),
            ]
            previous = block.view
        }
        if let previous { constraints.append(previous.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -Self.padding)) }
        NSLayoutConstraint.activate(constraints)
    }

    private func wrap(_ text: String, style: TextStyle, color: NSColor, lines: Int, weight: NSFont.Weight = .regular) -> NSTextField {
        let field = NSTextField(wrappingLabelWithString: text)
        var attributes = style.attributes(color, weight: weight)
        attributes[.paragraphStyle] = style.paragraph(lineBreak: style.mono ? .byCharWrapping : .byWordWrapping)
        field.attributedStringValue = NSAttributedString(string: text, attributes: attributes)
        field.isSelectable = true
        field.maximumNumberOfLines = lines
        field.lineBreakMode = style.mono ? .byCharWrapping : .byWordWrapping
        field.cell?.truncatesLastVisibleLine = true
        field.translatesAutoresizingMaskIntoConstraints = false
        field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        wrapping.append(field)
        return field
    }

    private func commandBox(_ command: String) -> NSView {
        let box = SurfaceView(fill: Palette.bgBase, ring: Palette.strokeQuaternary, radius: Radius.control)
        let field = wrap(command, style: .code, color: Palette.contentPrimary, lines: Self.commandLines)
        box.addSubview(field)
        NSLayoutConstraint.activate([
            field.topAnchor.constraint(equalTo: box.topAnchor, constant: Self.commandPadding.height),
            field.bottomAnchor.constraint(equalTo: box.bottomAnchor, constant: -Self.commandPadding.height),
            field.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: Self.commandPadding.width),
            field.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -Self.commandPadding.width),
        ])
        return box
    }

    private func buttons(leading: [NSView], trailing: [NSView]) -> NSStackView {
        let spacer = NSView()
        spacer.setContentHuggingPriority(.init(1), for: .horizontal)
        let row = NSStackView(views: leading + [spacer] + trailing)
        row.orientation = .horizontal
        row.spacing = Space.x2
        return row
    }
}
