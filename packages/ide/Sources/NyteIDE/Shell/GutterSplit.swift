import AppKit
import NyteDesign

/// A split whose dividers are the 8pt gutter between panes: nothing is drawn, and the gutter
/// itself is the resize handle.
@MainActor
final class GutterSplitView: NSSplitView {
    override var dividerThickness: CGFloat { Metric.gutter }
    override func drawDivider(in rect: NSRect) {}
}

@MainActor
class GutterSplitViewController: NSSplitViewController {
    init(vertical: Bool, autosave: String) {
        super.init(nibName: nil, bundle: nil)
        let split = GutterSplitView()
        split.isVertical = vertical
        split.dividerStyle = .thin
        split.autosaveName = autosave
        splitView = split
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    /// The gutter stays when a pane collapses, so the remaining pane keeps its inset.
    override func splitView(_ splitView: NSSplitView, shouldHideDividerAt dividerIndex: Int) -> Bool { false }

    func toggle(_ item: NSSplitViewItem) {
        guard !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else {
            return item.isCollapsed.toggle()
        }
        NSAnimationContext.runAnimationGroup { context in
            context.duration = Motion.slow
            context.timingFunction = Motion.easeOutQuint
            context.allowsImplicitAnimation = true
            item.animator().isCollapsed.toggle()
        }
    }
}

/// Wraps a pane's content in a card that fills its split item.
@MainActor
final class PaneViewController: NSViewController {
    let card = PaneCard()
    private let content: NSView

    init(content: NSView) {
        self.content = content
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func loadView() {
        card.embed(content)
        view = card
    }
}
