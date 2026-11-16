import AppKit

@MainActor
public struct CodeRowMetrics {
    public let font: NSFont
    public let slanted: NSFont
    public let lineHeight: CGFloat
    public let baseline: CGFloat
    public let advance: CGFloat
    public let tabColumns: Int
    public let paragraph: NSParagraphStyle

    public init(style: TextStyle = .code, size: CGFloat? = nil, lineHeight: CGFloat? = nil, tabColumns: Int = Indent.defaultWidth,
                family: String? = nil) {
        let sized = size.map { style.font().withSize($0) } ?? style.font()
        let font = family.map { NSFontManager.shared.convert(sized, toFamily: $0) } ?? sized
        self.font = font
        let shear = AffineTransform(m11: 1, m12: 0, m21: -TextStyle.commentSlant, m22: 1, tX: 0, tY: 0)
        slanted = size == nil && family == nil ? style.slantedFont(flippedTextMatrix: true) : NSFont(descriptor: font.fontDescriptor, textTransform: shear) ?? font
        let height = max(lineHeight ?? style.lineHeight, ceil(font.ascender - font.descender))
        self.lineHeight = height
        baseline = ((height - (font.ascender - font.descender)) / 2 + font.ascender).rounded()
        advance = (" " as NSString).size(withAttributes: [.font: font]).width
        self.tabColumns = max(1, tabColumns)
        let paragraph = NSMutableParagraphStyle()
        paragraph.tabStops = []
        paragraph.defaultTabInterval = advance * CGFloat(self.tabColumns)
        self.paragraph = paragraph
    }

    public var attributes: [NSAttributedString.Key: Any] {
        [.font: font, .foregroundColor: Palette.contentPrimary, .paragraphStyle: paragraph]
    }
}

public struct InlineBox {
    public let column: Int
    public let width: CGFloat
    public let draw: @MainActor (CGRect) -> Void

    public init(column: Int, width: CGFloat, draw: @escaping @MainActor (CGRect) -> Void) {
        self.column = column
        self.width = width
        self.draw = draw
    }
}

public struct TrailingNote {
    public struct Segment {
        public let text: String
        public let color: SyntaxColor?

        public init(_ text: String, color: SyntaxColor? = nil) {
            self.text = text
            self.color = color
        }
    }

    public struct Placement: Equatable {
        public let x: CGFloat
        public let width: CGFloat
        public let isCut: Bool

        public init(x: CGFloat, width: CGFloat, isCut: Bool) {
            self.x = x
            self.width = width
            self.isCut = isCut
        }
    }

    public static let gap = Space.x3
    public static let cap: CGFloat = 160
    public static let smallest = Space.x4
    public static let separator = " · "

    public let segments: [Segment]
    public let ink: NSColor
    public let isUnderlined: Bool

    public init(_ segments: [Segment], ink: NSColor = Palette.contentTertiary, isUnderlined: Bool = false) {
        self.segments = segments
        self.ink = ink
        self.isUnderlined = isUnderlined
    }

    public static func place(after codeEnd: CGFloat, edge: CGFloat, widths: [CGFloat], separator: CGFloat) -> [Placement?] {
        var x = codeEnd + gap
        var placed: [Placement?] = []
        for (index, natural) in widths.enumerated() {
            if index > 0 { x += separator }
            let wanted = min(natural, cap)
            let room = edge - x
            guard room >= min(wanted, smallest) else { break }
            let width = min(wanted, room)
            placed.append(Placement(x: x, width: width, isCut: width < natural))
            if width < natural { break }
            x += width
        }
        return placed + Array(repeating: nil, count: widths.count - placed.count)
    }
}

@MainActor
public final class CodeRowLayout {
    static let replacement: unichar = 0xFFFC

    public let line: CTLine
    public let start: Int
    public let length: Int
    public let origin: CGFloat
    public let width: CGFloat
    public let boxes: [InlineBox]
    private let boxColumns: [Int]

    init(line: CTLine, start: Int, length: Int, origin: CGFloat, boxes: [InlineBox]) {
        self.line = line
        self.start = start
        self.length = length
        self.origin = origin
        self.boxes = boxes
        boxColumns = boxes.map(\.column)
        width = CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
    }

    public var end: CGFloat { origin + width }

    public func x(ofColumn column: Int) -> CGFloat {
        let local = min(max(0, column - start), length)
        let display = local + boxColumns.reduce(0) { $0 + ($1 < local + start ? 1 : 0) }
        return origin + CTLineGetOffsetForStringIndex(line, display, nil)
    }

    public func column(at x: CGFloat) -> Int {
        let display = CTLineGetStringIndexForPosition(line, CGPoint(x: x - origin, y: 0))
        guard display != kCFNotFound else { return start + length }
        var column = max(0, display)
        var passed = 0
        for box in boxColumns where box - start + passed < column {
            passed += 1
        }
        column -= passed
        return start + min(column, length)
    }

    public func boxRects(height: CGFloat) -> [(InlineBox, CGRect)] {
        boxes.enumerated().map { index, box in
            let x = origin + CTLineGetOffsetForStringIndex(line, box.column - start + index, nil)
            return (box, CGRect(x: x, y: 0, width: box.width, height: height))
        }
    }

    public func draw(at top: CGFloat, metrics: CodeRowMetrics, in context: CGContext) {
        context.saveGState()
        context.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
        context.textPosition = CGPoint(x: origin, y: top + metrics.baseline)
        CTLineDraw(line, context)
        context.restoreGState()
        for (box, rect) in boxRects(height: metrics.lineHeight) { box.draw(rect.offsetBy(dx: 0, dy: top)) }
    }
}

