import Foundation
import NyteCore

extension LanguageService {
    static let classifiedFileLimit = 60

    struct Highlight: Sendable {
        var range: TextSpan
        var kind: Int
    }

    public func classifiedReferences(at position: TextPosition, in url: URL) async -> [Usage] {
        let url = Wire.canonical(url)
        guard let (_, connection) = route(url) else { return [] }
        let found = await locations(.references(includeDeclaration: true), at: position, in: url)
        let declarations = Set(await locations(.definition, at: position, in: url))
        let byFile = Dictionary(grouping: found, by: \.url)
        var kinds: [FileLocation: Int] = [:]
        if byFile.count <= Self.classifiedFileLimit {
            await withTaskGroup(of: [(FileLocation, Int)].self) { group in
                for (file, places) in byFile {
                    guard let first = places.first else { continue }
                    group.addTask { [weak self] in
                        guard let self else { return [] }
                        let answer = await ask(connection, .documentHighlight, Wire.at(first.range.start, in: file)) { connection, json in
                            (json.array ?? []).compactMap { item in
                                connection.range(item["range"]).map { Highlight(range: $0, kind: item["kind"]?.int ?? 1) }
                            }
                        }
                        return ((try? answer.get()) ?? []).map { (FileLocation(url: file, range: $0.range), $0.kind) }
                    }
                }
                for await pairs in group { for (place, kind) in pairs { kinds[place] = kind } }
            }
        }
        let buffers = Dictionary(byFile.keys.compactMap { file in text(of: file).map { (file, $0) } }) { first, _ in first }
        let texts = await Self.lines(of: Array(byFile.keys), buffers: buffers)
        return found.map { place in
            let line = texts[place.url].flatMap { $0.indices.contains(place.range.start.line) ? $0[place.range.start.line] : nil } ?? ""
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            let kind: Usage.Kind = if declarations.contains(where: { $0.url == place.url && $0.range.start == place.range.start }) {
                .declaration
            } else if trimmed.hasPrefix("import ") || (trimmed.hasPrefix("export ") && trimmed.contains(" from ")) {
                .import
            } else {
                switch kinds[place] {
                case 3?: .write
                case 2?: .read
                default: .other
                }
            }
            return Usage(location: place, kind: kind)
        }
    }

    @concurrent
    static func lines(of files: [URL], buffers: [URL: String]) async -> [URL: [Substring]] {
        Dictionary(files.map { file in
            let text = buffers[file] ?? (try? String(contentsOf: file, encoding: .utf8)) ?? ""
            return (file, text.split(separator: "\n", omittingEmptySubsequences: false))
        }) { first, _ in first }
    }
}
