import Foundation

extension Wire {
    struct SessionRow: Decodable {
        let id: String
        let name: String?
        let parent: String?
        let workspace: String
        let pinned: Bool
        let archived: Bool
        let activation: Activation
        let heads: [HeadSummary]
        let lastActivityAt: Double
    }

    struct SessionPage: Decodable {
        let items: [SessionRow]
        let next: String?

        init(from decoder: any Decoder) throws {
            let object = try decoder.container(keyedBy: Key.self)
            items = (try object.value("items") as Lenient<SessionRow>).items
            next = try object.optional("next")
        }
    }

    enum Activation: Decodable, Equatable {
        case active, inactive, unavailable
        case failed(String)
        case unknown(String)

        init(from decoder: any Decoder) throws {
            let (object, kind) = try Wire.kind(decoder)
            switch kind {
            case "active": self = .active
            case "inactive": self = .inactive
            case "unavailable": self = .unavailable
            case "failed": self = .failed(try object.value("message"))
            default: self = Wire.pick(kind, "activation", [:], Self.unknown)
            }
        }
    }

    struct HeadSummary: Decodable {
        struct Background: Decodable {
            let working: Int
            let waiting: Int
        }

        let name: String
        let tip: Tip
        let execution: Execution
        let unread: Bool
        let background: Background
    }

    enum Tip: Decodable, Equatable {
        case start
        case commit(String)
        case unknown(String)

        init(from decoder: any Decoder) throws {
            let (object, kind) = try Wire.kind(decoder)
            switch kind {
            case "start": self = .start
            case "commit": self = .commit(try object.value("id"))
            default: self = Wire.pick(kind, "tip", [:], Self.unknown)
            }
        }
    }

    struct Run: Decodable, Equatable {
        let id: String
        let startedAt: Double
    }

    struct LastRun: Decodable, Equatable {
        let id: String
        let end: RunEnd
    }

    enum Execution: Decodable, Equatable {
        case idle(lastEnd: RunEnd?, lastRun: String? = nil)
        case live(Run, stopping: Bool)
        case waiting(Run, on: WaitTarget)
        case retrying(Run, reason: String, until: Double?)
        case unknown(String)

        init(from decoder: any Decoder) throws {
            let (object, kind) = try Wire.kind(decoder)
            switch kind {
            case "idle":
                let last: LastRun? = try object.optional("lastRun")
                self = .idle(lastEnd: last?.end, lastRun: last?.id)
            case "live": self = .live(try object.value("run"), stopping: try object.optional("stopping") ?? false)
            case "waiting": self = .waiting(try object.value("run"), on: try object.value("on"))
            case "retrying":
                self = .retrying(try object.value("run"), reason: try object.optional("reason") ?? "", until: try object.optional("until"))
            default: self = Wire.pick(kind, "execution", [:], Self.unknown)
            }
        }
    }

    enum WaitTarget: Decodable, Equatable {
        case run, job, timer
        case part(String)
        case unknown(String)

        init(from decoder: any Decoder) throws {
            let (object, kind) = try Wire.kind(decoder)
            switch kind {
            case "part": self = .part(try object.value("part"))
            default: self = Wire.pick(kind, "wait target", ["run": .run, "job": .job, "timer": .timer], Self.unknown)
            }
        }
    }

    enum RunEnd: Decodable, Equatable {
        case completed, stopped
        case failed(Failure)
        case unknown(String)

        init(from decoder: any Decoder) throws {
            let (object, kind) = try Wire.kind(decoder)
            switch kind {
            case "failed": self = .failed(try object.value("failure"))
            default: self = Wire.pick(kind, "run end", ["completed": .completed, "stopped": .stopped], Self.unknown)
            }
        }
    }

    struct Failure: Decodable, Equatable {
        enum Cause: Equatable {
            case rateLimit, auth, quota, contextWindow, overloaded, network, aborted, provider, runner
            case unknown(String)

            static let known: [String: Cause] = [
                "rate_limit": .rateLimit, "auth": .auth, "quota": .quota, "context_window": .contextWindow,
                "overloaded": .overloaded, "network": .network, "aborted": .aborted, "provider": .provider, "runner": .runner,
            ]
        }

