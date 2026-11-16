import Foundation
import Md4c

enum MarkdownParser {
    static let options = UInt32(MD_FLAG_TABLES) | UInt32(MD_FLAG_STRIKETHROUGH) | UInt32(MD_FLAG_TASKLISTS)
        | UInt32(MD_FLAG_PERMISSIVEURLAUTOLINKS) | UInt32(MD_FLAG_PERMISSIVEEMAILAUTOLINKS)
        | UInt32(MD_FLAG_PERMISSIVEWWWAUTOLINKS) | UInt32(MD_FLAG_ADMONITIONS) | UInt32(MD_FLAG_NOHTMLBLOCKS)
        | UInt32(MD_FLAG_NOHTMLSPANS)

    static func make() -> MD_PARSER {
        var parser = MD_PARSER()
        parser.abi_version = 0
        parser.flags = options
        parser.enter_block = { type, detail, user in
            MarkdownBuilder.borrowed(from: user).enter(type, detail)
            return 0
        }
        parser.leave_block = { type, _, user in
            MarkdownBuilder.borrowed(from: user).leave(type)
            return 0
        }
        parser.enter_span = { type, detail, user in
            MarkdownBuilder.borrowed(from: user).enter(span: type, detail)
            return 0
        }
        parser.leave_span = { _, _, user in
            MarkdownBuilder.borrowed(from: user).leaveSpan()
            return 0
        }
        parser.text = { type, text, size, user in
            MarkdownBuilder.borrowed(from: user).text(type, text, Int(size))
            return 0
        }
        return parser
    }
}

final class MarkdownBuilder {
    static func borrowed(from user: UnsafeMutableRawPointer?) -> MarkdownBuilder {
        Unmanaged<MarkdownBuilder>.fromOpaque(user.unsafelyUnwrapped).takeUnretainedValue()
    }

    var document: MarkdownDocument
    let bytes: UnsafeBufferPointer<UInt8>
    let offset: Int
    private let base: UnsafeRawPointer

    private var depth = 0
    private var quoteDepth = 0
    private var alert = MarkdownDocument.Alert.none
    private var listStack: [(ordered: Bool, next: Int32)] = []
    private var marker = MarkdownDocument.Marker.none
    private var number: Int32 = 0
    private var leaf: Int?
    private var implicit = false
    private var spanStack: [(kind: MarkdownDocument.Span, start: Int, target: Range<Int>)] = []
    private var cellStart: (text: Int, spans: Int)?
    private var cellAlign = MarkdownDocument.Align.natural
    private var row: Int32 = -1
    private var topLeaf = 0
    private var low = Int.max
    private var high = -1
    private var codeEnds: [Int: Int] = [:]
    private var pendingTops: [(leaves: Range<Int>, low: Int, high: Int, fencedLead: Bool, alertLead: Bool)] = []

    private static let alertTitles = ["", "Note", "Tip", "Important", "Warning", "Caution"]
    private static let alertTypes = ["note", "tip", "important", "warning", "caution"]

    init(document: MarkdownDocument, bytes: UnsafeBufferPointer<UInt8>, offset: Int) {
        self.document = document
        self.bytes = bytes
        self.offset = offset
        base = UnsafeRawPointer(bytes.baseAddress.unsafelyUnwrapped)
    }

