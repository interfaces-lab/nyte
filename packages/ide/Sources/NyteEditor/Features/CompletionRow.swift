import AppKit
import NyteCore
import NyteUI

@MainActor
enum CompletionRow {
    static let maxTypeWidth: CGFloat = 180
    static let leading = RowCell.Geometry.inset + RowCell.Geometry.padding + RowCell.Geometry.icon + RowCell.Geometry.gap
    static let trailing = RowCell.Geometry.padding + RowCell.Geometry.inset

    static func width(of item: CompletionItem) -> CGFloat {
        let columns = columns(item)
        var width = leading + trailing + Draw.width(of: item.label, style: .code, weight: .medium)
        if !columns.tail.isEmpty { width += Space.x1 + Draw.width(of: columns.tail, style: .code) }
        if !columns.type.isEmpty {
            width += RowCell.Geometry.gap + RowCell.Geometry.trailingGap
                + min(Draw.width(of: columns.type, style: .sm, tabular: true), maxTypeWidth)
        }
        return width
    }

    static func columns(_ item: CompletionItem) -> (tail: String, type: String) {
        let tail = item.tail.trimmingCharacters(in: .whitespaces)
        let type = item.type.trimmingCharacters(in: .whitespaces)
        if tail.isEmpty || tail == type { return ("", type) }
        guard tail.hasPrefix("("), let close = closingParen(in: tail) else {
            return (tail, type.hasSuffix(tail) ? "" : type)
        }
        guard type.isEmpty || type.hasSuffix(tail) else { return (tail, type) }
        return (String(tail[...close]), trimmingColon(String(tail[tail.index(after: close)...])))
    }

    static func fitting(_ type: String) -> String {
        guard Draw.width(of: type, style: .sm, tabular: true) > maxTypeWidth else { return type }
        var shown = type
        while shown.count > 1, Draw.width(of: shown + "…", style: .sm, tabular: true) > maxTypeWidth { shown.removeLast() }
        return shown + "…"
    }

    static func closingParen(in text: String) -> String.Index? {
        var depth = 0
        for index in text.indices {
            switch text[index] {
            case "(": depth += 1
            case ")":
                depth -= 1
                if depth == 0 { return index }
            default: break
            }
        }
        return nil
    }

    static func trimmingColon(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        return (trimmed.hasPrefix(":") ? String(trimmed.dropFirst()) : trimmed).trimmingCharacters(in: .whitespaces)
    }

    static func isDigit(_ unit: UInt16) -> Bool {
        unit >= UInt16(UInt8(ascii: "0")) && unit <= UInt16(UInt8(ascii: "9"))
    }

    static func mark(_ kind: CompletionKind) -> RowContent.Mark {
        .code(letter: kind.mark.letter, semanticType: "\(kind.mark.token)")
    }
}
