import AppKit
import NyteCore
import NyteEditor
import NyteUI

@MainActor
final class EditorPaneController: NSViewController {
    let editor: EditorViewController
    let tabs = TabBar(style: .file, label: "Open files")
    let problems = ProblemSummary()
    let foot = EditorFoot()
    var onDismissBanner: ((String) -> Void)?
    var onShownDocumentChange: (() -> Void)?
    var documents: [PaneDocument] = []
    var shownDocument: String?
    var lastFile: URL?
    private var announcedDocument: String?
    let documentSlot = NSView()

    private let workspace: Workspace
    private let header = NSView()
    private let headerRule = Hairline()
    private let footRule = Hairline()
    private let bannerSlot = NSStackView()
    private var banner: (key: String, view: Banner)?
    private var bannerCollapse: NSLayoutConstraint?
    private let empty = EmptyState(title: "No open files", hints: [
        ("Open Quickly", "⌘P"), ("Command Palette", "⇧⌘P"), ("Ask Nyte", "⌘L"),
    ])

    init(workspace: Workspace, editor: EditorViewController) {
        self.workspace = workspace
        self.editor = editor
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func loadView() {
        let root = AppearanceView()
        root.onAppearanceChange = { [weak self] in self?.refreshTabs() }
        addChild(editor)
        let text = editor.view
        bannerSlot.orientation = .vertical
        bannerSlot.alignment = .width
        bannerSlot.edgeInsets = NSEdgeInsets(top: Space.x2, left: Space.x2, bottom: 0, right: Space.x2)
        bannerSlot.isHidden = true
        documentSlot.isHidden = true
        for view in [bannerSlot, text, header, headerRule, footRule, foot, empty, documentSlot] {
            view.translatesAutoresizingMaskIntoConstraints = false
            root.addSubview(view)
        }
        for view in [tabs, problems] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            header.addSubview(view)
        }
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: root.topAnchor),
            header.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            header.heightAnchor.constraint(equalToConstant: Metric.paneHeader),
            tabs.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: PaneHeader.actionInset),
            tabs.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            tabs.trailingAnchor.constraint(equalTo: problems.leadingAnchor, constant: -PaneHeader.middleGap),
            problems.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -ProblemSummary.trailing),
            problems.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            headerRule.topAnchor.constraint(equalTo: header.bottomAnchor),
            headerRule.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            headerRule.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            bannerSlot.topAnchor.constraint(equalTo: header.bottomAnchor),
            bannerSlot.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            bannerSlot.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            text.topAnchor.constraint(equalTo: bannerSlot.bottomAnchor),
            text.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            text.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            text.bottomAnchor.constraint(equalTo: footRule.topAnchor),
            footRule.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            footRule.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            footRule.bottomAnchor.constraint(equalTo: foot.topAnchor),
            foot.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            foot.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            foot.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            empty.topAnchor.constraint(equalTo: header.bottomAnchor),
            empty.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            empty.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            empty.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            documentSlot.topAnchor.constraint(equalTo: headerRule.bottomAnchor),
            documentSlot.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            documentSlot.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            documentSlot.bottomAnchor.constraint(equalTo: root.bottomAnchor),
        ])
        bannerCollapse = bannerSlot.heightAnchor.constraint(equalToConstant: 0)
        bannerCollapse?.isActive = true
        view = root
        tabs.onMove = { [weak self] from, to in
            guard let self else { return }
            guard from < editor.tabs.count, to < editor.tabs.count else { return refreshTabs() }
            editor.moveTab(from: from, to: to)
        }
        tabs.onSelect = { [weak self] index in self?.selectTab(index) }
        tabs.onClose = { [weak self] index in self?.closeTab(index) }
        refreshTabs()
    }

    func refreshTabs() {
        let appearance = view.effectiveAppearance
        if editor.selectedURL != lastFile {
            lastFile = editor.selectedURL
            if editor.selectedURL != nil { shownDocument = nil }
        }
        tabs.items = editor.tabs.map { tab in
            TabBar.Item(tab.title, icon: FileIcon.forFile(named: tab.title).image(for: appearance),
                        toolTip: workspace.relativePath(of: tab.url), isDirty: tab.isDirty, isPreview: tab.isPreview)
        } + documents.map { TabBar.Item($0.title, icon: Symbol.image($0.symbol, glyph: .md), toolTip: $0.toolTip) }
        let documentIndex = shownDocument.flatMap { id in documents.firstIndex { $0.id == id } }
        if shownDocument != announcedDocument {
            announcedDocument = shownDocument
            onShownDocumentChange?()
        }
        tabs.selectedIndex = documentIndex.map { editor.tabs.count + $0 } ?? editor.selectedIndex
        for document in documents { document.controller.view.isHidden = document.id != shownDocument }
        documentSlot.isHidden = documentIndex == nil
        let hasFile = editor.selectedURL != nil && documentIndex == nil
        empty.isHidden = hasFile || documentIndex != nil
        for view in [editor.view, footRule, foot] { view.isHidden = !hasFile }
        setBannerShown(hasFile && banner != nil)
        if !hasFile { problems.counts = nil }
    }

    func showBanner(key: String, title: String, detail: String = "", actions: [Banner.Action] = []) {
        guard banner?.key != key else { return }
        clearBanner()
        let view = Banner(title, detail: detail, tone: .warning, actions: actions)
        view.onDismiss = { [weak self] in
            self?.clearBanner()
            self?.onDismissBanner?(key)
        }
        bannerSlot.addArrangedSubview(view)
        banner = (key, view)
        setBannerShown(editor.selectedURL != nil)
    }

    var bannerKey: String? { banner?.key }

    func clearBanner(key: String) {
        if banner?.key == key { clearBanner() }
    }

    func clearBanner() {
        banner?.view.removeFromSuperview()
        banner = nil
        setBannerShown(false)
    }

    private func setBannerShown(_ shown: Bool) {
        bannerSlot.isHidden = !shown
        bannerCollapse?.isActive = !shown
    }
}

@MainActor
final class AppearanceView: NSView {
    var onAppearanceChange: (() -> Void)?
    override var isFlipped: Bool { true }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        onAppearanceChange?()
    }
}

@MainActor
final class ProblemSummary: NSStackView {
    static let trailing = PaneHeader.actionInset
    var onPress: (() -> Void)? { didSet { [errors, warnings, clean].forEach { $0.onPress = onPress } } }
    var counts: ProblemCounts? { didSet { if counts != oldValue { refresh() } } }

    private let errors = StatusItem("", symbol: "xmark.octagon.fill")
    private let warnings = StatusItem("", symbol: "exclamationmark.triangle.fill")
    private let clean = StatusItem("", symbol: "checkmark")

    init() {
        super.init(frame: .zero)
        orientation = .horizontal
        spacing = 0
        errors.tone = .danger
        warnings.tone = .warning
        [errors, warnings, clean].forEach(addArrangedSubview)
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("Problems in this file")
        setHuggingPriority(.required, for: .horizontal)
        refresh()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    private func refresh() {
        guard let counts else { return isHidden = true }
        isHidden = false
        errors.title = "\(counts.errors)"
        errors.setAccessibilityLabel(counts.errors == 1 ? "1 error" : "\(counts.errors) errors")
        warnings.title = "\(counts.warnings)"
        warnings.setAccessibilityLabel(counts.warnings == 1 ? "1 warning" : "\(counts.warnings) warnings")
        errors.isHidden = counts.errors == 0
        warnings.isHidden = counts.warnings == 0
        clean.isHidden = counts.errors + counts.warnings > 0
        clean.setAccessibilityLabel("No problems")
        clean.toolTip = "No problems"
    }
}
