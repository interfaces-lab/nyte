import AppKit
import NyteCore
import NyteDesign
import NyteEditor
import NyteTerminal

/// The working column: the editor pane above, the terminal pane below, one gutter between them.
@MainActor
final class CenterViewController: GutterSplitViewController {
    let editor: EditorViewController
    let terminal: TerminalViewController
    let editorPane: EditorPaneView
    private(set) var terminalItem: NSSplitViewItem!

    init(workspace: Workspace) {
        editor = EditorViewController(workspace: workspace)
        terminal = TerminalViewController(workspace: workspace)
        editorPane = EditorPaneView(workspace: workspace, editor: editor.view)
        super.init(vertical: false, autosave: "center")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let editorController = PaneViewController(content: editorPane)
        editorController.addChild(editor)
        let editorItem = NSSplitViewItem(viewController: editorController)
        editorItem.minimumThickness = 160
        editorItem.holdingPriority = .defaultLow

        let terminalPane = TerminalPaneView(terminal: terminal.view, title: terminal.paneTitle)
        terminal.onTitleChange = { [weak terminalPane] in terminalPane?.title = $0 }
        terminalPane.onHide = { [weak self] in self?.toggleTerminal() }
        let terminalController = PaneViewController(content: terminalPane)
        terminalController.addChild(terminal)
        terminalItem = NSSplitViewItem(viewController: terminalController)
        terminalItem.minimumThickness = Metric.terminalMin
        terminalItem.canCollapse = true
        terminalItem.holdingPriority = .init(260)

        addSplitViewItem(editorItem)
        addSplitViewItem(terminalItem)
        terminalController.view.heightAnchor.constraint(equalToConstant: Metric.terminalHeight)
            .withPriority(.init(240)).isActive = true
    }

    func toggleTerminal() {
        toggle(terminalItem)
        if !terminalItem.isCollapsed { terminal.focusTerminal() }
    }
}

extension NSLayoutConstraint {
    func withPriority(_ priority: NSLayoutConstraint.Priority) -> NSLayoutConstraint {
        self.priority = priority
        return self
    }
}

/// The editor pane: the text fills it, and one quiet line at the foot carries the path on the
/// left and the caret on the right. With no file open it shows where to begin.
@MainActor
final class EditorPaneView: NSView {
    private let workspace: Workspace
    private let path = Label(style: .sm, color: Palette.contentTertiary)
    private let position = Label(style: .sm, color: Palette.contentTertiary)
    private let footer = NSView()
    private let rule = Hairline()
    private let empty: EmptyEditorView
    private let editor: NSView

