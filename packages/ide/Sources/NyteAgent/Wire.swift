import Foundation
import OSLog
import Synchronization

enum Wire {
    static let minRevision = 17
    static let revision = 24
    static let backlogBytes = 8_388_608

    struct HostFile: Decodable, Equatable, Sendable {
        let url: String
        let token: String
        let pid: Int32
    }

    static func describeURL(_ base: URL) -> URL { base.appending(path: ".nyte/describe") }

    static func isHost(_ response: URLResponse) -> Bool {
        (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "X-Nyte-Host") != nil
    }

    static func socketURL(_ base: URL) -> URL? {
        guard var parts = URLComponents(url: base, resolvingAgainstBaseURL: false) else { return nil }
        parts.scheme = parts.scheme == "https" ? "wss" : "ws"
        parts.path = "/.nyte/ws"
        return parts.url
    }

    struct Describe: Decodable {
        let version: String?
    }

    static func incompatibility(closeReason: Data?) -> HostMismatch? {
        let reason = closeReason.map { String(decoding: $0, as: UTF8.self) } ?? ""
        // Nyte host: when the two sides share no API revision the host closes the socket with a reason that starts "Update the host" or "Update the client" and names the revision it serves.
        guard reason.hasPrefix(hostOlder) || reason.hasPrefix(clientOlder) else { return nil }
        let served = reason.range(of: "serves ").flatMap { Int(reason[$0.upperBound...].prefix { $0.isNumber }) }
        return HostMismatch(reason: reason, hostIsOlder: reason.hasPrefix(hostOlder), hostRevision: served)
    }

    private static let hostOlder = "Update the host"
    private static let clientOlder = "Update the client"

    struct Key: CodingKey {
        let stringValue: String
        var intValue: Int? { nil }

        init(_ name: String) { stringValue = name }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    struct Nothing: Decodable, Sendable {
        init(from decoder: any Decoder) {}
    }

    struct Lenient<Row: Decodable & Sendable>: Decodable, Sendable {
        private(set) var items: [Row] = []

        init(from decoder: any Decoder) throws {
            var list = try decoder.unkeyedContainer()
            items.reserveCapacity(list.count ?? 0)
            while !list.isAtEnd {
                do {
                    items.append(try list.decode(Row.self))
                } catch {
                    Wire.skipped(String(describing: Row.self), error)
                    _ = try list.decode(Nothing.self)
                }
            }
        }
    }

    struct Table<Row: Decodable & Sendable>: Decodable, Sendable {
        let upsert: [Row]
        let drop: [String]

        static var empty: Self { Self(upsert: [], drop: []) }

        init(upsert: [Row], drop: [String]) {
            self.upsert = upsert
            self.drop = drop
        }

        init(from decoder: any Decoder) throws {
            let object = try decoder.container(keyedBy: Key.self)
            upsert = try object.optional("upsert").map { (rows: Lenient<Row>) in rows.items } ?? []
            drop = try object.optional("drop") ?? []
        }
    }

    private static let reported = Mutex<Set<String>>([])

    static func unknown(_ what: String, _ value: String) {
        guard reported.withLock({ $0.insert(what + "\u{1F}" + value).inserted }) else { return }
        AgentLog.logger.warning("unknown \(what, privacy: .public) \(value, privacy: .public)")
    }

    static func skipped(_ what: String, _ error: any Error) {
        AgentLog.logger.error("skipped a \(what, privacy: .public) that did not decode: \(describe(error), privacy: .public)")
    }

    static func describe(_ error: any Error) -> String {
        guard let error = error as? DecodingError else { return String(describing: type(of: error)) }
        let (context, problem): (DecodingError.Context?, String) = switch error {
        case let .keyNotFound(key, context): (context, "missing \(key.stringValue)")
        case let .typeMismatch(type, context): (context, "expected \(type)")
        case let .valueNotFound(type, context): (context, "null where \(type) belongs")
        case let .dataCorrupted(context): (context, "malformed")
        @unknown default: (nil, "undecodable")
        }
        let path = context?.codingPath.map { $0.intValue.map(String.init) ?? $0.stringValue }.joined(separator: ".") ?? ""
        return path.isEmpty ? problem : problem + " at " + path
    }

