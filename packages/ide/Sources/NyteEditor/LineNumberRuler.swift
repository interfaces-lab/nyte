import AppKit
import NyteCore
import NyteUI

@MainActor
final class LineNumberRuler: NSRulerView {
    var lineIndex: () -> LineIndex? = { nil }
    var caretLine: () -> Int? = { nil }
    var breakpoints: () -> [SourceBreakpoint] = { [] }
    var executionLine: () -> Int? = { nil }
    var onClickLine: ((Int) -> Void)?
    var lightbulb: () -> (line: Int, kind: Lightbulb)? = { nil }
    var onClickLightbulb: ((Int) -> Void)?
    var runMark: (Int) -> RunMark.Kind? = { _ in nil }
    var onClickRunMark: ((Int, NSPoint) -> Void)?
    var change: (Int) -> ChangeKind? = { _ in nil }
    var onClickChange: ((Int) -> Void)?
    var onBreakpointMenu: ((Int) -> NSMenu?)?
    var pinnedLines: () -> (lines: [Int], lineHeight: CGFloat, push: CGFloat)? = { nil }
    var foldMark: (Int) -> FoldMark? = { _ in nil }
    var onClickFold: ((Int) -> Void)?

    private static let mark = Glyph.xs.rawValue
    private static let bulbGlyph = Glyph.xs
    private static let bulbLane = Glyph.xs.rawValue + Space.x2
    private static let changeLane = Space.x2
    private static let foldLane = Space.x3
    private static let chevron = Space.x1
    private static let numberTrail = Space.x3 + LineNumberRuler.foldLane
    private static let openChevron = [CGPoint(x: 0.2, y: 0.35), CGPoint(x: 0.5, y: 0.65), CGPoint(x: 0.8, y: 0.35)]
    private static let closedChevron = [CGPoint(x: 0.35, y: 0.2), CGPoint(x: 0.65, y: 0.5), CGPoint(x: 0.35, y: 0.8)]
    private static let changeBar = Space.x05
    private static let changeInset = Space.x1
    private static let ghostOpacity: Float = 0.35
    private static let innerArrowScale: CGFloat = 0.62
    private static let arrowOutline: [CGPoint] = [CGPoint(x: 0.06, y: 0.39), CGPoint(x: 0.5, y: 0.39), CGPoint(x: 0.5, y: 0.14), CGPoint(x: 0.94, y: 0.5), CGPoint(x: 0.5, y: 0.86), CGPoint(x: 0.5, y: 0.61), CGPoint(x: 0.06, y: 0.61)]

    private var font = TextStyle.codeSmall.font()
    private var digitWidth: CGFloat
    private var codeLineHeight = TextStyle.code.lineHeight
    private let band = CALayer()
    private let ghost = CAShapeLayer()
    private let bulb = CALayer()
    private var bulbInk: (kind: Lightbulb, appearance: NSAppearance.Name)?
    private var runLayers: [CALayer] = []
    private var changeLayers: [CALayer] = []
    private var runImages: [RunMark.Kind: NSImage] = [:]
    private var runImagesAppearance: NSAppearance.Name?
    private struct DrawnNumber: Equatable {
        let line: Int
        let isCaretLine: Bool
    }

    private var numberLayers: [CATextLayer] = []
    private var drawnNumbers: [DrawnNumber?] = []
    private var numberTops: [CGFloat] = []
    private var breakpointLayers: [CAShapeLayer] = []
    private var symbolLayers: [CAShapeLayer] = []
    private var foldLayers: [CAShapeLayer] = []
    private var appearanceName: NSAppearance.Name?
    private var digits = 0
    private var baseline: CGFloat?
    private var pointer: NSPoint?
    private var pressedLine: Int?
    private var pointerArea: NSTrackingArea?
    private lazy var discPath = CGPath(ellipseIn: CGRect(x: 0, y: 0, width: Self.mark, height: Self.mark), transform: nil)
    private lazy var ringPath = CGPath(
        ellipseIn: CGRect(x: 0, y: 0, width: Self.mark, height: Self.mark)
            .insetBy(dx: Metric.markStroke / 2, dy: Metric.markStroke / 2),
        transform: nil
    )
    private lazy var diamondPath = Self.diamond(inset: 0)
    private lazy var diamondRingPath = Self.diamond(inset: Metric.markStroke / 2)
    private lazy var arrowPath = Self.arrow(scale: 1)
    private lazy var innerArrowPath = Self.arrow(scale: Self.innerArrowScale)
    private lazy var conditionPath = Self.questionMark()

