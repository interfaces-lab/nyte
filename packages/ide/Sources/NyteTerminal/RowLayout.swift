import AppKit
import CoreText
import NyteUI
@MainActor
struct TerminalMetrics {
    let fonts: [CTFont]
    let cellWidth: CGFloat
    let cellHeight: CGFloat
    let baseline: CGFloat
    let scale: CGFloat
    let typeface: TerminalFont

    init(scale: CGFloat, font: TerminalFont = TerminalPreferences.standard.font) {
        let style = TextStyle.code
        let standard = style.font(.regular)
        let size = CGFloat(font.size ?? Double(standard.pointSize))
        let regular = font.family.flatMap { NSFont(name: $0, size: size) } ?? NSFont(descriptor: standard.fontDescriptor, size: size) ?? standard
        let bold = NSFontManager.shared.convert(regular, toHaveTrait: .boldFontMask)
        fonts = [regular, bold, Self.italic(regular), Self.italic(bold)]
        self.typeface = font
        var character: UniChar = 0x4D
        var glyph = CGGlyph(0)
        CTFontGetGlyphsForCharacters(regular, &character, &glyph, 1)
        var advance = CGSize.zero
        CTFontGetAdvancesForGlyphs(regular, .horizontal, &glyph, &advance, 1)
        self.scale = scale
        cellWidth = (advance.width * scale).rounded() / scale
        let lineHeight = style.lineHeight * size / standard.pointSize * CGFloat(font.lineHeight)
        cellHeight = (lineHeight * scale).rounded() / scale
        let ascent = CTFontGetAscent(regular)
        let natural = ascent + CTFontGetDescent(regular)
        baseline = (((cellHeight - natural) / 2 + ascent) * scale).rounded() / scale
    }

    func font(_ style: UInt16) -> CTFont {
        fonts[Int(style & (RunStyle.bold | RunStyle.italic))]
    }

    var grid: (width: UInt32, height: UInt32) {
        (UInt32((cellWidth * scale).rounded()), UInt32((cellHeight * scale).rounded()))
    }

    private static func italic(_ font: NSFont) -> CTFont {
        CTFontCreateCopyWithSymbolicTraits(font, 0, nil, .traitItalic, .traitItalic) ?? font
    }
}
struct RowLayout {
    struct Segment {
        let font: CTFont
        let color: UInt32
        let range: Range<Int>
    }

    struct Line {
        enum Kind { case underline, doubleUnderline, strikethrough, overline }
        let kind: Kind
        let column: Int
        let count: Int
        let color: UInt32
    }

    var source: FrameRow
    var glyphs: [CGGlyph] = []
    var positions: [CGPoint] = []
    var glyphColumns: [UInt16] = []
    var segments: [Segment] = []
    var lines: [Line] = []
    @MainActor
    init(_ row: FrameRow, metrics: TerminalMetrics) {
        source = row
        for run in row.runs {
            let first = Int(run.firstCluster)
            let range = row.utf16Range(first: first, count: Int(run.clusterCount))
            let string = String(decoding: row.text[range], as: UTF16.self)
            let attributed = NSAttributedString(string: string, attributes: [
                .font: metrics.font(run.style),
                .ligature: 0,
            ])
            let line = CTLineCreateWithAttributedString(attributed)
            for glyphRun in CTLineGetGlyphRuns(line) as? [CTRun] ?? [] {
                place(glyphRun, run: run, firstCluster: first, offset: range.lowerBound, metrics: metrics)
            }
            let lastCluster = first + Int(run.clusterCount) - 1
            let start = Int(row.clusterColumn[first])
            let count = Int(row.clusterColumn[lastCluster]) + Int(row.clusterWidth[lastCluster]) - start
            let kinds: [(UInt16, Line.Kind)] = [
                (RunStyle.underline, .underline), (RunStyle.doubleUnderline, .doubleUnderline),
                (RunStyle.strikethrough, .strikethrough), (RunStyle.overline, .overline),
            ]
            for (bit, kind) in kinds where run.style & bit != 0 {
                lines.append(Line(kind: kind, column: start, count: count, color: run.color))
            }
        }
    }

