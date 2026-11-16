import AppKit
import NyteCore

extension FindInFilesViewController {
    static let askAgentTitle = "Ask Nyte"

    @discardableResult
    func askAgent(about rows: IndexSet) -> Bool {
        let chosen = matches(in: rows)
        guard let onAskAgent, !chosen.isEmpty else { return false }
        let snapshot = results, root = workspace.root, buffers = unsaved
        Task {
            let contexts = await Task.detached(priority: .userInitiated) {
                AgentLines.contexts(for: chosen, in: snapshot, root: root, unsaved: buffers)
            }.value
            onAskAgent(contexts)
        }
        return true
    }
}

enum AgentLines {
    static func contexts(for matches: [Int], in results: SearchResults, root: URL, unsaved: [String: String]) -> [AgentContext] {
        let byFile = Dictionary(grouping: matches) { Int(results.matchFile[$0]) }
        return byFile.keys.sorted { results.fileOrder[$0] < results.fileOrder[$1] }.flatMap { file -> [AgentContext] in
            let path = results.paths[file]
            let url = root.appendingPathComponent(path)
            let text = unsaved[path] ?? (try? Data(contentsOf: url)).map { String(decoding: $0, as: UTF8.self) } ?? ""
            let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
            let ranges = merged((byFile[file] ?? []).map { (first: Int(results.matchLine[$0]), last: Int(results.matchEndLine[$0])) })
            return ranges.map { first, last in
                let body = lines[min(first, lines.count)..<min(last + 1, lines.count)]
                    .map { $0.hasSuffix("\r") ? String($0.dropLast()) : String($0) }.joined(separator: "\n")
                return .lines(AgentContext.Lines(file: url, range: AgentContext.LineRange(first: first + 1, last: last + 1), text: body))
            }
        }
    }

    static func merged(_ spans: [(first: Int, last: Int)]) -> [(first: Int, last: Int)] {
        var out: [(first: Int, last: Int)] = []
        for span in spans.sorted(by: { $0.first < $1.first }) {
            if let previous = out.last, span.first <= previous.last + 1 {
                out[out.count - 1].last = max(previous.last, span.last)
            } else {
                out.append(span)
            }
        }
        return out
    }
}
