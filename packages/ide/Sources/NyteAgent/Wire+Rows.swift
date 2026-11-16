import Foundation
import NyteCore

extension Wire {
    struct Tables: Decodable {
        let messages: Table<Message>?
        let turns: Table<Turn>?
        let parts: Table<Part>?
        let heads: Table<HeadRow>?
        let settings: Table<SettingsRow>?
        let background: Table<BackgroundRow>?
        let catalog: Table<CatalogRow>?
    }

    struct HeadWindow: Decodable {
        let seq: Int
        let order: [String]
        let leadingPrompt: String?
        let complete: Bool
        let tables: Tables
    }

    struct SessionChange: Decodable {
        let seq: Int
        let tables: Tables
        let paths: [PathChange]
    }

    struct PathChange: Decodable {
        let head: String
        let after: String?
        let ids: [String]
    }

    struct HistoryPage: Decodable {
        let messages: [Message]
        let turns: [Turn]

        init(from decoder: any Decoder) throws {
            let object = try decoder.container(keyedBy: Key.self)
            messages = (try object.value("messages") as Lenient<Message>).items
            turns = (try object.value("turns") as Lenient<Turn>).items
        }
    }

    struct Message: Decodable {
        enum Body {
            case user(UserMessage)
            case part(PartMessage)
            case unknown(String)
        }

        let id: String
        let turn: String?
        let body: Body

        init(from decoder: any Decoder) throws {
            let (object, kind) = try Wire.kind(decoder)
            id = try object.value("id")
            turn = try object.optional("turn")
            switch kind {
            case "user":
                let status: String = try object.object("status").value("kind")
                body = .user(UserMessage(content: try object.value("content"), source: try object.value("source"),
                                         landed: status == "landed"))
            case "part":
                body = .part(PartMessage(part: try object.value("part"), body: try PartBody(object),
                                         elided: try object.optional("elided") ?? false))
            default: body = Wire.pick(kind, "message kind", [:], Body.unknown)
            }
        }
    }

    struct UserMessage {
        let content: Prompt
        let source: Source
        let landed: Bool
    }

    struct Prompt: Decodable {
        enum Item: Decodable {
            case text(String)
            case file(String)
            case reference(String)
            case skill(String)
            case excerpt(ExcerptSource, text: String)
            case unknown(String)

            init(from decoder: any Decoder) throws {
                let (object, kind) = try Wire.kind(decoder)
                switch kind {
                case "text": self = .text(try object.value("text"))
                case "file": self = .file(try object.optional("name") ?? "file")
                case "reference": self = .reference(try object.value("path"))
                case "skill": self = .skill(try object.value("name"))
                case "excerpt":
                    let source = try object.object("source")
                    let kind: String = try source.value("kind")
                    let origin: ExcerptSource = switch kind {
                    case "diff": .diff(path: try source.value("path"), side: try source.value("side"), start: try source.value("start"),
                                       end: try source.value("end"))
                    case "terminal": .terminal(command: try source.optional("command"))
                    default: .other(kind)
                    }
                    self = .excerpt(origin, text: try object.value("text"))
                default: self = Wire.pick(kind, "content item", [:], Self.unknown)
                }
            }
        }

        let items: [Item]

        init(from decoder: any Decoder) throws {
            let single = try decoder.singleValueContainer()
            if let text = try? single.decode(String.self) {
                items = [.text(text)]
                return
            }
            items = try single.decode(Lenient<Item>.self).items
        }
    }

    enum Source: Decodable, Equatable {
        case user, child, job, shell, action, answer
        case unknown(String)

        init(from decoder: any Decoder) throws {
            let (_, kind) = try Wire.kind(decoder)
            self = Wire.pick(kind, "message source", [
                "user": .user, "child": .child, "job": .job, "shell": .shell, "action": .action, "answer": .answer,
            ], Self.unknown)
        }
    }

    struct PartMessage {
        let part: String
        let body: PartBody
        let elided: Bool
    }

    struct Part: Decodable {
        let id: String
        let body: PartBody

        init(from decoder: any Decoder) throws {
            let object = try decoder.container(keyedBy: Key.self)
            id = try object.value("id")
            body = try PartBody(object)
        }
    }

    struct PartRead: Decodable {
        let part: Part?
    }

    struct PartBody {
        let content: PartContent
        let version: Int
        let status: PartStatus

        init(_ object: KeyedDecodingContainer<Key>) throws {
            version = try object.value("version")
            status = try object.value("status")
            content = try PartContent(kind: try object.value("partKind"), object)
        }
    }

    enum PartContent {
        case text(String)
        case thinking(String)
        case tool(ToolState)
        case compaction
        case branchSummary
        case approval(ApprovalState)
        case question(QuestionState)
        case other(String)

