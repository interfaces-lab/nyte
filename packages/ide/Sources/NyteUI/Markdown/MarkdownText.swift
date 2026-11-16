import AppKit

public extension NSAttributedString.Key {
    static let nyteInlineCode = NSAttributedString.Key("NyteInlineCode")
    static let nyteCodeBlock = NSAttributedString.Key("NyteCodeBlock")
    static let nyteQuote = NSAttributedString.Key("NyteQuote")
    static let nyteRule = NSAttributedString.Key("NyteRule")
}

public struct MarkdownStyle: Sendable {
    public enum CodeLines: Sendable, Equatable { case scroll, wrap }

    public let body: TextStyle
    public let ink: NSColor
    public let code: CodeLines

    public static let quoteIndent = Space.x4
    public static let quoteBar = Space.x05
    public static let markerGap = Space.x15
    public static let chipPadding = Space.x1
    public static let ruleHeight = Space.x1
    public static let alertGlyph = Glyph.sm
    static let depthStride = 8

    public init(body: TextStyle, ink: NSColor, code: CodeLines? = nil) {
        self.body = body
        self.ink = ink
        self.code = code ?? (body.size >= TextStyle.prose.size ? .scroll : .wrap)
    }

    func matches(_ other: MarkdownStyle) -> Bool { body == other.body && ink == other.ink && code == other.code }

    var roomy: Bool { body.size >= TextStyle.prose.size }
    public var gap: CGFloat { roomy ? Space.x4 : Space.x3 }
    var itemGap: CGFloat { roomy ? Space.x2 : Space.x1 }
    var indent: CGFloat { roomy ? Space.x6 : Space.x5 }
    var headingBefore: CGFloat { roomy ? Space.x6 : Space.x4 }
    var headingAfter: CGFloat { roomy ? Space.x2 : Space.x1 }
    var quoteInk: NSColor { ink == Palette.contentPrimary ? Palette.contentSecondary : ink }

    func heading(_ level: Int32) -> TextStyle {
        let steps: [TextStyle] = roomy ? [.xxl, .xl, .lg] : [.lg]
        let index = Int(level) - 1
        return steps.indices.contains(index) ? steps[index] : body
    }

    static func alertHue(_ alert: MarkdownDocument.Alert) -> Hue {
        switch alert {
        case .none, .note: .blue
        case .tip: .green
        case .important: .purple
        case .warning: .yellow
        case .caution: .red
        }
    }

    static func alertSymbol(_ alert: MarkdownDocument.Alert) -> String {
        switch alert {
        case .none, .note: "info.circle"
        case .tip: "lightbulb"
        case .important: "exclamationmark.bubble"
        case .warning: "exclamationmark.triangle"
        case .caution: "exclamationmark.octagon"
        }
    }
}

@MainActor
struct MarkdownText {
    enum Mode {
        case flow(block: (Int, CGFloat) -> NSTextAttachment)
        case prose
    }

    let document: MarkdownDocument
    let style: MarkdownStyle
    let mode: Mode

    private static let objectReplacement = "\u{FFFC}"
    private static let zeroWidth = "\u{200B}"

    func build(from first: Int, places: inout [NSRange], offset: Int) -> NSAttributedString {
        let out = NSMutableAttributedString()
        var columns: [Int: [CGFloat]] = [:]
        places.removeSubrange(min(first, places.count)...)
        for leaf in first ..< document.count {
            let top = document.owners[leaf]
            if columns[top] == nil { columns[top] = Self.markerColumns(document, top: top, style: style) }
            if leaf > 0 {
                out.append(NSAttributedString(string: "\n", attributes: separator(leaf)))
            }
            let start = out.length
            out.append(content(leaf, columns: columns[top] ?? []))
            places.append(NSRange(location: offset + start, length: out.length - start))
        }
        return out
    }

