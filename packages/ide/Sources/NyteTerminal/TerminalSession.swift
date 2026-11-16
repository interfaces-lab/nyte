import Dispatch
import os
import Synchronization

enum TerminalLog {
    static let logger = Logger(subsystem: "ai.nyte.ide", category: "terminal")
    private static let reported = Mutex<Set<String>>([])

    static func unknown(_ kind: StaticString, _ raw: Int64) {
        guard reported.withLock({ $0.insert("\(kind) \(raw)").inserted }) else { return }
        logger.error("libghostty returned an unknown \(kind, privacy: .public): \(raw, privacy: .public)")
    }
}

struct TerminalEffects {
    var reply: [UInt8] = []
    var bells = 0
    var titleChanged = false
    var holdStarted = false
    var commandEnded = false
}

struct TerminalSessionEvents: Sendable {
    let wake: @Sendable () -> Void
    let frame: @Sendable (TerminalFrame) -> Void
    let title: @Sendable (_ title: String?, _ directory: String?) -> Void
    let bell: @Sendable () -> Void
    let exit: @Sendable (TerminalExit) -> Void
    var selection: @Sendable (TerminalSelectionChange) -> Void = { _ in }
    var commandOutput: @Sendable (String) -> Void = { _ in }
}

struct TerminalSelectionChange: Sendable, Equatable {
    var text: String?
    var byPointer: Bool
}