    func enter(_ type: MD_BLOCKTYPE, _ detail: UnsafeMutableRawPointer?) {
        guard type != MD_BLOCK_DOC else { return }
        if depth == 0 { beginTop() }
        depth += 1
        if implicit, leaf != nil, type != MD_BLOCK_TH, type != MD_BLOCK_TD { close() }
        switch type {
        case MD_BLOCK_QUOTE:
            quoteDepth += 1
        case MD_BLOCK_ADMONITION:
            quoteDepth += 1
            let type = detail?.assumingMemoryBound(to: MD_BLOCK_ADMONITION_DETAIL.self).pointee.type
            let kind = type.map(attribute) ?? ""
            let index = Self.alertTypes.firstIndex(of: kind.lowercased()).map { $0 + 1 } ?? 1
            alert = MarkdownDocument.Alert(rawValue: UInt8(index)) ?? .note
            open(.alertTitle)
            append(Self.alertTitles[index].utf16)
            close()
        case MD_BLOCK_UL:
            listStack.append((false, 1))
        case MD_BLOCK_OL:
            let start = detail.map { $0.assumingMemoryBound(to: MD_BLOCK_OL_DETAIL.self).pointee.start } ?? 1
            listStack.append((true, Int32(clamping: start)))
        case MD_BLOCK_LI:
            let item = detail?.assumingMemoryBound(to: MD_BLOCK_LI_DETAIL.self).pointee
            if let item, item.is_task != 0 {
                marker = item.task_mark == CChar(UInt8(ascii: " ")) ? .open : .done
                note(Int(item.task_mark_offset), length: 1)
            } else {
                marker = listStack.last?.ordered == true ? .number : .bullet
            }
            number = listStack.last?.next ?? 1
            if !listStack.isEmpty { listStack[listStack.count - 1].next += 1 }
        case MD_BLOCK_HR:
            open(.rule)
            close()
        case MD_BLOCK_H:
            open(.heading)
            let level = detail.map { $0.assumingMemoryBound(to: MD_BLOCK_H_DETAIL.self).pointee.level } ?? 1
            document.values[document.count - 1] = Int32(clamping: level)
        case MD_BLOCK_CODE:
            open(.code)
            guard let code = detail?.assumingMemoryBound(to: MD_BLOCK_CODE_DETAIL.self).pointee else { break }
            let current = document.count - 1
            if code.fence_char != 0 { document.flags[current].insert(.fenced) }
            let language = attribute(code.lang)
            let start = document.side.count
            if lineEnded(after: code.info) { document.side.append(contentsOf: language.utf16) }
            document.infos[current] = start ..< document.side.count
            if code.info.size > 0 { note(pointer: code.info.text, length: Int(code.info.size)) }
            codeEnds[current] = position(code.info.text).map { $0 + Int(code.info.size) }
        case MD_BLOCK_P, MD_BLOCK_HTML:
            open(.paragraph)
        case MD_BLOCK_TABLE:
            open(.table)
            let columns = detail.map { $0.assumingMemoryBound(to: MD_BLOCK_TABLE_DETAIL.self).pointee.col_count } ?? 0
            document.values[document.count - 1] = Int32(clamping: columns)
            row = -1
        case MD_BLOCK_TR:
            row += 1
        case MD_BLOCK_TH, MD_BLOCK_TD:
            let align = detail.map { $0.assumingMemoryBound(to: MD_BLOCK_TD_DETAIL.self).pointee.align } ?? MD_ALIGN_DEFAULT
            cellAlign = switch align {
            case MD_ALIGN_LEFT: .left
            case MD_ALIGN_CENTER: .center
            case MD_ALIGN_RIGHT: .right
            default: .natural
            }
            cellStart = (document.text.count, document.spanKinds.count)
        default:
            break
        }
        if type == MD_BLOCK_UL || type == MD_BLOCK_OL {
            implicit = false
        }
    }

    func leave(_ type: MD_BLOCKTYPE) {
        guard type != MD_BLOCK_DOC else { return }
        switch type {
        case MD_BLOCK_P:
            promoteImage()
            close()
        case MD_BLOCK_H, MD_BLOCK_HTML:
            close()
        case MD_BLOCK_CODE:
            if let current = leaf {
                while document.text.count > document.ranges[current].lowerBound, document.text.last == UInt16(UInt8(ascii: "\n")) {
                    document.text.removeLast()
                }
            }
            close()
        case MD_BLOCK_LI:
            if leaf != nil { close() }
            if marker != .none {
                open(.paragraph)
                close()
            }
        case MD_BLOCK_UL, MD_BLOCK_OL:
            if leaf != nil, implicit { close() }
            listStack.removeLast()
        case MD_BLOCK_QUOTE:
            if leaf != nil, implicit { close() }
            quoteDepth -= 1
        case MD_BLOCK_ADMONITION:
            if leaf != nil, implicit { close() }
            quoteDepth -= 1
            alert = .none
        case MD_BLOCK_TH, MD_BLOCK_TD:
            guard let start = cellStart else { break }
            document.cellRanges.append(start.text ..< document.text.count)
            document.cellSpans.append(start.spans ..< document.spanKinds.count)
            document.cellRows.append(row)
            document.cellAligns.append(cellAlign)
            cellStart = nil
        case MD_BLOCK_TABLE:
            if let current = leaf { document.infos[current] = tableCells(current) }
            close()
        default:
            break
        }
        depth -= 1
        if depth == 0 { endTop() }
    }