    private func separator(_ leaf: Int) -> [NSAttributedString.Key: Any] {
        var attributes = style.body.attributes(style.ink)
        let previous = leaf - 1
        if document.quotes[leaf] > 0, document.quotes[previous] > 0, document.owners[leaf] == document.owners[previous] {
            attributes[.nyteQuote] = quoteValue(depth: min(document.quotes[leaf], document.quotes[previous]),
                                                alert: document.alerts[leaf])
        }
        return attributes
    }

    private func quoteValue(depth: UInt8, alert: MarkdownDocument.Alert) -> Int {
        Int(depth) * MarkdownStyle.depthStride + Int(alert.rawValue)
    }

    private func content(_ leaf: Int, columns: [CGFloat]) -> NSAttributedString {
        let geometry = indents(leaf, columns: columns)
        let before = spacing(before: leaf)
        let out: NSMutableAttributedString
        switch document.kinds[leaf] {
        case .paragraph:
            out = inline(leaf, text: style.body, weight: .regular)
            prefixMarker(leaf, into: out, geometry: geometry)
            out.addAttribute(.paragraphStyle, value: textParagraph(style.body, geometry, before: before, leaf: leaf),
                             range: NSRange(location: 0, length: out.length))
        case .heading:
            let text = style.heading(document.values[leaf])
            out = inline(leaf, text: text, weight: .semibold)
            prefixMarker(leaf, into: out, geometry: geometry)
            out.addAttribute(.paragraphStyle, value: textParagraph(text, geometry, before: before, leaf: leaf),
                             range: NSRange(location: 0, length: out.length))
        case .alertTitle:
            out = alertTitle(leaf)
            out.addAttribute(.paragraphStyle, value: textParagraph(style.body, geometry, before: before, leaf: leaf),
                             range: NSRange(location: 0, length: out.length))
        case .rule:
            out = NSMutableAttributedString(string: Self.zeroWidth, attributes: [.font: style.body.font(), .nyteRule: true])
            let paragraph = NSMutableParagraphStyle()
            paragraph.minimumLineHeight = MarkdownStyle.ruleHeight
            paragraph.maximumLineHeight = MarkdownStyle.ruleHeight
            paragraph.firstLineHeadIndent = geometry.text
            paragraph.headIndent = geometry.text
            paragraph.paragraphSpacingBefore = before
            out.addAttribute(.paragraphStyle, value: paragraph, range: NSRange(location: 0, length: out.length))
        case .code, .table, .image:
            out = block(leaf, geometry: geometry, before: before)
        }
        if document.quotes[leaf] > 0 {
            out.addAttribute(.nyteQuote, value: quoteValue(depth: document.quotes[leaf], alert: document.alerts[leaf]),
                             range: NSRange(location: 0, length: out.length))
        }
        return out
    }

    private func block(_ leaf: Int, geometry: Geometry, before: CGFloat) -> NSMutableAttributedString {
        switch mode {
        case let .flow(make):
            let font = TextStyle.code.font()
            let out = NSMutableAttributedString(string: Self.objectReplacement, attributes: [
                .attachment: make(leaf, geometry.text), .font: font, .foregroundColor: style.ink,
            ])
            let paragraph = NSMutableParagraphStyle()
            paragraph.firstLineHeadIndent = geometry.text
            paragraph.headIndent = geometry.text
            paragraph.paragraphSpacingBefore = before
            paragraph.lineBreakMode = .byClipping
            out.addAttribute(.paragraphStyle, value: paragraph, range: NSRange(location: 0, length: out.length))
            return out
        case .prose:
            switch document.kinds[leaf] {
            case .table:
                return MarkdownTable.attributed(document, leaf: leaf, style: style, indent: geometry.text, before: before)
            case .image:
                let out = MarkdownInline.attributed(document, range: document.ranges[leaf], spans: document.spanRuns[leaf],
                                                    text: style.body, weight: .regular, ink: Palette.contentSecondary)
                out.addAttribute(.paragraphStyle, value: textParagraph(style.body, geometry, before: before, leaf: leaf),
                                 range: NSRange(location: 0, length: out.length))
                return out
            default:
                let code = document.string(document.ranges[leaf])
                let diff = document.language(leaf) == "diff"
                let out = NSMutableAttributedString(attributedString: Prose.lined(code.components(separatedBy: "\n"), diff: diff, ink: style.ink))
                if CodePanel.highlights(code, language: document.language(leaf)) {
                    CodePanel.colorize(out, with: CodeColors.ranges(in: code, language: document.language(leaf)))
                }
                let paragraph = Prose.codeParagraph(indent: geometry.text)
                paragraph.paragraphSpacingBefore = before + Prose.blockPadding
                paragraph.paragraphSpacing = Prose.blockPadding
                out.addAttributes([.paragraphStyle: paragraph, .nyteCodeBlock: leaf + 1], range: NSRange(location: 0, length: out.length))
                return out
            }
        }
    }

