import Darwin
import Foundation
import NyteCore
import os

enum VariableFilter: Sendable {
    case all, named
    case indexed(start: Int, count: Int)
}

enum SessionEvent: Sendable {
    case output(DebugOutput)
    case stopped(thread: Int?, reason: String)
    case continued
    case threads
    case breakpoint(URL, line: Int, verified: Bool)
    case capabilities(DebugCapabilities, adapter: String)
    case ended(exitCode: Int?)
    case failed(String)
}

actor DebugSession {
    nonisolated let events: AsyncStream<SessionEvent>
    private let emit: AsyncStream<SessionEvent>.Continuation
    private let plan: AdapterPlan
    private let debugging: Bool

    private var adapter: ChildProcess?
    private var port: UInt16?
    private var portWaiter: CheckedContinuation<UInt16, any Error>?
    private var adapterText = ""
    private var root: AdapterConnection?
    private var child: AdapterConnection?
    private var childWaiter: CheckedContinuation<Void, any Error>?
    private var childResult: Result<Void, DebugFailure>?
    private var initialized: Set<ObjectIdentifier> = []
    private var initializedWaiters: [ObjectIdentifier: CheckedContinuation<Void, any Error>] = [:]
    private var capabilities = DebugCapabilities()
    private var breakpointIDs: [Int: (url: URL, line: Int)] = [:]
    private var processes: Set<Int32> = []
    private var terminals: [ChildProcess] = []
    private var runningTerminals = 0
    private var launchOutput = ""
    private var exitCode: Int?
    private var finished = false
    private var stopping = false
    private var tasks: [Task<Void, Never>] = []

    private var program: AdapterConnection? { child ?? root }

    private static let launchTimeout: Duration = .seconds(120)
    private static let quitTimeout: Duration = .seconds(2)

    init(plan: AdapterPlan, debugging: Bool) {
        self.plan = plan
        self.debugging = debugging
        (events, emit) = AsyncStream.makeStream(of: SessionEvent.self)
    }

    func launch(breakpoints: BreakpointPlan) async throws {
        do {
            let connection = try await connect()
            let node = plan.adapterID == "pwa-node"
            try await configure(connection, request: "launch", arguments: plan.launch, breakpoints: node ? .none : breakpoints)
            if node { try await waitForChild(breakpoints) }
            collectProcesses()
        } catch {
            let message = launchOutput.trimmingCharacters(in: .whitespacesAndNewlines)
            let reason = (error as? DebugFailure)?.message ?? error.localizedDescription
            let text = message.isEmpty ? reason : reason + "\n" + message
            await finish(.failed(text))
            throw DebugFailure(text)
        }
    }

    func processIdentifiers() -> [Int32] {
        collectProcesses()
        return [adapter?.identifier].compactMap { $0 } + processes.sorted()
    }


    func setBreakpoints(_ url: URL, _ breakpoints: [Breakpoint]) async {
        guard let program else { return }
        await send(breakpoints, in: url, over: program)
    }

    func setExceptionBreakpoints(_ plan: BreakpointPlan) async {
        guard let program else { return }
        let filters = plan.enabledFilters(capabilities.exceptionFilters, adapter: self.plan.adapterID)
        _ = await answer("setExceptionBreakpoints", ["filters": .array(filters.map(JSON.string))], over: program)
    }

    func completions(_ text: String, column: Int, frame: Int?) async -> [DebugCompletion] {
        guard capabilities.supportsCompletions else { return [] }
        var arguments: [String: JSON] = ["text": .string(text), "column": .number(Double(column + 1))]
        if let frame { arguments["frameId"] = .number(Double(frame)) }
        let body = await answer("completions", .object(arguments))
        return (body?["targets"]?.array ?? []).compactMap { item in
            guard let label = item["label"]?.string else { return nil }
            return DebugCompletion(label: label, text: item["text"]?.string ?? label, type: item["type"]?.string ?? "",
                                   start: item["start"]?.int.map { max($0, 0) }, length: item["length"]?.int ?? 0)
        }
    }

    func sendInput(_ text: String) async -> Bool {
        guard let input = programInput else { return false }
        await input.send(Data(text.utf8))
        return true
    }

    func endInput() async -> Bool {
        guard let input = programInput else { return false }
        await input.closeInput()
        return true
    }

    private var programInput: ChildProcess? {
        if let terminal = terminals.last, runningTerminals > 0 { return terminal }
        // Delve: dlv dap launches with Foreground set, so debugserver gives the debuggee Delve's own stdin
        guard plan.adapterID == "go", !finished else { return nil }
        return adapter
    }

    private func answer(_ command: String, _ arguments: JSON = [:], over connection: AdapterConnection? = nil,
                        timeout: Duration = .seconds(30)) async -> JSON? {
        guard let target = connection ?? program else { return nil }
        do {
            return try await target.request(command, arguments, timeout: timeout)
        } catch {
            let message = (error as? DebugFailure)?.message ?? error.localizedDescription
            Logger.debugger.error("\(command, privacy: .public) failed: \(message, privacy: .public)")
            if !finished, !stopping { emit.yield(.output(DebugOutput(category: .console, text: "\(command) failed: \(message)\n"))) }
            return nil
        }
    }

    func threads() async -> [DebugThread] {
        let body = await answer("threads")
        return (body?["threads"]?.array ?? []).compactMap { thread in
            guard let id = thread["id"]?.int else { return nil }
            return DebugThread(id: id, name: thread["name"]?.string ?? "Thread \(id)")
        }
    }

    func stackTrace(thread: Int, levels: Int, workspace: Workspace) async -> [DebugFrame] {
        let body = await answer("stackTrace", ["threadId": .number(Double(thread)), "startFrame": 0, "levels": .number(Double(levels))])
        let root = workspace.root.path + "/"
        let resolved = Kernel.realPath(workspace.root) + "/"
        return (body?["stackFrames"]?.array ?? []).compactMap { frame in
            guard let id = frame["id"]?.int else { return nil }
            let path = frame["source"]?["path"]?.string.map { $0.hasPrefix(resolved) ? root + $0.dropFirst(resolved.count) : $0 }
            let url = path.map { URL(fileURLWithPath: $0).standardizedFileURL }
            let hint = frame["presentationHint"]?.string
            let sourceHint = frame["source"]?["presentationHint"]?.string
            let library = hint == "subtle" || hint == "label" || sourceHint == "deemphasize"
            return DebugFrame(
                id: id, function: frame["name"]?.string ?? "?", url: url, line: max((frame["line"]?.int ?? 1) - 1, 0),
                column: max((frame["column"]?.int ?? 1) - 1, 0), isUserCode: !library && url?.path.hasPrefix(root) == true,
                isLabel: hint == "label"
            )
        }
    }

    func scopes(frame: Int) async -> [DebugScope] {
        let body = await answer("scopes", ["frameId": .number(Double(frame))])
        return (body?["scopes"]?.array ?? []).compactMap { scope in
            guard let name = scope["name"]?.string, let reference = scope["variablesReference"]?.int else { return nil }
            return DebugScope(name: name, reference: reference, isExpensive: scope["expensive"]?.bool ?? false)
        }
    }

    func variables(_ reference: Int, filter: VariableFilter = .all) async -> [DebugVariable] {
        var arguments: [String: JSON] = ["variablesReference": .number(Double(reference))]
        switch filter {
        case .all: break
        case .named: arguments["filter"] = "named"
        case let .indexed(start, count):
            arguments["filter"] = "indexed"
            arguments["start"] = .number(Double(start))
            arguments["count"] = .number(Double(count))
        }
        let body = await answer("variables", .object(arguments))
        return (body?["variables"]?.array ?? []).compactMap { variable in
            guard let name = variable["name"]?.string else { return nil }
            return Self.variable(name: name, from: variable, valueKey: "value")
        }
    }

    func evaluate(_ expression: String, frame: Int?, context: EvaluateContext) async -> Result<DebugVariable, DebugFailure> {
        guard let program else { return .failure(DebugFailure("Nothing is running.")) }
        var arguments: [String: JSON] = ["expression": .string(expression), "context": .string(context.rawValue)]
        if let frame { arguments["frameId"] = .number(Double(frame)) }
        do {
            let body = try await program.request("evaluate", .object(arguments))
            return .success(Self.variable(name: expression, from: body, valueKey: "result"))
        } catch {
            return .failure((error as? DebugFailure) ?? DebugFailure(error.localizedDescription))
        }
    }

    func control(_ command: String, thread: Int) async {
        _ = await answer(command, ["threadId": .number(Double(thread))])
    }

    func stop() async {
        guard !finished else { return }
        stopping = true
        if capabilities.supportsTerminate { _ = await answer("terminate", timeout: Self.quitTimeout) }
        for connection in [child, root].compactMap({ $0 }) {
            _ = await answer("disconnect", ["terminateDebuggee": true], over: connection, timeout: Self.quitTimeout)
        }
        await finish(.ended(exitCode: exitCode))
    }

    private static func variable(name: String, from json: JSON, valueKey: String) -> DebugVariable {
        let named = json["namedVariables"]?.int, indexed = json["indexedVariables"]?.int
        return DebugVariable(
            name: name, value: json[valueKey]?.string ?? "", type: json["type"]?.string ?? "",
            reference: json["variablesReference"]?.int ?? 0,
            childCount: named == nil && indexed == nil ? nil : (named ?? 0) + (indexed ?? 0), indexedCount: indexed, isChanged: false
        )
    }


    private func connect() async throws -> AdapterConnection {
        let process = try ChildProcess(
            ChildProcess.Launch(executable: plan.executable, arguments: plan.arguments, environment: plan.environment, directory: plan.directory)
        )
        adapter = process
        let output = process.events
        tasks.append(Task { for await event in output { await self.adapterEvent(event) } })
        let port: UInt16 = switch plan.port {
        case let .fixed(port): port
        case .announced: try await withCheckedThrowingContinuation { portWaiter = $0 }
        }
        self.port = port
        let connection = try await open(port: port)
        root = connection
        let answer = try await connection.request("initialize", [
            "clientID": "nyte-ide", "clientName": "Nyte IDE", "adapterID": .string(plan.adapterID), "locale": "en",
            "linesStartAt1": true, "columnsStartAt1": true, "pathFormat": "path", "supportsVariableType": true,
            "supportsRunInTerminalRequest": true, "supportsStartDebuggingRequest": true, "supportsProgressReporting": false,
        ])
        adopt(answer)
        return connection
    }

    private func open(port: UInt16) async throws -> AdapterConnection {
        let connection = try await AdapterConnection.open(port: port)
        let incoming = connection.incoming
        tasks.append(Task {
            for await message in incoming { await self.receive(message, from: connection) }
            await self.closed(connection)
        })
        return connection
    }

    private func adopt(_ answer: JSON) {
        capabilities = DebugCapabilities(
            exceptionFilters: (answer["exceptionBreakpointFilters"]?.array ?? []).compactMap { filter in
                guard let id = filter["filter"]?.string else { return nil }
                return ExceptionFilter(id: id, label: filter["label"]?.string ?? id, detail: filter["description"]?.string ?? "",
                                       isDefault: filter["default"]?.bool ?? false)
            },
            supportsConditionalBreakpoints: answer["supportsConditionalBreakpoints"]?.bool ?? false,
            supportsHitConditionalBreakpoints: answer["supportsHitConditionalBreakpoints"]?.bool ?? false,
            supportsLogPoints: answer["supportsLogPoints"]?.bool ?? false,
            supportsCompletions: answer["supportsCompletionsRequest"]?.bool ?? false,
            supportsTerminate: answer["supportsTerminateRequest"]?.bool ?? false
        )
        emit.yield(.capabilities(capabilities, adapter: plan.adapterID))
    }

    private func configure(_ connection: AdapterConnection, request: String, arguments: JSON, breakpoints: BreakpointPlan) async throws {
        let key = ObjectIdentifier(connection)
        let launching = Task { try await connection.request(request, arguments, timeout: Self.launchTimeout) }
        let watcher = Task {
            do { _ = try await launching.value } catch { self.failInitialized(key, error) }
        }
        defer { watcher.cancel() }
        if plan.adapterID == "go", !debugging {
            // Delve: a noDebug launch answers without the initialized event and runs the program at once
            _ = try await launching.value
            return
        }
        if !initialized.contains(key) {
            try await withCheckedThrowingContinuation { initializedWaiters[key] = $0 }
        }
        if debugging {
            for (url, list) in breakpoints.files { await send(list, in: url, over: connection) }
        }
        let filters = debugging ? breakpoints.enabledFilters(capabilities.exceptionFilters, adapter: plan.adapterID) : []
        _ = await answer("setExceptionBreakpoints", ["filters": .array(filters.map(JSON.string))], over: connection)
        _ = try await connection.request("configurationDone")
        _ = try await launching.value
    }

    private func failInitialized(_ key: ObjectIdentifier, _ error: any Error) {
        initializedWaiters.removeValue(forKey: key)?.resume(throwing: error)
    }

    private func waitForChild(_ breakpoints: BreakpointPlan) async throws {
        pendingBreakpoints = breakpoints
        if let childResult { return try childResult.get() }
        try await withCheckedThrowingContinuation { childWaiter = $0 }
    }

    private var pendingBreakpoints = BreakpointPlan.none

    private func startChild(_ configuration: JSON, request: String) async {
        let result: Result<Void, DebugFailure>
        do {
            guard let port else { throw DebugFailure("The JavaScript debugger has no port.") }
            let connection = try await open(port: port)
            child = connection
            adopt(try await connection.request("initialize", [
                "clientID": "nyte-ide", "adapterID": .string(plan.adapterID), "linesStartAt1": true, "columnsStartAt1": true,
                "pathFormat": "path", "supportsVariableType": true, "supportsRunInTerminalRequest": true,
                "supportsStartDebuggingRequest": true,
            ]))
            try await configure(connection, request: request, arguments: configuration, breakpoints: pendingBreakpoints)
            result = .success(())
        } catch {
            result = .failure((error as? DebugFailure) ?? DebugFailure(error.localizedDescription))
        }
        childResult = result
        childWaiter?.resume(with: result)
        childWaiter = nil
    }

    private func send(_ breakpoints: [Breakpoint], in url: URL, over connection: AdapterConnection) async {
        let enabled = breakpoints.filter(\.isEnabled)
        let body = await answer("setBreakpoints", [
            "source": ["path": .string(Kernel.realPath(url)), "name": .string(url.lastPathComponent)],
            "breakpoints": .array(enabled.map { breakpoint in
                var fields: [String: JSON] = ["line": .number(Double(breakpoint.line + 1))]
                if !breakpoint.condition.isEmpty { fields["condition"] = .string(breakpoint.condition) }
                if !breakpoint.hitCondition.isEmpty { fields["hitCondition"] = .string(breakpoint.hitCondition) }
                if !breakpoint.logMessage.isEmpty { fields["logMessage"] = .string(breakpoint.logMessage) }
                return .object(fields)
            }),
        ], over: connection)
        let answers = body?["breakpoints"]?.array ?? []
        for (index, breakpoint) in enabled.enumerated() {
            let answer = index < answers.count ? answers[index] : .null
            if let id = answer["id"]?.int { breakpointIDs[id] = (url, breakpoint.line) }
            emit.yield(.breakpoint(url, line: breakpoint.line, verified: answer["verified"]?.bool ?? false))
        }
    }


    private func adapterEvent(_ event: ChildProcess.Event) async {
        switch event {
        case let .output(data), let .diagnostics(data):
            adapterText += String(decoding: data, as: UTF8.self)
            guard case let .announced(marker) = plan.port, let waiter = portWaiter,
                  let range = adapterText.range(of: marker),
                  let line = adapterText[range.upperBound...].split(separator: "\n", omittingEmptySubsequences: false).first,
                  adapterText[range.upperBound...].contains("\n"),
                  let port = line.split(separator: ":").last.flatMap({ UInt16($0.trimmingCharacters(in: .whitespaces)) })
            else { return }
            portWaiter = nil
            waiter.resume(returning: port)
        case let .exit(status):
            let failure = DebugFailure.adapterStopped(plan.executable.lastPathComponent, status: status, output: adapterText)
            portWaiter?.resume(throwing: failure)
            portWaiter = nil
            guard !finished, !stopping else { return }
            Logger.debugger.error("\(self.plan.executable.lastPathComponent, privacy: .public) exited with status \(status)")
            await finish(.failed(failure.message))
        }
    }

    private func receive(_ message: AdapterConnection.Incoming, from connection: AdapterConnection) async {
        switch message {
        case let .event(name, body): await event(name, body, from: connection)
        case let .request(seq, command, arguments): await reverseRequest(seq, command, arguments, from: connection)
        }
    }

    private func event(_ name: String, _ body: JSON, from connection: AdapterConnection) async {
        switch name {
        case "initialized":
            let key = ObjectIdentifier(connection)
            initialized.insert(key)
            initializedWaiters.removeValue(forKey: key)?.resume()
        case "output":
            guard let text = body["output"]?.string else { return }
            let category: DebugOutput.Category? = switch body["category"]?.string {
            case "stdout": .stdout
            case "stderr": .stderr
            case "telemetry": nil
            default: .console
            }
            guard let category else { return }
            if launchOutput.utf8.count < 65_536, category != .console || plan.adapterID == "go" { launchOutput += text }
            emit.yield(.output(DebugOutput(category: category, text: text)))
        case "stopped":
            guard connection === program else { return }
            collectProcesses()
            emit.yield(.stopped(thread: body["threadId"]?.int, reason: body["reason"]?.string ?? "pause"))
        case "continued":
            guard connection === program else { return }
            emit.yield(.continued)
        case "thread":
            emit.yield(.threads)
        case "breakpoint":
            guard let breakpoint = body["breakpoint"], let id = breakpoint["id"]?.int, let place = breakpointIDs[id] else { return }
            emit.yield(.breakpoint(place.url, line: place.line, verified: breakpoint["verified"]?.bool ?? false))
        case "process":
            if let pid = body["systemProcessId"]?.int { processes.insert(Int32(pid)) }
        case "exited":
            exitCode = body["exitCode"]?.int
        case "terminated":
            guard connection === root else { return childTerminated() }
            let deadline = ContinuousClock.now + Self.quitTimeout
            while runningTerminals > 0, ContinuousClock.now < deadline {
                try? await Task.sleep(for: .milliseconds(20))
                guard !Task.isCancelled else { break }
            }
            await finish(.ended(exitCode: exitCode))
        default:
            break
        }
    }

    private func reverseRequest(_ seq: Int, _ command: String, _ arguments: JSON, from connection: AdapterConnection) async {
        switch command {
        case "startDebugging":
            guard child == nil, childResult == nil else {
                return await connection.respond(to: seq, command: command, error: "Nyte IDE debugs one program per session.")
            }
            await connection.respond(to: seq, command: command)
            let configuration = arguments["configuration"] ?? [:]
            let request = arguments["request"]?.string ?? "launch"
            tasks.append(Task { await self.startChild(configuration, request: request) })
        case "runInTerminal":
            do {
                let pid = try runInTerminal(arguments)
                await connection.respond(to: seq, command: command, body: ["processId": .number(Double(pid))])
            } catch {
                await connection.respond(to: seq, command: command, error: (error as? DebugFailure)?.message ?? error.localizedDescription)
            }
        default:
            await connection.respond(to: seq, command: command, error: "Nyte IDE does not support \(command).")
        }
    }

    private func runInTerminal(_ arguments: JSON) throws -> Int32 {
        let command = (arguments["args"]?.array ?? []).compactMap(\.string)
        guard let first = command.first else { throw DebugFailure("runInTerminal came with no command.") }
        var environment = plan.environment
        for (name, value) in arguments["env"]?.object ?? [:] {
            if let value = value.string { environment[name] = value } else { environment[name] = nil }
        }
        let absolute = first.hasPrefix("/")
        let process = try ChildProcess(ChildProcess.Launch(
            executable: URL(fileURLWithPath: absolute ? first : "/usr/bin/env"),
            arguments: absolute ? Array(command.dropFirst()) : command, environment: environment,
            directory: arguments["cwd"]?.string.map { URL(fileURLWithPath: $0) }
        ))
        terminals.append(process)
        runningTerminals += 1
        processes.insert(process.identifier)
        let events = process.events
        let emit = emit
        tasks.append(Task {
            for await event in events {
                switch event {
                case let .output(data): emit.yield(.output(DebugOutput(category: .stdout, text: String(decoding: data, as: UTF8.self))))
                case let .diagnostics(data): emit.yield(.output(DebugOutput(category: .stderr, text: String(decoding: data, as: UTF8.self))))
                case let .exit(status): self.terminalExited(status)
                }
            }
        })
        return process.identifier
    }

    private func terminalExited(_ status: Int32) {
        runningTerminals -= 1
        exitCode = Int(status)
    }

    private func childTerminated() {
        tasks.append(Task {
            try? await Task.sleep(for: Self.quitTimeout)
            guard !Task.isCancelled else { return }
            await self.finish(.ended(exitCode: self.exitCode))
        })
    }

    private func closed(_ connection: AdapterConnection) async {
        guard connection === root else { return }
        await finish(.ended(exitCode: exitCode))
    }


    private func collectProcesses() {
        guard let pid = adapter?.identifier else { return }
        processes.formUnion(Kernel.descendants(of: pid))
    }

    private func finish(_ event: SessionEvent) async {
        guard !finished else { return }
        finished = true
        collectProcesses()
        for waiter in initializedWaiters.values { waiter.resume(throwing: DebugFailure("The debug session ended.")) }
        initializedWaiters.removeAll()
        childWaiter?.resume(throwing: DebugFailure("The debug session ended."))
        childWaiter = nil
        await child?.close()
        await root?.close()
        await adapter?.terminate(grace: .milliseconds(500))
        for terminal in terminals { await terminal.terminate(grace: .milliseconds(500)) }
        let pids = processes.union([adapter?.identifier].compactMap { $0 })
        for pid in pids { kill(pid, SIGTERM) }
        let deadline = ContinuousClock.now + .seconds(2)
        while pids.contains(where: { kill($0, 0) == 0 }), ContinuousClock.now < deadline {
            try? await Task.sleep(for: .milliseconds(25))
            guard !Task.isCancelled else { break }
        }
        for pid in pids where kill(pid, 0) == 0 { kill(pid, SIGKILL) }
        if let folder = plan.buildFolder {
            do {
                try FileManager.default.removeItem(at: folder)
            } catch CocoaError.fileNoSuchFile {
            } catch {
                Logger.debugger.error("remove \(folder.path, privacy: .public) failed: \(error.localizedDescription, privacy: .public)")
            }
        }
        emit.yield(event)
        emit.finish()
        for task in tasks { task.cancel() }
    }
}
