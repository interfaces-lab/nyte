import AppKit
import NyteCore
import NyteDesign

@MainActor
public final class AgentViewController: NSViewController {
    public init(workspace: Workspace) {
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public func loadView() { view = NSView() }

    public func focusComposer() {}
}