    init(scrollView: NSScrollView) {
        digitWidth = ("0" as NSString).size(withAttributes: [.font: font]).width
        super.init(scrollView: scrollView, orientation: .verticalRuler)
        reservedThicknessForMarkers = 0
        reservedThicknessForAccessoryView = 0
        wantsLayer = true
        clipsToBounds = true
        layer?.addSublayer(band)
        ghost.opacity = Self.ghostOpacity
        ghost.isHidden = true
        layer?.addSublayer(ghost)
        bulb.isHidden = true
        layer?.addSublayer(bulb)
        setAccessibilityElement(false)
        updateThickness(lines: 1)
    }

    @available(*, unavailable)
    required init(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isFlipped: Bool { true }
    override var isOpaque: Bool { true }
    override var wantsUpdateLayer: Bool { true }

    static let numberSizeStep: CGFloat = 1

    func apply(_ metrics: CodeRowMetrics, lines: Int) {
        font = TextStyle.codeSmall.font().withSize(metrics.font.pointSize - Self.numberSizeStep)
        digitWidth = ("0" as NSString).size(withAttributes: [.font: font]).width
        codeLineHeight = metrics.lineHeight
        baseline = nil
        drawnNumbers = drawnNumbers.map { _ in nil }
        digits = 0
        updateThickness(lines: lines)
        needsDisplay = true
    }

    func updateThickness(lines: Int) {
        let count = String(lines).count
        guard count != digits else { return }
        digits = count
        ruleThickness = Self.bulbLane + (CGFloat(count) * digitWidth).rounded(.up) + Space.x3 + Self.foldLane
    }

    // AppKit: Everything is in layers; this keeps NSRulerView's own hash marks from being drawn by any path that still calls it.
    override func draw(_ dirtyRect: NSRect) {}

    override func updateLayer() {
        effectiveAppearance.performAsCurrentDrawingAppearance { layoutRows() }
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let pointerArea { removeTrackingArea(pointerArea) }
        let area = NSTrackingArea(
            rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self
        )
        addTrackingArea(area)
        pointerArea = area
    }

    override func mouseMoved(with event: NSEvent) {
        pointer = convert(event.locationInWindow, from: nil)
        needsDisplay = true
    }

    override func mouseEntered(with event: NSEvent) {
        pointer = convert(event.locationInWindow, from: nil)
        needsDisplay = true
    }

    override func mouseExited(with event: NSEvent) {
        pointer = nil
        needsDisplay = true
    }

    override func mouseDown(with event: NSEvent) {
        if event.modifierFlags.contains(.control), let menu = menu(for: event) {
            return NSMenu.popUpContextMenu(menu, with: event, for: self)
        }
        pressedLine = line(at: convert(event.locationInWindow, from: nil))
    }

    override func menu(for event: NSEvent) -> NSMenu? {
        guard let line = line(at: convert(event.locationInWindow, from: nil)), points(on: line) else { return nil }
        return onBreakpointMenu?(line)
    }

    var shownNumbers: [(line: Int, top: CGFloat)] {
        numberLayers.indices.compactMap { slot in
            guard !numberLayers[slot].isHidden, let number = drawnNumbers[slot] else { return nil }
            return (number.line, numberTops[slot])
        }
    }

    func rectOfMark(line: Int) -> NSRect? {
        guard let engine = clientView as? TextEngineView, let index = lineIndex(), line < index.count else { return nil }
        let top = convert(NSPoint(x: 0, y: engine.top(ofLine: line)), from: engine).y
        return markBox(top: top, height: engine.metrics.lineHeight)
    }

    private func markBox(top: CGFloat, height: CGFloat) -> NSRect {
        let scale = window?.backingScaleFactor ?? 2
        let column = CGFloat(digits) * digitWidth
        let markX = ((bounds.width - Self.numberTrail - column / 2 - Self.mark / 2) * scale).rounded() / scale
        return NSRect(x: markX, y: ((top + height / 2 - Self.mark / 2) * scale).rounded() / scale, width: Self.mark, height: Self.mark)
    }

    override func mouseUp(with event: NSEvent) {
        defer { pressedLine = nil }
        let point = convert(event.locationInWindow, from: nil)
        guard let pressedLine, line(at: point) == pressedLine else { return }
        let foldLane = point.x >= bounds.width - Self.numberTrail && point.x < bounds.width - Space.x3
        if foldLane, foldMark(pressedLine) != nil { return onClickFold?(pressedLine) ?? () }
        let target = GutterClick.decide(inBulbLane: point.x < Self.bulbLane, hasBulb: !bulb.isHidden && lightbulb()?.line == pressedLine,
                                        hasRunMark: runMark(pressedLine) != nil, hasBreakpoint: points(on: pressedLine),
                                        inChangeLane: point.x >= bounds.maxX - Self.changeLane, hasChange: change(pressedLine) != nil)
        switch target {
        case .change: onClickChange?(pressedLine)
        case .lightbulb: onClickLightbulb?(pressedLine)
        case .runMark: onClickRunMark?(pressedLine, point)
        case .breakpoint: onClickLine?(pressedLine)
        }
    }

    private func line(at point: NSPoint) -> Int? {
        guard let engine = clientView as? TextEngineView, lineIndex() != nil else { return nil }
        let y = engine.convert(point, from: self).y
        guard y >= TextEngineView.verticalInset else { return nil }
        let row = Int(((y - TextEngineView.verticalInset) / engine.metrics.lineHeight).rounded(.down))
        guard row < engine.rowCount else { return nil }
        return engine.rowMap.line(atRow: row)
    }

    private func layoutRows() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        defer { CATransaction.commit() }
        layer?.backgroundColor = Palette.bgBase.cgColor
        band.backgroundColor = Palette.bgMutedTranslucent.cgColor
        if appearanceName != effectiveAppearance.name {
            appearanceName = effectiveAppearance.name
            drawnNumbers = drawnNumbers.map { _ in nil }
        }
        band.isHidden = true
        ghost.isHidden = true
        bulb.isHidden = true
        let bulbLine = lightbulb()
        var numbersUsed = 0
        var breakpointsUsed = 0
        var symbolsUsed = 0
        var runsUsed = 0
        var changesUsed = 0
        var foldsUsed = 0
        defer {
            foldLayers[foldsUsed...].forEach { $0.isHidden = true }
            changeLayers[changesUsed...].forEach { $0.isHidden = true }
            runLayers[runsUsed...].forEach { $0.isHidden = true }
            numberLayers[numbersUsed...].forEach { $0.isHidden = true }
            breakpointLayers[breakpointsUsed...].forEach { $0.isHidden = true }
            symbolLayers[symbolsUsed...].forEach { $0.isHidden = true }
        }
        guard let engine = clientView as? TextEngineView, let index = lineIndex() else { return }
        let baseline = engine.metrics.baseline
        let lineHeight = engine.metrics.lineHeight
        let rows = engine.rows(in: engine.visibleRect)
        let caret = caretLine()
        let points = breakpoints()
        let execution = executionLine()
        let hovered = pointer.flatMap(line(at:))
        let scale = window?.backingScaleFactor ?? 2
        let pinned = pinnedLines()
        let pinnedHeight = pinned.map { CGFloat($0.lines.count) * $0.lineHeight - $0.push } ?? 0
        if let pinned {
            for (slot, number) in pinned.lines.enumerated() {
                placeNumber(number, top: CGFloat(slot) * pinned.lineHeight - pinned.push, baseline: baseline,
                            isCaretLine: number == caret, scale: scale, used: &numbersUsed)
            }
        }
        for row in rows {
            let line = engine.rowMap.line(atRow: row)
            guard line < index.count else { break }
            let top = convert(NSPoint(x: 0, y: engine.top(ofRow: row)), from: engine).y
            guard top < bounds.maxY else { break }
            guard top + lineHeight / 2 >= pinnedHeight else { continue }
            let fragment = NSRect(x: 0, y: top, width: 0, height: lineHeight)
            if let kind = change(line) { placeChange(kind, top: top, height: fragment.height, used: &changesUsed) }
            if let mark = foldMark(line), mark == .folded || pointer != nil {
                placeFold(mark, top: top, height: fragment.height, scale: scale, used: &foldsUsed)
            }
            if let bulbLine, bulbLine.line == line { placeBulb(bulbLine.kind, top: top, height: fragment.height, scale: scale) }
            if line == caret {
                band.isHidden = false
                band.frame = NSRect(x: 0, y: top, width: bounds.width, height: fragment.height)
            }
            let box = markBox(top: top, height: fragment.height)
            let breakpoint = points.first { $0.zeroBasedLine == line }
            let isExecution = line == execution
            if breakpoint != nil || isExecution {
                place(breakpoint, isExecution: isExecution, in: box, breakpointsUsed: &breakpointsUsed, symbolsUsed: &symbolsUsed)
                continue
            }
            if let kind = runMark(line) {
                placeRunMark(kind, in: box, used: &runsUsed)
                continue
            }
            if line == hovered {
                ghost.isHidden = false
                ghost.frame = box
                ghost.path = discPath
                ghost.fillColor = Palette.dangerFill.cgColor
                continue
            }
            placeNumber(line, top: top, baseline: baseline, isCaretLine: line == caret, scale: scale, used: &numbersUsed)
        }
    }

