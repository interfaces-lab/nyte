import AppKit
import CoreText
import IOSurface
import NyteUI

extension TerminalView {
    private static let maximumSurfaces = 3
    private static let bitsPerComponent = 8
    private static let bytesPerPixel = 4
    private static let pixelFormatBGRA: UInt32 = 0x4247_5241
    private static let underlineDrop: CGFloat = 2
    private static let secondUnderlineDrop: CGFloat = 3
    private static let sRGB = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()

    override var wantsUpdateLayer: Bool { true }

    override func updateLayer() {
        let interval = Self.signposter.beginInterval("draw")
        defer { Self.signposter.endInterval("draw", interval) }
        guard let layer else { return }
        let scale = metrics.scale
        let width = max(1, Int((bounds.width * scale).rounded(.up)))
        let height = max(1, Int((bounds.height * scale).rounded(.up)))
        if let first = surfaces.first, first.width != width || first.height != height {
            surfaces = []
            presented = nil
        }
        let free = surfaces.indices.first { $0 != presented && !surfaces[$0].isInUse }
        guard let index = free ?? makeSurface(width: width, height: height) else {
            DispatchQueue.main.async { [weak self] in self?.needsDisplay = true }
            return
        }
        let surface = surfaces[index]
        let previous = presented.map { surfaces[$0] }
        let regions = previous == nil || damage.isEmpty ? [bounds] : damage
        damage = []
        surface.lock(options: [], seed: nil)
        defer { surface.unlock(options: [], seed: nil) }
        if let previous, regions != [bounds] {
            previous.lock(options: .readOnly, seed: nil)
            memcpy(surface.baseAddress, previous.baseAddress, min(surface.allocationSize, previous.allocationSize))
            previous.unlock(options: .readOnly, seed: nil)
        }
        guard let context = CGContext(
            data: surface.baseAddress, width: width, height: height, bitsPerComponent: Self.bitsPerComponent,
            bytesPerRow: surface.bytesPerRow, space: Self.sRGB,
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        ) else { return }
        context.translateBy(x: 0, y: CGFloat(height))
        context.scaleBy(x: scale, y: -scale)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: true)
        effectiveAppearance.performAsCurrentDrawingAppearance {
            for region in regions {
                context.saveGState()
                context.clip(to: region)
                render(region, context: context)
                context.restoreGState()
            }
        }
        NSGraphicsContext.restoreGraphicsState()
        layer.contentsGravity = .topLeft
        layer.contentsScale = scale
        layer.contents = surface
        presented = index
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        effectiveAppearance.performAsCurrentDrawingAppearance { render(dirtyRect, context: context) }
    }

    private func makeSurface(width: Int, height: Int) -> Int? {
        guard surfaces.count < Self.maximumSurfaces, let surface = IOSurface(properties: [
            .width: width, .height: height, .bytesPerElement: Self.bytesPerPixel, .pixelFormat: Self.pixelFormatBGRA,
        ]) else { return nil }
        if let colorSpace = Self.sRGB.copyPropertyList() {
            IOSurfaceSetValue(surface, kIOSurfaceColorSpace, colorSpace)
        }
        surfaces.append(surface)
        return surfaces.count - 1
    }

    private func render(_ dirtyRect: NSRect, context: CGContext) {
        context.setFillColor(color(background))
        context.fill(dirtyRect)
        guard !layouts.isEmpty else { return }
        let first = max(0, Int(((dirtyRect.minY - Self.padding.height) / metrics.cellHeight).rounded(.down)))
        let last = min(layouts.count - 1, Int(((dirtyRect.maxY - Self.padding.height) / metrics.cellHeight).rounded(.up)))
        if first <= last {
            let selection = TerminalPalette.selection.cgColor
            for index in first...last {
                guard let layout = layouts[index] else { continue }
                draw(layout, row: index, selection: selection, context: context)
            }
        }
        drawHoverLink(dirtyRect, context: context)
        drawCursor(context)
        drawMarkedText()
        drawExitMessage(context)
    }

    private func draw(_ layout: RowLayout, row: Int, selection: CGColor, context: CGContext) {
        let top = Self.padding.height + CGFloat(row) * metrics.cellHeight
        for fill in layout.source.fills {
            context.setFillColor(color(fill.color))
            context.fill(cellRect(column: Int(fill.column), row: row, width: Int(fill.count)))
        }
        if let range = layout.source.selection {
            context.setFillColor(selection)
            context.fill(cellRect(column: range.lowerBound, row: row, width: range.count))
        }
        drawGlyphs(layout, top: top, context: context)
        for sprite in layout.source.sprites {
            Sprites.draw(sprite.scalar, in: cellRect(column: Int(sprite.column), row: row), color: color(sprite.color),
                         scale: metrics.scale, context: context)
        }
        for line in layout.lines {
            let rect = cellRect(column: line.column, row: row, width: line.count)
            let thickness = max(Metric.hairline, 1 / metrics.scale)
            let baseline = top + metrics.baseline
            let offsets: [CGFloat] = switch line.kind {
            case .underline: [baseline + thickness * Self.underlineDrop]
            case .doubleUnderline: [baseline + thickness, baseline + thickness * Self.secondUnderlineDrop]
            case .strikethrough: [top + (metrics.cellHeight / 2).rounded()]
            case .overline: [top]
            }
            context.setFillColor(color(line.color))
            for offset in offsets { context.fill(CGRect(x: rect.minX, y: offset, width: rect.width, height: thickness)) }
        }
    }

    private func drawGlyphs(_ layout: RowLayout, top: CGFloat, only column: Int? = nil, ink: CGColor? = nil, context: CGContext) {
        context.saveGState()
        context.translateBy(x: Self.padding.width, y: top + metrics.baseline)
        context.scaleBy(x: 1, y: -1)
        context.textMatrix = .identity
        for segment in layout.segments {
            context.setFillColor(ink ?? color(segment.color))
            layout.glyphs.withUnsafeBufferPointer { glyphs in
                layout.positions.withUnsafeBufferPointer { positions in
                    guard let glyphBase = glyphs.baseAddress, let positionBase = positions.baseAddress else { return }
                    if let column {
                        for index in segment.range where Int(layout.glyphColumns[index]) == column {
                            CTFontDrawGlyphs(segment.font, glyphBase + index, positionBase + index, 1, context)
                        }
                    } else {
                        CTFontDrawGlyphs(segment.font, glyphBase + segment.range.lowerBound,
                                         positionBase + segment.range.lowerBound, segment.range.count, context)
                    }
                }
            }
        }
        context.restoreGState()
    }

    private func drawHoverLink(_ dirtyRect: NSRect, context: CGContext) {
        guard let hoverLink, !hoverLink.columns.isEmpty else { return }
        let rect = cellRect(column: hoverLink.columns.lowerBound, row: hoverLink.row, width: hoverLink.columns.count)
        guard rect.intersects(dirtyRect) else { return }
        let thickness = max(Metric.hairline, 1 / metrics.scale)
        context.setFillColor(Palette.accentInk.cgColor)
        context.fill(CGRect(x: rect.minX, y: rect.minY + metrics.baseline + thickness * Self.underlineDrop, width: rect.width,
                            height: thickness))
    }

    private func drawCursor(_ context: CGContext) {
        guard cursor.visible, exitMessage == nil, markedText == nil, cursor.row < layouts.count else { return }
        let layout = layouts[cursor.row]
        let width = layout?.source.cluster(at: cursor.column).map { Int(layout?.source.clusterWidth[$0] ?? 1) } ?? 1
        let rect = cellRect(column: cursor.column, row: cursor.row, width: width)
        let ink = color(cursorColor)
        let shape: FrameCursor.Shape = isFocused ? cursor.shape : .hollow
        switch shape {
        case .block:
            guard isBlinkOn else { return }
            context.setFillColor(ink)
            context.fill(rect)
            if let layout {
                context.saveGState()
                context.clip(to: rect)
                drawGlyphs(layout, top: rect.minY, only: cursor.column, ink: color(background), context: context)
                context.restoreGState()
            }
        case .bar:
            guard isBlinkOn else { return }
            context.setFillColor(ink)
            context.fill(rect.divided(atDistance: Space.x05, from: .minXEdge).slice)
        case .underline:
            guard isBlinkOn else { return }
            context.setFillColor(ink)
            context.fill(rect.divided(atDistance: Space.x05, from: .maxYEdge).slice)
        case .hollow:
            context.setStrokeColor(ink)
            context.setLineWidth(Metric.hairline)
            context.stroke(rect.insetBy(dx: Metric.hairline / 2, dy: Metric.hairline / 2))
        }
    }

    var markedTextAttributes: [NSAttributedString.Key: Any] {
        [.font: metrics.fonts[0], .foregroundColor: TerminalPalette.foreground,
         .underlineStyle: NSUnderlineStyle.single.rawValue]
    }

    private func drawMarkedText() {
        guard let markedText, markedText.length > 0, cursor.row < layouts.count else { return }
        let attributed = NSMutableAttributedString(attributedString: markedText)
        attributed.addAttributes(markedTextAttributes, range: NSRange(location: 0, length: attributed.length))
        let size = attributed.size()
        let origin = cellRect(column: cursor.column, row: cursor.row)
        let cells = max(1, Int((size.width / metrics.cellWidth).rounded(.up)))
        TerminalPalette.background.setFill()
        cellRect(column: cursor.column, row: cursor.row, width: cells).fill()
        attributed.draw(at: NSPoint(x: origin.minX, y: origin.minY + (metrics.cellHeight - size.height) / 2))
    }

    private func drawExitMessage(_ context: CGContext) {
        guard let exitMessage, !layouts.isEmpty else { return }
        let rect = rowRect(exitMessageRow)
        context.setFillColor(color(background))
        context.fill(rect)
        let text = NSAttributedString(string: exitMessage, attributes: TextStyle.sm.attributes(Palette.contentTertiary))
        text.draw(in: rect.insetBy(dx: Self.padding.width, dy: (rect.height - TextStyle.sm.lineHeight) / 2))
    }

    private var exitMessageRow: Int {
        let empty = layouts[safe: cursor.row]??.source.clusterStart.isEmpty ?? true
        return min(empty ? cursor.row : cursor.row + 1, layouts.count - 1)
    }
}
