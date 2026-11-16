import Foundation

public struct GitBranch: Sendable, Hashable {
    public var name: String?
    public var commit: String?
    public var upstream: String?
    public var ahead = 0
    public var behind = 0

    public init(name: String? = nil, commit: String? = nil, upstream: String? = nil, ahead: Int = 0, behind: Int = 0) {
        self.name = name
        self.commit = commit
        self.upstream = upstream
        self.ahead = ahead
        self.behind = behind
    }

    public var isDetached: Bool { name == nil }
    public var isUnborn: Bool { commit == nil }
}

public struct GitEntry: Sendable, Hashable {
    public enum State: UInt8, Sendable {
        case unmodified, modified, typeChanged, added, deleted, renamed, copied, untracked, ignored, unmerged
    }

    public enum Conflict: UInt8, Sendable {
        case bothDeleted, addedByUs, deletedByThem, addedByThem, deletedByUs, bothAdded, bothModified
    }

    public struct Submodule: OptionSet, Sendable, Hashable {
        public let rawValue: UInt8
        public init(rawValue: UInt8) { self.rawValue = rawValue }

        public static let commitChanged = Submodule(rawValue: 1 << 0)
        public static let modified = Submodule(rawValue: 1 << 1)
        public static let untracked = Submodule(rawValue: 1 << 2)
    }

    public var path: String
    public var originalPath: String?
    public var index: State
    public var worktree: State
    public var conflict: Conflict?
    public var submodule: Submodule?
    public var headMode: UInt32 = 0
    public var indexMode: UInt32 = 0
    public var worktreeMode: UInt32 = 0
    public var similarity: Int?

    public init(path: String, index: State, worktree: State) {
        self.path = path
        self.index = index
        self.worktree = worktree
    }

    public var isStaged: Bool { conflict == nil && index != .unmodified && index != .untracked && index != .ignored }
    public var isUnstaged: Bool { conflict == nil && worktree != .unmodified && worktree != .ignored }
    public var isUntracked: Bool { worktree == .untracked }
}

public struct GitStatusReport: Sendable, Hashable {
    public var branch: GitBranch
    public var entries: [GitEntry]
    public var ignored: [String]

    public init(branch: GitBranch = GitBranch(), entries: [GitEntry] = [], ignored: [String] = []) {
        self.branch = branch
        self.entries = entries
        self.ignored = ignored
    }

    public static func parse(_ data: Data) -> GitStatusReport {
        var report = GitStatusReport()
        var records = data.split(separator: 0, omittingEmptySubsequences: false)[...]
        while let record = records.popFirst() {
            guard let kind = record.first else { continue }
            let text = String(decoding: record, as: UTF8.self)
            switch kind {
            case UInt8(ascii: "#"): report.branch.read(header: text)
            case UInt8(ascii: "1"): if let entry = ordinary(text, fields: 8) { report.entries.append(entry) }
            case UInt8(ascii: "2"):
                guard var entry = ordinary(text, fields: 9) else { continue }
                entry.originalPath = records.popFirst().map { String(decoding: $0, as: UTF8.self) }
                report.entries.append(entry)
            case UInt8(ascii: "u"): if let entry = unmerged(text) { report.entries.append(entry) }
            case UInt8(ascii: "?"): report.entries.append(GitEntry(path: String(text.dropFirst(2)), index: .untracked, worktree: .untracked))
            case UInt8(ascii: "!"):
                let path = text.dropFirst(2)
                report.ignored.append(String(path.hasSuffix("/") ? path.dropLast() : path))
            default: continue
            }
        }
        return report
    }

    static func ordinary(_ text: String, fields count: Int) -> GitEntry? {
        let fields = text.split(separator: " ", maxSplits: count, omittingEmptySubsequences: false)
        guard fields.count == count + 1 else { return nil }
        let states = Array(fields[1].utf8)
        guard states.count == 2 else { return nil }
        var entry = GitEntry(path: String(fields[count]), index: state(states[0]), worktree: state(states[1]))
        entry.submodule = submodule(fields[2])
        entry.headMode = UInt32(fields[3], radix: 8) ?? 0
        entry.indexMode = UInt32(fields[4], radix: 8) ?? 0
        entry.worktreeMode = UInt32(fields[5], radix: 8) ?? 0
        if count == 9 { entry.similarity = Int(fields[8].dropFirst()) }
        return entry
    }

    static func unmerged(_ text: String) -> GitEntry? {
        let fields = text.split(separator: " ", maxSplits: 10, omittingEmptySubsequences: false)
        guard fields.count == 11 else { return nil }
        var entry = GitEntry(path: String(fields[10]), index: .unmerged, worktree: .unmerged)
        entry.submodule = submodule(fields[2])
        entry.worktreeMode = UInt32(fields[6], radix: 8) ?? 0
        entry.conflict = switch fields[1] {
        case "DD": .bothDeleted
        case "AU": .addedByUs
        case "UD": .deletedByThem
        case "UA": .addedByThem
        case "DU": .deletedByUs
        case "AA": .bothAdded
        default: .bothModified
        }
        return entry
    }

    static func submodule(_ field: Substring) -> GitEntry.Submodule? {
        let flags = Array(field.utf8)
        guard flags.count == 4, flags[0] == UInt8(ascii: "S") else { return nil }
        var submodule: GitEntry.Submodule = []
        if flags[1] == UInt8(ascii: "C") { submodule.insert(.commitChanged) }
        if flags[2] == UInt8(ascii: "M") { submodule.insert(.modified) }
        if flags[3] == UInt8(ascii: "U") { submodule.insert(.untracked) }
        return submodule
    }

    static func state(_ letter: UInt8) -> GitEntry.State {
        switch letter {
        case UInt8(ascii: "M"): .modified
        case UInt8(ascii: "T"): .typeChanged
        case UInt8(ascii: "A"): .added
        case UInt8(ascii: "D"): .deleted
        case UInt8(ascii: "R"): .renamed
        case UInt8(ascii: "C"): .copied
        case UInt8(ascii: "U"): .unmerged
        default: .unmodified
        }
    }
}

extension GitBranch {
    mutating func read(header: String) {
        let parts = header.split(separator: " ", maxSplits: 2)
        guard parts.count == 3 else { return }
        let value = String(parts[2])
        switch parts[1] {
        case "branch.oid": commit = value == "(initial)" ? nil : value
        case "branch.head": name = value == "(detached)" ? nil : value
        case "branch.upstream": upstream = value
        case "branch.ab":
            let counts = value.split(separator: " ")
            ahead = counts.first.flatMap { Int($0.dropFirst()) } ?? 0
            behind = counts.dropFirst().first.flatMap { Int($0.dropFirst()) } ?? 0
        default: break
        }
    }
}
