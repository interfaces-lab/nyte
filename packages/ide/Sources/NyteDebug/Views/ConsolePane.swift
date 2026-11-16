import AppKit
import NyteCore
import NyteUI

@MainActor
final class ConsolePane: NSView {
    static let historyLimit = 200
    static let filterShare: CGFloat = 0.4
    static let completionLimit = 40
    enum PromptMode: Equatable {
        case evaluate, input, inputEnded, starting, exited, idle

        var words: String {
            switch self {
            case .evaluate: "Evaluate in the selected frame"
            case .input: "Type a line for the program's input, ⌃D to end it"
            case .inputEnded: "Input ended; the program reads no more"
            case .starting: "Waiting for the program to start"
            case .exited: "The program has exited"
            case .idle: "Nothing is running"
            }
        }

        var isEnabled: Bool { self == .evaluate || self == .input }

        static func decide(_ state: Debugger.State, inputEnded: Bool) -> PromptMode {
            switch state {
            case .paused: .evaluate
            case .running: inputEnded ? .inputEnded : .input
            case .starting: .starting
            case .ended, .failed: .exited
            case .idle: .idle
            }
        }
    }

    var onNavigate: ((FileLocation) -> Void)?

    private let debugger: Debugger
    let console = ConsoleView()
    let failure = FailureView()
    let filter = SearchField(placeholder: "Filter output", size: .sm)
    let promptRow = PromptRow(placeholder: PromptMode.idle.words)
    var prompt: Input { promptRow.input }
    private(set) var mode = PromptMode.idle
    private let dropped = Label("", style: .sm, color: Palette.contentTertiary)
    private let copyButton = Button(symbol: "doc.on.doc", label: "Copy console output", size: .sm)
    private let clearButton = Button(symbol: "trash", label: "Clear console", size: .sm)
    private let tool = ToolWindowView(header: DebugLayout.stripRole)
    private lazy var completion = FieldCompletion(input: prompt)
    private(set) var history: [String] = []
    private var historyIndex: Int?
    private var draft = ""
    private var completing: Task<Void, Never>?

