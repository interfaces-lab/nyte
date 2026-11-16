import AppKit

public struct FileIcon: Equatable, Sendable {
    public let index: UInt8

    public init(index: UInt8) {
        self.index = index < FileIconData.names.count ? index : 0
    }

    public static let generic = FileIcon(index: 0)
    public static let size: CGFloat = 16

    public static func forFile(named name: String) -> FileIcon {
        let lower = name.lowercased()
        if let exact = FileIconData.byFileName[lower] { return FileIcon(index: exact) }
        var suffix = Substring(lower)
        while let dot = suffix.firstIndex(of: ".") {
            suffix = suffix[suffix.index(after: dot)...]
            if let match = FileIconData.byExtension[String(suffix)] { return FileIcon(index: match) }
        }
        return FileIconData.byExtension[lower].map(FileIcon.init(index:)) ?? generic
    }

    @MainActor public func image(dark: Bool) -> NSImage {
        let slot = Int(index) * 2 + (dark ? 1 : 0)
        if let cached = Self.images[slot] { return cached }
        let palette = dark ? FileIconData.dark : FileIconData.light
        let rgb = self == .generic ? Self.rgb(Palette.fileIconNeutral, dark: dark) : palette[Int(index)]
        let image = Self.render(FileIconData.markup[Int(index)], rgb: rgb)
        Self.images[slot] = image
        return image
    }

    @MainActor public func image(for appearance: NSAppearance) -> NSImage {
        image(dark: appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua)
    }

    @MainActor private static func rgb(_ role: NSColor, dark: Bool) -> UInt32 {
        var rgb: UInt32 = 0
        (NSAppearance(named: dark ? .darkAqua : .aqua) ?? NSAppearance.currentDrawing()).performAsCurrentDrawingAppearance {
            let resolved = role.usingColorSpace(.sRGB) ?? role
            rgb = UInt32((resolved.redComponent * byte).rounded()) << 16 | UInt32((resolved.greenComponent * byte).rounded()) << 8
                | UInt32((resolved.blueComponent * byte).rounded())
        }
        return rgb
    }

    @MainActor public static func chevron(_ ink: NSColor) -> NSImage {
        let resolved = ink.usingColorSpace(.sRGB) ?? ink
        let rgb = UInt32(resolved.redComponent * Self.byte) << 16 | UInt32(resolved.greenComponent * Self.byte) << 8
            | UInt32(resolved.blueComponent * Self.byte)
        if let cached = chevrons[rgb] { return cached }
        let image = render(FileIconData.chevron, rgb: rgb)
        chevrons[rgb] = image
        return image
    }

    private static let byte: CGFloat = 255

    private static let folderStroke = "fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linejoin=\"round\" stroke-linecap=\"round\""
    private static let closedFolder = "<path d=\"M1.9 4.4a1.5 1.5 0 0 1 1.5-1.5h2.7l1.5 1.5h4.9a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H3.4a1.5 1.5 0 0 1-1.5-1.5z\" \(folderStroke)/><path d=\"M1.9 6.6h12.2\" \(folderStroke)/>"
    private static let openFolder = "<path d=\"M1.9 11.6V4.4a1.5 1.5 0 0 1 1.5-1.5h2.7l1.5 1.5h4.4a1.5 1.5 0 0 1 1.5 1.5v1\" \(folderStroke)/><path d=\"M3.3 13.4h8.4a1.3 1.3 0 0 0 1.2-.8l1.7-4.4a.7.7 0 0 0-.7-1H5.3a1.3 1.3 0 0 0-1.2.8l-2.2 5.4z\" \(folderStroke)/>"
    @MainActor private static var folders: [Bool: NSImage] = [:]

    @MainActor public static func folder(open: Bool) -> NSImage {
        if let cached = folders[open] { return cached }
        let image = render(open ? openFolder : closedFolder, rgb: 0)
        folders[open] = image
        return image
    }

    @MainActor public static func folderLeading(open: Bool, ink: RowContent.Ink) -> RowContent.Leading {
        .tinted(folder(open: open), ink.color)
    }

    @MainActor private static var images = [NSImage?](repeating: nil, count: FileIconData.names.count * 2)
    @MainActor private static var chevrons: [UInt32: NSImage] = [:]

    private static func render(_ markup: String, rgb: UInt32) -> NSImage {
        let hex = String(format: "#%06X", rgb)
        let body = markup.replacingOccurrences(of: "currentColor", with: hex, options: .caseInsensitive)
        let document = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" viewBox=\"0 0 16 16\">\(body)</svg>"
        let image = NSImage(data: Data(document.utf8)) ?? NSImage(size: NSSize(width: size, height: size))
        image.size = NSSize(width: size, height: size)
        return image
    }
}
