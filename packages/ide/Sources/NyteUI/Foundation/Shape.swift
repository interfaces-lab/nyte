import AppKit

public enum Shape {
    public static func rounded(_ rect: NSRect, radius: CGFloat) -> NSBezierPath {
        let radius = max(0, min(radius, min(rect.width, rect.height) / 2))
        guard radius > 0 else { return NSBezierPath(rect: rect) }
        guard min(rect.width, rect.height) >= radius * ContinuousCorner.span * 2 else {
            return NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
        }
        return rounded(rect, radii: CornerRadii(radius), flipped: false)
    }

    public static func ring(_ rect: NSRect, radius: CGFloat, width: CGFloat = Metric.hairline) -> NSBezierPath {
        let path = rounded(rect.insetBy(dx: width / 2, dy: width / 2), radius: max(0, radius - width / 2))
        path.lineWidth = width
        return path
    }

    public static func rounded(_ rect: NSRect, radii: CornerRadii, flipped: Bool) -> NSBezierPath {
        let limit = min(rect.width, rect.height) / (2 * ContinuousCorner.span)
        let order = flipped
            ? [radii.topLeft, radii.topRight, radii.bottomRight, radii.bottomLeft]
            : [radii.bottomLeft, radii.bottomRight, radii.topRight, radii.topLeft]
        let corners = [
            NSPoint(x: rect.minX, y: rect.minY), NSPoint(x: rect.maxX, y: rect.minY),
            NSPoint(x: rect.maxX, y: rect.maxY), NSPoint(x: rect.minX, y: rect.maxY),
        ]
        let path = NSBezierPath()
        for (index, corner) in corners.enumerated() {
            let previous = corners[(index + corners.count - 1) % corners.count]
            let next = corners[(index + 1) % corners.count]
            let incoming = unit(from: previous, to: corner), outgoing = unit(from: corner, to: next)
            let radius = max(0, min(order[index], limit))
            func place(_ offset: ContinuousCorner.Offset) -> NSPoint {
                NSPoint(x: corner.x - incoming.x * offset.back * radius + outgoing.x * offset.ahead * radius,
                        y: corner.y - incoming.y * offset.back * radius + outgoing.y * offset.ahead * radius)
            }
            let entry = place(ContinuousCorner.entry)
            if index == 0 { path.move(to: entry) } else { path.line(to: entry) }
            guard radius > 0 else { continue }
            for segment in ContinuousCorner.segments {
                path.curve(to: place(segment.end), controlPoint1: place(segment.control1), controlPoint2: place(segment.control2))
            }
        }
        path.close()
        return path
    }

    private static func unit(from a: NSPoint, to b: NSPoint) -> NSPoint {
        let length = max(hypot(b.x - a.x, b.y - a.y), 1)
        return NSPoint(x: (b.x - a.x) / length, y: (b.y - a.y) / length)
    }

    private enum ContinuousCorner {
        struct Offset {
            let back: CGFloat
            let ahead: CGFloat
        }

        struct Segment {
            let control1: Offset
            let control2: Offset
            let end: Offset
        }

        static let span: CGFloat = 1.528_665
        static let entry = Offset(back: span, ahead: 0)
        static let segments = [
            Segment(control1: Offset(back: 1.088_493, ahead: 0), control2: Offset(back: 0.868_407, ahead: 0),
                    end: Offset(back: 0.631_494, ahead: 0.074_911)),
            Segment(control1: Offset(back: 0.372_824, ahead: 0.169_060), control2: Offset(back: 0.169_060, ahead: 0.372_824),
                    end: Offset(back: 0.074_911, ahead: 0.631_494)),
            Segment(control1: Offset(back: 0, ahead: 0.868_407), control2: Offset(back: 0, ahead: 1.088_493),
                    end: Offset(back: 0, ahead: span)),
        ]
    }
}

public struct CornerRadii: Sendable, Equatable {
    public var topLeft: CGFloat
    public var topRight: CGFloat
    public var bottomLeft: CGFloat
    public var bottomRight: CGFloat

    public init(topLeft: CGFloat, topRight: CGFloat, bottomLeft: CGFloat, bottomRight: CGFloat) {
        self.topLeft = topLeft
        self.topRight = topRight
        self.bottomLeft = bottomLeft
        self.bottomRight = bottomRight
    }

    public init(_ radius: CGFloat) { self.init(topLeft: radius, topRight: radius, bottomLeft: radius, bottomRight: radius) }

    public var isUniform: Bool { topLeft == topRight && topLeft == bottomLeft && topLeft == bottomRight }
}

@MainActor
public enum Draw {
    public static func fill(_ rect: NSRect, radius: CGFloat, color: NSColor) {
        color.setFill()
        Shape.rounded(rect, radius: radius).fill()
    }

    public static func ring(_ rect: NSRect, radius: CGFloat, color: NSColor, width: CGFloat = Metric.hairline) {
        color.setStroke()
        Shape.ring(rect, radius: radius, width: width).stroke()
    }

    public static func glyph(_ image: NSImage, in rect: NSRect, ink: NSColor) {
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        context.saveGState()
        context.beginTransparencyLayer(in: rect.insetBy(dx: -1, dy: -1), auxiliaryInfo: nil)
        image.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
        ink.setFill()
        rect.insetBy(dx: -1, dy: -1).fill(using: .sourceAtop)
        context.endTransparencyLayer()
        context.restoreGState()
    }

    public static func glyph(_ image: NSImage, centeredIn rect: NSRect, ink: NSColor) {
        let size = image.size
        glyph(image, in: NSRect(
            x: (rect.midX - size.width / 2).rounded(), y: (rect.midY - size.height / 2).rounded(),
            width: size.width, height: size.height
        ), ink: ink)
    }

    public static func text(_ string: String, in rect: NSRect, style: TextStyle = .base, ink: NSColor,
                            weight: NSFont.Weight = .regular, alignment: NSTextAlignment = .natural,
                            lineBreak: NSLineBreakMode = .byTruncatingTail, tabular: Bool = false, font: NSFont? = nil) {
        guard !string.isEmpty, rect.width > 0 else { return }
        var attributes = style.attributes(ink, weight: weight)
        if tabular { attributes[.font] = style.tabularFont(weight) }
        if let font { attributes[.font] = font }
        attributes[.paragraphStyle] = style.paragraph(lineBreak: lineBreak, alignment: alignment)
        let line = NSRect(
            x: rect.minX, y: (rect.midY - style.lineHeight / 2).rounded(), width: rect.width, height: style.lineHeight
        )
        (string as NSString).draw(with: line, options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine], attributes: attributes)
    }

    public static func faded(_ alpha: CGFloat, in rect: NSRect, _ body: () -> Void) {
        guard alpha < 1, let context = NSGraphicsContext.current?.cgContext else { return body() }
        context.saveGState()
        context.setAlpha(alpha)
        context.beginTransparencyLayer(in: rect, auxiliaryInfo: nil)
        body()
        context.endTransparencyLayer()
        context.restoreGState()
    }

    public static func dot(in rect: NSRect, diameter: CGFloat, color: NSColor) {
        color.setFill()
        NSBezierPath(ovalIn: NSRect(x: rect.midX - diameter / 2, y: rect.midY - diameter / 2,
                                    width: diameter, height: diameter)).fill()
    }

    public static func width(of string: String, style: TextStyle = .base, weight: NSFont.Weight = .regular,
                             tabular: Bool = false) -> CGFloat {
        guard !string.isEmpty else { return 0 }
        let font = tabular ? style.tabularFont(weight) : style.font(weight)
        return ceil((string as NSString).size(withAttributes: [.font: font]).width)
    }
}
