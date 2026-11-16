import AppKit
import NyteCore
import NyteUI

@MainActor
public final class DebugViewController: NSViewController, NSSplitViewDelegate, NSUserInterfaceValidations {
    public enum Tab: Int, Sendable { case threads, console, breakpoints }

    public var onNavigate: ((FileLocation) -> Void)?
    public var onInstall: ((ToolInstall) -> Void)? {
        didSet { consolePane.failure.onInstall = onInstall }
    }
    public var onAskAgent: ((AgentContext) -> Void)? {
        didSet { askingChanged() }
    }

    public var tab = Tab.threads {
        didSet {
            views.selectedIndex = tab.rawValue
            updateVisibility()
        }
    }

    private let debugger: Debugger
    private let bar = ToolWindowView(header: DebugLayout.headerRole)
    private let toolbar = Toolbar()
    private let views = TextTabs(["Threads & Variables", "Console", "Breakpoints"],
                                      label: "View")
    private let status = Label("", style: .sm, color: Palette.contentSecondary)
    private let loader = Loader(side: Glyph.sm.rawValue)
    private let content = NSView()
    private let split = HairlineSplitView()
    private let frames = FramesPane()
    let variables: VariablesPane
    let consolePane: ConsolePane
    let breakpoints: BreakpointsPane
    var console: ConsoleView { consolePane.console }
    private let empty = EmptyState(
        symbol: "ladybug", title: "Run or debug a program",
        description: "Set a breakpoint in the gutter, then start debugging.",
        hints: [("Start debugging", "F5"), ("Run without debugging", "⌃F5"), ("Toggle breakpoint", "F9")]
    )

    private let askFixButton = Button("Ask Nyte to Fix", variant: .outline, size: .sm)
    private lazy var resumeButton = control("play", "Resume", key: "F5") { [unowned self] in resumeOrPause() }
    private lazy var stepOverButton = control("arrowshape.bounce.right", "Step over", key: "F10") { [unowned self] in
        run { await $0.stepOver() }
    }
    private lazy var stepIntoButton = control("arrow.down.to.line", "Step into", key: "F11") { [unowned self] in
        run { await $0.stepInto() }
    }
    private lazy var stepOutButton = control("arrow.up.to.line", "Step out", key: "⇧F11") { [unowned self] in
        run { await $0.stepOut() }
    }
    private lazy var restartButton = control("arrow.clockwise", "Restart", key: "⇧⌘F5") { [unowned self] in
        run { await $0.restart() }
    }
    private lazy var stopButton = control("stop.fill", "Stop", key: "⇧F5", tone: .danger) { [unowned self] in
        run { await $0.stop() }
    }

    private var thread: Int?
    private var stackGeneration = 0
    private var stackLoading: Task<Void, Never>?
    private var staling: Task<Void, Never>?
    private var layoutMemory = DebugLayoutMemory.load()

    static let staleDelay: Duration = .milliseconds(250)
    static let readableRows: CGFloat = 6
    public static let readableHeight = (DebugLayout.headerRole.height ?? 0) + (DebugLayout.stripRole.height ?? 0) + Space.x1
        + Metric.rowCompact * readableRows
    static let raisingReasons: Set<String> = ["breakpoint", "function breakpoint", "data breakpoint", "instruction breakpoint", "exception", "entry"]

