import Foundation
import NyteCore

struct HostMismatch: Sendable, Equatable {
    enum Install: Sendable, Equatable {
        case desktop(URL)
        case commandLine
        case unknown
    }

    static let updateCommand = "nyte update"

    let reason: String
    let hostIsOlder: Bool
    var hostVersion: String?
    var hostRevision: Int?
    var install = Install.unknown

    var revisions: String {
        let required = "This IDE needs API revision \(Wire.minRevision) to \(Wire.revision)."
        let version = hostVersion.map { "Nyte \($0)" } ?? "This Nyte"
        guard let hostRevision else { return hostVersion == nil ? required : "\(version) is running. \(required)" }
        return "\(version) serves API revision \(hostRevision). \(required)"
    }

    var advice: String {
        guard hostIsOlder else { return "Update Nyte IDE to talk to this Nyte." }
        return switch install {
        case .desktop: "Nyte updates itself in the background and installs the update when it restarts."
        case .commandLine: "Update Nyte from a terminal, then restart nyte host."
        case .unknown: "Update Nyte, then try again."
        }
    }
}

enum ConnectionState: Sendable, Equatable {
    case missing
    case connecting
    case incompatible(HostMismatch)
    case failed(String)
    case ready
}

enum RowKind: UInt8, Sendable {
    case user, prose, tool, thinking, note, unknown
    case ended
    case failure
    case output
    case review
    case context
}

enum ToolGlyph: UInt8, Sendable {
    case read, list, edit, shell, delegate, denied, other

    var symbol: String {
        switch self {
        case .read: "doc.text"
        case .list: "folder"
        case .edit: "pencil"
        case .shell: "apple.terminal"
        case .delegate: "person.2"
        case .denied: "nosign"
        case .other: "wrench.and.screwdriver"
        }
    }
}

struct RowSpec: Sendable, Equatable {
    var kind: RowKind
    var key: String
    var part: String = ""
    var lead = ""
    var text: String
    var version: Int = 0
    var running = false
    var pending = false
    var failed = false
    var glyph: ToolGlyph = .other
    var added = 0
    var removed = 0
    var expandable = false
    var retryable = false
    var reviewable = false
}

enum ReviewTarget: Sendable, Equatable {
    case step(part: String)
    case run(turn: String)
    case session

    static let runPrefix = "review:"

    init(key: String) {
        self = key.hasPrefix(Self.runPrefix) ? .run(turn: String(key.dropFirst(Self.runPrefix.count))) : .step(part: key)
    }
}

struct TranscriptSnapshot: Sendable {
    var rows: [RowSpec]
    var live: Bool
    var sessionOpen: Bool
    var canLoadEarlier: Bool
    var activity: Activity? = nil
    var contexts: [String: [ContextFormat.Chip]] = [:]
    var deadlines: [String: Date] = [:]
}

struct Activity: Sendable, Equatable {
    enum Kind: Sendable, Equatable { case working, retrying, stopping }

    var kind: Kind
    var since: Date
    var reason = ""
    var until: Date?
}

enum SessionRun: Sendable, Equatable {
    case idle
    case working(since: Date)
    case retrying(reason: String, until: Date? = nil)
    case asking(part: String)
    case failed(String)
}

struct SessionSummary: Sendable, Equatable {
    var id: String
    var title: String?
    var lastActivity: Date
    var run = SessionRun.idle
    var backgroundWorking = 0
    var backgroundWaiting = 0
    var unread = false
    var pinned = false
    var reachable = true
    var tip: String?
    var asked: String?
    var askKind: AskKind?
    var lastRun: String?
    var worktree: String?
    var changes: ChangeTotals?
}

enum AskKind: Sendable, Equatable {
    case approval, question
}

struct ChangeTotals: Sendable, Equatable {
    var files: Int
    var added: Int
    var removed: Int

    init(files: Int, added: Int, removed: Int) {
        self.files = files
        self.added = added
        self.removed = removed
    }

    init(_ run: [Wire.RunFile]) {
        files = run.count
        added = run.reduce(0) { $0 + ($1.added ?? 0) }
        removed = run.reduce(0) { $0 + ($1.removed ?? 0) }
    }
}

struct ModelRef: Sendable, Hashable, Codable {
    let provider: String
    let id: String
}

struct ModelChoice: Sendable, Equatable {
    let ref: ModelRef
    let name: String
    let provider: String
}

struct Approval: Sendable, Equatable {
    let session: String
    let part: String
    let title: String
    let detail: String
    let command: Bool
    let subagent: Bool
    var tool = ""
}

struct QuestionItem: Sendable, Equatable {
    let header: String
    let question: String
    let options: [(label: String, description: String)]

    static func == (left: QuestionItem, right: QuestionItem) -> Bool {
        left.header == right.header && left.question == right.question
            && left.options.map(\.label) == right.options.map(\.label)
    }
}

struct Question: Sendable, Equatable {
    let session: String
    let part: String
    let items: [QuestionItem]
    let subagent: Bool
}

enum RequestAnswer: Sendable, Equatable {
    case allowOnce
    case allowForSession
    case deny
    case choose([[String]])
    case skip
}

enum AgentRequest: Sendable, Equatable {
    case approval(Approval)
    case question(Question)

    var session: String {
        switch self {
        case let .approval(approval): approval.session
        case let .question(question): question.session
        }
    }

    var part: String {
        switch self {
        case let .approval(approval): approval.part
        case let .question(question): question.part
        }
    }

    var kind: AskKind {
        switch self {
        case .approval: .approval
        case .question: .question
        }
    }

    var summary: String {
        switch self {
        case let .approval(approval):
            let subject = approval.detail.split(separator: "\n", maxSplits: 1).first.map(String.init) ?? ""
            if approval.command { return "Wants to run " + subject }
            return subject.isEmpty ? approval.title : approval.title.replacingOccurrences(of: "?", with: "") + ": " + subject
        case let .question(question):
            return question.items.first?.question ?? "Asked a question"
        }
    }
}

struct ToolOutput: Sendable {
    let text: String
    let diff: Bool
}

struct AgentEvent: Sendable {
    let session: Int
    let connection: Int
    let update: AgentUpdate
}

enum AgentUpdate: Sendable {
    case connection(ConnectionState)
    case sessions([SessionSummary])
    case models([ModelChoice], current: ModelRef?, problem: String? = nil)
    case title(String?)
    case transcript(TranscriptSnapshot)
    case text(part: String, version: Int, text: String, append: Bool)
    case requests([AgentRequest])
    case draft(String)
    case shown(String?)
    case renameRefused(String)
    case sendFailed(String?)
    case draftContext([AgentContext])
    case permission(Wire.Setting?)
    case place(worktree: String?, path: String?)
    case permissionRefused(String)
}
