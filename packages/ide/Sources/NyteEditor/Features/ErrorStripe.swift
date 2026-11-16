import AppKit
import NyteCore
import NyteUI

@MainActor
final class ErrorStripe: NSView {
    static let width = Space.x3
    private static let tickInset = Space.x05
    private static let tickHeight = Space.x05
    private static let tickWidth = Space.x2
    private static let reach = Space.x1

    var onJump: ((Int) -> Void)?
    private var ratios: [CGFloat] = []
    private var severities: [Diagnostic.Severity] = []
    private var targets: [Int] = []
    private var order: [Int] = []
    private var matchRatios: [CGFloat] = []

    override var isFlipped: Bool { true }

    func show(ratios: [CGFloat], severities: [Diagnostic.Severity], targets: [Int]) {
        guard ratios != self.ratios || severities != self.severities || targets != self.targets else { return }
        self.ratios = ratios
        self.severities = severities
        self.targets = targets
        order = severities.indices.sorted { severities[$1].isMoreSevere(than: severities[$0]) }
        isHidden = ratios.isEmpty && matchRatios.isEmpty
        needsDisplay = true
        window?.invalidateCursorRects(for: self)
    }

    func showMatches(_ ratios: [CGFloat]) {
        guard ratios != matchRatios else { return }
        matchRatios = ratios
        isHidden = self.ratios.isEmpty && matchRatios.isEmpty
        needsDisplay = true
    }

    override func draw(_ dirtyRect: NSRect) {
        Palette.contentQuaternary.setFill()
        for ratio in matchRatios {
            let tick = tickRect(ratio: ratio)
            if tick.intersects(dirtyRect) { NSRect(x: tick.minX, y: tick.minY, width: tick.width / 2, height: tick.height).fill() }
        }
        for index in order {
            let tick = tickRect(index)
            guard tick.intersects(dirtyRect) else { continue }
            ink(severities[index]).setFill()
            tick.fill()
        }
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        guard !isHidden, let local = superview.map({ convert(point, from: $0) }), bounds.contains(local) else { return nil }
        return nearest(to: local.y) == nil ? nil : self
    }

    override func mouseDown(with event: NSEvent) {
        guard let index = nearest(to: convert(event.locationInWindow, from: nil).y) else { return }
        onJump?(targets[index])
    }

    override func resetCursorRects() {
        for index in ratios.indices { addCursorRect(tickRect(index).insetBy(dx: 0, dy: -Self.reach), cursor: .pointingHand) }
    }

    private func nearest(to y: CGFloat) -> Int? {
        var best: Int?
        var distance = Self.reach + Self.tickHeight
        for index in order {
            let gap = abs(tickRect(index).midY - y)
            if gap <= distance {
                distance = gap
                best = index
            }
        }
        return best
    }

    private func tickRect(_ index: Int) -> NSRect { tickRect(ratio: ratios[index]) }

    private func tickRect(ratio: CGFloat) -> NSRect {
        let scale = window?.backingScaleFactor ?? 2
        let usable = bounds.height - Self.tickHeight
        let y = ((ratio * usable) * scale).rounded() / scale
        return NSRect(x: Self.tickInset, y: y, width: max(Self.tickWidth, bounds.width - Self.tickInset * 2), height: Self.tickHeight)
    }

    private func ink(_ severity: Diagnostic.Severity) -> NSColor {
        switch severity {
        case .error: Palette.dangerFill
        case .warning: effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? Palette.warningFill : Palette.warningInk
        case .information, .hint: Palette.contentQuaternary
        }
    }
}
