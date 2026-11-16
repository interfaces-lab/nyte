import AppKit

@MainActor
public final class Tween: NSObject {
    public private(set) var value: CGFloat
    public private(set) var target: CGFloat
    public var isRunning: Bool { link != nil }

    private weak var view: NSView?
    private var origin: CGFloat
    private var start: CFTimeInterval = 0
    private var duration: TimeInterval = 0
    private var curve = Curve(Motion.easeOut)
    private var link: CADisplayLink?

    public init(_ value: CGFloat, in view: NSView) {
        self.value = value
        self.target = value
        self.origin = value
        self.view = view
    }

    public func move(to target: CGFloat, duration: TimeInterval, curve: CAMediaTimingFunction) {
        self.target = target
        guard duration > 0, let view, view.canProduceFrames, value != target else { return jump(to: target) }
        origin = value
        start = CACurrentMediaTime()
        self.duration = duration
        self.curve = Curve(curve)
        if link == nil {
            let link = view.displayLink(target: self, selector: #selector(step))
            link.add(to: .main, forMode: .common)
            self.link = link
        }
    }

    func finish() { jump(to: target) }

    public func jump(to target: CGFloat) {
        link?.invalidate()
        link = nil
        self.target = target
        value = target
        view?.needsDisplay = true
    }

    @objc private func step(_ link: CADisplayLink) {
        let progress = min(1, (CACurrentMediaTime() - start) / duration)
        value = origin + (target - origin) * curve.solve(progress)
        view?.needsDisplay = true
        if progress >= 1 { jump(to: target) }
    }

    struct Curve {
        let x1: Double, y1: Double, x2: Double, y2: Double

        init(_ function: CAMediaTimingFunction) {
            var first: [Float] = [0, 0], second: [Float] = [0, 0]
            function.getControlPoint(at: 1, values: &first)
            function.getControlPoint(at: 2, values: &second)
            (x1, y1, x2, y2) = (Double(first[0]), Double(first[1]), Double(second[0]), Double(second[1]))
        }

        static let steps = 24
        static let tolerance = 1e-5
        static let weight: Double = 3

        func solve(_ x: Double) -> Double {
            guard x > 0 else { return 0 }
            guard x < 1 else { return 1 }
            var low: Double = 0, high: Double = 1, t = x
            for _ in 0..<Self.steps {
                let guess = bezier(t, x1, x2)
                if abs(guess - x) < Self.tolerance { break }
                if guess < x { low = t } else { high = t }
                t = (low + high) / 2
            }
            return bezier(t, y1, y2)
        }

        private func bezier(_ t: Double, _ a: Double, _ b: Double) -> Double {
            let u = 1 - t
            return Self.weight * u * u * t * a + Self.weight * u * t * t * b + t * t * t
        }
    }
}

final class PressableElement: NSAccessibilityElement {
    var onPress: (@MainActor @Sendable () -> Void)?

    @MainActor static func make(role: NSAccessibility.Role, label: String, frame: NSRect, parent: NSView,
                                onPress: @escaping @MainActor @Sendable () -> Void) -> PressableElement {
        let element = PressableElement()
        element.setAccessibilityRole(role)
        element.setAccessibilityLabel(label)
        element.setAccessibilityParent(parent)
        element.setAccessibilityFrameInParentSpace(frame)
        element.onPress = onPress
        return element
    }

    override func accessibilityPerformPress() -> Bool {
        guard let action = onPress else { return false }
        MainActor.assumeIsolated { action() }
        return true
    }
}
