import AppKit
import NyteCore
import NyteUI

@MainActor
final class SettingsWindowController: NSWindowController {
    private let center: PreferencesCenter
    private let toolsFolder: () -> URL
    var currentFolder: () -> URL? = { nil }
    var onInstall: ((ToolInstall) -> Void)?
    private var findings: [ToolFinding]?
    private var keys: KeysPane?
    private(set) var pane = SettingsPane.general
    private var back: [SettingsPane] = []
    private var forward: [SettingsPane] = []
    private lazy var sidebar = SettingsSidebar(categories())
    private let header = SettingsHeader()
    private let content = FlippedView()
    private var scroll: NSScrollView?

    static let size = NSSize(width: 760, height: 600)

    init(center: PreferencesCenter, toolsFolder: @escaping () -> URL) {
        self.center = center
        self.toolsFolder = toolsFolder
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: Self.size),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                              backing: .buffered, defer: true)
        window.title = "Settings"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isRestorable = false
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        window.minSize = Self.size
        super.init(window: window)
        window.contentView = makeRoot()
        window.setContentSize(Self.size)
        window.center()
        show(.general)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    private func categories() -> [SettingsSidebar.Category] {
        SettingsPane.allCases.map { pane in
            let keywords = form(for: pane)?.entries.map(\.label) ?? Commands.all.map(\.title)
            return SettingsSidebar.Category(pane.title, symbol: pane.symbol, hue: pane.hue, keywords: keywords)
        }
    }

    private func makeRoot() -> NSView {
        let root = ChromeBackground()
        let rule = Hairline()
        let body = FlippedView()
        sidebar.onSelect = { [weak self] index in
            guard let self, SettingsPane.allCases.indices.contains(index) else { return }
            navigate(to: SettingsPane.allCases[index])
        }
        let filter = sidebar.search.onChange
        sidebar.search.onChange = { [weak self] query in
            filter?(query)
            self?.reveal(query)
        }
        header.back.onPress = { [weak self] in self?.goBack() }
        header.forward.onPress = { [weak self] in self?.goForward() }
        for view in [header, content] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            body.addSubview(view)
        }
        for view in [sidebar, rule, body] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            root.addSubview(view)
        }
        NSLayoutConstraint.activate([
            sidebar.topAnchor.constraint(equalTo: root.topAnchor, constant: Metric.titlebar),
            sidebar.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            sidebar.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            sidebar.widthAnchor.constraint(equalToConstant: SettingsSidebar.width),
            rule.topAnchor.constraint(equalTo: root.topAnchor),
            rule.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            rule.leadingAnchor.constraint(equalTo: sidebar.trailingAnchor),
            rule.widthAnchor.constraint(equalToConstant: Metric.hairline),
            body.topAnchor.constraint(equalTo: root.topAnchor),
            body.leadingAnchor.constraint(equalTo: rule.trailingAnchor),
            body.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            body.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            header.topAnchor.constraint(equalTo: body.topAnchor, constant: (Metric.titlebar - Metric.paneHeader - Space.x2) / 2),
            header.leadingAnchor.constraint(equalTo: body.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: body.trailingAnchor),
            content.topAnchor.constraint(equalTo: body.topAnchor, constant: Metric.titlebar),
            content.leadingAnchor.constraint(equalTo: body.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: body.trailingAnchor),
            content.bottomAnchor.constraint(equalTo: body.bottomAnchor),
            root.widthAnchor.constraint(greaterThanOrEqualToConstant: Self.size.width),
            root.heightAnchor.constraint(greaterThanOrEqualToConstant: Self.size.height),
        ])
        return root
    }

    func show(_ next: SettingsPane) {
        pane = next
        header.title = next.title
        window?.title = next.title
        let index = SettingsPane.allCases.firstIndex(of: next)
        if sidebar.selectedCategory != index { sidebar.selectedCategory = index }
        header.back.isEnabled = !back.isEmpty
        header.forward.isEnabled = !forward.isEmpty
        let shown: NSView = switch next {
        case .keys: makeKeys()
        default: form(for: next)?.view() ?? NSView()
        }
        if [.languages, .debugger, .tools].contains(next), findings == nil { lookForTools() }
        place(shown)
        reveal(sidebar.search.stringValue)
    }

    private func navigate(to next: SettingsPane) {
        guard next != pane else { return }
        back.append(pane)
        forward = []
        show(next)
    }

    private func goBack() {
        guard let previous = back.popLast() else { return }
        forward.append(pane)
        show(previous)
    }

    private func goForward() {
        guard let next = forward.popLast() else { return }
        back.append(pane)
        show(next)
    }

    private func form(for pane: SettingsPane) -> SettingsForm? {
        switch pane {
        case .general: GeneralPane.build(center)
        case .appearance: AppearancePane.build(center)
        case .editor: EditorPane.build(center)
        case .languages: ToolsPane.languages(center, findings: findings, folder: currentFolder())
        case .debugger: ToolsPane.debugger(center, findings: findings)
        case .terminal: TerminalPane.build(center)
        case .agent: AgentPane.build(center)
        case .tools: ToolsPane.tools(findings: findings) { [weak self] install in self?.onInstall?(install) }
        case .keys: nil
        }
    }

    private func reveal(_ query: String) {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, let scroll, let document = scroll.documentView else { return }
        let row = Self.rows(in: document).first { row in
            row.subviews.flatMap(Self.labels).contains { $0.stringValue.localizedCaseInsensitiveContains(trimmed) }
        }
        guard let row else { return }
        document.layoutSubtreeIfNeeded()
        row.scrollToVisible(row.bounds)
    }

    private static func rows(in view: NSView) -> [SettingsRow] {
        ((view as? SettingsRow).map { [$0] } ?? []) + view.subviews.flatMap(rows)
    }

    private static func labels(in view: NSView) -> [NSTextField] {
        ((view as? NSTextField).map { [$0] } ?? []) + view.subviews.flatMap(labels)
    }

    private func makeKeys() -> NSView {
        let pane = KeysPane()
        keys = pane
        return pane.build()
    }

    private func place(_ shown: NSView) {
        let scroll = NSScrollView()
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        let document = FlippedView()
        shown.translatesAutoresizingMaskIntoConstraints = false
        document.translatesAutoresizingMaskIntoConstraints = false
        document.addSubview(shown)
        scroll.documentView = document
        NSLayoutConstraint.activate([
            shown.topAnchor.constraint(equalTo: document.topAnchor),
            shown.leadingAnchor.constraint(equalTo: document.leadingAnchor),
            shown.trailingAnchor.constraint(equalTo: document.trailingAnchor),
            shown.bottomAnchor.constraint(equalTo: document.bottomAnchor),
            document.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor),
        ])
        content.subviews.forEach { $0.removeFromSuperview() }
        scroll.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(scroll)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: content.topAnchor),
            scroll.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: content.bottomAnchor),
        ])
        self.scroll = scroll
    }

    private func lookForTools() {
        let folder = toolsFolder()
        let settings = center.value.tools.debugSettings
        Task {
            findings = await ToolProbe.findAll(in: folder, debugSettings: settings)
            sidebar.categories = categories()
            if [.languages, .debugger, .tools].contains(pane) { show(pane) }
        }
    }
}