    private func place(_ breakpoint: SourceBreakpoint?, isExecution: Bool, in box: NSRect,
                       breakpointsUsed: inout Int, symbolsUsed: inout Int) {
        var markInk: CGColor?
        var filled = false
        if let breakpoint {
            let ring = breakpoint.isEnabled && breakpoint.verification != .unverified
                ? nil : (breakpoint.isEnabled ? Palette.contentTertiary : Palette.dangerFill)
            let shape = take(&breakpointLayers, at: breakpointsUsed, below: true)
            breakpointsUsed += 1
            shape.frame = box
            filled = ring == nil
            if let ring {
                shape.path = breakpoint.isLogpoint ? diamondRingPath : ringPath
                shape.fillColor = nil
                shape.strokeColor = ring.cgColor
                shape.lineWidth = Metric.markStroke
                markInk = ring.cgColor
            } else {
                shape.path = breakpoint.isLogpoint ? diamondPath : discPath
                shape.fillColor = Palette.dangerFill.cgColor
                shape.strokeColor = nil
                markInk = Palette.contentOnControl.cgColor
            }
        }
        let symbol: CGPath?
        let ink: CGColor?
        if isExecution {
            symbol = breakpoint == nil ? arrowPath : innerArrowPath
            ink = filled ? Palette.contentOnControl.cgColor : Palette.accentFill.cgColor
        } else if let breakpoint, breakpoint.isConditional {
            symbol = conditionPath
            ink = markInk
        } else {
            symbol = nil
            ink = nil
        }
        guard let symbol, let ink else { return }
        let shape = take(&symbolLayers, at: symbolsUsed, below: false)
        symbolsUsed += 1
        shape.frame = box
        shape.path = symbol
        shape.fillColor = ink
    }