    private func alertTitle(_ leaf: Int) -> NSMutableAttributedString {
        let alert = MarkdownDocument.Alert(rawValue: UInt8(clamping: document.values[leaf])) ?? .note
        let ink = Palette.color(.contentAccent, in: MarkdownStyle.alertHue(alert))
        let attributes = style.body.attributes(ink, weight: .medium)
        let out = NSMutableAttributedString()
        if let font = attributes[.font] as? NSFont {
            let attachment = NSTextAttachment()
            attachment.attachmentCell = GlyphCell(symbol: MarkdownStyle.alertSymbol(alert), ink: ink, font: font)
            var glyph = attributes
            glyph[.attachment] = attachment
            out.append(NSAttributedString(string: Self.objectReplacement, attributes: glyph))
        }
        out.append(NSAttributedString(string: "\t" + document.string(document.ranges[leaf]), attributes: attributes))
        return out
    }

    private func prefixMarker(_ leaf: Int, into out: NSMutableAttributedString, geometry: Geometry) {
        guard document.flags[leaf].contains(.itemStart) else { return }
        let marker = NSMutableAttributedString(string: "\t", attributes: style.body.attributes(style.ink))
        switch document.markers[leaf] {
        case .none:
            return
        case .bullet:
            marker.append(NSAttributedString(string: "\u{2022}", attributes: style.body.attributes(Palette.contentTertiary)))
        case .number:
            var attributes = style.body.attributes(Palette.contentSecondary)
            attributes[.font] = style.body.tabularFont()
            marker.append(NSAttributedString(string: "\(document.values[leaf]).", attributes: attributes))
        case .open, .done:
            let attachment = NSTextAttachment()
            attachment.attachmentCell = CheckCell(done: document.markers[leaf] == .done, font: style.body.font())
            var attributes = style.body.attributes(style.ink)
            attributes[.attachment] = attachment
            marker.append(NSAttributedString(string: Self.objectReplacement, attributes: attributes))
        }
        marker.append(NSAttributedString(string: "\t", attributes: style.body.attributes(style.ink)))
        out.insert(marker, at: 0)
    }

    struct Geometry {
        var first: CGFloat
        var text: CGFloat
        var marker: CGFloat
    }

    private func indents(_ leaf: Int, columns: [CGFloat]) -> Geometry {
        let quote = CGFloat(document.quotes[leaf]) * MarkdownStyle.quoteIndent
        let depth = Int(document.lists[leaf])
        guard depth > 0 else { return Geometry(first: quote, text: quote, marker: quote) }
        let lead = quote + columns.prefix(depth - 1).reduce(0, +)
        let column = depth - 1 < columns.count ? columns[depth - 1] : style.indent
        let text = lead + column
        let first = document.flags[leaf].contains(.itemStart) ? lead : text
        return Geometry(first: first, text: text, marker: text - MarkdownStyle.markerGap)
    }

