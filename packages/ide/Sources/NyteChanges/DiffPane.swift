import AppKit
import NyteCore
import NyteUI

@MainActor
final class DiffPane: NSView {
    static let modeSegments = [Segmented.Segment(symbol: "text.justify.left", label: "Unified"),
                               Segmented.Segment(symbol: "rectangle.split.2x1", label: "Side by Side")]
    static let byteFormat = ByteCountFormatStyle(style: .file)
    static let badgeGap = Space.x15
    static let octal = 8

    let header = PaneHeader()
    let canvas = DiffCanvas()
    let scroll = QuietScrollView()
    let modeControl = Segmented(DiffPane.modeSegments, size: .xs, sizing: .hug, label: "Layout")
    let previousButton = Button(symbol: "chevron.up", label: "Previous Change", size: .sm)
    let nextButton = Button(symbol: "chevron.down", label: "Next Change", size: .sm)
    let sendButton = Button("Send to Agent", variant: .solid, tone: .primary, size: .sm)
    var onModeChange: ((DiffMode) -> Void)?
    var onOpenFile: (() -> Void)?

    private let folder = Label("", style: .sm, color: Palette.contentSecondary)
    let comparison = Label("", style: .sm, color: Palette.contentSecondary)
    private let added = Label("", style: .sm, color: Palette.successInk)
    private let removed = Label("", style: .sm, color: Palette.dangerInk)
    private let badges = NSStackView()
    private let body = NSView()
    private let stack = NSStackView()
    private(set) var banner: Banner?
    private var bannerHost: NSView?
    private var state: NSView?

