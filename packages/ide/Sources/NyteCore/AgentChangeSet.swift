import Foundation

public struct AgentChangeSet: Sendable, Equatable {
    public enum Scope: Sendable, Equatable {
        case step(part: String)
        case run(turn: String)
        case session
    }

    public enum Status: Sendable, Equatable {
        case added, modified, deleted, renamed, untracked, conflicted
        case unknown(String)
    }

    public enum Content: Sendable, Equatable {
        case texts(before: String, after: String)
        case patches([String])
        case unavailable(String)
    }

    public struct File: Sendable, Equatable {
        public let path: String
        public let status: Status
        public let content: Content
        public let added: Int
        public let removed: Int

        public init(path: String, status: Status, content: Content, added: Int, removed: Int) {
            self.path = path
            self.status = status
            self.content = content
            self.added = added
            self.removed = removed
        }
    }

    public let session: String
    public let scope: Scope
    public let title: String
    public let root: URL
    public let files: [File]

    public init(session: String, scope: Scope, title: String, root: URL, files: [File]) {
        self.session = session
        self.scope = scope
        self.title = title
        self.root = root
        self.files = files
    }

    public var added: Int { files.reduce(0) { $0 + $1.added } }
    public var removed: Int { files.reduce(0) { $0 + $1.removed } }
}
