import AppKit
import CoreGraphics
import CoreText

extension FrameLayout {
  /// Draws the frame into a context whose origin is the frame's top-left corner, y pointing down.
  public func draw(in context: CGContext, environment: LayoutEnvironment = LayoutEnvironment()) {
    Painter(context: context, environment: environment).draw(root)
  }

  /// Rasterizes the frame at a scale. `region` limits the bitmap to part of the frame, in the
  /// frame's own points.
  public func image(
    scale: CGFloat, region: CGRect? = nil, environment: LayoutEnvironment = LayoutEnvironment()
  ) -> CGImage? {
    let bounds = CGRect(origin: .zero, size: size)
    let area = (region ?? bounds).intersection(bounds)
    let width = Int((area.width * scale).rounded(.up))
    let height = Int((area.height * scale).rounded(.up))
    guard width > 0, height > 0,
      let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
          | CGBitmapInfo.byteOrder32Little.rawValue)
    else { return nil }

    context.translateBy(x: 0, y: CGFloat(height))
    context.scaleBy(x: scale, y: -scale)
    context.translateBy(x: -area.minX, y: -area.minY)
    context.setAllowsFontSubpixelPositioning(true)
    context.setShouldSubpixelPositionFonts(true)
    context.setAllowsFontSubpixelQuantization(false)
    context.setShouldSubpixelQuantizeFonts(false)
    draw(in: context, environment: environment)
    return context.makeImage()
  }
}

private struct Painter {
  let context: CGContext
  let environment: LayoutEnvironment

  func draw(_ box: LayoutBox) {
    let style = box.style
    let rect = CGRect(origin: .zero, size: box.frame.size)
    context.saveGState()
    context.translateBy(x: box.frame.minX, y: box.frame.minY)
    defer { context.restoreGState() }

    let layered = style.opacity < 1
    if layered {
      context.setAlpha(style.opacity)
      context.beginTransparencyLayer(auxiliaryInfo: nil)
    }
    defer { if layered { context.endTransparencyLayer() } }

    let outline = path(for: box, in: rect, inset: 0)

    for shadow in style.shadows where style.fill != nil {
      context.saveGState()
      context.addRect(rect.insetBy(dx: -shadow.blur * 3 - abs(shadow.x), dy: -shadow.blur * 3 - abs(shadow.y)))
      context.addPath(outline)
      context.clip(using: .evenOdd)
      context.setShadow(
        offset: CGSize(width: shadow.x * scaleX, height: -shadow.y * scaleY),
        blur: shadow.blur * scaleX, color: shadow.color.cgColor)
      context.addPath(outline)
      context.setFillColor(CGColor(gray: 0, alpha: 1))
      context.fillPath()
      context.restoreGState()
    }

    if let fill = style.fill { paint(fill, outline, rect) }

    context.saveGState()
    if style.clip {
      context.addPath(outline)
      context.clip()
    }
    switch box.node.kind {
    case .text: drawText(box, rect)
    case .image: drawImage(box, rect, outline)
    case .icon: drawSymbol(box, rect)
    default: break
    }
    for child in box.children { draw(child) }
    context.restoreGState()

    if let stroke = style.stroke, style.strokeWidth > 0 {
      context.addPath(path(for: box, in: rect, inset: style.strokeWidth / 2))
      context.setStrokeColor(stroke.cgColor)
      context.setLineWidth(style.strokeWidth)
      context.strokePath()
    }
  }

  /// The context's scale, which `setShadow` ignores: shadows are measured in device pixels.
  private var scaleX: CGFloat { abs(context.ctm.a) }
  private var scaleY: CGFloat { abs(context.ctm.d) }

  private func path(for box: LayoutBox, in rect: CGRect, inset: CGFloat) -> CGPath {
    let area = rect.insetBy(dx: inset, dy: inset)
    guard area.width > 0, area.height > 0 else { return CGPath(rect: .zero, transform: nil) }
    if box.node.kind == .ellipse { return CGPath(ellipseIn: area, transform: nil) }
    return roundedPath(area, box.style.radii.inset(inset))
  }