    private func points(on line: Int) -> Bool {
        breakpoints().contains { $0.zeroBasedLine == line } || executionLine() == line
    }

    private func placeNumber(_ line: Int, top: CGFloat, baseline: CGFloat, isCaretLine: Bool, scale: CGFloat, used: inout Int) {
        if used == numberLayers.count {
            let row = CATextLayer()
            row.alignmentMode = .right
            row.contentsFormat = .RGBA8Uint
            layer?.addSublayer(row)
            numberLayers.append(row)
            drawnNumbers.append(nil)
            numberTops.append(0)
        }
        let number = DrawnNumber(line: line, isCaretLine: isCaretLine)
        if drawnNumbers[used] != number, let drawn = drawnNumbers[used...].firstIndex(of: number) {
            numberLayers.swapAt(used, drawn)
            drawnNumbers.swapAt(used, drawn)
        }
        let row = numberLayers[used]
        row.isHidden = false
        row.contentsScale = scale
        if drawnNumbers[used] != number {
            drawnNumbers[used] = number
            row.string = NSAttributedString(string: String(line + 1), attributes: [
                .font: font,
                NSAttributedString.Key(kCTForegroundColorAttributeName as String):
                    (isCaretLine ? Palette.contentPrimary : Palette.contentSecondary).cgColor,
            ])
        }
        numberTops[used] = top
        used += 1
        row.frame = NSRect(x: 0, y: top + baseline - font.ascender, width: bounds.width - Self.numberTrail, height: font.ascender - font.descender)
    }