        private struct Markdown: Decodable { let markdown: String }

        init(kind: String, _ object: KeyedDecodingContainer<Key>) throws {
            let state = Key("state")
            do {
                switch kind {
                case "text": self = .text(try object.decode(Markdown.self, forKey: state).markdown)
                case "thinking": self = .thinking(try object.decode(Markdown.self, forKey: state).markdown)
                case "tool": self = .tool(try object.decode(ToolState.self, forKey: state))
                case "compaction": self = .compaction
                case "branchSummary": self = .branchSummary
                case "ask/approval": self = .approval(try object.decode(ApprovalState.self, forKey: state))
                case "ask/question": self = .question(try object.decode(QuestionState.self, forKey: state))
                default: self = Wire.pick(kind, "part kind", [:], Self.other)
                }
            } catch {
                Wire.skipped("\(kind) part state", error)
                self = .other(kind)
            }
        }
    }

    enum PartStatus: Decodable, Equatable {
        case live, waiting, settled
        case failed(Failure)
        case unknown(String)

        init(from decoder: any Decoder) throws {
            let (object, kind) = try Wire.kind(decoder)
            switch kind {
            case "failed": self = .failed(try object.value("failure"))
            default: self = Wire.pick(kind, "part status", ["live": .live, "waiting": .waiting, "settled": .settled], Self.unknown)
            }
        }
    }
}

extension Wire {
    enum ToolClass: Decodable, Equatable {
        case read(path: String)
        case list(path: String)
        case edit(path: String)
        case shell(command: String)
        case delegate(title: String?)
        case custom(label: String)
        case unknown(String)

        init(from decoder: any Decoder) throws {
            let (object, kind) = try Wire.kind(decoder)
            switch kind {
            case "read": self = .read(path: try object.value("path"))
            case "list": self = .list(path: try object.value("path"))
            case "edit": self = .edit(path: try object.value("path"))
            case "shell": self = .shell(command: try object.value("command"))
            case "delegate": self = .delegate(title: try object.optional("title"))
            case "custom": self = .custom(label: try object.value("label"))
            default: self = Wire.pick(kind, "tool class", [:], Self.unknown)
            }
        }
    }

    struct ToolState: Decodable {
        enum Phase: Equatable { case calling, running, settled, unknown(String) }

        struct Changes: Decodable {
            let added: Int
            let removed: Int
        }

        private struct Written: Decodable { let content: String? }

        let name: String
        let asksQuestion: Bool
        let written: String?
        let subject: ToolClass
        let phase: Phase
        let outcome: ToolOutcome?
        let changes: Changes?

        init(from decoder: any Decoder) throws {
            let object = try decoder.container(keyedBy: Key.self)
            name = try object.value("name")
            asksQuestion = name == "question"
            written = name == "write" ? try object.optional("args").flatMap { (args: Written) in args.content } : nil
            subject = try object.value("class")
            phase = Wire.pick(try object.value("phase"), "tool phase",
                              ["calling": .calling, "running": .running, "settled": .settled], Phase.unknown)
            outcome = try object.optional("outcome")
            changes = try object.optional("changes")
        }
    }

    enum ShellEnd: Equatable {
        case exitedCleanly, exitedWithError, timedOut, other

        static let exitPrefix = "[exit code "
        static let cleanExit = "[exit code 0]"
        static let timeoutPrefix = "[stopped after "
        static let lostLine = "[the process was lost]"

        init(output: String) {
            let last = output.split(separator: "\n").last.map(String.init) ?? ""
            if last == Self.cleanExit {
                self = .exitedCleanly
            } else if last.hasPrefix(Self.exitPrefix) || last == Self.lostLine {
                self = .exitedWithError
            } else if last.hasPrefix(Self.timeoutPrefix) {
                self = .timedOut
            } else {
                self = .other
            }
        }
    }

    enum ToolOutcome: Decodable {
        case ok(text: String, entry: PatchEntry?, shell: ShellEnd)
        case failed(String)
        case interrupted
        case rejected(String)
        case stopped
        case unknown(String)

        private struct Content: Decodable {
            let text: String?
        }

        init(from decoder: any Decoder) throws {
            let (object, kind) = try Wire.kind(decoder)
            switch kind {
            case "ok":
                let content: [Content] = try object.optional("content") ?? []
                let text = content.compactMap(\.text).joined(separator: "\n")
                self = .ok(text: text, entry: try? object.decode(PatchEntry.self, forKey: Key("output")),
                           shell: ShellEnd(output: text))
            case "failed": self = .failed(try object.optional("message") ?? "")
            case "rejected": self = .rejected(try object.optional("reason") ?? "")
            default: self = Wire.pick(kind, "tool outcome", ["interrupted": .interrupted, "stopped": .stopped], Self.unknown)
            }
        }
    }