    static func markerColumns(_ document: MarkdownDocument, top: Int, style: MarkdownStyle) -> [CGFloat] {
        guard top < document.topLeaves.count else { return [] }
        let range = document.topLeaves[top]
        var columns: [CGFloat] = []
        let font = style.body.tabularFont()
        for leaf in range where document.markers[leaf] == .number {
            let depth = Int(document.lists[leaf])
            while columns.count < depth { columns.append(style.indent) }
            let width = ("\(document.values[leaf])." as NSString).size(withAttributes: [.font: font]).width.rounded(.up)
            columns[depth - 1] = max(columns[depth - 1], width + MarkdownStyle.markerGap)
        }
        let deepest = range.map { Int(document.lists[$0]) }.max() ?? 0
        while columns.count < deepest { columns.append(style.indent) }
        return columns
    }

    private func spacing(before leaf: Int) -> CGFloat {
        guard leaf > 0 else { return 0 }
        let previous = leaf - 1
        let sameTop = document.owners[leaf] == document.owners[previous]
        if document.kinds[leaf] == .heading { return document.values[leaf] <= 2 ? style.headingBefore : style.gap }
        if document.kinds[previous] == .heading { return style.headingAfter }
        if document.kinds[previous] == .alertTitle { return Space.x1 }
        if sameTop, document.lists[leaf] > 0, document.lists[previous] > 0 { return style.itemGap }
        return style.gap
    }

    private func textParagraph(_ text: TextStyle, _ geometry: Geometry, before: CGFloat, leaf: Int) -> NSParagraphStyle {
        let paragraph = text.paragraph().mutableCopy() as? NSMutableParagraphStyle ?? NSMutableParagraphStyle()
        paragraph.firstLineHeadIndent = geometry.first
        paragraph.headIndent = geometry.text
        paragraph.paragraphSpacingBefore = before
        if document.kinds[leaf] == .alertTitle {
            let lead = geometry.text + MarkdownStyle.alertGlyph.rawValue + Space.x15
            paragraph.tabStops = [NSTextTab(textAlignment: .left, location: lead)]
            paragraph.headIndent = lead
        } else if document.flags[leaf].contains(.itemStart), document.markers[leaf] != .none {
            paragraph.tabStops = [
                NSTextTab(textAlignment: .right, location: geometry.marker),
                NSTextTab(textAlignment: .left, location: geometry.text),
            ]
        } else if document.lists[leaf] == 0, document.quotes[leaf] == 0, MarkdownDirection.isRightToLeft(document.text[document.ranges[leaf]]) {
            paragraph.baseWritingDirection = .rightToLeft
            paragraph.alignment = .right
        }
        return paragraph
    }

    func inline(_ leaf: Int, text: TextStyle, weight: NSFont.Weight) -> NSMutableAttributedString {
        let ink = document.quotes[leaf] > 0 && document.alerts[leaf] == .none ? style.quoteInk : style.ink
        return MarkdownInline.attributed(document, range: document.ranges[leaf], spans: document.spanRuns[leaf],
                                         text: text, weight: weight, ink: ink)
    }
}

@MainActor
enum MarkdownInline {
    struct Traits: OptionSet, Hashable {
        let rawValue: UInt8
        static let strong = Traits(rawValue: 1 << 0)
        static let emphasis = Traits(rawValue: 1 << 1)
        static let strike = Traits(rawValue: 1 << 2)
        static let code = Traits(rawValue: 1 << 3)
        static let image = Traits(rawValue: 1 << 4)
    }

    private struct FontKey: Hashable {
        let size: CGFloat
        let weight: CGFloat
        let traits: Traits
    }

    private static var fonts: [FontKey: NSFont] = [:]
    static let lead = "\u{2060}"