    init() {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        for label in [added, removed] {
            label.font = TextStyle.sm.tabularFont()
            label.setContentCompressionResistancePriority(.required, for: .horizontal)
        }
        folder.lineBreakMode = .byTruncatingHead
        folder.setContentCompressionResistancePriority(.defaultLow - 1, for: .horizontal)
        comparison.lineBreakMode = .byTruncatingTail
        badges.orientation = .horizontal
        badges.spacing = Self.badgeGap
        narrow.isHidden = true
        narrow.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let middle = NSStackView(views: [folder, comparison, badges, added, removed, narrow])
        middle.orientation = .horizontal
        middle.spacing = Space.x2
        middle.setCustomSpacing(Space.x1, after: added)
        middle.alignment = .centerY
        header.middle = middle
        sendButton.isHidden = true
        header.actions = [sendButton, previousButton, nextButton, modeControl]
        previousButton.onPress = { [weak self] in self?.canvas.moveToChange(-1) }
        nextButton.onPress = { [weak self] in self?.canvas.moveToChange(1) }
        modeControl.onSelect = { [weak self] index in
            let mode = DiffMode(rawValue: index) ?? .unified
            self?.setMode(mode)
            self?.onModeChange?(mode)
        }
        scroll.documentView = canvas
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.hasHorizontalScroller = true
        scroll.autohidesScrollers = true
        scroll.scrollerStyle = .overlay
        scroll.automaticallyAdjustsContentInsets = false
        scroll.contentView.postsBoundsChangedNotifications = true
        scroll.contentView.postsFrameChangedNotifications = true
        NotificationCenter.default.addObserver(self, selector: #selector(clipMoved), name: NSView.boundsDidChangeNotification,
                                               object: scroll.contentView)
        NotificationCenter.default.addObserver(self, selector: #selector(clipResized), name: NSView.frameDidChangeNotification,
                                               object: scroll.contentView)
        stack.orientation = .vertical
        stack.alignment = .width
        stack.spacing = 0
        for view in [header, stack] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        body.translatesAutoresizingMaskIntoConstraints = false
        stack.addArrangedSubview(body)
        Pin.fill(scroll, in: body)
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: topAnchor),
            header.leadingAnchor.constraint(equalTo: leadingAnchor),
            header.trailingAnchor.constraint(equalTo: trailingAnchor),
            stack.topAnchor.constraint(equalTo: header.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    private var scrolledX: CGFloat = 0

    @objc private func clipMoved() {
        canvas.updateActionButtons()
        let x = scroll.contentView.bounds.minX
        guard x != scrolledX else { return }
        scrolledX = x
        canvas.layoutNotes()
        canvas.needsDisplay = true
    }

    @objc private func clipResized() { applyMode() }

    static let narrowestHalf = 60
    static let narrowNote = "Side by side needs a wider pane"
    private(set) var requestedMode = DiffMode.unified
    let narrow = Label(DiffPane.narrowNote, style: .sm, color: Palette.contentTertiary)

    func setMode(_ mode: DiffMode) {
        requestedMode = mode
        modeControl.selectedIndex = mode.rawValue
        applyMode()
    }

    func applyMode() {
        let width = scroll.contentView.bounds.width
        let refused = requestedMode == .split && width > 0 && canvas.splitColumns(width: width) < Self.narrowestHalf
        narrow.isHidden = !refused
        let effective = refused ? DiffMode.unified : requestedMode
        if canvas.mode != effective { canvas.mode = effective }
        canvas.resize()
    }

    func showLoading(path: String) {
        title(path, document: nil)
        replaceState(EmptyState(loading: true, title: "Comparing…"))
    }

    func show(_ document: DiffDocument, actions: HunkActions) {
        title(document.path, document: document)
        canvas.actions = actions
        setBanner(conflictBanner(document))
        switch document.shape {
        case .text:
            replaceState(nil)
            canvas.document = document
            applyMode()
        case .identical:
            replaceState(EmptyState(symbol: "equal.circle", title: identicalTitle(document), description: identicalDetail(document)))
        case let .binary(old, new):
            replaceState(EmptyState(symbol: "doc.zipper", title: "Binary file", description: Self.sizes(old, new),
                                    actions: openAction()))
        case let .tooLarge(old, new):
            replaceState(EmptyState(symbol: "doc.text.magnifyingglass", title: "Too large to compare",
                                    description: Self.sizes(old, new) + ". Changes are compared up to "
                                        + Int64(DiffDocument.largestFile).formatted(Self.byteFormat) + ".",
                                    actions: openAction()))
        case let .unavailable(message):
            replaceState(EmptyState(symbol: "exclamationmark.triangle", title: "Can’t show this change", description: message))
        }
        previousButton.isEnabled = !document.diff.hunks.isEmpty
        nextButton.isEnabled = !document.diff.hunks.isEmpty
        modeControl.isEnabled = document.shape == .text
    }

    func showFailure(_ title: String, message: String) {
        setBanner(Banner(title, detail: message, tone: .danger, onDismiss: { [weak self] in self?.setBanner(nil) }))
    }

    private func openAction() -> [(title: String, run: () -> Void)] {
        onOpenFile == nil ? [] : [("Open File", { [weak self] in self?.onOpenFile?() })]
    }

    private func conflictBanner(_ document: DiffDocument) -> Banner? {
        guard let conflict = document.conflict else { return nil }
        return Banner("Conflict: \(StatusMark.word(conflict))", detail: "Resolve the markers in the editor, then stage the file.",
                      tone: .danger, action: onOpenFile.map { open in ("Open File", open) })
    }

    private func identicalTitle(_ document: DiffDocument) -> String {
        if document.originalPath != nil { return "Renamed without changes" }
        if document.modeChanged { return "Only the file mode changed" }
        return "No changes"
    }

    private func identicalDetail(_ document: DiffDocument) -> String {
        if let original = document.originalPath { return original + " \u{2192} " + document.path }
        if document.modeChanged { return Self.modeChange(document.oldMode, document.newMode) }
        return document.oldTitle + " and " + document.newTitle + " are the same."
    }

    static func modeChange(_ old: UInt32, _ new: UInt32) -> String {
        let executable = new & 0o111 != 0
        guard (old & 0o111 != 0) != executable else { return "Mode " + String(old, radix: Self.octal) + " \u{2192} " + String(new, radix: Self.octal) }
        return executable ? "Now executable" : "No longer executable"
    }

    static func sizes(_ old: Int?, _ new: Int?) -> String {
        switch (old, new) {
        case let (old?, new?): Int64(old).formatted(byteFormat) + " \u{2192} " + Int64(new).formatted(byteFormat)
        case let (nil, new?): "Added, " + Int64(new).formatted(byteFormat)
        case let (old?, nil): "Deleted, " + Int64(old).formatted(byteFormat)
        case (nil, nil): "Empty"
        }
    }

    private func title(_ path: String, document: DiffDocument?) {
        let name = (path as NSString).lastPathComponent
        header.title = name
        folder.stringValue = (path as NSString).deletingLastPathComponent
        badges.arrangedSubviews.forEach { $0.removeFromSuperview() }
        comparison.stringValue = document?.comparison ?? ""
        comparison.setAccessibilityLabel(document.map { "Comparing \($0.oldTitle) with \($0.newTitle)" })
        added.stringValue = ""
        removed.stringValue = ""
        guard let document else { return }
        var marks: [Badge] = []
        if document.unsaved { marks.append(Badge("Unsaved", size: .xs, dot: true)) }
        if document.isNew { marks.append(Badge("New", tone: .success, size: .xs)) }
        if document.isDeleted { marks.append(Badge("Deleted", tone: .danger, size: .xs)) }
        if let original = document.originalPath {
            marks.append(Badge("Renamed from " + (original as NSString).lastPathComponent, size: .xs))
        }
        if document.modeChanged { marks.append(Badge(Self.modeChange(document.oldMode, document.newMode), size: .xs)) }
        if document.diff.quality == .wholeFile { marks.append(Badge("Compared as a whole", size: .xs)) }
        marks.forEach(badges.addArrangedSubview)
        if document.shape == .text {
            added.stringValue = "+\(document.diff.addedLines.formatted())"
            removed.stringValue = "\u{2212}\(document.diff.removedLines.formatted())"
        }
        setAccessibilityLabel("\(name), \(document.diff.addedLines) added, \(document.diff.removedLines) removed")
    }

    private func replaceState(_ view: NSView?) {
        state?.removeFromSuperview()
        state = view
        scroll.isHidden = view != nil
        guard let view else { return }
        Pin.fill(view, in: body)
    }

    func setBanner(_ new: Banner?) {
        bannerHost?.removeFromSuperview()
        bannerHost = nil
        banner = new
        guard let new else { return }
        let inset = NSView()
        inset.translatesAutoresizingMaskIntoConstraints = false
        new.translatesAutoresizingMaskIntoConstraints = false
        inset.addSubview(new)
        NSLayoutConstraint.activate([
            new.leadingAnchor.constraint(equalTo: inset.leadingAnchor, constant: Space.x2),
            new.trailingAnchor.constraint(equalTo: inset.trailingAnchor, constant: -Space.x2),
            new.topAnchor.constraint(equalTo: inset.topAnchor, constant: Space.x1),
            new.bottomAnchor.constraint(equalTo: inset.bottomAnchor, constant: -Space.x2),
        ])
        stack.insertArrangedSubview(inset, at: 0)
        bannerHost = inset
    }
}
