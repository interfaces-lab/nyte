import Foundation
import NyteCore

@MainActor
public final class Debugger {
    public enum State: Sendable, Equatable {
        case idle
        case starting(DebugTarget)
        case running
        case paused(thread: Int, reason: String, frame: DebugFrame?)
        case ended(exitCode: Int?)
        case failed(String)
    }

    public enum Change: Sendable {
        case state
        case breakpoints(URL)
        case output([DebugOutput])
        case threads
    }

    public let workspace: Workspace
    public var onChange: ((Change) -> Void)?
    public private(set) var state = State.idle { didSet { onChange?(.state) } }
    public private(set) var threads: [DebugThread] = []
    public private(set) var selectedFrame: DebugFrame?
    public private(set) var selectedThread: Int?
    public private(set) var output: [DebugOutput] = []
    public private(set) var droppedOutput = 0
    public private(set) var capabilities = DebugCapabilities()
    public private(set) var failure: LaunchFailure?
    public internal(set) var inputEnded = false

    let toolchain: Toolchain
    var store: BreakpointStore
    var session: DebugSession?
    private var listening: Task<Void, Never>?
    private(set) var lastStart: (target: DebugTarget, debugging: Bool)?
    var syncing: Task<Void, Never>?
    var runToLine: URL?
    var temporaryLine: Int?
    private var seen: [String: String] = [:]
    private var baseline: [String: String] = [:]
    private var paths: [Int: String] = [:]
    private var cancelsStart = false
    private var describing: Task<Void, Never>?

    static let outputLimit = 10_000
    static let frameLimit = 64
    static let threadPatience: Duration = .seconds(2)
    static let pauseWait: Duration = .milliseconds(500)
    static let pauseAttempts = 4

    public var settings: DebugSettings

    public init(workspace: Workspace, toolchain: Toolchain, settings: DebugSettings = DebugSettings()) {
        self.workspace = workspace
        self.toolchain = toolchain
        self.settings = settings
        store = BreakpointStore(workspace: workspace)
    }


    public func start(_ target: DebugTarget, debugging: Bool) async {
        if session != nil { await stop() }
        lastStart = (target, debugging)
        output.removeAll()
        inputEnded = false
        droppedOutput = 0
        failure = nil
        capabilities = DebugCapabilities()
        threads = []
        selectedFrame = nil
        seen = [:]
        baseline = [:]
        cancelsStart = false
        state = .starting(target)
        let plan: AdapterPlan
        do {
            plan = try await AdapterPlan.make(for: target, in: workspace, debugging: debugging, toolchain: toolchain, settings: settings)
        } catch {
            let delve = await ToolResolver.status(.delve, settings: settings, toolchain: toolchain, readsVersion: false)
            let goTarget = switch target.kind {
            case .goPackage, .goTest: true
            case .node: false
            }
            fail((error as? DebugFailure)?.message ?? error.localizedDescription,
                 install: goTarget && delve.path == nil ? delve.install : nil)
            return
        }
        guard !cancelsStart else {
            cancelsStart = false
            state = .ended(exitCode: nil)
            return
        }
        let session = DebugSession(plan: plan, debugging: debugging)
        self.session = session
        if debugging {
            for url in store.files.keys { store.setVerification(.unverified, in: url) }
        }
        let events = session.events
        listening = Task { [weak self] in
            for await event in events {
                guard let self, self.session === session else { return }
                await self.handle(event)
            }
        }
        let breakpoints = debugging ? store.plan : .none
        do {
            try await session.launch(breakpoints: breakpoints)
            if self.session === session, case .starting = state { state = .running }
        } catch {
            await listening?.value
        }
    }

    public func stop() async {
        guard let session else {
            if case .starting = state { cancelsStart = true }
            return
        }
        await session.stop()
        await listening?.value
    }

    public func restart() async {
        guard let lastStart else { return }
        await start(lastStart.target, debugging: lastStart.debugging)
    }

    public func resume() async { await control("continue") }
    public func stepOver() async { await control("next") }
    public func stepInto() async { await control("stepIn") }
    public func stepOut() async { await control("stepOut") }

    public func pause() async {
        guard let session, state == .running else { return }
        let deadline = ContinuousClock.now + Self.threadPatience
        while threads.isEmpty, ContinuousClock.now < deadline {
            threads = await session.threads()
            guard threads.isEmpty else { break }
            try? await Task.sleep(for: .milliseconds(50))
            guard !Task.isCancelled, self.session === session else { return }
        }
        guard let thread = threads.first?.id else { return }
        for _ in 0..<Self.pauseAttempts {
            await session.control("pause", thread: thread)
            let deadline = ContinuousClock.now + Self.pauseWait
            while state == .running, self.session === session, ContinuousClock.now < deadline {
                try? await Task.sleep(for: .milliseconds(25))
                guard !Task.isCancelled else { return }
            }
            guard state == .running, self.session === session else { return }
        }
    }

    public func selectThread(_ id: Int) {
        guard case .paused = state, threads.contains(where: { $0.id == id }) else { return }
        selectedThread = id
    }

    public func runToLine(_ line: Int, in url: URL) async {
        let url = url.standardizedFileURL
        guard case .paused = state else { return }
        runToLine = url
        temporaryLine = line
        sync(url)
        await resume()
    }

