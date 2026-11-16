import Foundation
import NyteCore
import os
import Synchronization

enum ServerSignal: Sendable {
    case request(id: JSON, method: String, params: JSON)
    case applyEdit(id: JSON, Result<WorkspaceEdit, IntelligenceFailure>)
    case diagnostics(URL, version: Int?, [Diagnostic])
    case progress(token: String, title: String?, percent: Int?, done: Bool)
    case message(String, Diagnostic.Severity)
    case log(String)
    case exited(Int32)
}

typealias Reply = @Sendable (isolated ServerConnection, Result<JSON, IntelligenceFailure>) -> Void

enum Outgoing: Sendable {
    case notify(String, JSON)
    case request(Int, String, JSON, Reply)
    case respond(JSON, JSON)
    case cancel(Int)
}

extension IntelligenceFailure {
    static let serverStopped = IntelligenceFailure("The language server stopped.")
    static let cancelled = IntelligenceFailure("Cancelled.")
}

actor ServerConnection {
    private enum Phase {
        case initializing(held: [Outgoing])
        case running
        case stopped
    }

    nonisolated let name: String
    nonisolated let signals: AsyncStream<ServerSignal>
    nonisolated let identifier: Int32
    private nonisolated let emit: AsyncStream<ServerSignal>.Continuation
    private nonisolated let queued: AsyncStream<Outgoing>.Continuation
    private nonisolated let ids = Mutex(0)

    private let process: ChildProcess
    private let outbox: AsyncStream<Outgoing>
    private var phase = Phase.initializing(held: [])
    private var framer = MessageFramer()
    private var pending: [Int: Reply] = [:]
    private(set) var capabilities = Capabilities()
    private var reading: Task<Void, Never>?
    private var writing: Task<Void, Never>?

    init(name: String, launch: ChildProcess.Launch) throws {
        self.name = name
        process = try ChildProcess(launch)
        identifier = process.identifier
        (signals, emit) = AsyncStream.makeStream(of: ServerSignal.self)
        (outbox, queued) = AsyncStream.makeStream(of: Outgoing.self)
    }

    nonisolated func nextID() -> Int {
        ids.withLock { id in
            id += 1
            return id
        }
    }

    nonisolated func enqueue(_ message: Outgoing) {
        guard case .terminated = queued.yield(message) else { return }
        Task { await self.refuse(message) }
    }

    func start(initialize parameters: JSON, deadline: Duration) async -> Result<Capabilities, IntelligenceFailure> {
        let events = process.events
        reading = Task { for await event in events { self.handle(event) } }
        let outbox = outbox
        writing = Task { for await message in outbox { await self.send(message) } }
        let id = nextID()
        let expiry = Task {
            try await Task.sleep(for: deadline)
            self.expire(id, after: deadline)
        }
        defer { expiry.cancel() }
        let answer = await withCheckedContinuation { continuation in
            pending[id] = { _, result in continuation.resume(returning: result) }
            Task { await self.write(["jsonrpc": "2.0", "id": .number(Double(id)), "method": "initialize", "params": parameters]) }
        }
        guard case let .success(json) = answer else {
            stop()
            return answer.map { _ in capabilities }
        }
        capabilities = decodeCapabilities(json)
        await write(["jsonrpc": "2.0", "method": "initialized", "params": [:]])
        while case let .initializing(held) = phase, let first = held.first {
            phase = .initializing(held: Array(held.dropFirst()))
            await transmit(first)
        }
        if case .initializing = phase { phase = .running }
        return .success(capabilities)
    }

    func terminate() async {
        queued.finish()
        await process.terminate()
    }

    func finish(within grace: Duration) async {
        queued.finish()
        await writing?.value
        await process.closeInput()
        guard let reading else { return await process.terminate() }
        let process = process
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await reading.value }
            group.addTask {
                do { try await Task.sleep(for: grace) } catch { return }
                await process.terminate()
            }
            await group.next()
            group.cancelAll()
        }
    }

    private func expire(_ id: Int, after deadline: Duration) {
        guard let reply = pending.removeValue(forKey: id) else { return }
        Logger.language.error("\(self.name, privacy: .public) did not answer initialize within \(deadline, privacy: .public)")
        reply(self, .failure(IntelligenceFailure.startTimedOut(name, after: deadline)))
    }

    private func send(_ message: Outgoing) async {
        switch phase {
        case var .initializing(held):
            if case let .cancel(id) = message, let index = held.firstIndex(where: { if case .request(id, _, _, _) = $0 { true } else { false } }) {
                let removed = held.remove(at: index)
                phase = .initializing(held: held)
                if case let .request(_, _, _, reply) = removed { reply(self, .failure(.cancelled)) }
                return
            }
            held.append(message)
            phase = .initializing(held: held)
        case .running:
            await transmit(message)
        case .stopped:
            refuse(message)
        }
    }

    private func transmit(_ message: Outgoing) async {
        switch message {
        case let .notify(method, params):
            await write(["jsonrpc": "2.0", "method": .string(method), "params": params])
        case let .request(id, method, params, reply):
            pending[id] = reply
            await write(["jsonrpc": "2.0", "id": .number(Double(id)), "method": .string(method), "params": params])
        case let .respond(id, result):
            await write(["jsonrpc": "2.0", "id": id, "result": result])
        case let .cancel(id):
            guard let reply = pending.removeValue(forKey: id) else { return }
            await write(["jsonrpc": "2.0", "method": "$/cancelRequest", "params": ["id": .number(Double(id))]])
            reply(self, .failure(.cancelled))
        }
    }

    private func refuse(_ message: Outgoing) {
        guard case let .request(_, _, _, reply) = message else { return }
        reply(self, .failure(.serverStopped))
    }

    private func stop() {
        if case let .initializing(held) = phase { for message in held { refuse(message) } }
        phase = .stopped
        let failed = pending.values
        pending.removeAll()
        for reply in failed { reply(self, .failure(.serverStopped)) }
        queued.finish()
    }

    private func write(_ message: JSON) async {
        await process.send(MessageFramer.frame(message.encoded()))
    }

    private func handle(_ event: ChildProcess.Event) {
        switch event {
        case let .output(data):
            for body in framer.append(data) {
                guard let message = JSON.parse(body) else {
                    Logger.language.error("\(self.name, privacy: .public) sent a message that is not JSON (\(body.count) bytes)")
                    emit.yield(.log("Nyte IDE: dropped a message that is not JSON (\(body.count) bytes).\n"))
                    continue
                }
                receive(message)
            }
        case let .diagnostics(data):
            emit.yield(.log(String(decoding: data, as: UTF8.self)))
        case let .exit(status):
            stop()
            emit.yield(.exited(status))
            emit.finish()
        }
    }

    private func receive(_ message: JSON) {
        guard let method = message["method"]?.string else {
            guard let id = message["id"]?.int, let reply = pending.removeValue(forKey: id) else { return }
            if let error = message["error"] {
                return reply(self, .failure(IntelligenceFailure(error["message"]?.string ?? "The language server failed.")))
            }
            return reply(self, .success(message["result"] ?? .null))
        }
        let params = message["params"] ?? .null
        if let id = message["id"] {
            if method == ClientFeature.applyEdit.method {
                let edit = Result { () throws(IntelligenceFailure) in try workspaceEdit(params["edit"] ?? .null) }
                emit.yield(.applyEdit(id: id, edit))
                return
            }
            emit.yield(.request(id: id, method: method, params: params))
            return
        }
        switch method {
        case ClientFeature.publishDiagnostics.method:
            guard let url = url(params["uri"]) else { return }
            emit.yield(.diagnostics(url, version: params["version"]?.int, (params["diagnostics"]?.array ?? []).compactMap { diagnostic($0) }))
        case ClientFeature.workDoneProgress.method:
            let value = params["value"]
            let token = params["token"].map { $0.string ?? $0.int.map(String.init) ?? "" } ?? ""
            guard let kind = value?.kind else { return }
            emit.yield(.progress(
                token: token, title: kind == "begin" ? value?["title"]?.string ?? "" : nil,
                percent: value?["percentage"]?.int, done: kind == "end"
            ))
        case ClientFeature.showMessage.method:
            emit.yield(.message(params["message"]?.string ?? "", severity(params["type"])))
        case "window/logMessage":
            emit.yield(.log((params["message"]?.string ?? "") + "\n"))
        default: break
        }
    }
}