    static func attributed(_ document: MarkdownDocument, range: Range<Int>, spans: Range<Int>, text: TextStyle,
                           weight: NSFont.Weight, ink: NSColor) -> NSMutableAttributedString
    {
        let units = Array(document.text[range])
        let string = NSString(characters: units, length: units.count) as String
        let base = text.attributes(ink, weight: weight)
        let out = NSMutableAttributedString(string: string, attributes: base)
        guard !spans.isEmpty else { return out }
        var traits = [Traits](repeating: [], count: units.count)
        var links: [(NSRange, String)] = []
        for span in spans {
            let local = document.spanRanges[span].clamped(to: range)
            let start = local.lowerBound - range.lowerBound
            let end = local.upperBound - range.lowerBound
            guard start < end else { continue }
            let trait: Traits = switch document.spanKinds[span] {
            case .strong: .strong
            case .emphasis: .emphasis
            case .strike: .strike
            case .code: .code
            case .image: .image
            case .link: []
            }
            for index in start ..< end { traits[index].insert(trait) }
            let nsRange = NSRange(location: start, length: end - start)
            if document.spanKinds[span] == .link {
                links.append((nsRange, document.sideString(document.spanTargets[span])))
            } else if document.spanKinds[span] == .code, let target = MarkdownLinks.fileTarget(document.string(local)) {
                links.append((nsRange, target))
            }
        }
        var index = 0
        while index < traits.count {
            let trait = traits[index]
            var end = index + 1
            while end < traits.count, traits[end] == trait { end += 1 }
            if !trait.isEmpty {
                let run = NSRange(location: index, length: end - index)
                var attributes: [NSAttributedString.Key: Any] = [.font: font(text, weight: weight, traits: trait)]
                if trait.contains(.strike) {
                    attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
                }
                if trait.contains(.image) { attributes[.foregroundColor] = Palette.contentSecondary }
                if trait.contains(.code) {
                    attributes[.nyteInlineCode] = true
                    attributes[.kern] = MarkdownStyle.chipPadding
                    out.addAttributes(attributes, range: run)
                    out.addAttribute(.kern, value: 0, range: run)
                    out.addAttribute(.kern, value: MarkdownStyle.chipPadding, range: NSRange(location: end - 1, length: 1))
                    if index > 0 {
                        out.addAttribute(.kern, value: MarkdownStyle.chipPadding, range: NSRange(location: index - 1, length: 1))
                    }
                } else {
                    out.addAttributes(attributes, range: run)
                }
            }
            index = end
        }
        for (range, target) in links { out.addAttributes([.link: target, .foregroundColor: Palette.accentInk], range: range) }
        if traits.first?.contains(.code) == true {
            var lead = base
            lead[.kern] = MarkdownStyle.chipPadding
            out.insert(NSAttributedString(string: MarkdownInline.lead, attributes: lead), at: 0)
        }
        return out
    }

    static func font(_ text: TextStyle, weight: NSFont.Weight, traits: Traits) -> NSFont {
        let key = FontKey(size: text.size, weight: weight.rawValue, traits: traits.intersection([.strong, .emphasis, .code]))
        if let known = fonts[key] { return known }
        var font: NSFont
        if traits.contains(.code) {
            font = TextStyle.code.font(traits.contains(.strong) ? .semibold : .regular)
        } else {
            font = text.font(traits.contains(.strong) ? .semibold : weight)
        }
        if traits.contains(.emphasis) {
            font = NSFont(descriptor: font.fontDescriptor.withSymbolicTraits(.italic), size: font.pointSize) ?? font
        }
        fonts[key] = font
        return font
    }
}

enum MarkdownLinks {
    private static let extensions: Set<String> = [
        "swift", "ts", "tsx", "js", "jsx", "mjs", "cjs", "go", "rs", "py", "rb", "md", "mdx", "json", "yaml", "yml",
        "toml", "c", "h", "m", "mm", "cc", "cpp", "hpp", "java", "kt", "sh", "zsh", "css", "scss", "html", "txt",
        "sql", "lock", "xml", "plist", "proto", "graphql", "vue", "svelte", "lua", "zig", "ex", "exs", "cs", "php",
    ]
    private static let pathCharacters = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "/._-~@+"))

    static func fileTarget(_ text: String) -> String? {
        let parsed = file(text)
        guard parsed != nil else { return nil }
        return text
    }

    static func file(_ target: String) -> (path: String, line: Int?)? {
        var text = target
        if text.hasPrefix("file://") {
            guard let url = URL(string: text) else { return nil }
            return (url.path, nil)
        }
        guard !text.contains("://"), !text.hasPrefix("mailto:"), !text.isEmpty else { return nil }
        var line: Int?
        let parts = text.split(separator: ":", omittingEmptySubsequences: false)
        if parts.count >= 2, let number = Int(parts[1]) {
            line = number
            text = String(parts[0])
        } else if parts.count > 1 {
            return nil
        }
        guard text.unicodeScalars.allSatisfy(pathCharacters.contains) else { return nil }
        let name = text.split(separator: "/").last.map(String.init) ?? text
        let dot = name.lastIndex(of: ".")
        let ext = dot.map { String(name[name.index(after: $0)...]).lowercased() } ?? ""
        if text.contains("/") {
            guard !name.isEmpty, dot != nil || line != nil else { return nil }
            return (text, line)
        }
        guard extensions.contains(ext), name.count > ext.count + 1 else { return nil }
        return (text, line)
    }
}