    func enter(span type: MD_SPANTYPE, _ detail: UnsafeMutableRawPointer?) {
        let kind: MarkdownDocument.Span
        var target = document.side.count ..< document.side.count
        switch type {
        case MD_SPAN_STRONG: kind = .strong
        case MD_SPAN_EM: kind = .emphasis
        case MD_SPAN_DEL: kind = .strike
        case MD_SPAN_CODE: kind = .code
        case MD_SPAN_IMG:
            kind = .image
            if let image = detail?.assumingMemoryBound(to: MD_SPAN_IMG_DETAIL.self).pointee {
                let start = document.side.count
                document.side.append(contentsOf: attribute(image.src).utf16)
                target = start ..< document.side.count
                note(pointer: image.src.text, length: Int(image.src.size))
            }
        case MD_SPAN_A:
            kind = .link
            if let link = detail?.assumingMemoryBound(to: MD_SPAN_A_DETAIL.self).pointee {
                let href = attribute(link.href)
                let start = document.side.count
                document.side.append(contentsOf: Self.resolve(href, autolink: link.is_autolink != 0).utf16)
                target = start ..< document.side.count
                note(pointer: link.href.text, length: Int(link.href.size))
            }
        default: kind = .emphasis
        }
        ensureLeaf()
        spanStack.append((kind, document.text.count, target))
    }

    func leaveSpan() {
        guard let span = spanStack.popLast() else { return }
        document.spanKinds.append(span.kind)
        document.spanRanges.append(span.start ..< document.text.count)
        document.spanTargets.append(span.target)
    }

    func text(_ type: MD_TEXTTYPE, _ pointer: UnsafePointer<CChar>?, _ size: Int) {
        guard let pointer else { return }
        ensureLeaf()
        note(pointer: pointer, length: size)
        switch type {
        case MD_TEXT_NULLCHAR:
            document.text.append(UInt16(Unicode.Scalar.replacement.value))
        case MD_TEXT_BR:
            document.text.append(UInt16(Unicode.Scalar.lineSeparator))
        case MD_TEXT_SOFTBR:
            document.text.append(UInt16(UInt8(ascii: " ")))
        case MD_TEXT_ENTITY:
            let raw = String(decoding: UnsafeRawBufferPointer(start: pointer, count: size), as: UTF8.self)
            append(MarkdownEntity.decode(raw).utf16)
        default:
            if let current = leaf, document.kinds[current] == .code, let end = position(pointer) {
                codeEnds[current] = end + size
            }
            let buffer = UnsafeBufferPointer(start: UnsafeRawPointer(pointer).assumingMemoryBound(to: UInt8.self), count: size)
            _ = transcode(buffer.makeIterator(), from: UTF8.self, to: UTF16.self, stoppingOnError: false) { self.document.text.append($0) }
        }
    }

    func finish() {
        var previousEnd = offset
        var starts: [Int] = []
        for top in pendingTops {
            var start: Int
            if top.high >= 0 {
                start = lineStart(top.low)
                if top.fencedLead, !isFence(lineAt: start), start > previousEnd { start = lineStart(start - 1) }
                if top.alertLead, start > previousEnd { start = lineStart(start - 1) }
            } else {
                start = firstContent(from: previousEnd)
            }
            start = max(start, offset)
            starts.append(start)
            previousEnd = top.high >= 0 ? lineEnd(top.high) : lineEnd(start)
            if top.fencedLead, previousEnd < bytes.count, isFence(lineAt: min(bytes.count, previousEnd + 1)) {
                previousEnd = lineEnd(previousEnd + 1)
            }
        }
        for (index, top) in pendingTops.enumerated() {
            let end = index + 1 < starts.count ? trimmedEnd(before: starts[index + 1]) : bytes.count
            document.topSources.append(starts[index] ..< max(starts[index], end))
            document.topLeaves.append(top.leaves)
        }
        guard let last = document.kinds.indices.last, document.kinds[last] == .code, document.flags[last].contains(.fenced) else { return }
        let end = codeEnds[last] ?? starts.last ?? offset
        if !closingFence(after: end) { document.flags[last].insert(.open) }
    }

