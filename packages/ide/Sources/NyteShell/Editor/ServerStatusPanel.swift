import AppKit
import NyteCore
import NyteLanguage
import NyteUI

@MainActor
final class ServerStatusPanel {
    let view = ServerStatusView()
    private let panel = FloatingPanel(radius: Radius.card, presentation: .popover)

    func show(_ statuses: [ServerStatus], environment: EnvironmentReading?, from anchor: NSView) {
        view.show(statuses, environment: environment)
        panel.content = view
        view.layoutSubtreeIfNeeded()
        panel.show(size: view.fittingSize, anchoredTo: anchor.bounds, in: anchor, prefersAbove: true)
    }

    func update(_ statuses: [ServerStatus], environment: EnvironmentReading?) {
        guard panel.isShown else { return }
        view.show(statuses, environment: environment)
        view.layoutSubtreeIfNeeded()
        panel.resize(to: view.fittingSize)
    }

    func dismiss() { panel.dismiss() }
}
