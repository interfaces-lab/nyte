import AppKit
import IOSurface
import NyteUI
import os

@MainActor @objc public protocol TerminalCommands {
    func clearTerminal(_ sender: Any?)
    func askNyte(_ sender: Any?)
}

@MainActor
final class TerminalView: NSView, TerminalCommands {
    private(set) var session: TerminalSession?
    private(set) var generation = 0
    var onGrid: ((TerminalGrid) -> Void)?
    var onRestart: (() -> Void)?
    var isResizeSuspended = false {
        didSet { if !isResizeSuspended { updateGrid() } }
    }
    var preferences = TerminalPreferences.standard {
        didSet { preferencesChanged(from: oldValue) }
    }
    var pasteboard = NSPasteboard.general
    var linkDirectory: URL?
    var onOpenLink: ((ResolvedLink) -> Void)?
    var onAskAgent: (() -> Void)?
    private(set) var selectionTextCache: String?
    var lastCommandOutput: String?
    var hoverLink: HoverLink?
    var hoverRequest = 0

    static let padding = CGSize(width: Space.x2, height: Space.x15)
    static let signposter = OSSignposter(subsystem: "ai.nyte.ide", category: "terminal")
    private static let minimumGrid = (columns: 12, rows: 3)
    private static let defaultBlinkPeriod: Double = 560
    private static let millisecondsPerSecond: Double = 1000
    private static let channelMaximum: CGFloat = 255

    private(set) var metrics = TerminalMetrics(scale: 2)
    private(set) var lastGrid: TerminalGrid?
    private(set) var layouts: [RowLayout?] = []
    private(set) var columns = 0
    private(set) var cursor = FrameCursor(column: 0, row: 0, visible: false, blinking: false, shape: .block)
    private(set) var mouseTracking = false
    private(set) var background: UInt32 = 0
    private(set) var cursorColor: UInt32 = 0
    private var foreground: UInt32 = 0
    private var hasFrameColors = false
    private var colorCache: [UInt32: CGColor] = [:]
    private var displayLink: CADisplayLink?
    private var isFrameWanted = false
    private(set) var isFocused = false
    private var blinkTimer: Timer?
    private(set) var isBlinkOn = true
    private(set) var exitMessage: String?
    var announcement = 0
    var screenTextCache: String?

    var surfaces: [IOSurface] = []
    var presented: Int?
    var damage: [NSRect] = []

    var markedText: NSAttributedString?
    var markedSelection = NSRange(location: 0, length: 0)
    var typedDuringKey: [String]?
    var surrogates = TerminalTyping.SurrogatePairing()
    var scrollRemainder: CGFloat = 0

