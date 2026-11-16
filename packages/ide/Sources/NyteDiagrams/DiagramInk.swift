import AppKit
import BeautifulMermaid
import NyteUI

enum DiagramLook: Hashable, Sendable {
    case light, dark, lightContrast, darkContrast

    init(_ appearance: NSAppearance) {
        let names: [NSAppearance.Name] = [.aqua, .darkAqua, .accessibilityHighContrastAqua, .accessibilityHighContrastDarkAqua]
        switch appearance.bestMatch(from: names) {
        case .darkAqua: self = .dark
        case .accessibilityHighContrastAqua: self = .lightContrast
        case .accessibilityHighContrastDarkAqua: self = .darkContrast
        default: self = .light
        }
    }

    var appearance: NSAppearance? {
        switch self {
        case .light: NSAppearance(named: .aqua)
        case .dark: NSAppearance(named: .darkAqua)
        case .lightContrast: NSAppearance(named: .accessibilityHighContrastAqua)
        case .darkContrast: NSAppearance(named: .accessibilityHighContrastDarkAqua)
        }
    }
}

struct DiagramRamp: Sendable {
    struct Ink: Sendable, Hashable {
        let red: UInt8
        let green: UInt8
        let blue: UInt8
    }

    let lookup: [Ink]

    static let greyTolerance = 3

    init(stops: [(level: Int, ink: Ink)]) {
        let sorted = stops.sorted { $0.level < $1.level }
        lookup = (0 ... Int(UInt8.max)).map { level in
            guard let upper = sorted.firstIndex(where: { $0.level >= level }) else { return sorted.last?.ink ?? Ink(red: 0, green: 0, blue: 0) }
            let high = sorted[upper]
            guard upper > 0, high.level != level else { return high.ink }
            let low = sorted[upper - 1]
            let t = Double(level - low.level) / Double(max(1, high.level - low.level))
            let mix = { (a: UInt8, b: UInt8) in UInt8((Double(a) + (Double(b) - Double(a)) * t).rounded()) }
            return Ink(red: mix(low.ink.red, high.ink.red), green: mix(low.ink.green, high.ink.green), blue: mix(low.ink.blue, high.ink.blue))
        }
    }

    func apply(to pixels: UnsafeMutablePointer<UInt8>, count: Int) {
        let full = Int(UInt8.max)
        for index in 0 ..< count {
            let pixel = pixels + index * DiagramRender.pixel
            let alpha = Int(pixel[DiagramRender.alpha])
            guard alpha > 0 else { continue }
            let red = Int(pixel[0]) * full / alpha
            let green = Int(pixel[1]) * full / alpha
            let blue = Int(pixel[2]) * full / alpha
            guard abs(red - green) <= Self.greyTolerance, abs(green - blue) <= Self.greyTolerance else { continue }
            let ink = lookup[min(full, (red + green + blue) / DiagramRender.channels)]
            pixel[0] = UInt8(Int(ink.red) * alpha / full)
            pixel[1] = UInt8(Int(ink.green) * alpha / full)
            pixel[2] = UInt8(Int(ink.blue) * alpha / full)
        }
    }
}

@MainActor
enum DiagramPalette {
    static let lineWidth = Metric.hairline
    static let corner = Radius.indicator

    private enum Key {
        static let ground = 255
        static let surface = 250
        static let border = 153
        static let line = 140
        static let accent = 128
        static let muted = 115
        static let ink = 0
    }

    static func theme(for look: DiagramLook, chart: Bool) -> (theme: DiagramTheme, ramp: DiagramRamp?) {
        guard !chart else { return (direct(look), nil) }
        let theme = DiagramTheme(
            background: key(Key.ground), foreground: key(Key.ink), line: key(Key.line), accent: key(Key.accent),
            muted: key(Key.muted), surface: key(Key.surface), border: key(Key.border),
            font: TextStyle.sm.font(), lineWidth: lineWidth, cornerRadius: corner, transparent: true
        )
        let ground = resolve(Palette.bgMuted, in: look)
        let node = resolve(Palette.bgBase, in: look)
        let stops: [(color: BMColor, ink: DiagramRamp.Ink)] = [
            (theme.background, ground),
            (theme.effectiveSurface(), node),
            (theme.subgraphHeaderColor(), ground),
            (theme.keyBadgeColor(), resolve(Palette.fillSecondary, in: look, over: node)),
            (theme.effectiveInnerStroke(), resolve(Palette.strokeTertiary, in: look, over: node)),
            (theme.effectiveTextFaint(), resolve(Palette.contentTertiary, in: look)),
            (theme.effectiveBorder(), resolve(Palette.strokePrimary, in: look)),
            (theme.effectiveLine(), resolve(Palette.strokePrimary, in: look)),
            (theme.effectiveArrow(), resolve(Palette.contentSecondary, in: look)),
            (theme.effectiveMuted(), resolve(Palette.contentSecondary, in: look)),
            (theme.effectiveTextSecondary(), resolve(Palette.contentSecondary, in: look)),
            (theme.foreground, resolve(Palette.contentPrimary, in: look)),
        ]
        return (theme, DiagramRamp(stops: stops.map { stop in (level(stop.color), stop.ink) }))
    }

