import Foundation
struct Transcript {
    struct Flags: OptionSet {
        let rawValue: UInt8
        static let running = Flags(rawValue: 1 << 0)
        static let pending = Flags(rawValue: 1 << 1)
        static let failed = Flags(rawValue: 1 << 2)
        static let expandable = Flags(rawValue: 1 << 3)
        static let expanded = Flags(rawValue: 1 << 4)
        static let diff = Flags(rawValue: 1 << 5)
        static let retryable = Flags(rawValue: 1 << 6)
        static let reviewable = Flags(rawValue: 1 << 7)
    }

    enum Change {
        case none
        case rows(IndexSet)
        case appended(Range<Int>, changed: IndexSet)
        case prepended(Int, changed: IndexSet)
        case reload
    }

    private(set) var kinds: [RowKind] = []
    private(set) var keys: [String] = []
    private(set) var parts: [String] = []
    private(set) var spans: [Range<Int>] = []
    private(set) var leads: [Int32] = []
    private(set) var versions: [Int] = []
    private(set) var flags: [Flags] = []
    private(set) var glyphs: [ToolGlyph] = []
    private(set) var added: [Int32] = []
    private(set) var removed: [Int32] = []
    var heights: [CGFloat] = []
    var exact: [Bool] = []
    private(set) var arena: [UInt8] = []
    private var rowOfKey: [String: Int] = [:]
    private var rowOfPart: [String: Int] = [:]

    private static let compactBytes = 1 << 20

    var count: Int { kinds.count }

    func text(_ row: Int) -> String { String(decoding: arena[spans[row]], as: UTF8.self) }
    func lead(_ row: Int) -> String {
        String(decoding: arena[spans[row].lowerBound ..< spans[row].lowerBound + Int(leads[row])], as: UTF8.self)
    }
    func subject(_ row: Int) -> String {
        String(decoding: arena[spans[row].lowerBound + Int(leads[row]) ..< spans[row].upperBound], as: UTF8.self)
    }
    func row(key: String) -> Int? { rowOfKey[key] }
    func byteCount(_ row: Int) -> Int { spans[row].count }
    mutating func rebuild(_ specs: [RowSpec], expanded: Set<String>, outputs: [String: ToolOutput]) -> Change {
        var next = Transcript()
        next.arena = arena
        for spec in specs {
            var flag: Flags = []
            if spec.running { flag.insert(.running) }
            if spec.pending { flag.insert(.pending) }
            if spec.failed { flag.insert(.failed) }
            if spec.expandable { flag.insert(.expandable) }
            if spec.retryable { flag.insert(.retryable) }
            if spec.reviewable { flag.insert(.reviewable) }
            let open = spec.expandable && expanded.contains(spec.key)
            if open { flag.insert(.expanded) }
            next.place(spec.kind, key: spec.key, part: spec.part, lead: spec.lead, text: spec.text, version: spec.version, flags: flag,
                       glyph: spec.glyph, added: spec.added, removed: spec.removed, from: self)
            guard open else { continue }
            if spec.kind == .thinking {
                next.place(.output, key: "out:" + spec.key, part: "", lead: "", text: spec.text, version: spec.version, flags: [],
                           glyph: .other, added: 0, removed: 0, from: self)
            } else if let output = outputs[spec.key] {
                next.place(.output, key: "out:" + spec.key, part: "", lead: "", text: output.text, version: 0,
                           flags: output.diff ? .diff : [], glyph: .other, added: 0, removed: 0, from: self)
            }
        }
        next.compactIfWasteful()
        let change = next.change(from: self)
        self = next
        return change
    }
    mutating func stream(part: String, version: Int, text: String, append: Bool) -> [Int] {
        guard let row = rowOfPart[part], kinds[row] == .prose || kinds[row] == .thinking, version > versions[row] else { return [] }
        let bytes = Array(text.utf8)
        if append, spans[row].upperBound == arena.count {
            arena.append(contentsOf: bytes)
            spans[row] = spans[row].lowerBound ..< arena.count
        } else {
            let start = arena.count
            if append { arena.append(contentsOf: arena[spans[row]]) }
            arena.append(contentsOf: bytes)
            spans[row] = start ..< arena.count
        }
        versions[row] = version
        exact[row] = false
        var moved = [row]
        if let output = rowOfKey["out:" + keys[row]] {
            spans[output] = spans[row]
            versions[output] = version
            exact[output] = false
            moved.append(output)
        }
        return moved
    }

    private mutating func place(_ kind: RowKind, key: String, part: String, lead: String, text: String, version: Int,
                                flags flag: Flags, glyph: ToolGlyph, added plus: Int, removed minus: Int, from old: Transcript)
    {
        let leadBytes = Int32(lead.utf8.count)
        let bytes = Array(lead.utf8) + Array(text.utf8)
        var span: Range<Int>
        var height: CGFloat = 0
        var laid = false
        var at = version
        if let previous = old.rowOfKey[key], old.kinds[previous] == kind {
            let streamedAhead = (kind == .prose || kind == .thinking || kind == .output) && old.versions[previous] > version
            let same = old.versions[previous] == version && old.leads[previous] == leadBytes
                && old.arena[old.spans[previous]].elementsEqual(bytes)
            if streamedAhead || same {
                span = old.spans[previous]
                at = max(version, old.versions[previous])
                if old.flags[previous] == flag {
                    height = old.heights[previous]
                    laid = old.exact[previous]
                }
            } else {
                span = arena.count ..< arena.count + bytes.count
                arena.append(contentsOf: bytes)
            }
        } else {
            span = arena.count ..< arena.count + bytes.count
            arena.append(contentsOf: bytes)
        }
        rowOfKey[key] = kinds.count
        if !part.isEmpty { rowOfPart[part] = kinds.count }
        kinds.append(kind)
        keys.append(key)
        parts.append(part)
        spans.append(span)
        leads.append(leadBytes)
        versions.append(at)
        flags.append(flag)
        glyphs.append(glyph)
        added.append(Int32(clamping: plus))
        removed.append(Int32(clamping: minus))
        heights.append(height)
        exact.append(laid)
    }
    private mutating func compactIfWasteful() {
        let live = spans.reduce(0) { $0 + $1.count }
        guard arena.count > Self.compactBytes, arena.count > live * 2 else { return }
        var fresh: [UInt8] = []
        fresh.reserveCapacity(live)
        var moved: [Range<Int>: Range<Int>] = [:]
        spans = spans.map { span in
            if let known = moved[span] { return known }
            let start = fresh.count
            fresh.append(contentsOf: arena[span])
            moved[span] = start ..< fresh.count
            return start ..< fresh.count
        }
        arena = fresh
    }

    private func change(from old: Transcript) -> Change {
        let changed = { (offset: Int, range: Range<Int>) -> IndexSet in
            IndexSet(range.filter { row in
                let before = row - offset
                return heights[row] == 0 || old.versions[before] != versions[row] || old.flags[before] != flags[row]
                    || old.spans[before] != spans[row] || old.glyphs[before] != glyphs[row]
            })
        }
        if keys == old.keys { return count == 0 ? .none : .rows(changed(0, 0 ..< count)) }
        if old.count > 0, keys.count > old.count, Array(keys.prefix(old.count)) == old.keys {
            return .appended(old.count ..< count, changed: changed(0, 0 ..< old.count))
        }
        if old.count > 0, keys.count > old.count, Array(keys.suffix(old.count)) == old.keys {
            let added = count - old.count
            return .prepended(added, changed: changed(added, added ..< count))
        }
        return .reload
    }
}
