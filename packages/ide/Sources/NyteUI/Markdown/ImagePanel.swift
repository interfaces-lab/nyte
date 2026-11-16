import AppKit
import ImageIO

@MainActor
final class MarkdownImages {
    static let shared = MarkdownImages()

    enum State: Equatable {
        case loading
        case loaded(CGImage)
        case failed(String)
    }

    struct Decoded: @unchecked Sendable {
        let image: CGImage?
        let reason: String
    }

    static let byteBudget = 32 << 20
    nonisolated static let remoteLimit = 16 << 20
    static var allowsRemote = false

    private var images: [String: CGImage] = [:]
    private var failures: [String: String] = [:]
    private var order: [String] = []
    private var pending: [String: Task<Void, Never>] = [:]
    private(set) var bytes = 0
    private let watchers = NSHashTable<ImagePanel>.weakObjects()

    func watch(_ panel: ImagePanel) { watchers.add(panel) }
    func unwatch(_ panel: ImagePanel) { watchers.remove(panel) }

    func state(_ source: String, base: URL?, pixels: Int) -> State {
        let key = Self.key(source, base: base, pixels: pixels)
        if let image = images[key] {
            order.removeAll { $0 == key }
            order.append(key)
            return .loaded(image)
        }
        if let reason = failures[key] { return .failed(reason) }
        guard pending[key] == nil else { return .loading }
        guard let url = Self.resolve(source, base: base) else { return .failed("The image address isn’t valid.") }
        if url.scheme == "http" || url.scheme == "https", !Self.allowsRemote { return .failed("Remote images aren’t loaded.") }
        pending[key] = Task { @MainActor [weak self] in
            let decoded = await Task.detached(priority: .utility) { await Self.decode(url, pixels: pixels) }.value
            self?.finish(key, decoded)
        }
        return .loading
    }

    private func finish(_ key: String, _ decoded: Decoded) {
        pending[key] = nil
        if let image = decoded.image {
            images[key] = image
            order.append(key)
            bytes += image.bytesPerRow * image.height
            while bytes > Self.byteBudget, order.count > 1, let oldest = order.first, oldest != key {
                order.removeFirst()
                if let evicted = images.removeValue(forKey: oldest) { bytes -= evicted.bytesPerRow * evicted.height }
            }
        } else {
            failures[key] = decoded.reason
        }
        for panel in watchers.allObjects { panel.refresh() }
    }

    private static func key(_ source: String, base: URL?, pixels: Int) -> String {
        "\(pixels)\u{1}\(base?.path ?? "")\u{1}\(source)"
    }

    static func resolve(_ source: String, base: URL?) -> URL? {
        let trimmed = source.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        if let url = URL(string: trimmed), let scheme = url.scheme, ["http", "https", "file", "data"].contains(scheme) { return url }
        if trimmed.hasPrefix("/") || trimmed.hasPrefix("~") { return URL(fileURLWithPath: (trimmed as NSString).expandingTildeInPath) }
        return base.map { $0.appendingPathComponent(trimmed) }
    }

    nonisolated static let success = 200 ..< 300

    nonisolated static func decode(_ url: URL, pixels: Int) async -> Decoded {
        let data: Data
        if url.isFileURL || url.scheme == "data" {
            guard let read = try? Data(contentsOf: url, options: .mappedIfSafe) else { return Decoded(image: nil, reason: "The image file couldn’t be read.") }
            data = read
        } else {
            let session = URLSession(configuration: .ephemeral)
            defer { session.finishTasksAndInvalidate() }
            guard let (body, response) = try? await session.data(from: url),
                  let status = (response as? HTTPURLResponse)?.statusCode, success.contains(status), body.count <= remoteLimit
            else { return Decoded(image: nil, reason: "The image couldn’t be downloaded.") }
            data = body
        }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: pixels,
            kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceShouldCacheImmediately: true,
        ]
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
        else { return Decoded(image: nil, reason: "The file isn’t an image this Mac can show.") }
        return Decoded(image: image, reason: "")
    }
}