@MainActor
public enum CodeRowBuilder {
    private static let ellipsis = "…"

    public static func build(units: UnsafeBufferPointer<UInt16>, start: Int = 0, origin: CGFloat = 0, tokens: [UInt64], tokenBase: Int = 0,
                             runs: [(range: NSRange, color: NSColor)] = [], boxes: [InlineBox] = [],
                             metrics: CodeRowMetrics) -> CodeRowLayout {
        let text = NSMutableAttributedString(string: String(decoding: units, as: UTF16.self), attributes: [
            .font: metrics.font, .foregroundColor: Palette.contentPrimary, .paragraphStyle: metrics.paragraph,
        ])
        let whole = NSRange(location: 0, length: text.length)
        for token in tokens {
            let kind = Token.kind(token)
            guard kind != .plain else { continue }
            let raw = Token.range(token)
            let range = NSIntersectionRange(NSRange(location: raw.location - tokenBase - start, length: raw.length), whole)
            guard range.length > 0 else { continue }
            text.addAttribute(.foregroundColor, value: kind.color, range: range)
            if kind == .comment { text.addAttribute(.font, value: metrics.slanted, range: range) }
        }
        for run in runs {
            let range = NSIntersectionRange(NSRange(location: run.range.location - start, length: run.range.length), whole)
            if range.length > 0 { text.addAttribute(.foregroundColor, value: run.color, range: range) }
        }
        for box in boxes.reversed() where box.column >= start {
            guard let mark = placeholder(width: box.width, metrics: metrics) else { continue }
            text.insert(mark, at: min(box.column - start, text.length))
        }
        return CodeRowLayout(line: CTLineCreateWithAttributedString(text), start: start, length: units.count, origin: origin, boxes: boxes)
    }

    public static func drawNotes(_ notes: [TrailingNote], after layout: CodeRowLayout, top: CGFloat, visibleRight: CGFloat,
                                 metrics: CodeRowMetrics, in context: CGContext) {
        guard !notes.isEmpty else { return }
        let lines = notes.map { note in
            let text = NSMutableAttributedString()
            for segment in note.segments {
                text.append(NSAttributedString(string: segment.text, attributes: [
                    .font: metrics.font, .foregroundColor: segment.color?.color ?? note.ink,
                ]))
            }
            return CTLineCreateWithAttributedString(text)
        }
        let separator = plainLine(TrailingNote.separator, metrics: metrics)
        let separatorWidth = (TrailingNote.separator as NSString).size(withAttributes: [.font: metrics.font]).width
        let placed = placeNotes(notes, after: layout, visibleRight: visibleRight, metrics: metrics)
        let token = plainLine(ellipsis, metrics: metrics)
        context.saveGState()
        context.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
        for (index, placement) in placed.enumerated() {
            guard let placement else { break }
            if index > 0 {
                context.textPosition = CGPoint(x: placement.x - separatorWidth, y: top + metrics.baseline)
                CTLineDraw(separator, context)
            }
            let line = placement.isCut ? CTLineCreateTruncatedLine(lines[index], Double(placement.width), .end, token) : lines[index]
            guard let line else { continue }
            context.textPosition = CGPoint(x: placement.x, y: top + metrics.baseline)
            CTLineDraw(line, context)
            guard notes[index].isUnderlined else { continue }
            context.setFillColor(notes[index].ink.cgColor)
            context.fill(CGRect(x: placement.x, y: top + metrics.baseline - metrics.font.underlinePosition, width: placement.width,
                                height: max(Metric.hairline, metrics.font.underlineThickness)))
        }
        context.restoreGState()
    }

    public static func placeNotes(_ notes: [TrailingNote], after layout: CodeRowLayout, visibleRight: CGFloat,
                                  metrics: CodeRowMetrics) -> [TrailingNote.Placement?] {
        let widths = notes.map { note in
            ceil(note.segments.reduce(CGFloat(0)) { $0 + (($1.text as NSString).size(withAttributes: [.font: metrics.font]).width) })
        }
        let separator = (TrailingNote.separator as NSString).size(withAttributes: [.font: metrics.font]).width
        return TrailingNote.place(after: layout.end, edge: visibleRight, widths: widths, separator: separator)
    }

    private static func plainLine(_ text: String, metrics: CodeRowMetrics) -> CTLine {
        CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: [
            .font: metrics.font, .foregroundColor: Palette.contentTertiary,
        ]))
    }

    private static func placeholder(width: CGFloat, metrics: CodeRowMetrics) -> NSAttributedString? {
        let stored = UnsafeMutablePointer<CGFloat>.allocate(capacity: 1)
        stored.initialize(to: width)
        var callbacks = CTRunDelegateCallbacks(version: kCTRunDelegateVersion1, dealloc: { $0.deallocate() },
                                               getAscent: { _ in 0 }, getDescent: { _ in 0 },
                                               getWidth: { $0.assumingMemoryBound(to: CGFloat.self).pointee })
        guard let delegate = CTRunDelegateCreate(&callbacks, stored) else {
            stored.deallocate()
            return nil
        }
        return NSAttributedString(string: String(utf16CodeUnits: [CodeRowLayout.replacement], count: 1), attributes: [
            .font: metrics.font, kCTRunDelegateAttributeName as NSAttributedString.Key: delegate,
        ])
    }
}