    private func control(_ command: String) async {
        guard let session, case let .paused(thread, _, _) = state else { return }
        await syncing?.value
        state = .running
        await session.control(command, thread: selectedThread ?? thread)
    }

    public func processIdentifiers() async -> [Int32] {
        await session?.processIdentifiers() ?? []
    }

    public func frames(of thread: Int) async -> [DebugFrame] {
        guard let session else { return [] }
        return await session.stackTrace(thread: thread, levels: Self.frameLimit, workspace: workspace)
    }

    public func selectFrame(_ frame: DebugFrame) {
        selectedFrame = frame
    }

    public func scopes(of frame: DebugFrame) async -> [DebugScope] {
        guard let session else { return [] }
        let scopes = await session.scopes(frame: frame.id)
        for scope in scopes where scope.reference > 0 { paths[scope.reference] = frame.function + "/" + scope.name }
        return scopes
    }

    public func children(of reference: Int) async -> [DebugVariable] {
        await children(of: reference, filter: .all)
    }

    public func namedChildren(of reference: Int) async -> [DebugVariable] {
        await children(of: reference, filter: .named)
    }

    public func children(of reference: Int, start: Int, count: Int) async -> [DebugVariable] {
        await children(of: reference, filter: .indexed(start: start, count: count))
    }

    private func children(of reference: Int, filter: VariableFilter) async -> [DebugVariable] {
        guard let session, reference > 0 else { return [] }
        let parent = paths[reference] ?? String(reference)
        return await session.variables(reference, filter: filter).map { variable in
            remember(variable, path: parent + "/" + variable.name)
        }
    }

    public func evaluate(_ expression: String, in frame: DebugFrame?, context: EvaluateContext) async -> Result<DebugVariable, DebugFailure> {
        guard let session else { return .failure(DebugFailure("Nothing is running.")) }
        let result = await session.evaluate(expression, frame: frame?.id, context: context)
        guard context == .watch, case let .success(variable) = result else { return result }
        return .success(remember(variable, path: "watch/" + expression))
    }

    func remember(_ variable: DebugVariable, path: String) -> DebugVariable {
        var marked = variable
        marked.isChanged = baseline[path].map { $0 != variable.value } ?? false
        seen[path] = variable.value
        if variable.reference > 0 { paths[variable.reference] = path }
        return marked
    }

    private func handle(_ event: SessionEvent) async {
        switch event {
        case let .output(entry):
            output.append(entry)
            if output.count > Self.outputLimit + Self.outputLimit / 10 {
                droppedOutput += output.count - Self.outputLimit
                output.removeFirst(output.count - Self.outputLimit)
            }
            onChange?(.output([entry]))
        case let .capabilities(capabilities, adapter):
            self.capabilities = capabilities
            store.remember(capabilities.exceptionFilters, adapter: adapter)
        case let .stopped(thread, reason):
            await stopped(thread: thread, reason: reason)
        case .continued:
            if case .paused = state { state = .running }
        case .threads:
            if let session { threads = await session.threads() }
            onChange?(.threads)
        case let .breakpoint(url, line, verified):
            store.setVerification(verified ? .verified : .unverified, in: url, line: line)
            onChange?(.breakpoints(url))
        case let .ended(exitCode):
            end(.ended(exitCode: exitCode))
        case let .failed(message):
            failure = LaunchFailure.parse(message, directory: lastStart?.target.directory ?? workspace.root)
            end(.failed(message))
        }
    }

    private func stopped(thread: Int?, reason: String) async {
        guard let session else { return }
        threads = await session.threads()
        onChange?(.threads)
        guard let thread = thread ?? threads.first?.id else { return }
        let frames = await session.stackTrace(thread: thread, levels: 1, workspace: workspace)
        if let url = runToLine {
            runToLine = nil
            temporaryLine = nil
            sync(url)
        }
        baseline = seen
        paths = [:]
        selectedThread = thread
        selectedFrame = frames.first
        state = .paused(thread: thread, reason: reason, frame: frames.first)
        describing?.cancel()
        describing = Task { await describeThreads(stopped: thread) }
    }

    private func describeThreads(stopped: Int) async {
        guard let session else { return }
        let listed = threads
        var described = listed
        for index in described.indices.prefix(ThreadStates.described) {
            let frames = await session.stackTrace(thread: described[index].id, levels: ThreadStates.depth, workspace: workspace)
            guard !Task.isCancelled else { return }
            let summary = ThreadStates.describe(frames, isStopped: described[index].id == stopped)
            described[index].state = summary.state
            described[index].function = summary.function
        }
        guard case .paused = state, threads == listed else { return }
        threads = described
        onChange?(.threads)
    }

    private func fail(_ message: String, install: ToolInstall? = nil) {
        failure = LaunchFailure.parse(message, directory: lastStart?.target.directory ?? workspace.root)
        failure?.install = install
        state = .failed(message)
    }

    private func end(_ ending: State) {
        describing?.cancel()
        describing = nil
        session = nil
        selectedThread = nil
        threads = []
        selectedFrame = nil
        runToLine = nil
        temporaryLine = nil
        syncing = nil
        for url in Array(store.files.keys) {
            store.setVerification(.notDebugging, in: url)
            onChange?(.breakpoints(url))
        }
        state = ending
    }
}