    init(workspace: Workspace, editor: NSView) {
        self.workspace = workspace
        self.editor = editor
        empty = EmptyEditorView(workspace: workspace)
        super.init(frame: .zero)
        position.alignment = .right
        position.font = NSFont.monospacedDigitSystemFont(ofSize: TextStyle.sm.size, weight: .regular)
        position.setContentCompressionResistancePriority(.required, for: .horizontal)
        path.lineBreakMode = .byTruncatingHead
        for view in [editor, footer, rule, empty] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        [path, position].forEach(footer.addSubview)
        NSLayoutConstraint.activate([
            editor.topAnchor.constraint(equalTo: topAnchor),
            editor.leadingAnchor.constraint(equalTo: leadingAnchor),
            editor.trailingAnchor.constraint(equalTo: trailingAnchor),
            editor.bottomAnchor.constraint(equalTo: footer.topAnchor),
            footer.leadingAnchor.constraint(equalTo: leadingAnchor),
            footer.trailingAnchor.constraint(equalTo: trailingAnchor),
            footer.bottomAnchor.constraint(equalTo: bottomAnchor),
            footer.heightAnchor.constraint(equalToConstant: Metric.paneFooter),
            rule.leadingAnchor.constraint(equalTo: leadingAnchor),
            rule.trailingAnchor.constraint(equalTo: trailingAnchor),
            rule.bottomAnchor.constraint(equalTo: footer.topAnchor),
            path.leadingAnchor.constraint(equalTo: footer.leadingAnchor, constant: Space.x3),
            path.centerYAnchor.constraint(equalTo: footer.centerYAnchor),
            path.trailingAnchor.constraint(lessThanOrEqualTo: position.leadingAnchor, constant: -Space.x3),
            position.trailingAnchor.constraint(equalTo: footer.trailingAnchor, constant: -Space.x3),
            position.centerYAnchor.constraint(equalTo: footer.centerYAnchor),
            empty.topAnchor.constraint(equalTo: topAnchor),
            empty.leadingAnchor.constraint(equalTo: leadingAnchor),
            empty.trailingAnchor.constraint(equalTo: trailingAnchor),
            empty.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        show(file: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func show(file url: URL?) {
        empty.isHidden = url != nil
        for view in [editor, footer, rule] { view.isHidden = url == nil }
        guard let url else { return }
        let parts = workspace.relativePath(of: url).split(separator: "/").map(String.init)
        let text = NSMutableAttributedString()
        for (index, part) in parts.enumerated() {
            let last = index == parts.count - 1
            text.append(NSAttributedString(string: part, attributes: [
                .foregroundColor: last ? Palette.contentSecondary : Palette.contentTertiary,
                .font: TextStyle.sm.font(),
            ]))
            if !last {
                text.append(NSAttributedString(string: "  ›  ", attributes: [
                    .foregroundColor: Palette.contentQuaternary, .font: TextStyle.sm.font(),
                ]))
            }
        }
        path.attributedStringValue = text
    }

    func show(position value: EditorPosition?) {
        guard let value else { return position.stringValue = "" }
        let caret = value.selected > 0 ? "\(value.selected) selected" : "Ln \(value.line), Col \(value.column)"
        position.stringValue = value.language.isEmpty ? caret : "\(caret)    \(value.language)"
    }
}

/// What the editor pane says before a file is open: the workspace, and the three ways in.
@MainActor
final class EmptyEditorView: NSView {
    init(workspace: Workspace) {
        super.init(frame: .zero)
        let title = Label(workspace.name, style: .xl, color: Palette.contentPrimary, weight: .semibold)
        let stack = NSStackView(views: [
            title,
            Self.hint("Open a file from the sidebar", keys: []),
            Self.hint("Ask Nyte", keys: ["⌘", "L"]),
            Self.hint("Show the terminal", keys: ["⌃", "`"]),
        ])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = Space.x2
        stack.setCustomSpacing(Space.x4, after: title)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor, constant: -Space.x6),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    private static func hint(_ text: String, keys: [String]) -> NSView {
        let label = Label(text, style: .base, color: Palette.contentSecondary)
        let caps = keys.map { key -> NSView in
            let cap = SurfaceView(fill: Palette.bgMutedTranslucent, ring: Palette.strokeQuaternary, radius: Radius.indicator)
            let glyph = Label(key, style: .sm, color: Palette.contentTertiary)
            glyph.alignment = .center
            cap.addSubview(glyph)
            cap.setContentHuggingPriority(.required, for: .horizontal)
            NSLayoutConstraint.activate([
                cap.widthAnchor.constraint(equalToConstant: 20).withPriority(.defaultHigh),
                cap.widthAnchor.constraint(greaterThanOrEqualToConstant: 20),
                cap.heightAnchor.constraint(equalToConstant: 20),
                glyph.centerXAnchor.constraint(equalTo: cap.centerXAnchor),
                glyph.centerYAnchor.constraint(equalTo: cap.centerYAnchor),
                glyph.leadingAnchor.constraint(greaterThanOrEqualTo: cap.leadingAnchor, constant: Space.x1),
            ])
            return cap
        }
        let row = NSStackView(views: [label] + caps)
        row.distribution = .fill
        label.setContentHuggingPriority(.defaultLow, for: .horizontal)
        row.spacing = Space.x1
        row.setCustomSpacing(Space.x3, after: label)
        return row
    }
}

/// The terminal pane: a header that names the running program, then the terminal itself.
@MainActor
final class TerminalPaneView: NSView {
    var title: String { didSet { label.stringValue = title } }
    var onHide: (() -> Void)?
    private let label = Label(style: .base, color: Palette.contentSecondary)

    init(terminal: NSView, title: String) {
        self.title = title
        super.init(frame: .zero)
        label.stringValue = title
        let glyph = NSImageView()
        glyph.image = Symbol.image("apple.terminal", size: 12)
        glyph.contentTintColor = Palette.contentTertiary
        let hide = IconButton(symbol: "chevron.down", label: "Hide Terminal", size: 11, target: self, action: #selector(hide))
        for view in [glyph, label, hide, terminal] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        NSLayoutConstraint.activate([
            glyph.leadingAnchor.constraint(equalTo: leadingAnchor, constant: Space.x3),
            glyph.centerYAnchor.constraint(equalTo: topAnchor, constant: Metric.paneHeader / 2),
            label.leadingAnchor.constraint(equalTo: glyph.trailingAnchor, constant: Space.x15),
            label.centerYAnchor.constraint(equalTo: glyph.centerYAnchor),
            label.trailingAnchor.constraint(lessThanOrEqualTo: hide.leadingAnchor, constant: -Space.x2),
            hide.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -Space.x1),
            hide.centerYAnchor.constraint(equalTo: glyph.centerYAnchor),
            terminal.topAnchor.constraint(equalTo: topAnchor, constant: Metric.paneHeader),
            terminal.leadingAnchor.constraint(equalTo: leadingAnchor),
            terminal.trailingAnchor.constraint(equalTo: trailingAnchor),
            terminal.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    @objc private func hide() { onHide?() }
}
