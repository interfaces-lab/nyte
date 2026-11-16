import Foundation
import NyteCore

extension Wire {
    struct CatalogRow: Decodable, Sendable {
        let id: String
    }

    struct Setting: Decodable, Sendable, Equatable {
        struct Choice: Decodable, Sendable, Equatable {
            let value: String
            let label: String
            let badge: String?
        }

        enum Scope: Equatable, Sendable { case host, session, workspace, unknown(String) }

        let id: String
        let label: String
        let scope: Scope
        let value: String?
        let choices: [Choice]

        init(from decoder: any Decoder) throws {
            let object = try decoder.container(keyedBy: Key.self)
            id = try object.value("id")
            label = try object.value("label")
            scope = Wire.pick(try object.value("scope"), "setting scope", ["host": .host, "session": .session, "workspace": .workspace],
                              Scope.unknown)
            value = try? object.value("value") as String
            choices = (try object.optional("choices") as Lenient<Choice>?)?.items ?? []
        }

        init(copying setting: Setting, value: String) {
            id = setting.id
            label = setting.label
            scope = setting.scope
            self.value = value
            choices = setting.choices
        }

        var chosen: Choice? { choices.first { $0.value == value } }
    }

    struct CatalogSettings: Decodable, Sendable {
        let settings: [Setting]

        init(from decoder: any Decoder) throws {
            let object = try decoder.container(keyedBy: Key.self)
            settings = (try object.value("settings") as Lenient<Setting>).items
        }
    }

    struct ReadCatalog: Request {
        typealias Output = CatalogSettings
        static let name = "catalogs.read"
        let id: String
    }

    enum SettingOutcome: Decodable, Sendable, Equatable {
        case applied, invalid, unknown(String)

        init(from decoder: any Decoder) throws {
            let (_, kind) = try Wire.kind(decoder)
            self = Wire.pick(kind, "setting outcome", ["applied": .applied, "invalid": .invalid], Self.unknown)
        }
    }

    struct ApplySetting: Request {
        typealias Output = SettingOutcome
        static let name = "settings.apply"
        let id: String
        let value: String
    }

    struct WorkspaceRow: Decodable, Sendable {
        struct Isolation: Decodable, Sendable {
            let source: String
            let branch: String
        }

        struct Target: Decodable, Sendable {
            let path: String?
        }

        let id: String
        let target: Target
        let isolation: Isolation?
    }

    struct ListWorkspaces: Request {
        typealias Output = Lenient<WorkspaceRow>
        static let name = "workspaces.list"
    }

    struct RunFile: Decodable, Sendable, Equatable {
        let path: String
        let status: AgentChangeSet.Status
        let added: Int?
        let removed: Int?

        init(from decoder: any Decoder) throws {
            let object = try decoder.container(keyedBy: Key.self)
            path = try object.value("path")
            status = Wire.pick(try object.value("status"), "file status", [
                "added": .added, "modified": .modified, "deleted": .deleted, "renamed": .renamed, "untracked": .untracked,
                "conflicted": .conflicted,
            ], AgentChangeSet.Status.unknown)
            let stat = try object.object("stat")
            let kind: String = try stat.value("kind")
            added = kind == "text" ? try stat.value("added") : nil
            removed = kind == "text" ? try stat.value("removed") : nil
        }

        init(path: String, status: AgentChangeSet.Status, added: Int?, removed: Int?) {
            self.path = path
            self.status = status
            self.added = added
            self.removed = removed
        }
    }

    struct RunChangeSet: Decodable, Sendable {
        let files: [RunFile]

        init(from decoder: any Decoder) throws {
            let object = try decoder.container(keyedBy: Key.self)
            files = (try object.value("files") as Lenient<RunFile>).items
        }
    }

    struct RunChanges: Request {
        struct Source: Encodable {
            let kind: String
            let run: String?
            let session: String?

            init(run: String) {
                kind = "run"
                self.run = run
                session = nil
            }

            init(session: String) {
                kind = "session"
                run = nil
                self.session = session
            }
        }

        typealias Output = RunChangeSet
        static let name = "workspace.changes"
        let workspace: String
        let source: Source
    }
}