    struct PatchEntry: Decodable, Equatable {
        enum Body: Equatable {
            case text(patch: String, added: Int, removed: Int)
            case binary, empty
            case tooLarge(limit: Int)
            case failed(String)
            case unknown(String)
        }

        let path: String
        let status: AgentChangeSet.Status
        let digest: String
        let body: Body

        init(from decoder: any Decoder) throws {
            let (object, kind) = try Wire.kind(decoder)
            path = try object.value("path")
            digest = try object.value("digest")
            status = Wire.pick(try object.value("status"), "file status", [
                "added": .added, "modified": .modified, "deleted": .deleted, "renamed": .renamed, "untracked": .untracked,
                "conflicted": .conflicted,
            ], AgentChangeSet.Status.unknown)
            switch kind {
            case "text": body = .text(patch: try object.value("patch"), added: try object.value("added"), removed: try object.value("removed"))
            case "binary": body = .binary
            case "empty": body = .empty
            case "too-large": body = .tooLarge(limit: try object.value("limit"))
            case "failed": body = .failed(try object.optional("reason") ?? "")
            default: body = Wire.pick(kind, "patch kind", [:], Body.unknown)
            }
        }
    }

    struct ApprovalState: Decodable {
        enum Reason: Equatable { case shell, edit, outside, tool, unknown(String) }

        let tool: String
        let subject: ToolClass
        let reason: Reason
        let decided: Bool

        init(from decoder: any Decoder) throws {
            let object = try decoder.container(keyedBy: Key.self)
            tool = try object.value("tool")
            subject = try object.value("class")
            reason = Wire.pick(try object.value("reason"), "approval reason",
                               ["shell": .shell, "edit": .edit, "outside": .outside, "tool": .tool], Reason.unknown)
            decided = (try object.optional("decision") as String?) != nil
        }
    }

    struct QuestionState: Decodable {
        enum Phase: Equatable { case asking, open, answered, skipped, unknown(String) }

        struct Item: Decodable {
            struct Option: Decodable {
                let label: String
                let description: String
            }

            let header: String
            let question: String
            let options: [Option]
        }

        let questions: [Item]
        let phase: Phase

        init(from decoder: any Decoder) throws {
            let object = try decoder.container(keyedBy: Key.self)
            questions = try object.value("questions")
            phase = Wire.pick(try object.object("phase").value("kind"), "question phase",
                              ["asking": .asking, "open": .open, "answered": .answered, "skipped": .skipped], Phase.unknown)
        }
    }

    struct Turn: Decodable {
        enum State: Decodable {
            case working, waiting
            case ended(RunEnd)
            case unknown(String)

            init(from decoder: any Decoder) throws {
                let (object, kind) = try Wire.kind(decoder)
                switch kind {
                case "ended": self = .ended(try object.value("end"))
                default: self = Wire.pick(kind, "turn state", ["working": .working, "waiting": .waiting], Self.unknown)
                }
            }
        }

        let id: String
        let run: String?
        let prompt: String?
        let state: State
        let endedAt: Double?
    }

    struct HeadRow: Decodable {
        let name: String
        let execution: Execution
        let queue: [String]
    }

    struct SettingsRow: Decodable {
        private struct Configured: Decodable { let model: ModelRef? }

        let name: String
        let selected: ModelRef?
        let effective: ModelRef?

        init(from decoder: any Decoder) throws {
            let object = try decoder.container(keyedBy: Key.self)
            name = try object.value("name")
            let configuration = try object.object("configuration")
            selected = try configuration.optional("selected").flatMap { (value: Configured) in value.model }
            effective = try configuration.optional("effective").flatMap { (value: Configured) in value.model }
        }
    }

    struct BackgroundRow: Decodable {
        enum Kind: Equatable { case child, job, page, unknown(String) }
        enum State: Equatable { case working, waiting, done, failed, unknown(String) }

        let head: String
        let kind: Kind
        let id: String
        let state: State
        let key: String

        init(from decoder: any Decoder) throws {
            let object = try decoder.container(keyedBy: Key.self)
            let item = try object.object("item")
            let kindName: String = try item.value("kind")
            head = try object.value("head")
            id = try item.value("id")
            kind = Wire.pick(kindName, "background kind", ["child": .child, "job": .job, "page": .page], Kind.unknown)
            state = Wire.pick(try item.value("state"), "background state",
                              ["working": .working, "waiting": .waiting, "done": .done, "failed": .failed], State.unknown)
            key = head + "/" + kindName + "/" + id
        }
    }
}
