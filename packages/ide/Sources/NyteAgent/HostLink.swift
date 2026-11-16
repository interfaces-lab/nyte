import Darwin
import Foundation

enum LinkError: Error, Sendable, Equatable {
    case notConnected
    case lost
    case host(Wire.HostError)
    case undecodable(String)

    var message: String {
        switch self {
        case .notConnected: "Nyte isn't connected."
        case .lost: "The connection to Nyte dropped."
        case let .host(error): error.message.isEmpty ? "Nyte refused the request (\(error.code.name))." : error.message
        case .undecodable: "Nyte answered in a form this IDE can't read."
        }
    }

    var logDescription: String {
        switch self {
        case .notConnected: "not connected"
        case .lost: "connection lost before the answer"
        case let .host(error): "host error \(error.code.name)"
        case let .undecodable(detail): "undecodable answer: \(detail)"
        }
    }
}

enum DialFailure: Sendable, Equatable {
    case noHostFile
    case unreadableHostFile
    case hostNotRunning
    case unreachable(String)
    case notNyte
    case refused(status: Int)
    case dropped(String)
    case unanswered

    var hostAbsent: Bool {
        switch self {
        case .noHostFile, .hostNotRunning: true
        default: false
        }
    }

    var logDescription: String {
        switch self {
        case .noHostFile: "no host file"
        case .unreadableHostFile: "the host file did not decode"
        case .hostNotRunning: "the host file names a process that is not running"
        case let .unreachable(detail): "the host did not answer: \(detail)"
        case .notNyte: "the address in the host file is not a Nyte host"
        case let .refused(status): "the host refused the token (HTTP \(status))"
        case let .dropped(detail): "the socket dropped: \(detail)"
        case .unanswered: "the host stopped answering pings"
        }
    }
}

enum LinkState: Sendable, Equatable {
    case dialling(attempt: Int)
    case open(Wire.Welcome)
    case waiting(until: ContinuousClock.Instant, because: DialFailure)
    case incompatible(HostMismatch)
    case stopped
}

enum LinkSignal: Sendable {
    case state(LinkState)
    case event(Wire.Event)
    case text(Wire.TextFrame)
}