actor TerminalSession {
    nonisolated let queue = DispatchSerialQueue(label: "ai.nyte.terminal", qos: .userInteractive)
    nonisolated var unownedExecutor: UnownedSerialExecutor { queue.asUnownedSerialExecutor() }
    private nonisolated let pendingGrid = Mutex<TerminalGrid?>(nil)

    private enum Phase {
        case idle
        case live(TerminalEngine, any TerminalBackend)
        case ended(TerminalEngine)
        case closing(any TerminalBackend)
        case closed
    }

    private let events: TerminalSessionEvents
    private let makeBackend: @Sendable () -> any TerminalBackend
    private var preferences: TerminalPreferences
    private var phase = Phase.idle
    private var isWakePending = false
    private var buttonsDown = 0
    private var command: String?

    private static let commandWait: DispatchTimeInterval = .seconds(5)
    private static let lineEditorReadingMode: UInt16 = 2004

    init(events: TerminalSessionEvents, preferences: TerminalPreferences = .standard, command: String? = nil,
         makeBackend: @escaping @Sendable () -> any TerminalBackend) {
        self.events = events
        self.preferences = preferences
        self.command = command
        self.makeBackend = makeBackend
    }

    nonisolated func enqueue(_ work: @escaping @Sendable (isolated TerminalSession) -> Void) {
        queue.async { self.assumeIsolated(work) }
    }

    nonisolated func requestResize(_ grid: TerminalGrid) {
        let schedule = pendingGrid.withLock { pending in
            defer { pending = grid }
            return pending == nil
        }
        guard schedule else { return }
        enqueue { $0.applyPendingGrid() }
    }

    private var engine: TerminalEngine? {
        switch phase {
        case let .live(engine, _), let .ended(engine): engine
        case .idle, .closing, .closed: nil
        }
    }

    private var backend: (any TerminalBackend)? {
        switch phase {
        case let .live(_, backend), let .closing(backend): backend
        case .idle, .ended, .closed: nil
        }
    }

    func start(grid: TerminalGrid, colors: TerminalColors) {
        guard case .idle = phase else { return assertionFailure("a terminal session starts once") }
        let engine: TerminalEngine
        do {
            engine = try TerminalEngine(grid: grid, colors: colors, preferences: preferences)
        } catch {
            return fail(error)
        }
        let backend = makeBackend()
        phase = .live(engine, backend)
        do {
            try backend.start(grid: grid, in: self)
        } catch {
            phase = .ended(engine)
            return fail(error)
        }
        guard command != nil else { return }
        queue.asyncAfter(deadline: .now() + Self.commandWait) { [weak self] in self?.assumeIsolated { $0.typeCommandAtPrompt() } }
    }

    private func typeCommandAtPrompt() {
        guard let command, case let .live(engine, backend) = phase else { return }
        self.command = nil
        backend.send((engine.paste(command, confirmed: true) ?? Array(command.utf8)) + [0x0D], in: self)
    }

    private func fail(_ failure: TerminalFailure) {
        TerminalLog.logger.error("The terminal could not start: \(failure.reason, privacy: .public)")
        if case .idle = phase { phase = .closed }
        requestWake()
        events.exit(.failedToStart(failure))
    }

    func shutdown() {
        switch phase {
        case let .live(_, backend):
            phase = .closing(backend)
            backend.shutdown(in: self)
        case .idle, .ended:
            phase = .closed
        case .closing, .closed:
            break
        }
    }

    func serviceBackend() {
        backend?.service(in: self)
    }

    func backendOutput(_ bytes: UnsafeRawBufferPointer) {
        guard case let .live(engine, backend) = phase else { return }
        let effects = engine.write(bytes)
        if !effects.reply.isEmpty { backend.send(effects.reply, in: self) }
        for _ in 0..<effects.bells { events.bell() }
        if effects.titleChanged { events.title(engine.title, engine.directory) }
        if effects.commandEnded, let output = engine.commandOutputText() { events.commandOutput(output) }
        if command != nil, engine.mode(Self.lineEditorReadingMode) { typeCommandAtPrompt() }
        if effects.holdStarted {
            queue.asyncAfter(deadline: .now() + .nanoseconds(Int(TerminalEngine.holdLimit))) { [weak self] in
                self?.assumeIsolated { $0.requestWake() }
            }
        }
        requestWake()
    }

    func backendExited(_ status: TerminalExit) {
        if case let .live(engine, _) = phase { phase = .ended(engine) }
        requestWake()
        events.exit(status)
    }

    func backendClosed() {
        phase = .closed
    }

    private func requestWake() {
        guard !isWakePending else { return }
        isWakePending = true
        events.wake()
    }

    func produceFrame(full: Bool = false) {
        isWakePending = false
        guard let engine else { return }
        events.frame(engine.makeFrame(full: full))
    }

    private func applyPendingGrid() {
        let next = pendingGrid.withLock { pending in
            defer { pending = nil }
            return pending
        }
        guard let next, let engine, next != engine.grid else { return }
        engine.resize(next)
        backend?.resize(next, in: self)
        requestWake()
    }

    func apply(_ preferences: TerminalPreferences) {
        self.preferences = preferences
        engine?.apply(preferences)
        requestWake()
    }

    func setColors(_ colors: TerminalColors) {
        guard let engine else { return }
        let reply = engine.setColors(colors)
        if !reply.isEmpty { backend?.send(reply, in: self) }
        requestWake()
    }

    func key(_ input: KeyInput) {
        guard let engine else { return }
        sendInput(engine.encode(input))
    }

    func text(_ string: String) {
        sendInput(Array(string.utf8))
    }

    func paste(_ string: String, confirmed: Bool, reply: @escaping @Sendable (PasteOutcome) -> Void) {
        guard let engine else { return }
        guard let bytes = engine.paste(string, confirmed: confirmed) else { return reply(.needsConfirmation) }
        send(bytes)
        followInput()
        reply(.pasted)
    }

    func focus(_ gained: Bool) {
        guard let bytes = engine?.encodeFocus(gained), !bytes.isEmpty else { return }
        backend?.send(bytes, in: self)
    }

    func pointer(_ input: PointerInput) {
        guard let engine else { return }
        if input.phase == .press { buttonsDown += 1 }
        if input.phase == .release { buttonsDown = max(0, buttonsDown - 1) }
        if engine.isMouseTracking, !input.forceSelection {
            return send(engine.encodePointer(input, anyButtonPressed: buttonsDown > 0))
        }
        guard input.button == .left, input.phase != .motion else { return }
        engine.select(input)
        if input.phase == .release { events.selection(TerminalSelectionChange(text: engine.selectionText(), byPointer: true)) }
        requestWake()
    }

    func scroll(_ input: ScrollInput) {
        guard let engine, input.rows != 0 else { return }
        let up = input.rows < 0
        if engine.isMouseTracking {
            let wheel = PointerInput(
                phase: .press, button: up ? .wheelUp : .wheelDown, modifiers: input.modifiers, column: input.column,
                row: input.row, x: input.x, y: input.y, time: 0, repeatInterval: 0, forceSelection: false
            )
            for _ in 0..<abs(input.rows) { send(engine.encodePointer(wheel, anyButtonPressed: buttonsDown > 0)) }
            return
        }
        if engine.isAlternateScreen {
            let arrow = KeyInput(phase: .press, key: up ? .arrowUp : .arrowDown, modifiers: [], consumed: [], text: "",
                                 unshifted: 0)
            for _ in 0..<abs(input.rows) { send(engine.encode(arrow)) }
            return
        }
        engine.scrollViewport(by: input.rows)
        requestWake()
    }

    func copySelection(reply: @escaping @Sendable (String?) -> Void) {
        reply(engine?.selectionText())
    }

    func selectAll() {
        guard let engine else { return }
        engine.selectAll()
        events.selection(TerminalSelectionChange(text: engine.selectionText(), byPointer: false))
        requestWake()
    }

    func hyperlink(column: Int, row: Int, reply: @escaping @Sendable (String?) -> Void) {
        reply(engine?.hyperlink(column: column, row: row))
    }

    func clearScreen() {
        guard engine?.clearScreen() == true else { return }
        requestWake()
    }

    private func send(_ bytes: [UInt8]) {
        guard !bytes.isEmpty else { return }
        backend?.send(bytes, in: self)
    }

    private func sendInput(_ bytes: [UInt8]) {
        guard !bytes.isEmpty else { return }
        send(bytes)
        followInput()
    }

    private func followInput() {
        guard let engine else { return }
        _ = engine.scrollToBottom()
        if engine.clearSelection() { events.selection(TerminalSelectionChange(text: nil, byPointer: false)) }
        requestWake()
    }
}
