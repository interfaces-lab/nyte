import Foundation
import NyteCore

public struct ChangedFiles: Sendable, Equatable {
    public var staged: [URL] = []
    public var unstaged: [URL] = []
    public var searchable: [URL] = []

    public init() {}

    init(_ report: GitStatusReport, root repository: GitRepository) {
        func urls(_ entries: [GitEntry]) -> [URL] { entries.map { repository.url(of: $0.path).standardizedFileURL } }
        staged = urls(report.entries.filter(\.isStaged))
        unstaged = urls(report.entries.filter { $0.isUnstaged || $0.conflict != nil })
        let present = report.entries.filter { entry in
            entry.worktree != .deleted && !(entry.index == .deleted && entry.worktree == .unmodified) && entry.submodule == nil
        }
        searchable = Array(Set(urls(present))).sorted { $0.path < $1.path }
    }
}

struct ChangesSnapshot: Sendable, Equatable {
    var report: GitStatusReport
    var unstaged: [String: GitLineCount]
    var staged: [String: GitLineCount]
    var untracked: [String: GitLineCount]
    var subject: String?

    static let largestCountedFile = 8 << 20

    @concurrent static func load(_ repository: GitRepository) async throws(GitFailure) -> ChangesSnapshot {
        async let report = repository.status()
        async let unstaged = repository.lineCounts(staged: false)
        async let staged = repository.lineCounts(staged: true)
        let status: GitStatusReport
        let counts: (unstaged: [String: GitLineCount], staged: [String: GitLineCount])
        do {
            status = try await report
            counts = (unstaged: try await unstaged, staged: try await staged)
        } catch let failure as GitFailure {
            throw failure
        } catch {
            throw GitFailure(.unreadable, command: "git status", message: error.localizedDescription)
        }
        var untracked: [String: GitLineCount] = [:]
        for entry in status.entries where entry.isUntracked {
            guard let count = countLines(repository.url(of: entry.path)) else { continue }
            untracked[entry.path] = count
        }
        let subject = status.branch.isUnborn ? nil : try? await repository.headSubject()
        return ChangesSnapshot(report: status, unstaged: counts.unstaged, staged: counts.staged, untracked: untracked, subject: subject)
    }

    static func countLines(_ url: URL) -> GitLineCount? {
        guard let data = try? Data(contentsOf: url, options: .mappedIfSafe), data.count <= largestCountedFile else { return nil }
        let lines = TextLines(bytes: [UInt8](data))
        return lines.isBinary ? GitLineCount(added: 0, removed: 0, isBinary: true) : GitLineCount(added: lines.count, removed: 0)
    }

    func count(for entry: GitEntry, in group: ChangeGroup) -> GitLineCount? {
        switch group {
        case .staged: staged[entry.path]
        case .changes: entry.isUntracked ? untracked[entry.path] : unstaged[entry.path]
        case .conflicts: unstaged[entry.path]
        }
    }
}

enum ChangeGroup: UInt8, CaseIterable, Sendable {
    case conflicts, staged, changes

    var title: String {
        switch self {
        case .conflicts: "Conflicts"
        case .staged: "Staged"
        case .changes: "Changes"
        }
    }

    func contains(_ entry: GitEntry) -> Bool {
        switch self {
        case .conflicts: entry.conflict != nil
        case .staged: entry.isStaged
        case .changes: entry.isUnstaged
        }
    }
}

struct ChangeRows: Equatable {
    var groups: [ChangeGroup] = []
    var entries: [Int32] = []
    var groupStarts: [ChangeGroup: Int] = [:]
    var headerRows: [Int] = []

    var count: Int { groups.count }

    func isHeader(_ row: Int) -> Bool { entries[row] < 0 }

    static func build(_ snapshot: ChangesSnapshot, collapsed: Set<ChangeGroup>) -> ChangeRows {
        var rows = ChangeRows()
        let entries = snapshot.report.entries
        let order = entries.indices.sorted { entries[$0].path.localizedStandardCompare(entries[$1].path) == .orderedAscending }
        for group in ChangeGroup.allCases {
            let members = order.filter { group.contains(entries[$0]) }
            guard !members.isEmpty else { continue }
            rows.groupStarts[group] = rows.count
            rows.headerRows.append(rows.count)
            rows.groups.append(group)
            rows.entries.append(-1)
            guard !collapsed.contains(group) else { continue }
            for member in members {
                rows.groups.append(group)
                rows.entries.append(Int32(member))
            }
        }
        return rows
    }

    func members(of group: ChangeGroup, in snapshot: ChangesSnapshot) -> [Int] {
        snapshot.report.entries.indices.filter { group.contains(snapshot.report.entries[$0]) }
    }
}

enum StatusMark {
    static func letter(_ entry: GitEntry, in group: ChangeGroup) -> (letter: Character, word: String) {
        if let conflict = entry.conflict { return ("!", word(conflict)) }
        let state = group == .staged ? entry.index : entry.worktree
        switch state {
        case .modified: return ("M", "modified")
        case .typeChanged: return ("T", "type changed")
        case .added: return ("A", "added")
        case .deleted: return ("D", "deleted")
        case .renamed: return ("R", "renamed")
        case .copied: return ("C", "copied")
        case .untracked: return ("U", "untracked")
        case .unmerged: return ("!", "conflicted")
        case .unmodified, .ignored: return (entry.submodule == nil ? "M" : "S", "changed")
        }
    }

    static func word(_ conflict: GitEntry.Conflict) -> String {
        switch conflict {
        case .bothDeleted: "both deleted"
        case .addedByUs: "added by us"
        case .deletedByThem: "deleted by them"
        case .addedByThem: "added by them"
        case .deletedByUs: "deleted by us"
        case .bothAdded: "both added"
        case .bothModified: "both modified"
        }
    }
}

struct BranchLine: Equatable {
    var name: String
    var tracking: String
    var tip: String?
    var spoken: String

    static func make(_ branch: GitBranch, subject: String?) -> BranchLine {
        let name = branch.name ?? "Detached at " + String(branch.commit?.prefix(7) ?? "")
        var marks: [String] = [], words: [String] = []
        if branch.upstream != nil {
            if branch.ahead > 0 {
                marks.append("\u{2191}\(branch.ahead)")
                words.append("\(branch.ahead) ahead")
            }
            if branch.behind > 0 {
                marks.append("\u{2193}\(branch.behind)")
                words.append("\(branch.behind) behind")
            }
        }
        let tip = branch.isUnborn ? "No commits yet" : subject
        let spoken = (["Branch " + name] + words + [tip].compactMap { $0 }).joined(separator: ", ")
        return BranchLine(name: name, tracking: marks.joined(separator: " "), tip: tip, spoken: spoken)
    }
}

enum CommitReadiness: Equatable {
    case ready
    case blocked(String)

    static func decide(message: String, staged: Int, conflicts: Int, amend: Bool, busy: Bool) -> CommitReadiness {
        if busy { return .blocked("Committing…") }
        if conflicts > 0 { return .blocked("Resolve conflicts first") }
        if staged == 0, !amend { return .blocked("Stage changes to commit") }
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return .blocked("Write a commit message") }
        return .ready
    }

    static let subjectLimit = 72

    static func subjectOverflow(_ message: String) -> Int? {
        let subject = message.prefix { $0 != "\n" }
        return subject.count > subjectLimit ? subject.count : nil
    }
}
