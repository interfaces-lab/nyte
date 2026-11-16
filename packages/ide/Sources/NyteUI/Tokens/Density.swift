import AppKit

public enum Density: String, Sendable, CaseIterable {
    case compact, standard

    nonisolated(unsafe) private static var stored = Density.compact
    @MainActor private static var observers: [(owner: WeakOwner, run: @MainActor () -> Void)] = []

    public static var current: Density {
        get { stored }
        set { MainActor.assumeIsolated { apply(newValue) } }
    }

    @MainActor public static func apply(_ density: Density) {
        guard density != stored else { return }
        stored = density
        if let app = NSApp { app.windows.forEach { $0.contentView.map(refresh) } }
        observers.removeAll { $0.owner.object == nil }
        observers.forEach { $0.run() }
    }

    @MainActor public static func observe(_ owner: AnyObject, _ handler: @escaping @MainActor () -> Void) {
        observers.removeAll { $0.owner.object == nil }
        observers.append((WeakOwner(object: owner), handler))
    }

    static func pick(compact: CGFloat, standard: CGFloat) -> CGFloat { current == .compact ? compact : standard }

    @MainActor private static func refresh(_ view: NSView) {
        view.invalidateIntrinsicContentSize()
        view.needsLayout = true
        view.needsDisplay = true
        view.subviews.forEach(refresh)
    }
}

final class WeakOwner {
    weak var object: AnyObject?

    init(object: AnyObject) { self.object = object }
}

extension NSView {
    func observeDensity(_ selector: Selector) {
        Density.observe(self) { [weak self] in _ = self?.perform(selector) }
    }
}
