import AppKit
import NyteCore
import NyteUI

@MainActor
final class FailureView: NSView {
    static let glyph = Glyph.md
    static let gap = Space.x2

    var onNavigate: ((FileLocation) -> Void)?
    var onToggleOutput: ((Bool) -> Void)?
    var onInstall: ((ToolInstall) -> Void)? { didSet { showInstall() } }

    private let icon = NSImageView()
    private let text = NSTextView()
    private let open = Button("", variant: .link, tone: .primary, size: .sm)
    private let output = Button("Build Output", variant: .ghost, size: .sm)
    private let install = Button("", variant: .outline, size: .sm)
    private var failure: LaunchFailure?
    private(set) var showsOutput = false
    private let textHeight: NSLayoutConstraint
    private var fitsContent: NSLayoutConstraint?

    init() {
        textHeight = text.heightAnchor.constraint(equalToConstant: TextStyle.base.lineHeight)
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        icon.image = Symbol.image("exclamationmark.octagon.fill", glyph: Self.glyph)
        icon.contentTintColor = Palette.dangerInk
        icon.setAccessibilityElement(false)
        text.isEditable = false
        text.isSelectable = true
        text.isRichText = true
        text.drawsBackground = false
        text.textContainerInset = .zero
        text.textContainer?.lineFragmentPadding = 0
        text.textContainer?.widthTracksTextView = true
        text.isVerticallyResizable = true
        text.selectedTextAttributes = [.backgroundColor: TerminalPalette.selection]
        text.setAccessibilityLabel("Launch failure")
        open.onPress = { [weak self] in self?.navigate() }
        output.trailingSymbol = "chevron.down"
        output.onPress = { [weak self] in self?.toggleOutput() }
        install.onPress = { [weak self] in
            guard let self, let offer = failure?.install else { return }
            onInstall?(offer)
        }
        install.isHidden = true
        let buttons = NSStackView(views: [install, output])
        buttons.orientation = .horizontal
        buttons.spacing = Space.x1
        for view in [icon, open, text, buttons] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        NSLayoutConstraint.activate([
            icon.leadingAnchor.constraint(equalTo: leadingAnchor, constant: Metric.paneInset),
            icon.centerYAnchor.constraint(equalTo: open.centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: Self.glyph.rawValue),
            icon.heightAnchor.constraint(equalToConstant: Self.glyph.rawValue),
            open.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: Self.gap),
            open.topAnchor.constraint(equalTo: topAnchor, constant: Space.x2),
            text.leadingAnchor.constraint(equalTo: open.leadingAnchor),
            text.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -Metric.paneInset),
            text.topAnchor.constraint(equalTo: open.bottomAnchor, constant: Space.x05),
            buttons.leadingAnchor.constraint(equalTo: text.leadingAnchor, constant: -Space.x2),
            buttons.topAnchor.constraint(equalTo: text.bottomAnchor, constant: Space.x2),
            buttons.bottomAnchor.constraint(lessThanOrEqualTo: bottomAnchor, constant: -Space.x2),
            textHeight,
        ])
        fitsContent = buttons.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -Space.x2)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func layout() {
        super.layout()
        let width = bounds.width - Metric.paneInset * 2 - Self.glyph.rawValue - Self.gap
        guard let storage = text.textStorage, width > 0 else { return }
        let height = storage.boundingRect(with: NSSize(width: width, height: .greatestFiniteMagnitude),
                                          options: [.usesLineFragmentOrigin, .usesFontLeading]).height.rounded(.up)
        if textHeight.constant != height { textHeight.constant = height }
    }

    func show(_ failure: LaunchFailure) {
        self.failure = failure
        let shown = NSMutableAttributedString(string: failure.message, attributes: TextStyle.code.attributes(Palette.contentPrimary))
        if failure.otherErrors > 0 {
            let more = failure.otherErrors == 1 ? "1 more error in the build output" : "\(failure.otherErrors) more errors in the build output"
            shown.append(NSAttributedString(string: "\n" + more, attributes: TextStyle.sm.attributes(Palette.contentSecondary)))
        }
        text.textStorage?.setAttributedString(shown)
        open.title = failure.place.isEmpty ? "Failed to start" : failure.place
        open.isEnabled = failure.location != nil
        open.toolTip = failure.location.map { "Open \($0.url.lastPathComponent) at line \($0.range.start.line + 1)" }
        open.setAccessibilityLabel(failure.location.map { "Go to \(failure.place) in \($0.url.lastPathComponent)" } ?? failure.place)
        output.title = failure.location == nil ? "Output" : "Build Output"
        showInstall()
        setShowsOutput(false)
        textHeight.constant = TextStyle.base.lineHeight
        needsLayout = true
    }

    private func showInstall() {
        install.isHidden = onInstall == nil || failure?.install == nil
        install.title = failure?.install?.title ?? ""
        install.toolTip = failure?.install?.shown
    }

    private func navigate() {
        guard let location = failure?.location else { return }
        onNavigate?(location)
    }

    private func toggleOutput() {
        setShowsOutput(!showsOutput)
    }

    func setShowsOutput(_ shows: Bool) {
        showsOutput = shows
        fitsContent?.isActive = shows
        output.trailingSymbol = shows ? "chevron.up" : "chevron.down"
        output.setAccessibilityLabel(shows ? "Hide \(output.title)" : "Show \(output.title)")
        onToggleOutput?(shows)
    }
}