    private func beginTop() {
        topLeaf = document.count
        low = Int.max
        high = -1
        document.topMarks.append(.init(
            text: document.text.count, side: document.side.count, spans: document.spanKinds.count, cells: document.cellRanges.count
        ))
    }

    private func endTop() {
        if leaf != nil { close() }
        let leaves = topLeaf ..< document.count
        let fencedLead = leaves.first.map { document.kinds[$0] == .code && document.flags[$0].contains(.fenced) } ?? false
        let infoSeen = leaves.first.map { document.kinds[$0] == .code && codeEnds[$0] != nil && !document.infos[$0].isEmpty } ?? false
        let alertLead = leaves.first.map { document.kinds[$0] == .alertTitle } ?? false
        pendingTops.append((leaves, low, high, fencedLead && !infoSeen, alertLead))
    }

    private func open(_ kind: MarkdownDocument.Kind) {
        leaf = document.count
        implicit = false
        let start = document.text.count
        document.kinds.append(kind)
        document.values.append(kind == .alertTitle ? Int32(alert.rawValue) : (marker == .number ? number : 0))
        document.lists.append(UInt8(clamping: listStack.count))
        document.quotes.append(UInt8(clamping: quoteDepth))
        document.markers.append(kind == .alertTitle ? .none : marker)
        document.alerts.append(alert)
        document.flags.append(marker != .none && kind != .alertTitle ? .itemStart : [])
        document.ranges.append(start ..< start)
        document.infos.append(document.side.count ..< document.side.count)
        document.spanRuns.append(document.spanKinds.count ..< document.spanKinds.count)
        document.owners.append(document.topMarks.count - 1)
        if kind != .alertTitle { marker = .none }
    }

    private func close() {
        guard let current = leaf else { return }
        document.ranges[current] = document.ranges[current].lowerBound ..< document.text.count
        document.spanRuns[current] = document.spanRuns[current].lowerBound ..< document.spanKinds.count
        leaf = nil
        implicit = false
    }

    private func promoteImage() {
        guard let current = leaf, document.kinds[current] == .paragraph, cellStart == nil else { return }
        let start = document.spanRuns[current].lowerBound
        let spans = start ..< document.spanKinds.count
        guard spans.count >= 1, document.spanKinds[spans.upperBound - 1] == .image,
              document.spanRanges[spans.upperBound - 1] == document.ranges[current].lowerBound ..< document.text.count
        else { return }
        let image = spans.upperBound - 1
        document.kinds[current] = .image
        document.infos[current] = document.spanTargets[image]
    }

    private func ensureLeaf() {
        guard leaf == nil, cellStart == nil else { return }
        open(.paragraph)
        implicit = true
    }

    private func tableCells(_ table: Int) -> Range<Int> {
        let marks = document.topMarks[document.owners[table]]
        return marks.cells ..< document.cellRanges.count
    }

    private func append(_ units: some Sequence<UInt16>) { document.text.append(contentsOf: units) }

    private func position(_ pointer: UnsafePointer<CChar>?) -> Int? {
        guard let pointer else { return nil }
        let distance = UnsafeRawPointer(pointer) - base
        guard distance >= offset, distance <= bytes.count else { return nil }
        return distance
    }

    private func note(pointer: UnsafePointer<CChar>?, length: Int) {
        guard let at = position(pointer) else { return }
        low = min(low, at)
        high = max(high, at + max(0, length - 1))
    }

    private func note(_ relative: Int, length: Int) {
        let at = relative + offset
        guard at < bytes.count else { return }
        low = min(low, at)
        high = max(high, at + length - 1)
    }

    private func attribute(_ value: MD_ATTRIBUTE) -> String {
        guard let text = value.text, value.size > 0 else { return "" }
        let raw = String(decoding: UnsafeRawBufferPointer(start: text, count: Int(value.size)), as: UTF8.self)
        return raw.contains("&") ? MarkdownEntity.decode(raw) : raw
    }

