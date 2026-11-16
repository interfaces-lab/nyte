import AppKit

@MainActor
final class FrameGate: NSObject {
    private weak var view: NSView?
    private weak var watchedWindow: NSWindow?
    private let onChange: @MainActor () -> Void

    init(_ view: NSView, onChange: @escaping @MainActor () -> Void) {
        self.view = view
        self.onChange = onChange
    }

    var isOpen: Bool { view?.canProduceFrames ?? false }

    func viewDidMoveToWindow() {
        let window = view?.window
        if window !== watchedWindow {
            let center = NotificationCenter.default
            if let watchedWindow {
                center.removeObserver(self, name: NSWindow.didChangeOcclusionStateNotification, object: watchedWindow)
            }
            watchedWindow = window
            if let window {
                center.addObserver(self, selector: #selector(occlusionDidChange),
                                   name: NSWindow.didChangeOcclusionStateNotification, object: window)
            }
        }
        onChange()
    }

    @objc private func occlusionDidChange() { onChange() }
}

extension NSView {
    var canProduceFrames: Bool {
        guard let window, !isHiddenOrHasHiddenAncestor else { return false }
        return window.occlusionState.contains(.visible)
    }
}
