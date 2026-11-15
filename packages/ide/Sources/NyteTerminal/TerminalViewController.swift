import AppKit
import NyteCore
import NyteDesign

@MainActor
public final class TerminalViewController: NSViewController {
    /// The running program and its directory, for the pane header.
    public private(set) var paneTitle = "zsh"
    public var onTitleChange: ((String) -> Void)?

    public init(workspace: Workspace) {
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public func loadView() { view = NSView() }

    public func focusTerminal() {}
}
