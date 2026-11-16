import AppKit
import Darwin
import NyteCore
import NyteUI

@MainActor
public final class TerminalViewController: NSViewController {
    public private(set) var paneTitle: String
    public var onTitleChange: ((String) -> Void)?
    public var onOpenFile: ((FileLocation) -> Void)?
    public var onAskAgent: ((AgentContext) -> Void)? {
        didSet { terminalView.onAskAgent = onAskAgent == nil ? nil : { [weak self] in self?.askAgent() } }
    }
    public private(set) var preferences: TerminalPreferences
    public var isResizeSuspended: Bool {
        get { terminalView.isResizeSuspended }
        set { terminalView.isResizeSuspended = newValue }
    }

    private let workspace: Workspace
    private let startDirectory: URL
    private var shell: String
    let terminalView = TerminalView()
    private var session: TerminalSession?
    private var generation = 0
    private var programTitle: String?
    private var directory: String?
    private var command: String?

    private static let safeArgument = CharacterSet(charactersIn:
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@%+=:,./_-")

    public init(workspace: Workspace, directory: URL? = nil, command: [String]? = nil,
                preferences: TerminalPreferences = .standard) {
        self.workspace = workspace
        self.command = command.map(Self.commandLine)
        startDirectory = directory ?? workspace.root
        self.preferences = preferences
        shell = Self.shell(for: preferences)
        paneTitle = "\((shell as NSString).lastPathComponent)  \(workspace.name)"
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    isolated deinit {
        terminalView.detach()
        session?.enqueue { $0.shutdown() }
    }

    override public func loadView() {
        terminalView.onGrid = { [weak self] grid in self?.gridChanged(grid) }
        terminalView.onRestart = { [weak self] in self?.restart() }
        terminalView.preferences = preferences
        terminalView.linkDirectory = startDirectory
        terminalView.onOpenLink = { [weak self] link in
            switch link {
            case let .url(url): NSWorkspace.shared.open(url)
            case let .file(location): self?.onOpenFile?(location)
            }
        }
        view = terminalView
    }

    public func focusTerminal() {
        guard let window = terminalView.window else { return }
        window.makeFirstResponder(terminalView)
    }

    public func apply(_ preferences: TerminalPreferences) {
        self.preferences = preferences
        shell = Self.shell(for: preferences)
        terminalView.preferences = preferences
        session?.enqueue { $0.apply(preferences) }
    }

    public func selectionContext() -> (text: String, directory: URL)? {
        let selection = terminalView.selectionTextCache ?? (terminalView.hasSelection ? terminalView.selectedText : nil)
        guard let text = selection ?? terminalView.lastCommandOutput, !text.isEmpty else { return nil }
        return (text, currentDirectory)
    }

    private var currentDirectory: URL {
        directory.map { URL(fileURLWithPath: $0, isDirectory: true) } ?? startDirectory
    }

    private func askAgent() {
        guard let context = selectionContext() else { return }
        onAskAgent?(.terminal(AgentContext.Terminal(text: context.text, directory: context.directory)))
    }

    private func gridChanged(_ grid: TerminalGrid) {
        guard let session else { return start(grid) }
        session.requestResize(grid)
    }

    private func restart() {
        session?.enqueue { $0.shutdown() }
        session = nil
        guard let grid = terminalView.lastGrid else { return }
        start(grid)
    }

    private func start(_ grid: TerminalGrid) {
        generation += 1
        let launch = Self.shellLaunch(shell: shell, directory: startDirectory.path)
        let session = TerminalSession(events: events(for: generation), preferences: preferences, command: command) {
            LocalPTYBackend(launch: launch)
        }
        command = nil
        self.session = session
        programTitle = nil
        directory = nil
        terminalView.linkDirectory = startDirectory
        publishTitle()
        terminalView.attach(session, generation: generation)
        let colors = terminalView.resolvedColors()
        session.enqueue { $0.start(grid: grid, colors: colors) }
    }

    private func events(for generation: Int) -> TerminalSessionEvents {
        TerminalSessionEvents(
            wake: { [weak self] in
                DispatchQueue.main.async { [weak self] in self?.current(generation)?.terminalView.needsFrame() }
            },
            frame: { [weak self] frame in
                DispatchQueue.main.async { [weak self] in self?.current(generation)?.terminalView.apply(frame) }
            },
            title: { [weak self] title, directory in
                DispatchQueue.main.async { [weak self] in
                    guard let self = self?.current(generation) else { return }
                    self.programTitle = title
                    self.directory = directory.map(Self.path(fromWorkingDirectory:))
                    self.terminalView.linkDirectory = self.currentDirectory
                    self.publishTitle()
                }
            },
            bell: { [weak self] in
                DispatchQueue.main.async { [weak self] in
                    guard self?.current(generation) != nil else { return }
                    NSSound.beep()
                }
            },
            exit: { [weak self] status in
                DispatchQueue.main.async { [weak self] in self?.current(generation)?.terminalView.showExit(Self.describe(status)) }
            },
            selection: { [weak self] change in
                DispatchQueue.main.async { [weak self] in self?.current(generation)?.terminalView.selectionChanged(change) }
            },
            commandOutput: { [weak self] output in
                DispatchQueue.main.async { [weak self] in self?.current(generation)?.terminalView.lastCommandOutput = output }
            }
        )
    }

    private func current(_ generation: Int) -> TerminalViewController? {
        generation == self.generation ? self : nil
    }

    private func publishTitle() {
        let program = programTitle.flatMap { $0.isEmpty ? nil : $0 } ?? (shell as NSString).lastPathComponent
        let place = directory.map(Self.abbreviate) ?? workspace.name
        let title = "\(program)  \(place)"
        guard title != paneTitle else { return }
        paneTitle = title
        onTitleChange?(title)
    }

    static func shellLaunch(shell: String, directory: String) -> ShellLaunch {
        var environment = ProcessInfo.processInfo.environment
        for key in ["COLUMNS", "LINES", "TERM_SESSION_ID", "TERM_PROGRAM_VERSION"] { environment[key] = nil }
        environment["TERM"] = "xterm-256color"
        environment["COLORTERM"] = "truecolor"
        environment["TERM_PROGRAM"] = "NyteIDE"
        environment["SHELL"] = shell
        environment["PWD"] = directory
        if environment["LANG"]?.localizedCaseInsensitiveContains("UTF-8") != true {
            let language = Locale.current.language.languageCode?.identifier ?? "en"
            let region = Locale.current.region?.identifier ?? "US"
            environment["LANG"] = "\(language)_\(region).UTF-8"
        }
        return ShellLaunch(
            path: shell,
            arguments: ["-l"],
            environment: environment.map { "\($0.key)=\($0.value)" },
            directory: directory
        )
    }

    static func commandLine(_ arguments: [String]) -> String {
        arguments.map { argument in
            guard argument.isEmpty || argument.unicodeScalars.contains(where: { !safeArgument.contains($0) }) else { return argument }
            return "'" + argument.replacingOccurrences(of: "'", with: "'\\''") + "'"
        }.joined(separator: " ")
    }

    private static func shell(for preferences: TerminalPreferences) -> String {
        guard let path = preferences.shellPath, !path.isEmpty else { return loginShell() }
        return path
    }

    private static func loginShell() -> String {
        guard let entry = getpwuid(getuid()), let pointer = entry.pointee.pw_shell else { return "/bin/zsh" }
        let path = String(cString: pointer)
        return access(path, X_OK) == 0 ? path : "/bin/zsh"
    }

    private static func path(fromWorkingDirectory value: String) -> String {
        guard value.hasPrefix("file://"), let url = URL(string: value) else { return value }
        return url.path(percentEncoded: false)
    }

    private static func abbreviate(_ path: String) -> String {
        let home = NSHomeDirectory()
        if path == home { return "~" }
        return path.hasPrefix(home + "/") ? "~" + path.dropFirst(home.count) : path
    }

    private static func describe(_ status: TerminalExit) -> String {
        switch status {
        case let .exited(code): "Process exited with status \(code). Press Return to start a new shell."
        case let .signaled(signal): "Process exited after signal \(signal). Press Return to start a new shell."
        case let .failedToStart(failure):
            "The terminal could not start: \(failure.reason). Press Return to try again."
        }
    }
}