        let cause: Cause
        let message: String
        let retryAfter: Duration?

        init(from decoder: any Decoder) throws {
            let object = try decoder.container(keyedBy: Key.self)
            cause = Wire.pick(try object.value("class"), "failure class", Cause.known, Cause.unknown)
            message = try object.optional("message") ?? ""
            retryAfter = (try object.optional("retryAfterMs") as Double?).map { .milliseconds($0) }
        }
    }
}

extension Wire {
    struct Catalog: Decodable {
        enum Credential: Equatable { case unknown, missing, configured, verified, failed, other(String) }
        enum Listing: Decodable, Equatable {
            case hidden, favorite, unknown(String)

            init(from decoder: any Decoder) throws {
                self = Wire.pick(try String(from: decoder), "model listing", ["hidden": .hidden, "favorite": .favorite], Self.unknown)
            }
        }

        struct Model: Decodable {
            let ref: ModelRef
            let name: String
        }

        struct Provider: Decodable {
            let id: String
            let name: String
            let credential: Credential
            let models: [Model]
            let listings: [String: Listing]

            init(from decoder: any Decoder) throws {
                let object = try decoder.container(keyedBy: Key.self)
                id = try object.value("id")
                name = try object.value("name")
                credential = Wire.pick(try object.value("credential"), "credential", [
                    "unknown": .unknown, "missing": .missing, "configured": .configured, "verified": .verified, "failed": .failed,
                ], Credential.other)
                models = (try object.value("models") as Lenient<Model>).items
                listings = try object.optional("listings") ?? [:]
            }
        }

        let defaultModel: ModelRef?
        let providers: [Provider]

        init(from decoder: any Decoder) throws {
            let object = try decoder.container(keyedBy: Key.self)
            defaultModel = try object.optional("default")
            providers = (try object.value("providers") as Lenient<Provider>).items
        }
    }

    struct Inspection: Decodable {
        let identity: String
        let registered: String?
    }

    enum AddOutcome: Decodable {
        case added(String)
        case exists(String)
        case stale, unavailable
        case unknown(String)

        init(from decoder: any Decoder) throws {
            let (object, kind) = try Wire.kind(decoder)
            switch kind {
            case "added": self = .added(try object.value("workspace"))
            case "exists": self = .exists(try object.value("workspace"))
            default: self = Wire.pick(kind, "add outcome", ["stale": .stale, "unavailable": .unavailable], Self.unknown)
            }
        }
    }

    enum UpdateOutcome: Decodable {
        case updated, busy, unknownWorkspace
        case unknown(String)

        init(from decoder: any Decoder) throws {
            self = Wire.pick(try Wire.kind(decoder).1, "update outcome",
                             ["updated": .updated, "busy": .busy, "unknown-workspace": .unknownWorkspace], Self.unknown)
        }
    }

    enum ConfigureOutcome: Decodable {
        case configured, unknownModel, unknownAgent, invalid
        case unknown(String)

        init(from decoder: any Decoder) throws {
            self = Wire.pick(try Wire.kind(decoder).1, "configure outcome", [
                "configured": .configured, "unknown-model": .unknownModel, "unknown-agent": .unknownAgent, "invalid": .invalid,
            ], Self.unknown)
        }
    }

    enum ActOutcome: Decodable {
        case ok, unknownAction, closed, noOwner
        case rejected(String)
        case failed(String)
        case unknown(String)

        init(from decoder: any Decoder) throws {
            let (object, kind) = try Wire.kind(decoder)
            switch kind {
            case "rejected": self = .rejected(try object.optional("reason") ?? "")
            case "failed": self = .failed(try object.optional("message") ?? "")
            default: self = Wire.pick(kind, "act outcome", [
                "ok": .ok, "unknown-action": .unknownAction, "closed": .closed, "no-owner": .noOwner,
            ], Self.unknown)
            }
        }
    }

    struct Started: Decodable {
        let session: String
    }
}