    public init(debugger: Debugger) {
        self.debugger = debugger
        variables = VariablesPane(debugger: debugger)
        consolePane = ConsolePane(debugger: debugger)
        breakpoints = BreakpointsPane(debugger: debugger)
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public func loadView() {
        let root = NSView()
        root.setAccessibilityElement(false)
        view = root
        buildBar()
        buildContent()
        bar.headerRule = .always
        Pin.fill(bar, in: root)
        Pin.fill(content, in: bar.content)
        Pin.fill(empty, in: root)
        console.append(debugger.output)
        console.flush()
        if debugger.state == .idle, !debugger.placedBreakpoints.isEmpty { tab = .breakpoints }
        stateDidChange()
    }

    private func buildBar() {
        for button in [resumeButton, stepOverButton, stepIntoButton, stepOutButton] { toolbar.add(button) }
        toolbar.addSeparator()
        toolbar.add(restartButton)
        toolbar.add(stopButton)
        askFixButton.onPress = { [unowned self] in askAgentToFixLaunch(nil) }
        askFixButton.toolTip = "Hand the build output to Nyte"
        askFixButton.isHidden = true
        toolbar.add(askFixButton)
        views.onSelect = { [unowned self] index in tab = Tab(rawValue: index) ?? .threads }
        status.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        status.alignment = .right
        loader.ink = Palette.contentTertiary
        bar.header.leadingInset = RowCell.Geometry.inset
        bar.header.trailingInset = Metric.paneInset
        views.setContentCompressionResistancePriority(.required, for: .horizontal)
        bar.header.setViews(leading: [toolbar, views], trailing: [loader, status])
    }

    private func buildContent() {
        split.isVertical = true
        split.delegate = self
        split.addArrangedSubview(frames)
        split.addArrangedSubview(variables)
        frames.onSelectFrame = { [unowned self] frame in choose(frame) }
        frames.onSelectThread = { [unowned self] id in
            thread = id
            debugger.selectThread(id)
            loadStack(id, preferred: nil)
        }
        consolePane.onNavigate = { [unowned self] location in onNavigate?(location) }
        breakpoints.onNavigate = { [unowned self] location in onNavigate?(location) }
        for item in [split, consolePane, breakpoints] as [NSView] {
            item.translatesAutoresizingMaskIntoConstraints = false
            content.addSubview(item)
            NSLayoutConstraint.activate([
                item.topAnchor.constraint(equalTo: content.topAnchor),
                item.leadingAnchor.constraint(equalTo: content.leadingAnchor),
                item.trailingAnchor.constraint(equalTo: content.trailingAnchor),
                item.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            ])
        }
    }

    private func control(_ symbol: String, _ label: String, key: String, tone: Tone = .neutral,
                         action: @escaping () -> Void) -> Button {
        let button = Button(symbol: symbol, label: label, tone: tone, size: .md, onPress: action)
        button.setContentCompressionResistancePriority(.required, for: .horizontal)
        button.toolTip = "\(label) (\(key))"
        return button
    }

    private func run(_ command: @escaping @MainActor (Debugger) async -> Void) {
        let debugger = debugger
        Task { await command(debugger) }
    }

    private func resumeOrPause() {
        if debugger.state == .running {
            run { await $0.pause() }
        } else {
            run { await $0.resume() }
        }
    }

    public func debuggerDidChange(_ change: Debugger.Change) {
        switch change {
        case .state:
            stateDidChange()
        case let .output(entries):
            console.append(entries)
            if !empty.isHidden { updateVisibility() }
        case .threads:
            guard case .paused = debugger.state else { return }
            frames.show(threads: debugger.threads, selected: thread)
        case .breakpoints:
            breakpoints.reload()
            if !empty.isHidden { updateVisibility() }
        }
    }

    private func askingChanged() {
        let asks = onAskAgent != nil
        frames.onAskAboutFrame = asks ? { [unowned self] index in Task { await askAbout(frame: index) } } : nil
        variables.onAskAboutStop = asks ? { [unowned self] in askAgentAboutStop(nil) } : nil
        if isViewLoaded { updateControls(debugger.state) }
    }

    @objc public func askAgentAboutStop(_ sender: Any?) {
        guard let context = stopContext() else { return }
        onAskAgent?(context)
    }

    @objc public func askAgentToFixLaunch(_ sender: Any?) {
        guard let context = launchContext() else { return }
        onAskAgent?(context)
    }

    public func validateUserInterfaceItem(_ item: any NSValidatedUserInterfaceItem) -> Bool {
        switch item.action {
        case #selector(askAgentAboutStop(_:)):
            (item as? NSMenuItem)?.title = DebugText.askAboutStop
            return onAskAgent != nil && stopContext() != nil
        case #selector(askAgentToFixLaunch(_:)):
            (item as? NSMenuItem)?.title = "Ask Nyte to Fix"
            return onAskAgent != nil && launchContext() != nil
        default:
            return false
        }
    }

    private func askAbout(frame index: Int) async {
        await stackLoading?.value
        guard frames.frames.indices.contains(index) else { return }
        if frames.selectedFrameIndex != index {
            frames.select(frame: index)
            choose(frames.frames[index])
            await variables.settle()
        }
        askAgentAboutStop(nil)
    }

    func stopContext() -> AgentContext? {
        guard case .paused = debugger.state, let frame = debugger.selectedFrame, let url = frame.url else { return nil }
        return .stop(AgentContext.Stop(file: url, line: frame.line + 1, function: frame.function, locals: variables.stopLocals()))
    }

    func launchContext() -> AgentContext? {
        guard case .failed = debugger.state, let failure = debugger.failure else { return nil }
        return .terminal(AgentContext.Terminal(text: failure.output, directory: debugger.lastStart?.target.directory))
    }

    public func editBreakpoint(line: Int, in url: URL, anchoredTo rect: NSRect, in view: NSView) {
        breakpoints.edit(line: line, in: url, anchoredTo: rect, in: view)
    }

    public func showBreakpoints() {
        tab = .breakpoints
        updateVisibility()
    }

    public func selectFrame(at index: Int) async {
        await stackLoading?.value
        guard frames.frames.indices.contains(index) else { return }
        frames.select(frame: index)
        choose(frames.frames[index])
        await variables.settle()
    }

    func selectThread(_ id: Int) async {
        thread = id
        debugger.selectThread(id)
        frames.show(threads: debugger.threads, selected: id)
        loadStack(id, preferred: nil)
        await stackLoading?.value
    }

    public func reveal(_ names: [String]) async {
        await stackLoading?.value
        await variables.reveal(names)
    }

    public func addWatch(_ expression: String) async {
        await stackLoading?.value
        await variables.addWatch(expression)
    }

    private func choose(_ frame: DebugFrame) {
        debugger.selectFrame(frame)
        variables.show(frame: frame)
        guard let url = frame.url else { return }
        let place = TextPosition(line: frame.line, column: frame.column)
        onNavigate?(FileLocation(url: url, range: TextSpan(start: place, end: place)))
    }

    private func stateDidChange() {
        let state = debugger.state
        updateControls(state)
        consolePane.stateDidChange()
        breakpoints.reload()
        switch state {
        case .idle:
            break
        case .starting:
            staling?.cancel()
            console.clear()
            clearStack(message: FramesPane.placeholderWaiting)
        case .running:
            staling?.cancel()
            staling = Task { [weak self] in
                try? await Task.sleep(for: Self.staleDelay)
                guard let self, !Task.isCancelled, debugger.state == .running else { return }
                clearStack(message: FramesPane.placeholderWaiting)
            }
        case let .paused(thread, reason, frame):
            staling?.cancel()
            if Self.raisingReasons.contains(reason) { tab = .threads }
            frames.pause = (thread, reason)
            self.thread = thread
            loadStack(thread, preferred: frame)
        case .ended:
            staling?.cancel()
            clearStack(message: "The program is not running")
            tab = .console
        case .failed:
            staling?.cancel()
            clearStack(message: "")
            tab = .console
        }
        updateVisibility()
    }

    private func clearStack(message: String) {
        frames.pause = nil
        stackGeneration += 1
        frames.clear(message: message)
        frames.clearThreads()
        variables.clear()
    }

    private func loadStack(_ thread: Int, preferred: DebugFrame?) {
        stackGeneration += 1
        let generation = stackGeneration
        stackLoading = Task { [weak self] in
            guard let self else { return }
            let list = await debugger.frames(of: thread)
            guard generation == stackGeneration, case .paused = debugger.state else { return }
            frames.show(threads: debugger.threads, selected: thread)
            let index = list.firstIndex { $0.id == preferred?.id } ?? list.firstIndex(where: \.isUserCode) ?? 0
            frames.show(frames: list, selected: list.isEmpty ? nil : index)
            guard list.indices.contains(index) else { return variables.clear() }
            debugger.selectFrame(list[index])
            variables.show(frame: list[index])
            await variables.settle()
        }
    }

    private func updateControls(_ state: Debugger.State) {
        let paused = if case .paused = state { true } else { false }
        let running = state == .running
        let live = switch state {
        case .starting, .running, .paused: true
        default: false
        }
        resumeButton.symbol = running ? "pause" : "play"
        let resumeLabel = running ? "Pause" : "Resume"
        resumeButton.setAccessibilityLabel(resumeLabel)
        resumeButton.toolTip = running ? resumeLabel : "\(resumeLabel) (F5)"
        resumeButton.isEnabled = paused || running
        for button in [stepOverButton, stepIntoButton, stepOutButton] { button.isEnabled = paused }
        restartButton.isEnabled = state != .idle
        stopButton.isEnabled = live
        askFixButton.isHidden = onAskAgent == nil || debugger.failure == nil || { if case .failed = state { false } else { true } }()
        variables.setEnabled(paused)
        status.stringValue = DebugText.status(state)
        status.textColor = if case .failed = state { Palette.dangerInk } else { Palette.contentSecondary }
        status.setAccessibilityLabel("Debugger state")
        status.setAccessibilityValue(status.stringValue)
        loader.isHidden = if case .starting = state { false } else { true }
    }

    private func updateVisibility() {
        let isEmpty = debugger.state == .idle && console.isEmpty && debugger.placedBreakpoints.isEmpty
        empty.isHidden = !isEmpty
        bar.isHidden = isEmpty
        split.isHidden = tab != .threads
        consolePane.isHidden = tab != .console
        breakpoints.isHidden = tab != .breakpoints
        if tab == .console { console.flush() }
    }

    public func splitView(_ splitView: NSSplitView, resizeSubviewsWithOldSize oldSize: NSSize) {
        let views = splitView.arrangedSubviews
        guard views.count == 2 else { return splitView.adjustSubviews() }
        let width = splitView.bounds.width - splitView.dividerThickness
        let first = DebugLayoutMemory.framesWidth(fraction: layoutMemory.framesFraction, of: width)
        views[0].frame = NSRect(x: 0, y: 0, width: first, height: splitView.bounds.height)
        views[1].frame = NSRect(x: first + splitView.dividerThickness, y: 0, width: width - first, height: splitView.bounds.height)
    }

    public func splitViewDidResizeSubviews(_ notification: Notification) {
        guard notification.userInfo?["NSSplitViewDividerIndex"] != nil, split.bounds.width > split.dividerThickness else { return }
        let width = split.bounds.width - split.dividerThickness
        layoutMemory.framesFraction = Double(split.arrangedSubviews[0].frame.width / width)
        layoutMemory.save()
    }

    public func splitView(_ splitView: NSSplitView, constrainMinCoordinate proposed: CGFloat, ofSubviewAt index: Int) -> CGFloat {
        DebugLayout.columnMinimum
    }

    public func splitView(_ splitView: NSSplitView, constrainMaxCoordinate proposed: CGFloat, ofSubviewAt index: Int) -> CGFloat {
        splitView.bounds.width - DebugLayout.columnMinimum
    }

    public func splitView(_ splitView: NSSplitView, effectiveRect proposedEffectiveRect: NSRect, forDrawnRect drawnRect: NSRect,
                          ofDividerAt dividerIndex: Int) -> NSRect {
        split.grabRect(around: drawnRect)
    }
}