    static func pick<Value>(_ raw: String, _ what: String, _ known: [String: Value], _ fallback: (String) -> Value) -> Value {
        if let value = known[raw] { return value }
        unknown(what, raw)
        return fallback(raw)
    }

    static func kind(_ decoder: any Decoder) throws -> (KeyedDecodingContainer<Key>, String) {
        let object = try decoder.container(keyedBy: Key.self)
        return (object, try object.value("kind"))
    }
}

extension KeyedDecodingContainer where K == Wire.Key {
    func value<T: Decodable>(_ name: String) throws -> T { try decode(T.self, forKey: Wire.Key(name)) }
    func optional<T: Decodable>(_ name: String) throws -> T? { try decodeIfPresent(T.self, forKey: Wire.Key(name)) }
    func object(_ name: String) throws -> Self { try nestedContainer(keyedBy: Wire.Key.self, forKey: Wire.Key(name)) }
}

extension Wire {
    struct Welcome: Decodable, Equatable {
        let hostId: String
        let clientId: String
        let revision: Int
        let minRevision: Int
        let serverRevision: Int

        init(from decoder: any Decoder) throws {
            let object = try decoder.container(keyedBy: Key.self)
            hostId = try object.value("host_id")
            clientId = try object.value("client_id")
            revision = try object.value("api_revision")
            minRevision = try object.value("api_min_revision")
            serverRevision = try object.value("api_server_revision")
        }

        var mismatch: HostMismatch? {
            if revision < Wire.minRevision {
                return HostMismatch(reason: "Update the host: this IDE needs API revision \(Wire.minRevision) or later.", hostIsOlder: true,
                                    hostRevision: serverRevision)
            }
            if revision > Wire.revision {
                return HostMismatch(reason: "Update the client: this IDE speaks API revision \(Wire.revision) at most.", hostIsOlder: false,
                                    hostRevision: serverRevision)
            }
            return nil
        }
    }

    struct HostError: Decodable, Equatable {
        enum Code: Equatable {
            case unauthenticated, denied, missing, invalid, stale, unavailable, failed, notSupported, timeout
            case unknown(String)

            static let known: [String: Code] = [
                "unauthenticated": .unauthenticated, "denied": .denied, "unknown": .missing, "invalid": .invalid,
                "stale": .stale, "unavailable": .unavailable, "internal": .failed, "not_supported": .notSupported,
                "timeout": .timeout,
            ]

            var name: String {
                if case let .unknown(raw) = self { return raw }
                return Self.known.first { $0.value == self }?.key ?? ""
            }
        }

        let code: Code
        let message: String

        init(from decoder: any Decoder) throws {
            let object = try decoder.container(keyedBy: Key.self)
            code = Wire.pick(try object.value("code"), "error code", Code.known, Code.unknown)
            message = try object.optional("message") ?? ""
        }
    }

    enum Inbound {
        case welcome(Welcome)
        case answered(id: String)
        case refused(id: String, HostError)
        case event(Event)
        case text(TextFrame)
        case fragment(String, last: Bool)
        case ignored(String)
    }

    struct Pending: Sendable {
        let operation: String
        let resolve: @Sendable (any Decoder) -> Void
        let reject: @Sendable (LinkError) -> Void
    }

    enum Event {
        case sessions(Table<SessionRow>)
        case session(id: String, SessionChange)
        case presence
        case unknown(String)
    }

    enum TextFrame {
        case whole(part: String, version: Int, text: String)
        case append(part: String, version: Int, text: String)
        case progress
        case closed
        case unknown(String)
    }
}

extension Wire.Inbound: DecodableWithConfiguration {
    init(from decoder: any Decoder, configuration calls: [String: Wire.Pending]) throws {
        let object = try decoder.container(keyedBy: Wire.Key.self)
        let channel: String = try object.value("c")
        guard channel == "e" else {
            self = channel == "t" ? .text(try Wire.TextFrame(object)) : .ignored("channel " + channel)
            return
        }
        let type: String = try object.value("type")
        switch type {
        case "welcome": self = .welcome(try Wire.Welcome(from: decoder))
        case "result":
            let id: String = try object.value("id")
            calls[id]?.resolve(try object.superDecoder(forKey: Wire.Key("output")))
            self = .answered(id: id)
        case "error": self = .refused(id: try object.value("id"), try object.value("error"))
        case "event": self = .event(try Wire.Event(object, decoder: decoder))
        case "fragment": self = .fragment(try object.value("text"), last: try object.value("last"))
        default:
            Wire.unknown("frame type", type)
            self = .ignored(type)
        }
    }
}

extension Wire.Event {
    init(_ object: KeyedDecodingContainer<Wire.Key>, decoder: any Decoder) throws {
        let scope: String = try object.value("scope")
        let kind: String = try object.value("kind")
        if scope == "host" {
            switch kind {
            case "change": self = .sessions(try object.object("tables").optional("sessions") ?? .empty)
            case "live", "status", "performed": self = .presence
            default: self = Self.unknown("host event", kind)
            }
            return
        }
        let parts = scope.split(separator: "/", maxSplits: 1)
        guard parts.count == 2, parts[0] == "session" else {
            self = Self.unknown("event scope", parts.first.map(String.init) ?? scope)
            return
        }
        switch kind {
        case "change": self = .session(id: String(parts[1]), try Wire.SessionChange(from: decoder))
        case "live": self = .presence
        default: self = Self.unknown("session event", kind)
        }
    }

