import AppKit

@MainActor
public enum Prose {
    public nonisolated static let blockPadding = Space.x25
    public static let paragraphGap = Space.x3

    public static func render(_ markdown: String, body: TextStyle = .prose,
                              color: NSColor = Palette.contentPrimary) -> NSAttributedString {
        let document = MarkdownDocument.parse(markdown)
        let builder = MarkdownText(document: document, style: MarkdownStyle(body: body, ink: color), mode: .prose)
        var places: [NSRange] = []
        let text = builder.build(from: 0, places: &places, offset: 0)
        guard document.kinds.first == .code else { return text }
        let out = NSMutableAttributedString(attributedString: spacer())
        out.append(NSAttributedString(string: "\n"))
        out.append(text)
        return out
    }

    public static func code(_ text: String, diff: Bool) -> NSAttributedString {
        let lines = text.components(separatedBy: "\n")
        let shown = diff ? Array(lines.drop(while: { !$0.hasPrefix("@@") })) : lines
        let body = NSMutableAttributedString(attributedString: lined(shown, diff: diff, ink: Palette.contentPrimary))
        body.addAttributes([.paragraphStyle: codeParagraph(indent: 0), .nyteCodeBlock: 1],
                           range: NSRange(location: 0, length: body.length))
        let out = NSMutableAttributedString(attributedString: spacer())
        out.append(NSAttributedString(string: "\n"))
        out.append(body)
        return out
    }

    public static func plain(_ text: String, style: TextStyle, color: NSColor) -> NSAttributedString {
        NSAttributedString(string: text, attributes: style.attributes(color))
    }

    static func lined(_ shown: [String], diff: Bool, ink: NSColor) -> NSAttributedString {
        let out = NSMutableAttributedString()
        for (index, line) in shown.enumerated() {
            let color = diff ? CodeInk.diff(line) ?? ink : ink
            if index > 0 { out.append(NSAttributedString(string: "\u{2028}", attributes: TextStyle.code.attributes(color))) }
            out.append(NSAttributedString(string: line, attributes: TextStyle.code.attributes(color)))
        }
        return out
    }

    static func codeParagraph(indent: CGFloat) -> NSMutableParagraphStyle {
        let style = TextStyle.code.paragraph(lineBreak: .byCharWrapping).mutableCopy() as? NSMutableParagraphStyle
            ?? NSMutableParagraphStyle()
        style.headIndent = indent + blockPadding
        style.firstLineHeadIndent = indent + blockPadding
        style.tailIndent = -blockPadding
        style.paragraphSpacingBefore = blockPadding
        style.paragraphSpacing = blockPadding + paragraphGap
        return style
    }

    private static func spacer() -> NSAttributedString {
        let style = NSMutableParagraphStyle()
        style.minimumLineHeight = Metric.hairline
        style.maximumLineHeight = Metric.hairline
        return NSAttributedString(string: "\u{200B}", attributes: [.font: TextStyle.code.font(), .paragraphStyle: style])
    }
}

enum CodeInk {
    static func diff(_ line: String) -> NSColor? {
        switch line.first {
        case "+": Palette.successInk
        case "-": Palette.dangerInk
        case "@": Palette.contentTertiary
        default: nil
        }
    }
}

public final class ProseLayoutManager: NSLayoutManager {
    override public func drawBackground(forGlyphRange glyphsToShow: NSRange, at origin: NSPoint) {
        super.drawBackground(forGlyphRange: glyphsToShow, at: origin)
        decorate(glyphsToShow, at: origin)
    }

    private func decorate(_ glyphsToShow: NSRange, at origin: NSPoint) {
        guard let storage = textStorage, let container = textContainers.first else { return }
        let characters = characterRange(forGlyphRange: glyphsToShow, actualGlyphRange: nil)
        storage.enumerateAttribute(.nyteCodeBlock, in: characters) { value, range, _ in
            guard value != nil else { return }
            let rect = blockRect(range, container: container).offsetBy(dx: origin.x, dy: origin.y)
            Palette.bgMuted.setFill()
            Shape.rounded(rect, radius: Radius.control).fill()
            Palette.strokeQuaternary.setStroke()
            Shape.ring(rect, radius: Radius.control).stroke()
        }
        drawQuotes(in: characters, storage: storage, container: container, origin: origin)
        storage.enumerateAttribute(.nyteRule, in: characters) { value, range, _ in
            guard value != nil else { return }
            let glyphs = glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            guard glyphs.length > 0 else { return }
            let line = lineFragmentUsedRect(forGlyphAt: glyphs.location, effectiveRange: nil)
            let indent = (storage.attribute(.paragraphStyle, at: range.location, effectiveRange: nil) as? NSParagraphStyle)?
                .firstLineHeadIndent ?? 0
            Palette.strokeQuaternary.setFill()
            NSRect(x: origin.x + indent, y: (origin.y + line.midY - Metric.hairline / 2).rounded(),
                   width: container.size.width - indent, height: Metric.hairline).fill()
        }
        storage.enumerateAttribute(.nyteInlineCode, in: characters) { value, range, _ in
            guard value != nil else { return }
            let glyphs = glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            enumerateLineFragments(forGlyphRange: glyphs) { _, _, _, line, _ in
                let piece = NSIntersectionRange(line, glyphs)
                guard piece.length > 0 else { return }
                let rect = self.boundingRect(forGlyphRange: piece, in: container)
                let inset = max(0, (rect.height - TextStyle.code.lineHeight) / 2)
                let chip = NSRect(x: rect.minX - MarkdownStyle.chipPadding, y: rect.minY + inset,
                                  width: rect.width + MarkdownStyle.chipPadding, height: rect.height - inset * 2)
                Palette.bgMutedTranslucent.setFill()
                Shape.rounded(chip.offsetBy(dx: origin.x, dy: origin.y), radius: Radius.indicator).fill()
            }
        }
    }