@MainActor
final class ImagePanel: NSView {
    static let aspect: CGFloat = 0.5625
    static let maxHeight: CGFloat = 240
    static let glyph = Glyph.md

    var onOpen: ((String) -> Void)?
    private(set) var source = ""
    private(set) var alt = ""
    private var base: URL?
    private(set) var state = MarkdownImages.State.loading

    static func height(width: CGFloat) -> CGFloat { min(maxHeight, (width * aspect).rounded()) }

    override var isFlipped: Bool { true }

    init() {
        super.init(frame: .zero)
        setAccessibilityElement(true)
        setAccessibilityRole(.image)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func show(source: String, alt: String, base: URL?) {
        guard source != self.source || alt != self.alt || base != self.base else { return }
        self.source = source
        self.alt = alt
        self.base = base
        setAccessibilityLabel(alt.isEmpty ? "Image" : alt)
        refresh()
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if window == nil { MarkdownImages.shared.unwatch(self) } else { MarkdownImages.shared.watch(self) }
    }

    func refresh() {
        let scale = window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2
        let pixels = Int((max(bounds.width, Self.height(width: bounds.width)) * scale).rounded(.up))
        guard pixels > 0, !source.isEmpty else { return }
        let next = MarkdownImages.shared.state(source, base: base, pixels: pixels)
        guard next != state else { return }
        state = next
        needsDisplay = true
    }

    override func setFrameSize(_ newSize: NSSize) {
        let grew = newSize.width > frame.width
        super.setFrameSize(newSize)
        if grew { refresh() }
    }

    override func draw(_ dirtyRect: NSRect) {
        guard case let .loaded(image) = state else { return drawPlaceholder() }
        let natural = CGSize(width: CGFloat(image.width), height: CGFloat(image.height))
        let fit = min(1, bounds.width / max(1, natural.width), bounds.height / max(1, natural.height))
        let size = CGSize(width: (natural.width * fit).rounded(), height: (natural.height * fit).rounded())
        let rect = NSRect(x: 0, y: 0, width: size.width, height: size.height)
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        context.saveGState()
        context.addPath(Shape.rounded(rect, radius: Radius.control).cgPath)
        context.clip()
        context.interpolationQuality = .high
        context.translateBy(x: rect.minX, y: rect.maxY)
        context.scaleBy(x: 1, y: -1)
        context.draw(image, in: CGRect(origin: .zero, size: rect.size))
        context.restoreGState()
    }

    private func drawPlaceholder() {
        Draw.fill(bounds, radius: Radius.control, color: Palette.bgMuted)
        Draw.ring(bounds, radius: Radius.control, color: Palette.strokeQuaternary)
        let note: String
        switch state {
        case let .failed(reason): note = reason
        default: note = ""
        }
        let lines = [alt.isEmpty ? "Image" : alt, note].filter { !$0.isEmpty }
        let symbol = Symbol.image(state == .loading ? "photo" : "photo.badge.exclamationmark", glyph: Self.glyph)
        let lineHeight = TextStyle.sm.lineHeight
        let total = Self.glyph.rawValue + Space.x2 + CGFloat(lines.count) * lineHeight
        var y = ((bounds.height - total) / 2).rounded()
        if let symbol {
            Draw.glyph(symbol, centeredIn: NSRect(x: 0, y: y, width: bounds.width, height: Self.glyph.rawValue), ink: Palette.contentTertiary)
        }
        y += Self.glyph.rawValue + Space.x2
        for (index, line) in lines.enumerated() {
            Draw.text(line, in: NSRect(x: Space.x3, y: y, width: max(0, bounds.width - Space.x3 * 2), height: lineHeight), style: .sm,
                      ink: index == 0 ? Palette.contentSecondary : Palette.contentTertiary, alignment: .center)
            y += lineHeight
        }
    }

    override func mouseUp(with event: NSEvent) {
        guard !source.isEmpty else { return }
        onOpen?(source)
    }

    override func accessibilityPerformPress() -> Bool {
        onOpen?(source)
        return true
    }
}