    private static func unknown(_ what: String, _ value: String) -> Self {
        Wire.unknown(what, value)
        return .unknown(value)
    }
}

extension Wire.TextFrame {
    init(_ object: KeyedDecodingContainer<Wire.Key>) throws {
        if let type: String = try object.optional("type") {
            guard type == "closed" else {
                Wire.unknown("text frame", type)
                self = .unknown(type)
                return
            }
            self = .closed
            return
        }
        let part: String = try object.value("part")
        if let text: String = try object.optional("text") {
            self = .whole(part: part, version: try object.value("version"), text: text)
        } else if let text: String = try object.optional("append") {
            self = .append(part: part, version: try object.value("version"), text: text)
        } else if object.contains(Wire.Key("progress")) {
            self = .progress
        } else {
            Wire.unknown("text frame", "without text, append or progress")
            self = .unknown("")
        }
    }
}

extension Wire {
    protocol Request: Encodable, Sendable {
        associatedtype Output: Decodable & Sendable
        static var name: String { get }
    }

    struct Hello: Encodable {
        struct Client: Encodable {
            let kind = "other"
            let name: String
            let version: String
            let actions: [String] = []
        }

        let channel = "e"
        let type = "hello"
        let minRevision = Wire.minRevision
        let revision = Wire.revision
        let client: Client

        enum CodingKeys: String, CodingKey {
            case channel = "c", type, minRevision = "api_min_revision", revision = "api_revision", client
        }
    }

    struct Call<Input: Request>: Encodable {
        let channel = "e"
        let type = "call"
        let id: String
        let op = Input.name
        let input: Input

        enum CodingKeys: String, CodingKey { case channel = "c", type, id, op, input }
    }

    static func encode(_ value: some Encodable) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .withoutEscapingSlashes
        return String(decoding: try encoder.encode(value), as: UTF8.self)
    }

    struct Target: Encodable {
        let kind = "local"
        let path: String
    }

    struct Subscribe: Request {
        typealias Output = Nothing
        static let name = "events.subscribe"
        let scopes: [String]
    }

    struct Unsubscribe: Request {
        typealias Output = Nothing
        static let name = "events.unsubscribe"
        let scopes: [String]
    }

    struct Inspect: Request {
        typealias Output = Inspection
        static let name = "workspaces.inspect"
        let target: Target
    }

    struct AddWorkspace: Request {
        struct Options: Encodable { let expect: Expect }
        struct Expect: Encodable { let identity: String }
        typealias Output = AddOutcome
        static let name = "workspaces.add"
        let target: Target
        let options: Options?
    }

    struct ListModels: Request {
        typealias Output = Catalog
        static let name = "models.list"
    }

    struct ListSessions: Request {
        struct Parents: Encodable { let kind = "roots" }
        typealias Output = SessionPage
        static let name = "sessions.list"
        let parents = Parents()
        let cursor: String?
        let limit: Int
    }

    struct ReadSession: Request {
        typealias Output = SessionRow
        static let name = "session.info"
        let session: String
    }

    struct UpdateSession: Request {
        struct Patch: Encodable {
            var name: String?
            var archived: Bool?
        }
        typealias Output = UpdateOutcome
        static let name = "session.update"
        let session: String
        let patch: Patch
    }