    private static func direct(_ look: DiagramLook) -> DiagramTheme {
        let color = { (role: NSColor) -> NSColor in
            let ink = resolve(role, in: look)
            return grey(Double(ink.red), Double(ink.green), Double(ink.blue))
        }
        return DiagramTheme(
            background: color(Palette.bgMuted), foreground: color(Palette.contentPrimary), line: color(Palette.strokePrimary),
            accent: color(Palette.accentInk), muted: color(Palette.contentSecondary), surface: color(Palette.bgBase),
            border: color(Palette.strokePrimary), font: TextStyle.sm.font(), lineWidth: lineWidth, cornerRadius: corner,
            transparent: true
        )
    }

    static func resolve(_ role: NSColor, in look: DiagramLook, over ground: DiagramRamp.Ink? = nil) -> DiagramRamp.Ink {
        var components: [CGFloat] = [0, 0, 0, 1]
        let read = {
            guard let color = role.usingColorSpace(.sRGB) else { return }
            components = [color.redComponent, color.greenComponent, color.blueComponent, color.alphaComponent]
        }
        if let appearance = look.appearance { appearance.performAsCurrentDrawingAppearance(read) } else { read() }
        let alpha = components[DiagramRender.alpha]
        let base = alpha >= 1 ? DiagramRamp.Ink(red: 0, green: 0, blue: 0) : ground ?? resolve(Palette.bgBase, in: look)
        let mix = { (value: CGFloat, under: UInt8) -> UInt8 in
            let full = CGFloat(UInt8.max)
            return UInt8(max(0, min(full, (value * full * alpha + CGFloat(under) * (1 - alpha)).rounded())))
        }
        return DiagramRamp.Ink(red: mix(components[0], base.red), green: mix(components[1], base.green), blue: mix(components[2], base.blue))
    }

    private static func key(_ level: Int) -> NSColor { grey(Double(level), Double(level), Double(level)) }

    private static func grey(_ red: Double, _ green: Double, _ blue: Double) -> NSColor {
        let full = Double(UInt8.max)
        return NSColor(colorSpace: .sRGB, components: [red / full, green / full, blue / full, 1], count: DiagramRender.pixel)
    }

    private static func level(_ color: NSColor) -> Int {
        guard let srgb = color.usingColorSpace(.sRGB) else { return 0 }
        let mean = (srgb.redComponent + srgb.greenComponent + srgb.blueComponent) / CGFloat(DiagramRender.channels)
        return Int((mean * CGFloat(UInt8.max)).rounded())
    }
}

enum DiagramRender {
    struct Drawn: @unchecked Sendable {
        let image: CGImage
        let size: CGSize
        let scale: CGFloat
        let smallestText: CGFloat
    }

    enum Failure: Error, Sendable {
        case unsupported(String)
        case invalid(String)
        case empty
    }

    static let layout = LayoutConfig(padding: Space.x2)
    static let margin = Space.x05
    static let scale: CGFloat = 2
    static let pixel = 4
    static let alpha = 3
    static let channels = 3
    static let bitsPerChannel = 8

    private static let supported: Set<String> = [
        "graph", "flowchart", "statediagram", "statediagram-v2", "sequencediagram", "classdiagram", "classdiagram-v2",
        "erdiagram", "xychart", "xychart-beta",
    ]

