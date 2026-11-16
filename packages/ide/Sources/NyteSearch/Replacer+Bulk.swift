import Foundation
import NyteCore

public struct MatchKey: Hashable, Sendable {
    public var path: String
    public var byte: Int64

    public init(path: String, byte: Int64) {
        self.path = path
        self.byte = byte
    }
}

extension Replacer {
    public static let hardLimit = 100_000

    public enum Bulk: Sendable {
        case ready(ReplacePlan)
        case refused(String)
    }

    public func planAll(engine: SearchEngine, unsaved: [String: String], excluding: Set<MatchKey> = [],
                        limit: Int = Replacer.hardLimit) async -> Bulk {
        var uncapped = query
        uncapped.limits = SearchQuery.Limits(matchesPerFile: limit + 1, matches: limit + 1, fileBytes: query.limits.fileBytes)
        let run: SearchRun
        do {
            run = try engine.start(uncapped, unsaved: unsaved)
        } catch {
            return .refused(error.message)
        }
        var plan = ReplacePlan()
        var found = 0
        for await event in run.events {
            if Task.isCancelled {
                run.cancel()
                continue
            }
            switch event {
            case let .batch(batch, _):
                found += batch.matchCount
                guard found <= limit else {
                    run.cancel()
                    continue
                }
                let chosen = (0..<batch.matchCount).filter { match in
                    excluding.isEmpty
                        || !excluding.contains(MatchKey(path: batch.paths[Int(batch.matchFile[match])], byte: batch.matchBytes[match].lowerBound))
                }
                let piece = self.plan(batch, matches: chosen, root: engine.root, unsaved: unsaved)
                plan.edit.files += piece.edit.files
                plan.inverse.files += piece.inverse.files
                plan.stale += piece.stale
            case let .finished(summary):
                if Task.isCancelled { return .refused("Replace All was stopped.") }
                guard found <= limit, summary.ending != .capped else { return .refused(Self.tooMany(limit)) }
                guard summary.ending == .complete else { return .refused("Replace All was stopped.") }
                return .ready(plan)
            }
        }
        return .refused("Replace All was stopped.")
    }

    public static func tooMany(_ limit: Int) -> String {
        "Replace All stops at \(limit.formatted()) occurrences and this search has more. Narrow it with a folder or a file filter."
    }
}