    private func lineEnded(after info: MD_ATTRIBUTE) -> Bool {
        guard let at = position(info.text) else { return true }
        let end = at + Int(info.size)
        return bytes[end...].contains(UInt8(ascii: "\n"))
    }

    private static func resolve(_ href: String, autolink: Bool) -> String {
        guard autolink, !href.contains("://"), !href.hasPrefix("mailto:") else { return href }
        if href.contains("@"), !href.hasPrefix("www.") { return "mailto:" + href }
        return "https://" + href
    }

    private func lineStart(_ at: Int) -> Int {
        var index = min(at, bytes.count)
        while index > offset, bytes[index - 1] != UInt8(ascii: "\n") { index -= 1 }
        return index
    }

    private func lineEnd(_ at: Int) -> Int {
        var index = max(at, offset)
        while index < bytes.count, bytes[index] != UInt8(ascii: "\n") { index += 1 }
        return index
    }

    private func firstContent(from at: Int) -> Int {
        var index = at
        var line = at
        while index < bytes.count {
            let byte = bytes[index]
            if byte == UInt8(ascii: "\n") {
                line = index + 1
            } else if byte != UInt8(ascii: " "), byte != UInt8(ascii: "\t"), byte != UInt8(ascii: "\r") {
                return line
            }
            index += 1
        }
        return min(line, bytes.count)
    }

    private func trimmedEnd(before at: Int) -> Int {
        var index = at
        while index > offset, [UInt8(ascii: "\n"), UInt8(ascii: " "), UInt8(ascii: "\t"), UInt8(ascii: "\r")].contains(bytes[index - 1]) {
            index -= 1
        }
        return index
    }

    private func isFence(lineAt start: Int) -> Bool {
        var index = start
        while index < bytes.count, bytes[index] == UInt8(ascii: " ") { index += 1 }
        guard index < bytes.count else { return false }
        let mark = bytes[index]
        guard mark == UInt8(ascii: "`") || mark == UInt8(ascii: "~") else { return false }
        var run = 0
        while index < bytes.count, bytes[index] == mark {
            run += 1
            index += 1
        }
        return run >= MarkdownEntity.fenceLength
    }

    private func closingFence(after end: Int) -> Bool {
        var line = lineEnd(end) + 1
        while line < bytes.count {
            if isFence(lineAt: line) { return true }
            line = lineEnd(line) + 1
        }
        return false
    }
}

enum MarkdownEntity {
    static let fenceLength = 3
    private static let named: [String: String] = [
        "amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "nbsp": "\u{00A0}", "copy": "\u{00A9}",
        "reg": "\u{00AE}", "trade": "\u{2122}", "mdash": "\u{2014}", "ndash": "\u{2013}", "hellip": "\u{2026}",
        "larr": "\u{2190}", "rarr": "\u{2192}", "uarr": "\u{2191}", "darr": "\u{2193}", "times": "\u{00D7}",
        "middot": "\u{00B7}", "bull": "\u{2022}", "laquo": "\u{00AB}", "raquo": "\u{00BB}", "deg": "\u{00B0}",
    ]
    private static let hexRadix = 16
    private static let decimalRadix = 10

    static func decode(_ raw: String) -> String {
        guard raw.hasPrefix("&"), raw.hasSuffix(";") else { return raw }
        let body = raw.dropFirst().dropLast()
        if body.hasPrefix("#x") || body.hasPrefix("#X") {
            return scalar(UInt32(body.dropFirst(2), radix: hexRadix)) ?? raw
        }
        if body.hasPrefix("#") {
            return scalar(UInt32(body.dropFirst(), radix: decimalRadix)) ?? raw
        }
        return named[String(body)] ?? raw
    }

    private static func scalar(_ value: UInt32?) -> String? {
        guard let value else { return nil }
        guard value != 0, let scalar = Unicode.Scalar(value) else { return "\u{FFFD}" }
        return String(Character(scalar))
    }
}

private extension Unicode.Scalar {
    static let replacement = Unicode.Scalar(0xFFFD).unsafelyUnwrapped
    static let lineSeparator: UInt32 = 0x2028
}
