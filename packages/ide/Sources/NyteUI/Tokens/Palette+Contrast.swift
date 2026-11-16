import AppKit

extension Palette {
    @MainActor static func composite(_ top: NSColor?, over bottom: NSColor) -> NSColor {
        guard let top else { return bottom }
        let (t, b) = (top.usingColorSpace(.sRGB) ?? top, bottom.usingColorSpace(.sRGB) ?? bottom)
        let mix = { (front: CGFloat, back: CGFloat) in front * t.alphaComponent + back * (1 - t.alphaComponent) }
        return NSColor(srgbRed: mix(t.redComponent, b.redComponent), green: mix(t.greenComponent, b.greenComponent),
                       blue: mix(t.blueComponent, b.blueComponent), alpha: 1)
    }

    @MainActor static func contrast(_ first: NSColor, _ second: NSColor) -> Double {
        let luminance = { (color: NSColor) -> Double in
            let rgb = color.usingColorSpace(.sRGB) ?? color
            let linear = [rgb.redComponent, rgb.greenComponent, rgb.blueComponent].map {
                Double($0) <= 0.04045 ? Double($0) / 12.92 : pow((Double($0) + 0.055) / 1.055, 2.4)
            }
            return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
        }
        let (x, y) = (luminance(first), luminance(second))
        return (max(x, y) + 0.05) / (min(x, y) + 0.05)
    }
}
