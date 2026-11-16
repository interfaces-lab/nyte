import Foundation
import NyteCore

enum FuzzyMatch {
    static let enabledBonus = 1_000
    private static let wordStart = 8
    private static let consecutive = 4
    private static let prefix = 16
    private static let space = UInt16(UInt8(ascii: " "))

    static func score(_ query: String, in text: String) -> Int? {
        guard !query.isEmpty else { return 0 }
        guard let positions = positions(of: query, in: text) else { return nil }
        let characters = Array(text.utf16)
        var score = positions.first == 0 ? prefix : 0
        for (index, position) in positions.enumerated() {
            if position == 0 || characters[position - 1] == Self.space { score += wordStart }
            if index > 0, positions[index - 1] == position - 1 { score += consecutive }
        }
        let spread = (positions.last ?? 0) - (positions.first ?? 0)
        return score - spread
    }

    private static func positions(of query: String, in text: String) -> [Int]? {
        let needle = Array(query.lowercased().utf16).filter { $0 != Self.space }
        guard !needle.isEmpty else { return nil }
        let haystack = Array(text.lowercased().utf16)
        var found: [Int] = []
        var cursor = 0
        for unit in needle {
            guard let at = haystack[cursor...].firstIndex(of: unit) else { return nil }
            found.append(at)
            cursor = at + 1
        }
        return found
    }
}
