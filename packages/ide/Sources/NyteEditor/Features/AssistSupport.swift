import AppKit
import NyteCore
import NyteUI

enum Identifier {
    private static let extra = Set("_$".utf16)

    static func isPart(_ unit: UInt16) -> Bool {
        if extra.contains(unit) { return true }
        guard let scalar = Unicode.Scalar(unit) else { return false }
        return CharacterSet.alphanumerics.contains(scalar)
    }

    static func isPart(_ text: String) -> Bool { !text.isEmpty && text.utf16.allSatisfy(isPart) }

    static func start(before offset: Int, in text: some UnitString) -> Int {
        var start = min(offset, text.length)
        while start > 0, isPart(text.character(at: start - 1)) { start -= 1 }
        return start
    }

    static func end(after offset: Int, in text: some UnitString) -> Int {
        var end = max(0, offset)
        while end < text.length, isPart(text.character(at: end)) { end += 1 }
        return end
    }

    static func range(at offset: Int, in text: some UnitString) -> NSRange? {
        guard offset >= 0, offset <= text.length else { return nil }
        let start = start(before: offset, in: text)
        let end = end(after: offset, in: text)
        guard end > start else { return nil }
        return NSRange(location: start, length: end - start)
    }
}

extension EditorViewController {
    var isAssisted: Bool {
        guard let url, textView.isEditable, let intelligence else { return false }
        return intelligence.handles(url)
    }

    var shownText: ShownText { textView.text }

    var caretRange: NSRange { textView.selectedRange() }

    var fenceLanguage: String {
        guard let document = shown else { return "" }
        let named = document.language.name.lowercased()
        return Language.detect(fence: named).family == .plain ? document.url.pathExtension.lowercased() : named
    }

    func caretRect(at offset: Int) -> NSRect? {
        rects(for: NSRange(location: min(offset, shownText.length), length: 0)).first
    }

    func symbolName(at offset: Int) -> String {
        guard let range = Identifier.range(at: offset, in: shownText) else { return "" }
        return shownText.substring(with: range)
    }
}

@MainActor
final class QuietNote {
    static let life = Duration.milliseconds(2400)

    private let panel = FloatingPanel(radius: Radius.control, presentation: .hover)
    private let view = DocumentationView()
    private var expiry: Task<Void, Never>?

    init() {
        panel.content = view
    }

    func show(_ message: String, at rect: NSRect, in host: NSView) {
        view.show(message: message)
        let anchor = NSRect(x: rect.minX - DocumentationView.inset, y: rect.minY, width: rect.width, height: rect.height)
        panel.show(size: view.fittingSize(), anchoredTo: anchor, in: host)
        expiry?.cancel()
        expiry = Task { [weak self] in
            try? await Task.sleep(for: Self.life)
            guard !Task.isCancelled else { return }
            self?.panel.dismiss()
        }
    }

    func dismiss() {
        expiry?.cancel()
        panel.dismiss()
    }
}
