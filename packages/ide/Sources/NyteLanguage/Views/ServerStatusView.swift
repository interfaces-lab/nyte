import AppKit
import NyteCore
import NyteUI

@MainActor
public final class ServerStatusView: NSView {
    public var onRestart: ((ServerStatus) -> Void)?
    public var onInstall: ((ToolInstall) -> Void)?
    public var onOffer: ((ServerStatus.Offer) -> Void)?
    public var onReloadEnvironment: (() -> Void)?

    public static let width: CGFloat = 360
    static let inset = Space.x4
    static let rowHeight: CGFloat = 24
    static let labelWidth: CGFloat = 62
    static let sectionGap = Space.x4

    private let stack = NSStackView()

    public init() {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 0
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: topAnchor, constant: Self.inset - Space.x1),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: Self.inset),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -Self.inset),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -Self.inset + Space.x1),
            widthAnchor.constraint(equalToConstant: Self.width),
        ])
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public var isFlipped: Bool { true }

    public func show(_ statuses: [ServerStatus], environment: EnvironmentReading? = nil) {
        stack.setViews([], in: .top)
        for status in statuses {
            if !stack.arrangedSubviews.isEmpty { addRule() }
            for row in section(status) { add(row) }
        }
        addRule()
        if let problem = environment?.problem {
            let sentence = Label(problem, style: .sm, color: Palette.warningInk)
            sentence.maximumNumberOfLines = 0
            sentence.lineBreakMode = .byWordWrapping
            sentence.preferredMaxLayoutWidth = Self.width - 2 * Self.inset
            add(sentence)
            stack.setCustomSpacing(Space.x2, after: sentence)
        }
        let reload = Button("Reload Environment", variant: .outline, size: .sm) { [weak self] in self?.onReloadEnvironment?() }
        reload.toolTip = "Read your login shell and mise again after you change .zshrc or mise.toml"
        let read = environment.map { "Environment read in \($0.elapsed.formatted(.units(allowed: [.seconds, .milliseconds], width: .narrow)))" }
        let note = Label(read ?? "", style: .sm, color: Palette.contentTertiary)
        note.lineBreakMode = .byTruncatingTail
        note.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        add(line([note, NSView(), reload]))
    }

    private func add(_ row: NSView) {
        stack.addArrangedSubview(row)
        row.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
    }

    private func addRule() {
        let rule = Hairline()
        if let last = stack.arrangedSubviews.last { stack.setCustomSpacing(Self.sectionGap, after: last) }
        add(rule)
        stack.setCustomSpacing(Self.sectionGap, after: rule)
    }

    private func section(_ status: ServerStatus) -> [NSView] {
        let title = Label(status.name, style: .base, color: Palette.contentPrimary, weight: .semibold)
        title.lineBreakMode = .byTruncatingTail
        title.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        var heading: [NSView] = [title, NSView()]
        let isMissing: Bool = if case .missing = status.state { true } else { false }
        if !isMissing {
            heading.append(Button("Restart", variant: .outline, size: .sm) { [weak self] in self?.onRestart?(status) })
        }
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let shorten = { (url: URL?) in url.map { $0.path.hasPrefix(home) ? "~" + $0.path.dropFirst(home.count) : $0.path } }
        let memory = status.residentBytes.map { ByteCountFormatter.string(fromByteCount: Int64($0), countStyle: .memory) }
        let ceiling = status.memoryCeiling.map { ByteCountFormatter.string(fromByteCount: Int64($0), countStyle: .memory) }
        let facts: [(String, String?, String?)] = [
            ("State", Self.words(status.state), nil),
            ("Version", status.version.isEmpty ? nil : status.version, nil),
            ("Note", status.note, nil),
            ("Found in", status.source?.words, nil),
            ("Found at", shorten(status.location), status.location?.path),
            ("Root", shorten(status.root), status.root?.path),
            ("Memory", memory.map { used in ceiling.map { "\(used) of \($0)" } ?? used }, nil),
        ]
        let rows = facts.compactMap { name, value, full -> NSView? in
            guard let value else { return nil }
            let warns = status.isOverMemoryCeiling && name == "Memory"
            return row(name, value, toolTip: full, color: warns ? Palette.warningInk : Palette.contentPrimary)
        }
        return [line(heading)] + rows + actions(status)
    }

    private func actions(_ status: ServerStatus) -> [NSView] {
        var buttons: [Button] = []
        if let install = status.install {
            let button = Button(install.title, variant: .outline, size: .sm) { [weak self] in self?.onInstall?(install) }
            button.toolTip = "Runs \(install.shown) in a terminal"
            button.setAccessibilityHelp("Runs \(install.shown) in a terminal")
            buttons.append(button)
        }
        if let offer = status.offer {
            buttons.append(Button(offer.title, variant: .outline, size: .sm) { [weak self] in self?.onOffer?(offer) })
        }
        return buttons.map { button in
            let spacer = NSView()
            spacer.widthAnchor.constraint(equalToConstant: Self.labelWidth).isActive = true
            return line([spacer, button, NSView()])
        }
    }

    private func row(_ name: String, _ value: String, toolTip: String?, color: NSColor) -> NSView {
        let label = Label(name, style: .sm, color: Palette.contentTertiary)
        label.widthAnchor.constraint(equalToConstant: Self.labelWidth).isActive = true
        let text = Label(value, style: .sm, color: color)
        text.lineBreakMode = .byTruncatingMiddle
        text.maximumNumberOfLines = 1
        text.toolTip = toolTip ?? value
        text.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        text.setAccessibilityLabel("\(name): \(toolTip ?? value)")
        return line([label, text])
    }

    private func line(_ views: [NSView]) -> NSView {
        let row = NSStackView(views: views)
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = Space.x2
        row.heightAnchor.constraint(equalToConstant: Self.rowHeight).isActive = true
        return row
    }

    static func words(_ state: ServerStatus.State) -> String {
        switch state {
        case .missing: "Not installed"
        case .starting: "Starting"
        case .ready: "Running"
        case let .busy(title, percent): percent.map { "\(title) \($0)%" } ?? title
        case let .failed(sentence): sentence
        }
    }
}
