import Foundation
import NyteCore

enum PatchText {
    struct Line {
        var mark: UInt8
        var text: Substring
        var endsLine: Bool
    }

    struct Hunk {
        var oldStart: Int
        var newStart: Int
        var heading: String
        var lines: [Line] = []
    }

    static func hunks(_ patch: String) -> [Hunk] {
        var hunks: [Hunk] = []
        for line in patch.split(separator: "\n", omittingEmptySubsequences: false) {
            if line.hasPrefix("@@ ") {
                let fields = line.split(separator: " ", maxSplits: 3, omittingEmptySubsequences: false)
                guard fields.count >= 3 else { continue }
                let old = Int(fields[1].dropFirst().split(separator: ",").first ?? "") ?? 0
                let new = Int(fields[2].dropFirst().split(separator: ",").first ?? "") ?? 0
                let rest = fields.count > 3 ? fields[3] : ""
                let heading = rest.range(of: "@@").map { rest[$0.upperBound...] } ?? ""
                hunks.append(Hunk(oldStart: old, newStart: new, heading: heading.trimmingCharacters(in: .whitespaces)))
                continue
            }
            guard !hunks.isEmpty, let mark = line.utf8.first else { continue }
            switch mark {
            case UInt8(ascii: " "), UInt8(ascii: "-"), UInt8(ascii: "+"):
                hunks[hunks.count - 1].lines.append(Line(mark: mark, text: line.dropFirst(), endsLine: true))
            case UInt8(ascii: "\\"):
                let last = hunks[hunks.count - 1].lines.count - 1
                if last >= 0 { hunks[hunks.count - 1].lines[last].endsLine = false }
            default:
                continue
            }
        }
        return hunks
    }
}
