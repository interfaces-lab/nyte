import AppKit

@MainActor
public final class Spinner: NSView {
    public var ink: NSColor = Palette.contentSecondary { didSet { needsDisplay = true } }
    public let side: CGFloat

    static let cells = 5
    static let pitch: CGFloat = 3
    static let inset: CGFloat = 1
    static let units: CGFloat = 16
    static let frames = 16
    static let stillFrame = 3
    static let tilt = 0.18
    static let terminator = 0.15
    static let earthshineLight: CGFloat = 0.14

    static let disc: [(column: Int, row: Int, nx: Double, ny: Double, depth: Double)] = (0..<(cells * cells)).compactMap { index in
        let column = index % cells, row = index / cells
        let half = Double(cells) / 2
        let nx = (Double(column) + 0.5 - half) / half, ny = (Double(row) + 0.5 - half) / half
        let depth = 1 - nx * nx - ny * ny
        return depth > 0 ? (column, row, nx, ny, depth) : nil
    }

    static let lit: [UInt32] = (0..<frames).map { frame in
        let angle = Double(frame) / Double(frames) * 2 * .pi
        var bits: UInt32 = 0
        for (slot, cell) in disc.enumerated() {
            let shade = sin(angle) * cell.nx - tilt * cell.ny - cos(angle) * cell.depth.squareRoot()
            if shade > -terminator { bits |= 1 << UInt32(slot) }
        }
        return bits | brightestBlock(in: bits)
    }

    static let blocks: [UInt32] = (0..<(cells - 1) * (cells - 1)).compactMap { index in
        let column = index % (cells - 1), row = index / (cells - 1)
        let corners = [(column, row), (column + 1, row), (column, row + 1), (column + 1, row + 1)]
        let slots = corners.compactMap { cell in disc.firstIndex { $0.column == cell.0 && $0.row == cell.1 } }
        return slots.count == corners.count ? slots.reduce(0) { $0 | 1 << UInt32($1) } : nil
    }

    static func brightestBlock(in bits: UInt32) -> UInt32 {
        blocks.max { ($0 & bits).nonzeroBitCount < ($1 & bits).nonzeroBitCount } ?? 0
    }

    static let core: UInt32 = disc.enumerated().reduce(0) { bits, entry in
        entry.element.column == cells / 2 && entry.element.row == cells / 2 ? bits | 1 << UInt32(entry.offset) : bits
    }

    private var timer: Timer?
    private lazy var gate = FrameGate(self) { [weak self] in self?.updateTimer() }
    var isAnimating: Bool { timer != nil }
    var holdsPhase = false
    var phase = Spinner.stillFrame { didSet { if phase != oldValue { needsDisplay = true } } }

    public init(side: CGFloat = Glyph.md.rawValue) {
        self.side = side
        super.init(frame: NSRect(origin: .zero, size: NSSize(width: side, height: side)))
        translatesAutoresizingMaskIntoConstraints = false
        setContentHuggingPriority(.required, for: .horizontal)
        setContentHuggingPriority(.required, for: .vertical)
        setAccessibilityElement(true)
        setAccessibilityRole(.progressIndicator)
        setAccessibilityLabel("Working")
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public var isFlipped: Bool { true }
    override public var intrinsicContentSize: NSSize { NSSize(width: side, height: side) }

    override public func draw(_ dirtyRect: NSRect) {
        Self.draw(phase: phase, ink: ink, side: side, in: bounds)
    }

    public static var currentPhase: Int {
        Motion.duration(Motion.spinnerFrame) > 0 ? Int(CACurrentMediaTime() / Motion.spinnerFrame) % frames : stillFrame
    }

    public static func draw(phase: Int, ink: NSColor, side: CGFloat, in rect: NSRect) {
        let scale = side / units
        let origin = NSPoint(x: (rect.minX + (rect.width - side) / 2).rounded(), y: (rect.minY + (rect.height - side) / 2).rounded())
        let bits = lit[phase % frames] | core
        let square = (pitch - 1) * scale
        let dark = NSAppearance.currentDrawing().bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
        Draw.faded(dark ? Opacity.earthshine : earthshineLight, in: rect) { fill(bits: ~bits, ink: ink, origin: origin, scale: scale, square: square) }
        fill(bits: bits, ink: ink, origin: origin, scale: scale, square: square)
    }

    private static func fill(bits: UInt32, ink: NSColor, origin: NSPoint, scale: CGFloat, square: CGFloat) {
        ink.setFill()
        for (slot, cell) in disc.enumerated() where bits & (1 << UInt32(slot)) != 0 {
            NSRect(x: origin.x + (inset + CGFloat(cell.column) * pitch) * scale,
                   y: origin.y + (inset + CGFloat(cell.row) * pitch) * scale,
                   width: square, height: square).fill()
        }
    }

    override public func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        gate.viewDidMoveToWindow()
    }

    override public func viewDidHide() {
        super.viewDidHide()
        updateTimer()
    }

    override public func viewDidUnhide() {
        super.viewDidUnhide()
        updateTimer()
    }

    private func updateTimer() {
        guard !holdsPhase else { return }
        let running = gate.isOpen && Motion.duration(Motion.spinnerFrame) > 0
        guard running else {
            timer?.invalidate()
            timer = nil
            phase = Self.stillFrame
            return
        }
        tick()
        guard timer == nil else { return }
        let timer = Timer(timeInterval: Motion.spinnerFrame, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        timer.tolerance = Motion.instant / 2
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    private func tick() {
        phase = Self.currentPhase
    }
}