    private func drawQuotes(in characters: NSRange, storage: NSTextStorage, container: NSTextContainer, origin: NSPoint) {
        var runs: [(range: NSRange, depth: Int, alert: Int)] = []
        storage.enumerateAttribute(.nyteQuote, in: characters) { value, range, _ in
            guard let value = value as? Int else { return }
            runs.append((range, value / MarkdownStyle.depthStride, value % MarkdownStyle.depthStride))
        }
        guard let deepest = runs.map(\.depth).max() else { return }
        for level in 1 ... max(1, deepest) {
            var segment: NSRange?
            var alert = 0
            func flush() {
                guard let range = segment else { return }
                drawBar(range, level: level, alert: alert, container: container, origin: origin)
                segment = nil
            }
            for run in runs {
                guard run.depth >= level else {
                    flush()
                    continue
                }
                if let current = segment, NSMaxRange(current) >= run.range.location {
                    segment = NSUnionRange(current, run.range)
                } else {
                    flush()
                    segment = run.range
                    alert = level == 1 ? run.alert : 0
                }
            }
            flush()
        }
    }

    private func drawBar(_ range: NSRange, level: Int, alert: Int, container: NSTextContainer, origin: NSPoint) {
        let glyphs = glyphRange(forCharacterRange: range, actualCharacterRange: nil)
        guard glyphs.length > 0 else { return }
        var top = CGFloat.greatestFiniteMagnitude
        var bottom: CGFloat = 0
        enumerateLineFragments(forGlyphRange: glyphs) { _, used, _, _, _ in
            top = min(top, used.minY)
            bottom = max(bottom, used.maxY)
        }
        guard top < bottom else { return }
        let tone = MarkdownDocument.Alert(rawValue: UInt8(clamping: alert)) ?? .none
        let color = tone == .none ? Palette.strokeTertiary : Palette.color(.strokeAccent, in: MarkdownStyle.alertHue(tone))
        let x = origin.x + CGFloat(level - 1) * MarkdownStyle.quoteIndent
        color.setFill()
        Shape.rounded(NSRect(x: x, y: origin.y + top, width: MarkdownStyle.quoteBar, height: bottom - top),
                      radius: MarkdownStyle.quoteBar / 2).fill()
    }

    public func blockRect(_ range: NSRange, container: NSTextContainer) -> NSRect {
        let glyphs = glyphRange(forCharacterRange: range, actualCharacterRange: nil)
        var top = CGFloat.greatestFiniteMagnitude
        var bottom: CGFloat = 0
        var left = container.size.width
        enumerateLineFragments(forGlyphRange: glyphs) { _, used, _, _, _ in
            top = min(top, used.minY)
            bottom = max(bottom, used.maxY)
        }
        if let storage = textStorage, range.location < storage.length,
           let style = storage.attribute(.paragraphStyle, at: range.location, effectiveRange: nil) as? NSParagraphStyle {
            left = max(0, style.firstLineHeadIndent - Prose.blockPadding)
        } else {
            left = 0
        }
        guard top <= bottom else { return .zero }
        return NSRect(x: left, y: top - Prose.blockPadding, width: container.size.width - left,
                      height: bottom - top + Prose.blockPadding * 2)
    }
}

@MainActor
public final class ProseMeasure {
    public static let shared = ProseMeasure()
    private let storage = NSTextStorage()
    private let layout = ProseLayoutManager()
    private let container = NSTextContainer(size: .zero)

    private init() {
        container.lineFragmentPadding = 0
        layout.addTextContainer(container)
        storage.addLayoutManager(layout)
    }

    public func height(_ text: NSAttributedString, width: CGFloat) -> CGFloat {
        guard text.length > 0 else { return 0 }
        storage.setAttributedString(text)
        container.size = NSSize(width: max(1, width), height: .greatestFiniteMagnitude)
        layout.ensureLayout(for: container)
        var used = layout.usedRect(for: container)
        storage.enumerateAttribute(.nyteCodeBlock, in: NSRange(location: 0, length: storage.length)) { value, range, _ in
            guard value != nil else { return }
            used = used.union(layout.blockRect(range, container: container))
        }
        return ceil(used.maxY)
    }
}
