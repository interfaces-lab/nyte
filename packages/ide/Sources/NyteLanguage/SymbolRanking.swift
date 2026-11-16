import Foundation
import NyteCore
import NyteUI

enum SymbolRanking {
    static let limit = 500

    static func rank(_ symbols: [WorkspaceSymbol], for query: String, near file: URL?, in workspace: Workspace) -> [SymbolMatch] {
        let nearFolder = file.map { $0.deletingLastPathComponent().pathComponents }
        let scored = symbols.compactMap { symbol -> (SymbolMatch, Int, Int)? in
            guard let (quality, ranges) = match(query, in: symbol.name) ?? qualifiedMatch(query, in: symbol) else { return nil }
            let place = workspace.relativePath(of: symbol.location.url) + ":\(symbol.location.range.start.line + 1)"
            let distance = proximity(of: symbol.location.url, to: file, nearFolder: nearFolder, root: workspace.root)
            return (SymbolMatch(symbol: symbol, quality: quality, matched: ranges, file: place), kindRank(symbol.kind), distance)
        }
        let ordered = scored.sorted { left, right in
            if left.0.quality != right.0.quality { return left.0.quality < right.0.quality }
            if left.1 != right.1 { return left.1 < right.1 }
            if left.2 != right.2 { return left.2 < right.2 }
            let leftName = left.0.symbol.name
            let rightName = right.0.symbol.name
            if leftName.count != rightName.count { return leftName.count < rightName.count }
            if leftName != rightName { return leftName < rightName }
            return left.0.file < right.0.file
        }
        var seen: Set<String> = []
        return Array(ordered.map(\.0).filter { seen.insert("\($0.symbol.name)\u{0}\($0.file)").inserted }.prefix(limit))
    }

    static func kindRank(_ kind: SymbolKind) -> Int {
        switch kind {
        case .class, .struct, .interface, .enum, .typeParameter: 0
        case .function, .method, .constructor: 1
        case .constant, .enumMember: 2
        case .field, .property, .variable, .event, .operator: 3
        case .module, .namespace, .package, .file: 4
        case .string, .number, .boolean, .array, .object, .key, .null: 5
        }
    }

    static func proximity(of url: URL, to file: URL?, nearFolder: [String]?, root: URL) -> Int {
        let path = url.path
        let outside = !path.hasPrefix(root.path + "/") || path.contains("/node_modules/") || path.contains("/vendor/")
        guard !outside else { return Int.max / 2 }
        if url == file { return -1 }
        guard let nearFolder else { return 0 }
        let folder = url.deletingLastPathComponent().pathComponents
        let shared = zip(folder, nearFolder).prefix { $0 == $1 }.count
        return folder.count + nearFolder.count - 2 * shared
    }

    static func match(_ query: String, in name: String) -> (SymbolMatch.Quality, [NSRange])? {
        let needle = query as NSString
        let haystack = name as NSString
        guard needle.length > 0, needle.length <= haystack.length else {
            return needle.length == 0 ? (.scattered, []) : nil
        }
        let whole = NSRange(location: 0, length: haystack.length)
        let head = NSRange(location: 0, length: needle.length)
        if name == query { return (.exact, [whole]) }
        if name.caseInsensitiveCompare(query) == .orderedSame { return (.exactIgnoringCase, [whole]) }
        if name.hasPrefix(query) { return (.prefix, [head]) }
        if haystack.range(of: query, options: [.caseInsensitive, .anchored]).location != NSNotFound { return (.prefixIgnoringCase, [head]) }
        if let ranges = wordStarts(Array(query.utf16), in: Array(name.utf16)) { return (.wordStarts, ranges) }
        let found = haystack.range(of: query, options: .caseInsensitive)
        if found.location != NSNotFound { return (.substring, [found]) }
        let scattered = RowContent.matches(of: query, in: name)
        return scattered.isEmpty ? nil : (.scattered, scattered)
    }

    private static func qualifiedMatch(_ query: String, in symbol: WorkspaceSymbol) -> (SymbolMatch.Quality, [NSRange])? {
        guard let dot = query.lastIndex(of: "."), !symbol.container.isEmpty else { return nil }
        let member = String(query[query.index(after: dot)...])
        let owner = String(query[..<dot]).lowercased()
        guard symbol.container.lowercased().contains(owner), let found = match(member, in: symbol.name) else { return nil }
        return (max(found.0, .wordStarts), found.1)
    }

    static func wordStarts(_ query: [UInt16], in name: [UInt16]) -> [NSRange]? {
        guard let first = query.first, let start = name.first, fold(first) == fold(start) else { return nil }
        var ranges = [NSRange(location: 0, length: 1)]
        var position = 1
        for unit in query.dropFirst() {
            if position < name.count, fold(name[position]) == fold(unit), !isWordStart(name, position) || unit == name[position] {
                if let last = ranges.last, NSMaxRange(last) == position { ranges[ranges.count - 1].length += 1 } else {
                    ranges.append(NSRange(location: position, length: 1))
                }
                position += 1
                continue
            }
            guard let next = (position..<name.count).first(where: { isWordStart(name, $0) && fold(name[$0]) == fold(unit) }) else { return nil }
            ranges.append(NSRange(location: next, length: 1))
            position = next + 1
        }
        return ranges
    }

    private static func isWordStart(_ name: [UInt16], _ index: Int) -> Bool {
        guard index > 0 else { return true }
        let unit = name[index]
        let previous = name[index - 1]
        let upper = { (value: UInt16) in value >= 65 && value <= 90 }
        let letter = { (value: UInt16) in upper(value) || (value >= 97 && value <= 122) || (value >= 48 && value <= 57) }
        if upper(unit) && !upper(previous) { return true }
        if upper(unit), index + 1 < name.count, upper(previous), !upper(name[index + 1]), letter(name[index + 1]) { return true }
        return letter(unit) && !letter(previous)
    }

    private static func fold(_ unit: UInt16) -> UInt16 { unit >= 65 && unit <= 90 ? unit + 32 : unit }
}