    struct ReadHead: Request {
        struct Window: Encodable { let tail: Int }
        typealias Output = HeadWindow
        static let name = "head.read"
        let session: String
        let head: String
        let window: Window
        let resume: Resume?
    }

    struct Resume: Encodable {
        let seq: Int
        let from: String?

        func encode(to encoder: any Encoder) throws {
            var object = encoder.container(keyedBy: Key.self)
            try object.encode(seq, forKey: Key("seq"))
            try object.encode(from, forKey: Key("from"))
        }
    }

    struct ReadHistory: Request {
        typealias Output = HistoryPage
        static let name = "head.history"
        let session: String
        let head: String
        let before: String
        let limit: Int
    }

    struct See: Request {
        typealias Output = Nothing
        static let name = "head.see"
        let session: String
        let head: String
        let commit: String
    }

    enum ExcerptSource: Equatable, Sendable {
        case diff(path: String, side: String, start: Int, end: Int)
        case terminal(command: String?)
        case other(String)
    }

    enum Outgoing: Equatable, Sendable {
        case text(String)
        case reference(path: String)
        case excerpt(ExcerptSource, text: String)
    }

    struct Content: Encodable, Equatable, Sendable {
        let items: [Outgoing]

        func encode(to encoder: any Encoder) throws {
            if items.count == 1, case let .text(text) = items[0] {
                var single = encoder.singleValueContainer()
                return try single.encode(text)
            }
            var list = encoder.unkeyedContainer()
            for item in items {
                var object = list.nestedContainer(keyedBy: Key.self)
                switch item {
                case let .text(text):
                    try object.encode("text", forKey: Key("kind"))
                    try object.encode(text, forKey: Key("text"))
                case let .reference(path):
                    try object.encode("reference", forKey: Key("kind"))
                    try object.encode(path, forKey: Key("path"))
                case let .excerpt(source, text):
                    try object.encode("excerpt", forKey: Key("kind"))
                    try object.encode(text, forKey: Key("text"))
                    var origin = object.nestedContainer(keyedBy: Key.self, forKey: Key("source"))
                    switch source {
                    case let .diff(path, side, start, end):
                        try origin.encode("diff", forKey: Key("kind"))
                        try origin.encode(path, forKey: Key("path"))
                        try origin.encode(side, forKey: Key("side"))
                        try origin.encode(start, forKey: Key("start"))
                        try origin.encode(end, forKey: Key("end"))
                    case let .terminal(command):
                        try origin.encode("terminal", forKey: Key("kind"))
                        try origin.encodeIfPresent(command, forKey: Key("command"))
                    case let .other(kind):
                        try origin.encode(kind, forKey: Key("kind"))
                    }
                }
            }
        }
    }

    struct Send: Request {
        struct Options: Encodable {
            let id: String
            var replace: String?
        }

        typealias Output = Nothing
        static let name = "head.send"
        let session: String
        let head: String
        let content: Content
        let options: Options
    }

    struct ModelPatch: Encodable { let model: ModelRef }

    struct Configure: Request {
        typealias Output = ConfigureOutcome
        static let name = "head.configure"
        let session: String
        let head: String
        let patch: ModelPatch
    }

    struct Start: Request {
        typealias Output = Started
        static let name = "sessions.start"
        let id: String
        let workspace: String
        let content: Content
        let configuration: ModelPatch?
    }

    struct OpenText: Request {
        typealias Output = Nothing
        static let name = "text.open"
    }

    struct StopRun: Request {
        typealias Output = Nothing
        static let name = "run.stop"
        let session: String
        let run: String
    }

    struct ReadPart: Request {
        typealias Output = PartRead
        static let name = "part.read"
        let session: String
        let part: String
    }

    struct Act: Request {
        struct Input: Encodable { let answers: [[String]]? }
        typealias Output = ActOutcome
        static let name = "part.act"
        let session: String
        let part: String
        let action: String
        let input: Input

        init(session: String, part: String, answer: RequestAnswer) {
            self.session = session
            self.part = part
            (action, input) = switch answer {
            case .allowOnce: ("once", Input(answers: nil))
            case .allowForSession: ("session", Input(answers: nil))
            case .deny: ("deny", Input(answers: nil))
            case let .choose(answers): ("answer", Input(answers: answers))
            case .skip: ("skip", Input(answers: nil))
            }
        }
    }
}