    private func placeChange(_ kind: ChangeKind, top: CGFloat, height: CGFloat, used: inout Int) {
        if used == changeLayers.count {
            let layer = CALayer()
            self.layer?.addSublayer(layer)
            changeLayers.append(layer)
        }
        let layer = changeLayers[used]
        used += 1
        layer.isHidden = false
        let x = bounds.maxX - Self.changeInset - Self.changeBar
        switch kind {
        case .added:
            layer.backgroundColor = Palette.diffAddedBar.cgColor
            layer.frame = NSRect(x: x, y: top, width: Self.changeBar, height: height)
        case .modified:
            layer.backgroundColor = Palette.diffModifiedBar.cgColor
            layer.frame = NSRect(x: x, y: top, width: Self.changeBar, height: height)
        case .deleted:
            layer.backgroundColor = Palette.diffRemovedBar.cgColor
            layer.frame = NSRect(x: x - Self.changeInset, y: top - Self.changeBar / 2, width: Self.changeBar + Self.changeInset * 2,
                                 height: Self.changeBar)
        }
    }

    private func placeRunMark(_ kind: RunMark.Kind, in box: NSRect, used: inout Int) {
        if runImagesAppearance != effectiveAppearance.name {
            runImagesAppearance = effectiveAppearance.name
            runImages.removeAll()
        }
        if used == runLayers.count {
            let layer = CALayer()
            self.layer?.addSublayer(layer)
            runLayers.append(layer)
        }
        let layer = runLayers[used]
        used += 1
        layer.isHidden = false
        layer.frame = box
        layer.contentsScale = window?.backingScaleFactor ?? 2
        layer.contents = runImage(kind)
    }

    private func runImage(_ kind: RunMark.Kind) -> NSImage? {
        if let image = runImages[kind] { return image }
        let name = switch kind {
        case .program: "play.fill"
        case .test: "play.diamond"
        case .suite: "play.diamond.fill"
        }
        guard let symbol = Symbol.image(name, glyph: .xs) else { return nil }
        let appearance = effectiveAppearance
        let image = NSImage(size: symbol.size, flipped: false) { rect in
            appearance.performAsCurrentDrawingAppearance { MainActor.assumeIsolated { Draw.glyph(symbol, in: rect, ink: Palette.contentSecondary) } }
            return true
        }
        runImages[kind] = image
        return image
    }

    private func placeBulb(_ kind: Lightbulb, top: CGFloat, height: CGFloat, scale: CGFloat) {
        let size = Self.bulbGlyph.rawValue
        bulb.isHidden = false
        bulb.contentsScale = scale
        bulb.frame = NSRect(x: ((Self.bulbLane - size) / 2 * scale).rounded() / scale,
                            y: ((top + (height - size) / 2) * scale).rounded() / scale, width: size, height: size)
        guard bulbInk?.kind != kind || bulbInk?.appearance != effectiveAppearance.name,
              let symbol = Symbol.image("lightbulb.fill", size: Self.bulbGlyph.rawValue)
        else { return }
        bulbInk = (kind, effectiveAppearance.name)
        let ink = switch kind {
        case .intention: Palette.contentSecondary
        case .fixesError: Palette.dangerInk
        case .fixesWarning: Palette.warningInk
        }
        let appearance = effectiveAppearance
        bulb.contents = NSImage(size: symbol.size, flipped: false) { rect in
            appearance.performAsCurrentDrawingAppearance { MainActor.assumeIsolated { Draw.glyph(symbol, in: rect, ink: ink) } }
            return true
        }
    }

