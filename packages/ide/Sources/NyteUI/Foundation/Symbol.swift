import AppKit

public enum Symbol {
    @MainActor public static func image(_ name: String, glyph: Glyph, weight: NSFont.Weight = .regular) -> NSImage? {
        image(name, size: glyph.pointSize, weight: weight)
    }

    @MainActor public static func image(_ name: String, size: CGFloat = Glyph.md.pointSize, weight: NSFont.Weight = .regular) -> NSImage? {
        let key = Key(name: name, size: size, weight: weight.rawValue)
        if let cached = cache[key] { return cached }
        let image = NSImage(systemSymbolName: name, accessibilityDescription: nil)?
            .withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: size, weight: weight))
        cache[key] = image
        return image
    }

    private struct Key: Hashable {
        let name: String
        let size: CGFloat
        let weight: CGFloat
    }

    @MainActor private static var cache: [Key: NSImage] = [:]
}
