import AppKit
import NyteCore
import NyteEditor
import NyteUI

@MainActor
final class EditorFoot: NSView {
    enum Crumb {
        case folder(URL)
        case file(URL)
        case symbol(SymbolCrumb)
    }

    var onPressCrumb: ((Crumb) -> Void)?
    var onCopyInstallCommand: ((String) -> Void)?
    var onShowServer: ((NSView) -> Void)?
    private var serverName = ""
    private var serverMark: String?
    private var serverSymbol: String?
    private var compaction = 0

    private let bar = BreadcrumbBar(label: "Path")
    private let server = StatusItem("")
    var serverItem: NSView { server }
    private let caret = StatusItem("")
    private let indent = StatusItem("")
    private let language = StatusItem("")
    private var crumbs: [Crumb] = []
    private var file: [Crumb] = []
    private var symbols: [SymbolCrumb] = []
    private var fileImage: NSImage?
    private var fileTitles: [String] = []

    static let leading = Space.x2
    static let trailing = Space.x15

    init() {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        let items = NSStackView(views: [server, caret, indent, language])
        items.orientation = .horizontal
        items.spacing = 0
        items.setHuggingPriority(.required, for: .horizontal)
        items.setContentCompressionResistancePriority(.defaultHigh, for: .horizontal)
        server.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        for view in [bar, items] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        server.isHidden = true
        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: Metric.paneFooter),
            bar.leadingAnchor.constraint(equalTo: leadingAnchor, constant: Self.leading),
            bar.topAnchor.constraint(equalTo: topAnchor),
            bar.bottomAnchor.constraint(equalTo: bottomAnchor),
            bar.trailingAnchor.constraint(equalTo: items.leadingAnchor, constant: -Space.x2),
            items.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -Self.trailing),
            items.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
        bar.onPressCrumb = { [weak self] index, _ in
            guard let self, crumbs.indices.contains(index) else { return }
            onPressCrumb?(crumbs[index])
        }
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("Editor status")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isFlipped: Bool { true }

    func show(file url: URL?, in workspace: Workspace) {
        guard let url else {
            file = []
            fileTitles = []
            return rebuild()
        }
        let parts = workspace.relativePath(of: url).split(separator: "/").map(String.init)
        var folder = workspace.root
        file = parts.dropLast().map { part in
            folder = folder.appendingPathComponent(part, isDirectory: true)
            return Crumb.folder(folder)
        } + [.file(url)]
        fileTitles = parts
        fileImage = FileIcon.forFile(named: url.lastPathComponent).image(for: effectiveAppearance)
        symbols = []
        rebuild()
    }

    func show(symbols path: [SymbolCrumb]) {
        guard path != symbols else { return }
        symbols = path
        rebuild()
    }

    private func rebuild() {
        crumbs = file + symbols.map(Crumb.symbol)
        bar.crumbs = fileTitles.enumerated().map { index, title in
            index == fileTitles.count - 1 ? BreadcrumbBar.Crumb(title, image: fileImage) : BreadcrumbBar.Crumb(title)
        } + symbols.map { symbol in
            let mark = symbol.kind.mark
            return BreadcrumbBar.Crumb(symbol.name, mark: .code(letter: mark.letter, semanticType: "\(mark.token)"))
        }
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        guard case let .file(url) = file.last else { return }
        fileImage = FileIcon.forFile(named: url.lastPathComponent).image(for: effectiveAppearance)
        rebuild()
    }

    private static func mark(for state: ServerStatus.State) -> String {
        switch state {
        case .ready: "checkmark.circle"
        case .starting, .busy: "circle.dotted"
        case .missing, .failed: "exclamationmark.triangle"
        }
    }

    override func layout() {
        super.layout()
        let fileWidth = Draw.width(of: fileTitles.last ?? "", style: TextStyle.sm) + Self.fileCrumbRoom
        let needed = { [unowned self] in Self.leading + fileWidth + Space.x2 + itemsWidth() + Self.trailing }
        var level = 0
        apply(level)
        while needed() > bounds.width, level < Self.compactionLevels {
            level += 1
            apply(level)
        }
    }

    private static let compactionLevels = 3
    private static let fileCrumbRoom = Space.x8

    private func itemsWidth() -> CGFloat {
        [server, caret, indent, language].filter { !$0.isHidden }.reduce(0) { $0 + $1.intrinsicContentSize.width }
    }

    private func apply(_ level: Int) {
        guard level != compaction || level == 0 else { return }
        compaction = level
        let hasPosition = !caret.isHidden || !indent.isHidden || !language.isHidden
        if hasPosition {
            indent.isHidden = level >= 1
            language.isHidden = level >= 2
        }
        let collapsed = level >= Self.compactionLevels
        if !server.isLoading {
            server.title = collapsed ? "" : serverName
            server.symbol = collapsed ? serverMark : serverSymbol
        }
    }

    func show(position: EditorPosition?) {
        caret.isHidden = position == nil
        indent.isHidden = position == nil
        language.isHidden = position == nil
        guard let position else { return }
        caret.title = position.selected > 0
            ? (position.selected == 1 ? "1 char" : "\(position.selected) chars")
            : "\(position.line):\(position.column)"
        caret.setAccessibilityLabel(position.selected > 0 ? "\(position.selected) characters selected"
            : "Line \(position.line), column \(position.column)")
        indent.title = position.usesTabs ? "Tabs" : (position.indentWidth == 1 ? "1 space" : "\(position.indentWidth) spaces")
        indent.setAccessibilityLabel("Indent: \(indent.title)")
        language.title = position.language
        language.setAccessibilityLabel("Language: \(position.language)")
    }

    func show(server status: ServerStatus?) {
        server.isHidden = status == nil
        server.menuProvider = nil
        server.onPress = nil
        server.toolTip = nil
        guard let status else { return }
        server.tone = .neutral
        server.symbol = nil
        server.isLoading = false
        let short = status.shortName
        server.title = short
        switch status.state {
        case .ready:
            server.toolTip = "\(status.name) is running"
        case .starting:
            server.isLoading = true
            server.toolTip = "\(status.name) is starting"
        case let .busy(title, percent):
            server.isLoading = true
            server.title = percent.map { "\(short) · \(title) \($0)%" } ?? "\(short) · \(title)"
        case let .missing(hint):
            server.symbol = "exclamationmark.triangle"
            server.tone = .warning
            server.toolTip = "\(status.name) isn't installed"
            server.menuProvider = { [weak self] in
                Menu.make([MenuItem("Copy Install Command") { self?.onCopyInstallCommand?(hint) }])
            }
        case let .failed(message):
            server.symbol = "exclamationmark.triangle"
            server.tone = .warning
            server.toolTip = message
        }
        server.toolTip = server.toolTip ?? status.name
        server.setAccessibilityLabel("Language server: \(server.toolTip ?? status.name)")
        if server.menuProvider == nil { server.onPress = { [weak self] in self.map { $0.onShowServer?($0.server) } } }
        serverName = server.title
        serverSymbol = server.symbol
        serverMark = server.symbol ?? Self.mark(for: status.state)
        compaction = 0
        needsLayout = true
    }
}