    private func placeFold(_ mark: FoldMark, top: CGFloat, height: CGFloat, scale: CGFloat, used: inout Int) {
        let shape = take(&foldLayers, at: used, below: false)
        used += 1
        let size = Self.chevron * 2
        let x = ((bounds.width - Self.numberTrail + (Self.foldLane - size) / 2) * scale).rounded() / scale
        shape.frame = NSRect(x: x, y: ((top + (height - size) / 2) * scale).rounded() / scale, width: size, height: size)
        let path = CGMutablePath()
        let points = (mark == .foldable ? Self.openChevron : Self.closedChevron).map { CGPoint(x: $0.x * size, y: $0.y * size) }
        path.addLines(between: points)
        shape.path = path
        shape.fillColor = nil
        shape.strokeColor = (mark == .folded ? Palette.contentSecondary : Palette.contentTertiary).cgColor
        shape.lineWidth = Metric.markStroke
        shape.lineCap = .round
        shape.lineJoin = .round
    }

    private func take(_ pool: inout [CAShapeLayer], at index: Int, below: Bool) -> CAShapeLayer {
        if index == pool.count {
            let shape = CAShapeLayer()
            if below { layer?.insertSublayer(shape, above: band) } else { layer?.addSublayer(shape) }
            pool.append(shape)
        }
        pool[index].isHidden = false
        return pool[index]
    }

    private static func diamond(inset: CGFloat) -> CGPath {
        let path = CGMutablePath()
        let middle = mark / 2
        path.addLines(between: [CGPoint(x: middle, y: inset), CGPoint(x: mark - inset, y: middle), CGPoint(x: middle, y: mark - inset),
                                CGPoint(x: inset, y: middle)])
        path.closeSubpath()
        return path
    }

    private static func arrow(scale: CGFloat) -> CGPath {
        let path = CGMutablePath()
        let size = mark * scale
        let inset = (mark - size) / 2
        let points = arrowOutline.map { CGPoint(x: inset + $0.x * size, y: inset + $0.y * size) }
        path.addLines(between: points)
        path.closeSubpath()
        return path
    }

    private static func questionMark() -> CGPath {
        let font = TextStyle.xxs.font(.heavy)
        var character: UniChar = 0x3F
        var glyph: CGGlyph = 0
        guard CTFontGetGlyphsForCharacters(font, &character, &glyph, 1),
              let outline = CTFontCreatePathForGlyph(font, glyph, nil)
        else { return CGMutablePath() }
        let bounds = outline.boundingBoxOfPath
        var transform = CGAffineTransform(translationX: mark / 2, y: mark / 2)
            .scaledBy(x: 1, y: -1)
            .translatedBy(x: -bounds.midX, y: -bounds.midY)
        return outline.copy(using: &transform) ?? outline
    }
}

enum FoldMark: Equatable {
    case foldable, folded
}

enum Lightbulb: Equatable {
    case intention, fixesError, fixesWarning
}

enum GutterClick: Equatable {
    case lightbulb, runMark, breakpoint, change

    static func decide(inBulbLane: Bool, hasBulb: Bool, hasRunMark: Bool, hasBreakpoint: Bool,
                       inChangeLane: Bool = false, hasChange: Bool = false) -> GutterClick {
        if inChangeLane, hasChange { return .change }
        if inBulbLane, hasBulb { return .lightbulb }
        if !inBulbLane, hasRunMark, !hasBreakpoint { return .runMark }
        return .breakpoint
    }
}
