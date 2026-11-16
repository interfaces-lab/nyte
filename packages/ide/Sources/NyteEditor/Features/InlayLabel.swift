import Foundation
import NyteUI
import NyteCore

enum InlayLabel {
    static let ellipsis = "…"
    static let longestLabel = 24

    static func shown(_ hint: InlayHint, argumentAt offset: Int, in text: some UnitString) -> String? {
        let label = hint.label.trimmingCharacters(in: .whitespaces)
        guard !label.isEmpty else { return nil }
        if hint.kind == .parameter, offset < text.length {
            let name = label.hasSuffix(":") ? String(label.dropLast()) : label
            let end = Identifier.end(after: offset, in: text)
            if end > offset, text.substring(with: NSRange(location: offset, length: end - offset)) == name { return nil }
        }
        return elided(label, limit: longestLabel)
    }

    static func elided(_ label: String, limit: Int) -> String {
        guard label.count > limit else { return label }
        let kept = limit - ellipsis.count
        return String(label.prefix(kept - kept / 2)) + ellipsis + String(label.suffix(kept / 2))
    }
}