    init(debugger: Debugger) {
        self.debugger = debugger
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        build()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    private func build() {
        filter.variant = .strip
        filter.field.setAccessibilityLabel("Filter console output")
        filter.onChange = { [unowned self] query in console.setFilter(query) }
        filter.onCancel = { [unowned self] in
            filter.stringValue = ""
            console.setFilter("")
        }
        console.onFilterCount = { [unowned self] count in filter.count = count.map { "\($0) lines" } ?? "" }
        console.onDroppedChange = { [unowned self] count in showDropped(count) }
        copyButton.toolTip = "Copy all output"
        copyButton.onPress = { [unowned self] in console.copyAll() }
        clearButton.toolTip = "Clear (⌘K)"
        clearButton.onPress = { [unowned self] in console.clear() }
        dropped.isHidden = true
        dropped.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        prompt.field.setAccessibilityLabel("Console input")
        prompt.onChange = { [unowned self] _ in colourPrompt() }
        completion.onCommand = { [unowned self] command in handle(command) }
        completion.onAccept = { [unowned self] _ in colourPrompt() }
        prompt.onSubmit = { [unowned self] text in submit(text) }
        failure.isHidden = true
        failure.onNavigate = { [unowned self] location in onNavigate?(location) }
        failure.onToggleOutput = { [unowned self] shows in console.isHidden = !shows }

        tool.headerRule = .always
        tool.header.leadingInset = RowCell.Geometry.inset
        tool.header.setViews(leading: [filter], trailing: [dropped, copyButton, clearButton])
        let stack = NSStackView(views: [failure, console, promptRow])
        stack.orientation = .vertical
        stack.spacing = 0
        stack.alignment = .width
        stack.setHuggingPriority(.defaultLow, for: .vertical)
        console.setContentHuggingPriority(.defaultLow, for: .vertical)
        Pin.fill(tool, in: self)
        Pin.fill(stack, in: tool.content)
        filter.widthAnchor.constraint(equalTo: tool.widthAnchor, multiplier: Self.filterShare).isActive = true
        stateDidChange()
    }

    private func showDropped(_ count: Int) {
        dropped.isHidden = count == 0
        dropped.stringValue = count == 1 ? "1 earlier line dropped" : "\(count.formatted()) earlier lines dropped"
    }

    func stateDidChange() {
        let state = debugger.state
        let failed = if case .failed = state { true } else { false }
        if failed, let summary = debugger.failure {
            failure.show(summary)
        }
        failure.isHidden = !failed
        console.isHidden = failed && !failure.showsOutput
        promptRow.isHidden = failed
        mode = PromptMode.decide(state, inputEnded: debugger.inputEnded)
        promptRow.placeholder = mode.words
        promptRow.disabledReason = mode.isEnabled ? nil : mode.words
        prompt.field.setAccessibilityHelp(mode.words)
    }

    private func submit(_ text: String) {
        let line = text.trimmingCharacters(in: .newlines)
        guard mode == .input || !line.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        if !line.isEmpty, history.last != line { history.append(line) }
        if history.count > Self.historyLimit { history.removeFirst(history.count - Self.historyLimit) }
        historyIndex = nil
        prompt.stringValue = ""
        Task { await run(line) }
    }

    func endInput() async {
        guard await debugger.endInput() else { return }
        console.echo("⌃D\n", stream: .input)
    }

    func run(_ line: String) async {
        if case .paused = debugger.state {
            console.codeLanguage = debugger.codeLanguage
            console.echo("› " + line + "\n", stream: .prompt)
            let result = await debugger.evaluate(line, in: debugger.selectedFrame, context: .repl)
            switch result {
            case let .success(variable):
                let shown = variable.value.isEmpty ? "(no value)" : variable.value
                console.echo(shown + "\n", stream: variable.value.isEmpty ? .console : .result)
            case let .failure(failure):
                console.echo(failure.message + "\n", stream: .stderr)
            }
            return
        }
        if await debugger.sendInput(line + "\n") {
            console.echo(line + "\n", stream: .input)
        } else {
            console.echo("The program does not read input from the console.\n", stream: .console)
        }
    }

    func colourPrompt() {
        guard let editor = prompt.field.currentEditor() as? NSTextView, let storage = editor.textStorage, storage.length > 0 else { return }
        let whole = NSRange(location: 0, length: storage.length)
        storage.beginEditing()
        storage.addAttribute(.foregroundColor, value: Palette.contentPrimary, range: whole)
        if case .paused = debugger.state {
            for (range, color) in CodeColors.ranges(in: storage.string, language: debugger.codeLanguage) where NSMaxRange(range) <= storage.length {
                storage.addAttribute(.foregroundColor, value: color.color, range: range)
            }
        }
        storage.endEditing()
    }

    func handle(_ command: Selector) -> Bool {
        switch command {
        case #selector(NSResponder.deleteForward(_:)):
            guard mode == .input, prompt.stringValue.isEmpty else { return false }
            Task { await endInput() }
        case #selector(NSResponder.moveUp(_:)): recall(older: true)
        case #selector(NSResponder.moveDown(_:)): recall(older: false)
        case #selector(NSResponder.insertTab(_:)), #selector(NSResponder.complete(_:)): return complete()
        default: return false
        }
        return true
    }

    private func recall(older: Bool) {
        guard !history.isEmpty else { return }
        let current = historyIndex
        if current == nil { draft = prompt.stringValue }
        let next: Int? = switch (older, current) {
        case (true, nil): history.count - 1
        case let (true, index?): max(index - 1, 0)
        case (false, nil): nil
        case let (false, index?): index + 1 < history.count ? index + 1 : nil
        }
        historyIndex = next
        prompt.stringValue = next.map { history[$0] } ?? draft
        prompt.field.currentEditor()?.selectedRange = NSRange(location: prompt.stringValue.utf16.count, length: 0)
    }

    private func complete() -> Bool {
        guard debugger.capabilities.supportsCompletions, case .paused = debugger.state, !prompt.stringValue.isEmpty else { return false }
        let text = prompt.stringValue
        let column = prompt.field.currentEditor()?.selectedRange.location ?? text.utf16.count
        completing = Task {
            let found = await debugger.completions(for: text, column: column)
            guard prompt.stringValue == text, !Task.isCancelled else { return }
            var seen: Set<String> = []
            let candidates = found.prefix(Self.completionLimit).map { ConsolePane.applying($0, to: text, column: column) }
                .filter { seen.insert($0).inserted }
            guard candidates.count != 1 else {
                prompt.stringValue = candidates[0]
                prompt.field.currentEditor()?.selectedRange = NSRange(location: candidates[0].utf16.count, length: 0)
                return colourPrompt()
            }
            guard !candidates.isEmpty else { return NSSound.beep() }
            completion.show(candidates)
        }
        return true
    }

    func settleCompletion() async {
        await completing?.value
    }

    static func applying(_ item: DebugCompletion, to text: String, column: Int) -> String {
        let utf16 = Array(text.utf16)
        let end = min(column, utf16.count)
        let typed = String(decoding: utf16[..<end], as: UTF16.self)
        let fragment = String(typed.reversed().prefix { $0.isLetter || $0.isNumber || $0 == "_" || $0 == "$" || $0 == "#" }.reversed())
        let guessed = item.length > 0 ? end - item.length : end - fragment.utf16.count
        let start = min(max(item.start ?? guessed, 0), end)
        let replaced = max(min(item.length, utf16.count - start), end - start)
        let head = String(decoding: utf16[..<start], as: UTF16.self)
        let tail = String(decoding: utf16[min(start + replaced, utf16.count)...], as: UTF16.self)
        return head + item.text + tail
    }
}