    static func draw(_ source: String, theme: DiagramTheme, ramp: DiagramRamp?, scale fit: CGFloat) async throws -> Drawn {
        try await Task.detached(priority: .userInitiated) {
            if let header = header(source), !supported.contains(header.lowercased()) { throw Failure.unsupported(header) }
            let positioned: PositionedGraph
            do {
                positioned = try MermaidRenderer.layout(source, config: layout)
            } catch {
                throw Failure.invalid(reason(error, source: source))
            }
            let renderer = DiagramRenderer(theme: theme)
            let bounds = CGRect(x: 0, y: 0, width: max(1, positioned.width), height: max(1, positioned.height))
            guard let drawn = rasterize(bounds: bounds, ramp: ramp, fit: fit, smallestText: DiagramFit.smallestText(positioned),
                                        render: { renderer.render(positioned, in: $0, bounds: $1) })
            else { throw Failure.empty }
            return drawn
        }.value
    }

    static func message(_ failure: Error) -> String {
        switch failure {
        case let Failure.unsupported(header): "Mermaid \(header) diagrams aren’t supported yet."
        case let Failure.invalid(reason): reason
        default: "The diagram came out empty."
        }
    }

    private static func reason(_ error: Error, source: String) -> String {
        if let described = (error as? LocalizedError)?.errorDescription, !described.isEmpty { return described }
        let raw = String(describing: error)
        if raw.hasPrefix("emptyDiagram") { return "The diagram is empty." }
        if raw.hasPrefix("invalidHeader") {
            let line = header(source) ?? ""
            return line == "graph" || line == "flowchart"
                ? "A flowchart needs a direction on its first line, such as “graph TD”."
                : "The first line doesn’t name a diagram type the renderer knows."
        }
        return "The Mermaid source couldn’t be read: \(raw)"
    }

    static func header(_ source: String) -> String? {
        var front = false
        for raw in source.split(separator: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line == "---" {
                front.toggle()
                continue
            }
            guard !front, !line.isEmpty, !line.hasPrefix("%%") else { continue }
            return line.split(whereSeparator: { $0 == " " || $0 == ";" || $0 == ":" }).first.map(String.init)
        }
        return nil
    }

    private static func rasterize(bounds: CGRect, ramp: DiagramRamp?, fit: CGFloat, smallestText: CGFloat,
                                  render: (CGContext, CGRect) -> Void) -> Drawn? {
        let scale = Self.scale * fit
        let width = Int((bounds.width * scale).rounded(.up))
        let height = Int((bounds.height * scale).rounded(.up))
        guard width > 0, height > 0, let space = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: bitsPerChannel, bytesPerRow: width * pixel,
                                      space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
              let data = context.data
        else { return nil }
        context.translateBy(x: 0, y: CGFloat(height))
        context.scaleBy(x: scale, y: -scale)
        context.translateBy(x: -bounds.minX, y: -bounds.minY)
        render(context, bounds)
        let pixels = data.bindMemory(to: UInt8.self, capacity: width * height * pixel)
        ramp?.apply(to: pixels, count: width * height)
        let box = occupied(pixels, width: width, height: height)
        let pad = Int(margin * Self.scale)
        let crop = CGRect(x: max(0, box.minX - pad), y: max(0, box.minY - pad), width: 0, height: 0)
            .union(CGRect(x: min(width, box.maxX + pad), y: min(height, box.maxY + pad), width: 0, height: 0))
        guard let whole = context.makeImage(),
              let cropped = CGContext(data: nil, width: Int(crop.width), height: Int(crop.height), bitsPerComponent: bitsPerChannel,
                                      bytesPerRow: Int(crop.width) * pixel, space: space,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return nil }
        cropped.draw(whole, in: CGRect(x: -crop.minX, y: crop.maxY - CGFloat(height), width: CGFloat(width), height: CGFloat(height)))
        guard let image = cropped.makeImage() else { return nil }
        return Drawn(image: image, size: CGSize(width: crop.width / Self.scale, height: crop.height / Self.scale), scale: fit,
                     smallestText: smallestText)
    }

    private static func occupied(_ pixels: UnsafeMutablePointer<UInt8>, width: Int, height: Int) -> (minX: Int, minY: Int, maxX: Int, maxY: Int) {
        var top = height
        var bottom = -1
        var left = width
        var right = -1
        for y in 0 ..< height {
            let row = pixels + y * width * pixel
            for x in 0 ..< width where row[x * pixel + alpha] != 0 {
                top = min(top, y)
                bottom = max(bottom, y)
                left = min(left, x)
                right = max(right, x)
            }
        }
        guard bottom >= top, right >= left else { return (0, 0, width, height) }
        return (left, top, right + 1, bottom + 1)
    }
}