    @MainActor private mutating func place(_ glyphRun: CTRun, run: FrameRun, firstCluster: Int, offset: Int, metrics: TerminalMetrics) {
        let count = CTRunGetGlyphCount(glyphRun)
        guard count > 0 else { return }
        let attributes = CTRunGetAttributes(glyphRun) as? [NSAttributedString.Key: Any]
        let font = attributes?[.font] as? NSFont ?? metrics.font(run.style)
        var runGlyphs = [CGGlyph](repeating: 0, count: count)
        var indices = [CFIndex](repeating: 0, count: count)
        var advances = [CGSize](repeating: .zero, count: count)
        var origins = [CGPoint](repeating: .zero, count: count)
        let all = CFRange(location: 0, length: count)
        CTRunGetGlyphs(glyphRun, all, &runGlyphs)
        CTRunGetStringIndices(glyphRun, all, &indices)
        CTRunGetAdvances(glyphRun, all, &advances)
        CTRunGetPositions(glyphRun, all, &origins)

        let clusterEnd = firstCluster + Int(run.clusterCount)
        let clusters = indices.map { index in
            cluster(containing: UInt32(offset + index), from: firstCluster, to: clusterEnd)
        }
        var width: [Int: CGFloat] = [:]
        var anchor: [Int: CGFloat] = [:]
        for index in 0..<count {
            width[clusters[index], default: 0] += advances[index].width
            if anchor[clusters[index]] == nil { anchor[clusters[index]] = origins[index].x }
        }
        let start = glyphs.count
        for index in 0..<count {
            let cluster = clusters[index]
            let cells = CGFloat(source.clusterWidth[cluster]) * metrics.cellWidth
            let cellX = CGFloat(source.clusterColumn[cluster]) * metrics.cellWidth
            let x = cellX + (cells - (width[cluster] ?? 0)) / 2 + origins[index].x - (anchor[cluster] ?? 0)
            glyphs.append(runGlyphs[index])
            positions.append(CGPoint(x: (x * metrics.scale).rounded() / metrics.scale, y: origins[index].y))
            glyphColumns.append(source.clusterColumn[cluster])
        }
        segments.append(Segment(font: font, color: run.color, range: start..<glyphs.count))
    }

    private func cluster(containing utf16: UInt32, from first: Int, to end: Int) -> Int {
        var low = first
        var high = end - 1
        while low < high {
            let middle = (low + high + 1) / 2
            if source.clusterStart[middle] <= utf16 { low = middle } else { high = middle - 1 }
        }
        return low
    }
}
enum Sprites {
    @MainActor
    static func draw(_ scalar: UInt32, in cell: CGRect, color: CGColor, scale: CGFloat, context: CGContext) {
        context.setFillColor(color)
        context.setStrokeColor(color)
        if scalar >= 0x2580 { return block(scalar, in: cell, color: color, context: context) }
        let light = max(Metric.hairline, 1 / scale)
        let heavy = Space.x05
        let snap = { (value: CGFloat) in (value * scale).rounded() / scale }
        let centerX = snap(cell.midX)
        let centerY = snap(cell.midY)
        switch scalar {
        case 0x256D...0x2570:
            arc(scalar, in: cell, center: CGPoint(x: centerX, y: centerY), width: light, context: context)
            return
        case 0x2571...0x2573:
            context.setLineWidth(light)
            if scalar != 0x2572 { context.strokeLineSegments(between: [CGPoint(x: cell.minX, y: cell.maxY), CGPoint(x: cell.maxX, y: cell.minY)]) }
            if scalar != 0x2571 { context.strokeLineSegments(between: [CGPoint(x: cell.minX, y: cell.minY), CGPoint(x: cell.maxX, y: cell.maxY)]) }
            return
        default:
            break
        }
        let arms = Array(table[Int(scalar - 0x2500)].utf8).map { Int($0) - 48 }
        for (side, weight) in arms.enumerated() where weight > 0 {
            let thickness = weight == 2 ? heavy : light
            let offsets: [CGFloat] = weight == 3 ? [-light, light] : [0]
            for offset in offsets {
                let rect: CGRect = switch side {
                case 0: CGRect(x: centerX - thickness / 2 + offset, y: cell.minY, width: thickness, height: centerY - cell.minY + thickness / 2)
                case 1: CGRect(x: centerX - thickness / 2, y: centerY - thickness / 2 + offset, width: cell.maxX - centerX + thickness / 2, height: thickness)
                case 2: CGRect(x: centerX - thickness / 2 + offset, y: centerY - thickness / 2, width: thickness, height: cell.maxY - centerY + thickness / 2)
                default: CGRect(x: cell.minX, y: centerY - thickness / 2 + offset, width: centerX - cell.minX + thickness / 2, height: thickness)
                }
                context.fill(rect)
            }
        }
    }

