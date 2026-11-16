import Foundation
import Md4c

public struct MarkdownDocument: Sendable {
    public enum Kind: UInt8, Sendable { case paragraph, heading, code, table, rule, alertTitle, image }
    public enum Marker: UInt8, Sendable { case none, bullet, number, open, done }
    public enum Alert: UInt8, Sendable, CaseIterable { case none, note, tip, important, warning, caution }
    public enum Span: UInt8, Sendable { case strong, emphasis, strike, code, link, image }
    public enum Align: UInt8, Sendable { case natural, left, center, right }

    public struct Flags: OptionSet, Sendable {
        public let rawValue: UInt8
        public init(rawValue: UInt8) { self.rawValue = rawValue }
        public static let fenced = Flags(rawValue: 1 << 0)
        public static let open = Flags(rawValue: 1 << 1)
        public static let itemStart = Flags(rawValue: 1 << 2)
    }

    public internal(set) var text: [UInt16] = []
    public internal(set) var side: [UInt16] = []

    public internal(set) var kinds: [Kind] = []
    public internal(set) var values: [Int32] = []
    public internal(set) var lists: [UInt8] = []
    public internal(set) var quotes: [UInt8] = []
    public internal(set) var markers: [Marker] = []
    public internal(set) var alerts: [Alert] = []
    public internal(set) var flags: [Flags] = []
    public internal(set) var ranges: [Range<Int>] = []
    public internal(set) var infos: [Range<Int>] = []
    public internal(set) var spanRuns: [Range<Int>] = []
    public internal(set) var owners: [Int] = []

    public internal(set) var spanKinds: [Span] = []
    public internal(set) var spanRanges: [Range<Int>] = []
    public internal(set) var spanTargets: [Range<Int>] = []

    public internal(set) var cellRanges: [Range<Int>] = []
    public internal(set) var cellSpans: [Range<Int>] = []
    public internal(set) var cellRows: [Int32] = []
    public internal(set) var cellAligns: [Align] = []

    public internal(set) var topSources: [Range<Int>] = []
    public internal(set) var topLeaves: [Range<Int>] = []
    var topMarks: [Marks] = []

    struct Marks: Sendable {
        let text: Int
        let side: Int
        let spans: Int
        let cells: Int
    }

    public init() {}

    public var count: Int { kinds.count }

    public static func parse(_ source: String) -> MarkdownDocument {
        var document = MarkdownDocument()
        document.reparse(source, fromTop: 0)
        return document
    }

    @discardableResult
    public mutating func reparse(_ source: String, fromTop top: Int) -> Int {
        let start = top < topSources.count ? topSources[top].lowerBound : 0
        truncate(toTop: top)
        let first = kinds.count
        var source = source
        source.withUTF8 { bytes in
            guard let base = bytes.baseAddress, start < bytes.count else { return }
            let builder = MarkdownBuilder(document: self, bytes: bytes, offset: start)
            self = MarkdownDocument()
            var parser = MarkdownParser.make()
            _ = withUnsafeMutablePointer(to: &parser) { pointer in
                md_parse(UnsafeRawPointer(base + start).assumingMemoryBound(to: CChar.self), MD_SIZE(bytes.count - start),
                         pointer, Unmanaged.passUnretained(builder).toOpaque())
            }
            builder.finish()
            self = builder.document
        }
        return first
    }

    public func string(_ range: Range<Int>) -> String {
        String(utf16CodeUnits: Array(text[range]), count: range.count)
    }

    public func sideString(_ range: Range<Int>) -> String {
        String(utf16CodeUnits: Array(side[range]), count: range.count)
    }

    public func language(_ leaf: Int) -> String { sideString(infos[leaf]) }

    public func imageSource(_ leaf: Int) -> String { kinds[leaf] == .image ? sideString(infos[leaf]) : "" }

    func leafMatches(_ leaf: Int, in other: MarkdownDocument) -> Bool {
        guard leaf < count, leaf < other.count else { return false }
        guard kinds[leaf] == other.kinds[leaf], values[leaf] == other.values[leaf], lists[leaf] == other.lists[leaf],
              quotes[leaf] == other.quotes[leaf], markers[leaf] == other.markers[leaf], alerts[leaf] == other.alerts[leaf],
              flags[leaf] == other.flags[leaf], owners[leaf] == other.owners[leaf],
              text[ranges[leaf]].elementsEqual(other.text[other.ranges[leaf]]),
              kinds[leaf] == .table || side[infos[leaf]].elementsEqual(other.side[other.infos[leaf]]),
              spanRuns[leaf].count == other.spanRuns[leaf].count
        else { return false }
        let start = ranges[leaf].lowerBound
        let otherStart = other.ranges[leaf].lowerBound
        for (mine, theirs) in zip(spanRuns[leaf], other.spanRuns[leaf]) {
            guard spanKinds[mine] == other.spanKinds[theirs],
                  spanRanges[mine].lowerBound - start == other.spanRanges[theirs].lowerBound - otherStart,
                  spanRanges[mine].count == other.spanRanges[theirs].count,
                  side[spanTargets[mine]].elementsEqual(other.side[other.spanTargets[theirs]])
            else { return false }
        }
        guard kinds[leaf] == .table else { return true }
        let cells = infos[leaf]
        let otherCells = other.infos[leaf]
        return cells.count == otherCells.count && zip(cells, otherCells).allSatisfy { mine, theirs in
            cellRows[mine] == other.cellRows[theirs] && cellAligns[mine] == other.cellAligns[theirs]
                && text[cellRanges[mine]].elementsEqual(other.text[other.cellRanges[theirs]])
                && cellSpans[mine].count == other.cellSpans[theirs].count
        }
    }

    private mutating func truncate(toTop top: Int) {
        guard top < topLeaves.count else { return }
        let leaf = topLeaves[top].lowerBound
        let marks = topMarks[top]
        text.removeSubrange(marks.text...)
        side.removeSubrange(marks.side...)
        if leaf < kinds.count {
            kinds.removeSubrange(leaf...)
            values.removeSubrange(leaf...)
            lists.removeSubrange(leaf...)
            quotes.removeSubrange(leaf...)
            markers.removeSubrange(leaf...)
            alerts.removeSubrange(leaf...)
            flags.removeSubrange(leaf...)
            ranges.removeSubrange(leaf...)
            infos.removeSubrange(leaf...)
            spanRuns.removeSubrange(leaf...)
            owners.removeSubrange(leaf...)
        }
        spanKinds.removeSubrange(marks.spans...)
        spanRanges.removeSubrange(marks.spans...)
        spanTargets.removeSubrange(marks.spans...)
        cellRanges.removeSubrange(marks.cells...)
        cellSpans.removeSubrange(marks.cells...)
        cellRows.removeSubrange(marks.cells...)
        cellAligns.removeSubrange(marks.cells...)
        topSources.removeSubrange(top...)
        topLeaves.removeSubrange(top...)
        topMarks.removeSubrange(top...)
    }
}
