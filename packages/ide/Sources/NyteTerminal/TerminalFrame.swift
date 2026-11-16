struct TerminalFrame: Sendable {
    var columns: Int
    var rows: Int
    var full: Bool
    var background: UInt32
    var foreground: UInt32
    var cursorColor: UInt32
    var cursor: FrameCursor
    var changed: [FrameRow]
    var mouseTracking: Bool
    var isAlternateScreen: Bool
    var scrollback: Scrollback

    struct Scrollback: Sendable, Equatable {
        var total: Int
        var offset: Int
        var visible: Int
    }
}

struct TerminalColors: Sendable, Equatable {
    var ansi: [UInt32]
    var foreground: UInt32
    var background: UInt32
    var cursor: UInt32
    var isDark: Bool
}

struct FrameCursor: Sendable, Equatable {
    enum Shape: Sendable { case block, bar, underline, hollow }
    var column: Int
    var row: Int
    var visible: Bool
    var blinking: Bool
    var shape: Shape
}

struct FrameRow: Sendable {
    var index: Int
    var text: [UInt16] = []
    var clusterStart: [UInt32] = []
    var clusterColumn: [UInt16] = []
    var clusterWidth: [UInt8] = []
    var runs: [FrameRun] = []
    var fills: [FrameFill] = []
    var sprites: [FrameSprite] = []
    var selection: ClosedRange<Int>?

    func utf16Range(first: Int, count: Int) -> Range<Int> {
        let end = first + count < clusterStart.count ? Int(clusterStart[first + count]) : text.count
        return Int(clusterStart[first])..<end
    }

    var plainText: String {
        var units: [UInt16] = []
        var column = 0
        for cluster in clusterStart.indices {
            let start = Int(clusterColumn[cluster])
            if start > column { units += Array(repeating: 0x20, count: start - column) }
            units += text[utf16Range(first: cluster, count: 1)]
            column = start + Int(clusterWidth[cluster])
        }
        return String(decoding: units, as: UTF16.self)
    }

    mutating func fill(column: Int, width: UInt8, color: UInt32) {
        if let last = fills.last, last.color == color, Int(last.column + last.count) == column {
            fills[fills.count - 1].count += UInt16(width)
        } else {
            fills.append(FrameFill(column: UInt16(column), count: UInt16(width), color: color))
        }
    }

    mutating func append(_ scalars: some Sequence<UInt32>, column: Int, width: UInt8, color: UInt32, style: UInt16) {
        let cluster = clusterStart.count
        clusterStart.append(UInt32(text.count))
        clusterColumn.append(UInt16(column))
        clusterWidth.append(width)
        for value in scalars {
            guard let scalar = Unicode.Scalar(value) else { continue }
            text += scalar.utf16
        }
        if let last = runs.last, last.color == color, last.style == style, Int(last.firstCluster + last.clusterCount) == cluster {
            runs[runs.count - 1].clusterCount += 1
        } else {
            runs.append(FrameRun(firstCluster: Int32(cluster), clusterCount: 1, color: color, style: style))
        }
    }

    static func mix(_ first: UInt32, _ second: UInt32) -> UInt32 {
        let channel = { (shift: UInt32) in ((((first >> shift) & 0xFF) + ((second >> shift) & 0xFF)) / 2) << shift }
        return channel(16) | channel(8) | channel(0)
    }

    func cluster(at column: Int) -> Int? {
        clusterColumn.indices.first { column >= Int(clusterColumn[$0]) && column < Int(clusterColumn[$0]) + Int(clusterWidth[$0]) }
    }
}

struct FrameRun: Sendable {
    var firstCluster: Int32
    var clusterCount: Int32
    var color: UInt32
    var style: UInt16
}

enum RunStyle {
    static let bold: UInt16 = 1 << 0
    static let italic: UInt16 = 1 << 1
    static let strikethrough: UInt16 = 1 << 2
    static let overline: UInt16 = 1 << 3
    static let underline: UInt16 = 1 << 4
    static let doubleUnderline: UInt16 = 1 << 5
}

struct FrameFill: Sendable {
    var column: UInt16
    var count: UInt16
    var color: UInt32
}

struct FrameSprite: Sendable {
    var column: UInt16
    var scalar: UInt32
    var color: UInt32
}