actor HostLink {
    private struct Connection {
        let socket: URLSessionWebSocketTask
        let receiving: Task<Void, Never>
        let watching: Task<Void, Never>
        let host: Host
    }

    private struct Host: Sendable {
        let file: Wire.HostFile
        let version: String?
        let install: HostMismatch.Install

        func describe(_ mismatch: HostMismatch) -> HostMismatch {
            var mismatch = mismatch
            mismatch.hostVersion = version
            mismatch.install = install
            return mismatch
        }
    }

    private enum Phase {
        case idle
        case dialling(attempt: Int, finding: Task<Void, Never>)
        case greeting(attempt: Int, Connection)
        case open(Wire.Welcome, Connection)
        case waiting(attempt: Int, until: ContinuousClock.Instant, because: DialFailure, redial: Task<Void, Never>)
        case incompatible(HostMismatch, recheck: Task<Void, Never>)
        case stopped

        var connection: Connection? {
            switch self {
            case let .greeting(_, connection), let .open(_, connection): connection
            default: nil
            }
        }

        var task: Task<Void, Never>? {
            switch self {
            case let .dialling(_, finding): finding
            case let .waiting(_, _, _, redial): redial
            case let .incompatible(_, recheck): recheck
            default: nil
            }
        }

        var state: LinkState? {
            switch self {
            case .idle: nil
            case let .dialling(attempt, _), let .greeting(attempt, _): .dialling(attempt: attempt)
            case let .open(welcome, _): .open(welcome)
            case let .waiting(_, until, failure, _): .waiting(until: until, because: failure)
            case let .incompatible(mismatch, _): .incompatible(mismatch)
            case .stopped: .stopped
            }
        }
    }

    private enum Found {
        case found(socket: URL, host: Host)
        case absent(DialFailure)
        case unreachable(DialFailure)
    }

    nonisolated let signals: AsyncStream<LinkSignal>
    private let emit: AsyncStream<LinkSignal>.Continuation
    private let session = URLSession(configuration: .ephemeral)
    private let client: Wire.Hello.Client
    private let decoder = JSONDecoder()

    private var phase = Phase.idle
    private var calls = 0
    private var pending: [String: Wire.Pending] = [:]
    private var pieces: [String] = []
    private var pieceBytes = 0
    private var heard = ContinuousClock.now
    private var reported: DialFailure?

    private static let maxMessageBytes = 64 * 1_048_576
    private static let pollHost: Duration = .seconds(3)
    private static let describeTimeout: TimeInterval = 1
    private static let idleProbe: Duration = .seconds(30)
    private static let owedProbe: Duration = .seconds(5)
    private static let probeWait: Duration = .seconds(10)
    private static let longestBackOff = 30.0
    private static let pathCapacity = 4 * Int(MAXPATHLEN)

    init(clientName: String, version: String) {
        (signals, emit) = AsyncStream.makeStream(of: LinkSignal.self)
        client = Wire.Hello.Client(name: clientName, version: version)
    }

    func start() {
        guard case .idle = phase else { return }
        dial(attempt: 0)
    }

    func retry() {
        switch phase {
        case .idle, .greeting, .waiting, .incompatible: dial(attempt: 0)
        case .dialling, .open, .stopped: return
        }
    }

    func shutdown() async {
        if case .stopped = phase { return }
        let leaving = phase
        move(to: .stopped)
        session.invalidateAndCancel()
        emit.finish()
        await leaving.task?.value
        await leaving.connection?.receiving.value
        await leaving.connection?.watching.value
    }

    func call<Request: Wire.Request>(_ request: Request) async throws(LinkError) -> Request.Output {
        switch await perform(request) {
        case let .success(output): return output
        case let .failure(error):
            if case .stopped = phase {
                AgentLog.logger.debug("\(Request.name, privacy: .public) ended with the link: \(error.logDescription, privacy: .public)")
            } else {
                AgentLog.logger.error("\(Request.name, privacy: .public) failed: \(error.logDescription, privacy: .public)")
            }
            throw error
        }
    }

    private func perform<Request: Wire.Request>(_ request: Request) async -> Result<Request.Output, LinkError> {
        guard case let .open(_, connection) = phase else { return .failure(.notConnected) }
        calls += 1
        let id = String(calls)
        let frame: String
        do {
            frame = try Wire.encode(Wire.Call(id: id, input: request))
        } catch {
            assertionFailure("a request did not encode")
            return .failure(.undecodable(Wire.describe(error)))
        }
        if pending.isEmpty { heard = .now }
        return await withCheckedContinuation { continuation in
            pending[id] = Wire.Pending(operation: Request.name, resolve: { decoder in
                do {
                    continuation.resume(returning: .success(try Request.Output(from: decoder)))
                } catch {
                    continuation.resume(returning: .failure(.undecodable(Wire.describe(error))))
                }
            }, reject: { continuation.resume(returning: .failure($0)) })
            connection.socket.send(.string(frame)) { error in
                guard error != nil else { return }
                Task { await self.reject(id, .lost) }
            }
        }
    }

    private func reject(_ id: String, _ error: LinkError) {
        pending.removeValue(forKey: id)?.reject(error)
    }

    private func move(to next: Phase) {
        let leaving = phase
        phase = next
        if let old = leaving.connection, old.socket !== next.connection?.socket {
            old.socket.cancel(with: .goingAway, reason: nil)
            old.receiving.cancel()
            old.watching.cancel()
            let waiting = pending.values
            pending = [:]
            pieces = []
            pieceBytes = 0
            for call in waiting { call.reject(.lost) }
        }
        if let task = leaving.task, task != next.task { task.cancel() }
        guard let state = next.state, state != leaving.state else { return }
        report(state)
        emit.yield(.state(state))
    }

    private func report(_ state: LinkState) {
        let logger = AgentLog.logger
        switch state {
        case let .dialling(attempt):
            logger.info("dialling the host, attempt \(attempt + 1, privacy: .public)")
        case let .open(welcome):
            reported = nil
            logger.info("connected to host \(welcome.hostId, privacy: .public) at API revision \(welcome.revision, privacy: .public)")
        case let .waiting(until, failure):
            let delay = (until - .now).formatted(.units(allowed: [.seconds], fractionalPart: .show(length: 1)))
            guard failure != reported else {
                logger.info("redialling in \(delay, privacy: .public)")
                return
            }
            reported = failure
            logger.error("cannot reach the host: \(failure.logDescription, privacy: .public); redialling in \(delay, privacy: .public)")
        case let .incompatible(mismatch):
            logger.error("the host is incompatible: \(mismatch.reason, privacy: .public)")
        case .stopped:
            logger.info("disconnected from the host")
        }
    }

    private func dial(attempt: Int) {
        let session = session
        let finding = Task {
            let found = await Self.findHost(session: session)
            self.found(found, attempt: attempt)
        }
        move(to: .dialling(attempt: attempt, finding: finding))
    }

    private func found(_ found: Found, attempt: Int) {
        guard !Task.isCancelled, case .dialling = phase else { return }
        switch found {
        case let .absent(failure): wait(attempt: attempt, because: failure, for: Self.pollHost)
        case let .unreachable(failure): backOff(attempt: attempt, because: failure)
        case let .found(url, host): connect(to: url, host: host, attempt: attempt)
        }
    }

    private func connect(to url: URL, host: Host, attempt: Int) {
        var request = URLRequest(url: url)
        request.setValue("Bearer \(host.file.token)", forHTTPHeaderField: "Authorization")
        let socket = session.webSocketTask(with: request)
        socket.maximumMessageSize = Self.maxMessageBytes
        heard = .now
        socket.resume()
        do {
            socket.send(.string(try Wire.encode(Wire.Hello(client: client)))) { _ in }
        } catch {
            assertionFailure("the hello did not encode")
        }
        let connection = Connection(
            socket: socket,
            receiving: Task { await self.receive(socket) },
            watching: Task { await self.watch(socket) },
            host: host
        )
        move(to: .greeting(attempt: attempt, connection))
    }

    private func isCurrent(_ socket: URLSessionWebSocketTask) -> Bool {
        phase.connection?.socket === socket
    }

    private func receive(_ socket: URLSessionWebSocketTask) async {
        while !Task.isCancelled {
            let message: URLSessionWebSocketTask.Message
            do {
                message = try await socket.receive()
            } catch {
                lose(socket, because: Self.failure(of: socket, error))
                return
            }
            guard isCurrent(socket) else { return }
            heard = .now
            switch message {
            case let .string(text): read(Data(text.utf8), from: socket)
            case let .data(data): read(data, from: socket)
            @unknown default: continue
            }
        }
    }

    private static func failure(of socket: URLSessionWebSocketTask, _ error: any Error) -> DialFailure {
        let status = (socket.response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 || status == 403 { return .refused(status: status) }
        return .dropped((error as? URLError).map { "URLError \($0.code.rawValue)" } ?? String(describing: type(of: error)))
    }

    private func lose(_ socket: URLSessionWebSocketTask, because failure: DialFailure) {
        guard isCurrent(socket), let host = phase.connection?.host else { return }
        if let mismatch = Wire.incompatibility(closeReason: socket.closeReason) {
            return incompatible(host.describe(mismatch), with: host.file)
        }
        let attempt = if case let .greeting(attempt, _) = phase { attempt } else { 0 }
        backOff(attempt: attempt, because: failure)
    }

    private func watch(_ socket: URLSessionWebSocketTask) async {
        while !Task.isCancelled {
            try? await Task.sleep(for: Self.owedProbe)
            guard !Task.isCancelled, isCurrent(socket) else { return }
            let owes: Bool = if case .greeting = phase { true } else { !pending.isEmpty }
            guard ContinuousClock.now - heard >= (owes ? Self.owedProbe : Self.idleProbe) else { continue }
            let asked = ContinuousClock.now
            socket.sendPing { error in
                guard error == nil else { return }
                Task { await self.ponged(socket) }
            }
            try? await Task.sleep(for: Self.probeWait)
            guard !Task.isCancelled, isCurrent(socket) else { return }
            if heard < asked { lose(socket, because: .unanswered) }
        }
    }

    private func ponged(_ socket: URLSessionWebSocketTask) {
        guard isCurrent(socket) else { return }
        heard = .now
    }

    private func backOff(attempt: Int, because failure: DialFailure) {
        let ceiling = min(Self.longestBackOff, pow(2, Double(attempt)))
        let seconds = ceiling / 2 + Double.random(in: 0 ... ceiling / 2)
        wait(attempt: attempt + 1, because: failure, for: .milliseconds(Int(seconds * 1000)))
    }

    private func wait(attempt: Int, because failure: DialFailure, for delay: Duration) {
        let until = ContinuousClock.now + delay
        let redial = Task {
            try? await Task.sleep(until: until)
            guard !Task.isCancelled else { return }
            self.redial()
        }
        move(to: .waiting(attempt: attempt, until: until, because: failure, redial: redial))
    }

    private func incompatible(_ mismatch: HostMismatch, with file: Wire.HostFile) {
        let recheck = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: Self.pollHost)
                guard !Task.isCancelled else { return }
                guard Self.readHostFile() != file else { continue }
                self.dial(attempt: 0)
                return
            }
        }
        move(to: .incompatible(mismatch, recheck: recheck))
    }

    private func redial() {
        guard !Task.isCancelled, case let .waiting(attempt, _, _, _) = phase else { return }
        dial(attempt: attempt)
    }

    private func read(_ data: Data, from socket: URLSessionWebSocketTask) {
        let frame: Wire.Inbound
        do {
            frame = try decoder.decode(Wire.Inbound.self, from: data, configuration: pending)
        } catch {
            Wire.skipped("frame", error)
            return
        }
        switch frame {
        case let .welcome(welcome):
            guard case let .greeting(_, connection) = phase else { return }
            if let mismatch = welcome.mismatch {
                return incompatible(connection.host.describe(mismatch), with: connection.host.file)
            }
            move(to: .open(welcome, connection))
        case let .answered(id): pending.removeValue(forKey: id)
        case let .refused(id, error): reject(id, .host(error))
        case let .event(event): emit.yield(.event(event))
        case let .text(text): emit.yield(.text(text))
        case let .fragment(piece, last): gather(piece, last: last, from: socket)
        case .ignored: return
        }
    }

    private func gather(_ piece: String, last: Bool, from socket: URLSessionWebSocketTask) {
        pieceBytes += piece.utf8.count
        guard pieceBytes <= Wire.backlogBytes else {
            lose(socket, because: .dropped("a fragmented frame passed the backlog budget"))
            return
        }
        pieces.append(piece)
        guard last else { return }
        let joined = pieces.joined()
        pieces = []
        pieceBytes = 0
        read(Data(joined.utf8), from: socket)
    }

    private static var hostFile: URL {
        let home = ProcessInfo.processInfo.environment["NYTE_HOME"].map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.homeDirectoryForCurrentUser.appending(path: ".nyte")
        return home.appending(path: "host.json")
    }

    private static func readHostFile() -> Wire.HostFile? {
        guard let data = try? Data(contentsOf: hostFile) else { return nil }
        return try? JSONDecoder().decode(Wire.HostFile.self, from: data)
    }

    private static func install(of pid: Int32) -> HostMismatch.Install {
        var buffer = [CChar](repeating: 0, count: pathCapacity)
        guard proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return .unknown }
        let path = String(decoding: buffer.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, as: UTF8.self)
        if let bundle = path.range(of: ".app/") { return .desktop(URL(fileURLWithPath: String(path[..<bundle.lowerBound]) + ".app")) }
        return URL(fileURLWithPath: path).lastPathComponent == "nyte" ? .commandLine : .unknown
    }

    private static func findHost(session: URLSession) async -> Found {
        let data: Data
        do {
            data = try Data(contentsOf: hostFile)
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
            return .absent(.noHostFile)
        } catch {
            return .absent(.unreadableHostFile)
        }
        let file: Wire.HostFile
        do {
            file = try JSONDecoder().decode(Wire.HostFile.self, from: data)
        } catch {
            Wire.skipped("host file", error)
            return .absent(.unreadableHostFile)
        }
        guard kill(pid_t(file.pid), 0) == 0 || errno == EPERM else { return .absent(.hostNotRunning) }
        guard let base = URL(string: file.url), let socket = Wire.socketURL(base) else { return .absent(.unreadableHostFile) }
        var describe = URLRequest(url: Wire.describeURL(base))
        describe.timeoutInterval = describeTimeout
        let body: Data
        let response: URLResponse
        do {
            (body, response) = try await session.data(for: describe)
        } catch {
            return .unreachable(.unreachable((error as? URLError).map { "URLError \($0.code.rawValue)" } ?? "no answer"))
        }
        guard Wire.isHost(response) else { return .unreachable(.notNyte) }
        let version = (try? JSONDecoder().decode(Wire.Describe.self, from: body))?.version
        return .found(socket: socket, host: Host(file: file, version: version, install: install(of: file.pid)))
    }
}