    private static func arc(_ scalar: UInt32, in cell: CGRect, center: CGPoint, width: CGFloat, context: CGContext) {
        let radius = min(cell.width, cell.height) / 2
        let path = CGMutablePath()
        let (vertical, horizontal): (CGFloat, CGFloat) = switch scalar {
        case 0x256D: (cell.maxY, cell.maxX)
        case 0x256E: (cell.maxY, cell.minX)
        case 0x256F: (cell.minY, cell.minX)
        default: (cell.minY, cell.maxX)
        }
        let towardY: CGFloat = vertical > center.y ? 1 : -1
        let towardX: CGFloat = horizontal > center.x ? 1 : -1
        path.move(to: CGPoint(x: center.x, y: vertical))
        path.addLine(to: CGPoint(x: center.x, y: center.y + towardY * radius))
        path.addQuadCurve(to: CGPoint(x: center.x + towardX * radius, y: center.y), control: center)
        path.addLine(to: CGPoint(x: horizontal, y: center.y))
        context.setLineWidth(width)
        context.addPath(path)
        context.strokePath()
    }

    private static func block(_ scalar: UInt32, in cell: CGRect, color: CGColor, context: CGContext) {
        let eighthHigh = cell.height / 8
        let eighthWide = cell.width / 8
        let halfW = cell.width / 2
        let halfH = cell.height / 2
        switch scalar {
        case 0x2580: context.fill(CGRect(x: cell.minX, y: cell.minY, width: cell.width, height: halfH))
        case 0x2581...0x2588:
            let height = eighthHigh * CGFloat(scalar - 0x2580)
            context.fill(CGRect(x: cell.minX, y: cell.maxY - height, width: cell.width, height: height))
        case 0x2589...0x258F:
            context.fill(CGRect(x: cell.minX, y: cell.minY, width: eighthWide * CGFloat(0x2590 - scalar), height: cell.height))
        case 0x2590: context.fill(CGRect(x: cell.minX + halfW, y: cell.minY, width: halfW, height: cell.height))
        case 0x2591...0x2593:
            context.setFillColor(color.copy(alpha: CGFloat(scalar - 0x2590) / 4) ?? color)
            context.fill(cell)
        case 0x2594: context.fill(CGRect(x: cell.minX, y: cell.minY, width: cell.width, height: eighthHigh))
        case 0x2595: context.fill(CGRect(x: cell.maxX - eighthWide, y: cell.minY, width: eighthWide, height: cell.height))
        default:
            let quadrants: [UInt32: [Int]] = [
                0x2596: [2], 0x2597: [3], 0x2598: [0], 0x2599: [0, 2, 3], 0x259A: [0, 3],
                0x259B: [0, 1, 2], 0x259C: [0, 1, 3], 0x259D: [1], 0x259E: [1, 2], 0x259F: [1, 2, 3],
            ]
            for quadrant in quadrants[scalar] ?? [] {
                context.fill(CGRect(x: cell.minX + (quadrant % 2 == 1 ? halfW : 0),
                                    y: cell.minY + (quadrant >= 2 ? halfH : 0), width: halfW, height: halfH))
            }
        }
    }
    private static let table: [String] = [
        "0101", "0202", "1010", "2020", "0101", "0202", "1010", "2020",
        "0101", "0202", "1010", "2020", "0110", "0210", "0120", "0220",
        "0011", "0012", "0021", "0022", "1100", "1200", "2100", "2200",
        "1001", "1002", "2001", "2002", "1110", "1210", "2110", "1120",
        "2120", "2210", "1220", "2220", "1011", "1012", "2011", "1021",
        "2021", "2012", "1022", "2022", "0111", "0112", "0211", "0212",
        "0121", "0122", "0221", "0222", "1101", "1102", "1201", "1202",
        "2101", "2102", "2201", "2202", "1111", "1112", "1211", "1212",
        "2111", "1121", "2121", "2112", "2211", "1122", "1221", "2212",
        "1222", "2122", "2221", "2222", "0101", "0202", "1010", "2020",
        "0303", "3030", "0310", "0130", "0330", "0013", "0031", "0033",
        "1300", "3100", "3300", "1003", "3001", "3003", "1310", "3130",
        "3330", "1013", "3031", "3033", "0313", "0131", "0333", "1303",
        "3101", "3303", "1313", "3131", "3333", "0110", "0011", "1001",
        "1100", "0000", "0000", "0000", "0001", "1000", "0100", "0010",
        "0002", "2000", "0200", "0020", "0201", "1020", "0102", "2010",
    ]
}