    init() {
        super.init(frame: .zero)
        wantsLayer = true
        layerContentsRedrawPolicy = .onSetNeedsDisplay
        setAccessibilityElement(true)
        setAccessibilityRole(.textArea)
        setAccessibilityLabel("Terminal")
        adoptPaletteColors()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isFlipped: Bool { true }
    override var isOpaque: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    func attach(_ session: TerminalSession, generation: Int) {
        self.session = session
        self.generation = generation
        exitMessage = nil
        layouts = Array(repeating: nil, count: layouts.count)
        cursor.visible = false
        screenTextCache = nil
        invalidateAll()
        focusMayHaveChanged(force: true)
    }

    func detach() {
        session = nil
        selectionTextCache = nil
        lastCommandOutput = nil
        stopBlink()
    }

    func selectionChanged(_ change: TerminalSelectionChange) {
        selectionTextCache = change.text.flatMap { $0.isEmpty ? nil : $0 }
        guard change.byPointer, preferences.copiesOnSelect, let text = selectionTextCache else { return }
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
    }

    private func preferencesChanged(from old: TerminalPreferences) {
        guard preferences.font != old.font else { return }
        metrics = TerminalMetrics(scale: metrics.scale, font: preferences.font)
        layouts = layouts.map { $0.map { RowLayout($0.source, metrics: metrics) } }
        invalidateAll()
        updateGrid()
    }

    var isExited: Bool { exitMessage != nil }

    func showExit(_ message: String) {
        exitMessage = message
        updateBlink()
        invalidateAll()
    }

    override func viewWillMove(toWindow newWindow: NSWindow?) {
        super.viewWillMove(toWindow: newWindow)
        guard let window else { return }
        let center = NotificationCenter.default
        for name in [NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification,
                     NSWindow.didChangeOcclusionStateNotification] {
            center.removeObserver(self, name: name, object: window)
        }
        NSWorkspace.shared.notificationCenter.removeObserver(
            self, name: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil
        )
        displayLink?.invalidate()
        displayLink = nil
        stopBlink()
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        guard let window else { return }
        let center = NotificationCenter.default
        for name in [NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification] {
            center.addObserver(self, selector: #selector(windowKeyChanged), name: name, object: window)
        }
        center.addObserver(self, selector: #selector(occlusionChanged), name: NSWindow.didChangeOcclusionStateNotification,
                           object: window)
        NSWorkspace.shared.notificationCenter.addObserver(
            self, selector: #selector(displayOptionsChanged),
            name: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil
        )
        let link = displayLink(target: self, selector: #selector(tick))
        link.isPaused = !(isFrameWanted && isOnScreen)
        link.add(to: .main, forMode: .common)
        displayLink = link
        refreshMetrics()
        updateGrid()
        updateBlink()
    }

    override func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        refreshMetrics()
        updateGrid()
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        let colors = resolvedColors()
        session?.enqueue { $0.setColors(colors) }
        if !hasFrameColors { adoptPaletteColors() }
        invalidateAll()
    }

    private func adoptPaletteColors() {
        let colors = resolvedColors()
        (background, foreground, cursorColor) = (colors.background, colors.foreground, colors.cursor)
    }

    override func layout() {
        super.layout()
        updateGrid()
    }

    override func viewDidUnhide() {
        super.viewDidUnhide()
        updateGrid()
        resumeFramesIfWanted()
        updateBlink()
    }

    override func viewDidHide() {
        super.viewDidHide()
        displayLink?.isPaused = true
        updateBlink()
    }

    var isOnScreen: Bool {
        guard let window, !isHiddenOrHasHiddenAncestor else { return false }
        return window.occlusionState.contains(.visible)
    }

    @objc private func occlusionChanged() {
        if isOnScreen { resumeFramesIfWanted() } else { displayLink?.isPaused = true }
        updateBlink()
    }

    private func resumeFramesIfWanted() {
        guard isFrameWanted, isOnScreen else { return }
        displayLink?.isPaused = false
    }

    private func refreshMetrics() {
        let scale = window?.backingScaleFactor ?? metrics.scale
        guard scale != metrics.scale else { return }
        metrics = TerminalMetrics(scale: scale, font: preferences.font)
        layouts = layouts.map { $0.map { RowLayout($0.source, metrics: metrics) } }
        invalidateAll()
    }

    private func updateGrid() {
        guard window != nil, !isHiddenOrHasHiddenAncestor, !isResizeSuspended else { return }
        let columns = Int((bounds.width - 2 * Self.padding.width) / metrics.cellWidth)
        let rows = Int((bounds.height - 2 * Self.padding.height) / metrics.cellHeight)
        guard columns >= Self.minimumGrid.columns, rows >= Self.minimumGrid.rows else { return }
        let pixels = metrics.grid
        let grid = TerminalGrid(columns: UInt16(clamping: columns), rows: UInt16(clamping: rows),
                                cellWidth: pixels.width, cellHeight: pixels.height)
        guard grid != lastGrid else { return }
        lastGrid = grid
        onGrid?(grid)
    }

    func resolvedColors() -> TerminalColors {
        var colors = TerminalColors(ansi: [], foreground: 0, background: 0, cursor: 0, isDark: false)
        effectiveAppearance.performAsCurrentDrawingAppearance {
            colors.ansi = TerminalPalette.ansi.map(Self.pack)
            colors.foreground = Self.pack(TerminalPalette.foreground)
            colors.background = Self.pack(TerminalPalette.background)
            colors.cursor = Self.pack(TerminalPalette.cursor)
        }
        colors.isDark = effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
        return colors
    }

    private static func pack(_ color: NSColor) -> UInt32 {
        let srgb = color.usingColorSpace(.sRGB) ?? color
        let channel = { (value: CGFloat) in UInt32((min(max(value, 0), 1) * Self.channelMaximum).rounded()) }
        return channel(srgb.redComponent) << 16 | channel(srgb.greenComponent) << 8 | channel(srgb.blueComponent)
    }

    func needsFrame() {
        isFrameWanted = true
        resumeFramesIfWanted()
    }

    @objc private func tick(_ link: CADisplayLink) {
        link.isPaused = true
        guard isFrameWanted, isOnScreen else { return }
        isFrameWanted = false
        let full = layouts.allSatisfy { $0 == nil }
        session?.enqueue { $0.produceFrame(full: full) }
    }

    func apply(_ frame: TerminalFrame) {
        let interval = Self.signposter.beginInterval("apply", "\(frame.changed.count) rows")
        defer { Self.signposter.endInterval("apply", interval) }
        if frame.columns != columns || frame.rows != layouts.count {
            columns = frame.columns
            layouts = Array(repeating: nil, count: frame.rows)
            invalidateAll()
        }
        if frame.background != background || frame.foreground != foreground || frame.cursorColor != cursorColor {
            (background, foreground, cursorColor) = (frame.background, frame.foreground, frame.cursorColor)
            invalidateAll()
        }
        hasFrameColors = true
        for row in frame.changed where row.index < layouts.count {
            layouts[row.index] = RowLayout(row, metrics: metrics)
            invalidate(rowRect(row.index))
        }
        if frame.cursor != cursor {
            invalidate(rowRect(cursor.row))
            invalidate(rowRect(frame.cursor.row))
            cursor = frame.cursor
            updateBlink()
        }
        if frame.full { invalidateAll() }
        if frame.mouseTracking != mouseTracking {
            mouseTracking = frame.mouseTracking
            window?.invalidateCursorRects(for: self)
        }
        if !frame.changed.isEmpty {
            screenTextCache = nil
            announceCursorLine()
        }
    }

    func rowRect(_ row: Int) -> NSRect {
        NSRect(x: 0, y: Self.padding.height + CGFloat(row) * metrics.cellHeight, width: bounds.width, height: metrics.cellHeight)
    }

    func cellRect(column: Int, row: Int, width: Int = 1) -> NSRect {
        NSRect(x: Self.padding.width + CGFloat(column) * metrics.cellWidth,
               y: Self.padding.height + CGFloat(row) * metrics.cellHeight,
               width: CGFloat(width) * metrics.cellWidth, height: metrics.cellHeight)
    }

    func invalidate(_ rect: NSRect) {
        damage.append(rect)
        needsDisplay = true
    }

    func invalidateAll() {
        damage = [bounds]
        needsDisplay = true
    }

    func color(_ packed: UInt32) -> CGColor {
        if let cached = colorCache[packed] { return cached }
        let color = CGColor(srgbRed: CGFloat(packed >> 16 & 0xFF) / Self.channelMaximum,
                            green: CGFloat(packed >> 8 & 0xFF) / Self.channelMaximum,
                            blue: CGFloat(packed & 0xFF) / Self.channelMaximum, alpha: 1)
        colorCache[packed] = color
        return color
    }

    override func becomeFirstResponder() -> Bool {
        defer { focusMayHaveChanged() }
        return true
    }

    override func resignFirstResponder() -> Bool {
        defer { focusMayHaveChanged() }
        return true
    }

    @objc private func windowKeyChanged() { focusMayHaveChanged() }

    @objc private func displayOptionsChanged() { updateBlink() }

    private func focusMayHaveChanged(force: Bool = false) {
        let now = window?.isKeyWindow == true && window?.firstResponder === self
        guard now != isFocused || force else { return }
        isFocused = now
        session?.enqueue { $0.focus(now) }
        restartBlink()
    }

    func restartBlink() {
        isBlinkOn = true
        invalidate(rowRect(cursor.row))
        updateBlink()
    }

    private func updateBlink() {
        let wanted = cursor.blinking && cursor.visible && isFocused && exitMessage == nil && isOnScreen
            && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        guard wanted != (blinkTimer != nil) else { return }
        stopBlink()
        guard wanted else { return }
        let defaults = UserDefaults.standard
        let period = (defaults.object(forKey: "NSTextInsertionPointBlinkPeriodOn") as? Double ?? Self.defaultBlinkPeriod)
            / Self.millisecondsPerSecond
        let timer = Timer(timeInterval: period, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.isBlinkOn.toggle()
                self.invalidate(self.rowRect(self.cursor.row))
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        blinkTimer = timer
    }

    private func stopBlink() {
        blinkTimer?.invalidate()
        blinkTimer = nil
        guard !isBlinkOn else { return }
        isBlinkOn = true
        invalidate(rowRect(cursor.row))
    }

    override func resetCursorRects() {
        addCursorRect(bounds, cursor: mouseTracking ? .arrow : .iBeam)
    }
}

extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