  private func paint(_ paint: Paint, _ outline: CGPath, _ rect: CGRect) {
    switch paint {
    case .color(let color):
      context.addPath(outline)
      context.setFillColor(color.cgColor)
      context.fillPath()

    case .linear(let angle, let stops):
      guard let gradient = gradient(stops) else { return }
      let radians = angle * .pi / 180
      let direction = CGVector(dx: sin(radians), dy: -cos(radians))
      let reach = abs(rect.width * direction.dx) / 2 + abs(rect.height * direction.dy) / 2
      let center = CGPoint(x: rect.midX, y: rect.midY)
      context.saveGState()
      context.addPath(outline)
      context.clip()
      context.drawLinearGradient(
        gradient,
        start: CGPoint(x: center.x - direction.dx * reach, y: center.y - direction.dy * reach),
        end: CGPoint(x: center.x + direction.dx * reach, y: center.y + direction.dy * reach),
        options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
      context.restoreGState()

    case .radial(let center, let stops):
      guard let gradient = gradient(stops) else { return }
      let point = CGPoint(x: rect.minX + rect.width * center.x, y: rect.minY + rect.height * center.y)
      let radius = max(rect.width, rect.height) / 2
      context.saveGState()
      context.addPath(outline)
      context.clip()
      context.drawRadialGradient(
        gradient, startCenter: point, startRadius: 0, endCenter: point, endRadius: radius,
        options: [.drawsAfterEndLocation])
      context.restoreGState()
    }
  }

  private func gradient(_ stops: [GradientStop]) -> CGGradient? {
    CGGradient(
      colorsSpace: CGColorSpace(name: CGColorSpace.sRGB),
      colors: stops.map(\.color.cgColor) as CFArray, locations: stops.map(\.location))
  }

  private func drawText(_ box: LayoutBox, _ rect: CGRect) {
    guard let text = box.text else { return }
    let factor: CGFloat
    switch box.style.textAlign {
    case .start: factor = 0
    case .center: factor = 0.5
    case .end: factor = 1
    }
    context.saveGState()
    context.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
    for line in text.lines {
      context.textPosition = CGPoint(x: (rect.width - line.width) * factor, y: line.baseline)
      CTLineDraw(line.line, context)
    }
    context.restoreGState()
  }

  private func drawImage(_ box: LayoutBox, _ rect: CGRect, _ outline: CGPath) {
    guard let source = box.style.source,
      let image = environment.image(resolvePath(source, from: box.node.definition.file))
    else {
      context.addPath(outline)
      context.setFillColor(CGColor(gray: 0.5, alpha: 0.16))
      context.fillPath()
      return
    }

    let size = CGSize(width: image.width, height: image.height)
    var target = rect
    if box.style.fit != .fill, size.width > 0, size.height > 0 {
      let scale = box.style.fit == .cover
        ? max(rect.width / size.width, rect.height / size.height)
        : min(rect.width / size.width, rect.height / size.height)
      target = CGRect(
        x: rect.midX - size.width * scale / 2, y: rect.midY - size.height * scale / 2,
        width: size.width * scale, height: size.height * scale)
    }
    context.saveGState()
    context.addPath(outline)
    context.clip()
    context.translateBy(x: target.minX, y: target.maxY)
    context.scaleBy(x: 1, y: -1)
    context.interpolationQuality = .high
    context.draw(image, in: CGRect(origin: .zero, size: target.size))
    context.restoreGState()
  }

  private func drawSymbol(_ box: LayoutBox, _ rect: CGRect) {
    guard let name = box.style.symbol,
      let symbol = NSImage(systemSymbolName: name, accessibilityDescription: nil)
    else { return }
    let weight = symbolWeight(box.style.fontWeight)
    let tint = NSColor(cgColor: box.style.color.cgColor) ?? .labelColor
    let configuration = NSImage.SymbolConfiguration(pointSize: box.style.symbolSize * 0.82, weight: weight)
      .applying(NSImage.SymbolConfiguration(paletteColors: [tint]))
    guard let image = symbol.withSymbolConfiguration(configuration) else { return }

    let scale = min(1, min(rect.width / image.size.width, rect.height / image.size.height))
    let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
    let target = CGRect(
      x: rect.midX - size.width / 2, y: rect.midY - size.height / 2, width: size.width,
      height: size.height)

    let previous = NSGraphicsContext.current
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: true)
    image.draw(in: target, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
    NSGraphicsContext.current = previous
  }
}

private func symbolWeight(_ weight: CGFloat) -> NSFont.Weight {
  switch weight {
  case ..<350: return .light
  case ..<450: return .regular
  case ..<550: return .medium
  case ..<650: return .semibold
  default: return .bold
  }
}

/// A rectangle with a radius per corner, each clamped so opposite corners never overlap.
public func roundedPath(_ rect: CGRect, _ radii: Radii) -> CGPath {
  if radii.isZero { return CGPath(rect: rect, transform: nil) }
  let limit = min(rect.width, rect.height) / 2
  if radii.isUniform {
    let radius = min(radii.topLeft, limit)
    return CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)
  }
  let topLeft = min(radii.topLeft, limit)
  let topRight = min(radii.topRight, limit)
  let bottomRight = min(radii.bottomRight, limit)
  let bottomLeft = min(radii.bottomLeft, limit)
  let path = CGMutablePath()
  path.move(to: CGPoint(x: rect.minX + topLeft, y: rect.minY))
  path.addLine(to: CGPoint(x: rect.maxX - topRight, y: rect.minY))
  path.addArc(
    tangent1End: CGPoint(x: rect.maxX, y: rect.minY),
    tangent2End: CGPoint(x: rect.maxX, y: rect.minY + topRight), radius: topRight)
  path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - bottomRight))
  path.addArc(
    tangent1End: CGPoint(x: rect.maxX, y: rect.maxY),
    tangent2End: CGPoint(x: rect.maxX - bottomRight, y: rect.maxY), radius: bottomRight)
  path.addLine(to: CGPoint(x: rect.minX + bottomLeft, y: rect.maxY))
  path.addArc(
    tangent1End: CGPoint(x: rect.minX, y: rect.maxY),
    tangent2End: CGPoint(x: rect.minX, y: rect.maxY - bottomLeft), radius: bottomLeft)
  path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + topLeft))
  path.addArc(
    tangent1End: CGPoint(x: rect.minX, y: rect.minY),
    tangent2End: CGPoint(x: rect.minX + topLeft, y: rect.minY), radius: topLeft)
  path.closeSubpath()
  return path
}