final class CheckCell: NSTextAttachmentCell {
    private let done: Bool
    private let capHeight: CGFloat
    private nonisolated static let box = Glyph.sm.rawValue

    init(done: Bool, font: NSFont) {
        self.done = done
        capHeight = font.capHeight
        super.init(imageCell: nil)
    }

    @available(*, unavailable)
    required init(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func cellSize() -> NSSize { NSSize(width: Self.box, height: Self.box) }

    override func cellBaselineOffset() -> NSPoint { NSPoint(x: 0, y: ((capHeight - Self.box) / 2).rounded()) }

    override func draw(withFrame cellFrame: NSRect, in controlView: NSView?) {
        let box = cellFrame.integral
        MainActor.assumeIsolated { [done] in
            if done {
                Draw.fill(box, radius: Radius.indicator, color: Palette.bgControlSelected)
                if let check = Symbol.image("checkmark", glyph: .xxs, weight: .bold) {
                    Draw.glyph(check, centeredIn: box, ink: Palette.contentOnControl)
                }
            } else {
                Draw.ring(box, radius: Radius.indicator, color: Palette.strokePrimary, width: Metric.markStroke)
            }
        }
    }
}

final class GlyphCell: NSTextAttachmentCell {
    private let symbol: String
    private let ink: NSColor
    private let capHeight: CGFloat
    private nonisolated static let box = MarkdownStyle.alertGlyph.rawValue

    init(symbol: String, ink: NSColor, font: NSFont) {
        self.symbol = symbol
        self.ink = ink
        capHeight = font.capHeight
        super.init(imageCell: nil)
    }

    @available(*, unavailable)
    required init(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func cellSize() -> NSSize { NSSize(width: Self.box, height: Self.box) }

    override func cellBaselineOffset() -> NSPoint { NSPoint(x: 0, y: ((capHeight - Self.box) / 2).rounded()) }

    override func draw(withFrame cellFrame: NSRect, in controlView: NSView?) {
        MainActor.assumeIsolated { [symbol, ink] in
            guard let image = Symbol.image(symbol, glyph: MarkdownStyle.alertGlyph, weight: .medium) else { return }
            Draw.glyph(image, centeredIn: cellFrame, ink: ink)
        }
    }
}

enum MarkdownDirection {
    private static let hebrewToArabic: ClosedRange<UInt32> = 0x0590 ... 0x08FF
    private static let presentationForms: ClosedRange<UInt32> = 0xFB1D ... 0xFDFF
    private static let arabicFormsB: ClosedRange<UInt32> = 0xFE70 ... 0xFEFF
    private static let historic: ClosedRange<UInt32> = 0x10800 ... 0x10FFF
    private static let supplementary: ClosedRange<UInt32> = 0x1E800 ... 0x1EFFF
    private static let rightToLeft = [hebrewToArabic, presentationForms, arabicFormsB, historic, supplementary]

    static func isRightToLeft(_ units: ArraySlice<UInt16>) -> Bool {
        for scalar in String(decoding: units, as: UTF16.self).unicodeScalars where scalar.properties.isAlphabetic {
            return rightToLeft.contains { $0.contains(scalar.value) }
        }
        return false
    }
}
