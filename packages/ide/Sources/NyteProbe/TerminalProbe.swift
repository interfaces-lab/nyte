import AppKit
import Darwin
import Foundation
@testable import NyteTerminal
import Synchronization

@MainActor func runTerminalProbe(_ arguments: [String]) async {
    guard arguments.first == "check" else { fail("NyteProbe terminal: unknown command; see NyteProbe --help") }
    let check = TerminalCheck()
    check.typing()
    check.keyTable()
    check.keyEquivalents()
    check.firstFrame()
    await check.shell()
    await check.closing()
    await check.failedStart()
    await check.links()
    await check.preferences()
    await check.pane()
    await check.runInTerminal()
    await check.manyTerminals()
    print(check.failures == 0 ? "terminal check: all passed" : "terminal check: \(check.failures) failed")
    if check.failures > 0 { exit(1) }
}

final class TerminalScreen: Sendable {
    struct State {
        var rows: [Int: FrameRow] = [:]
        var frame: TerminalFrame?
        var title: String?
        var directory: String?
        var exit: TerminalExit?
    }

    let state = Mutex(State())

    var events: TerminalSessionEvents {
        TerminalSessionEvents(
            wake: {},
            frame: { [self] frame in
                state.withLock { state in
                    if frame.full || state.frame.map({ $0.rows != frame.rows || $0.columns != frame.columns }) == true {
                        state.rows = [:]
                    }
                    for row in frame.changed { state.rows[row.index] = row }
                    state.frame = frame
                }
            },
            title: { [self] title, directory in state.withLock { ($0.title, $0.directory) = (title, directory) } },
            bell: {},
            exit: { [self] status in state.withLock { $0.exit = status } }
        )
    }

    var lines: [String] {
        state.withLock { state in
            state.rows.keys.sorted().map { index in
                var line = state.rows[index]?.plainText ?? ""
                while line.last == " " { line.removeLast() }
                return line
            }
        }
    }
}

@MainActor final class TerminalCheck {
    static let ansi: [UInt32] = [
        0x000000, 0xCD0000, 0x00CD00, 0xCDCD00, 0x0000EE, 0xCD00CD, 0x00CDCD, 0xE5E5E5,
        0x7F7F7F, 0xFF0000, 0x00FF00, 0xFFFF00, 0x5C5CFF, 0xFF00FF, 0x00FFFF, 0xFFFFFF,
    ]
    static let colors = TerminalColors(ansi: ansi, foreground: 0x202020, background: 0xFAFAFA, cursor: 0x202020, isDark: false)
    static let grid = TerminalGrid(columns: 100, rows: 30, cellWidth: 8, cellHeight: 16)
    static let scrollbackLines = 1000
    static let printedLines = 20_000

    var failures = 0
    var session: TerminalSession?
    var screen = TerminalScreen()

    func expect(_ condition: Bool, _ name: String, _ saw: @autoclosure () -> String = "") {
        if condition { return print("ok    \(name)") }
        failures += 1
        let detail = saw()
        print("FAIL  \(name)\n      saw: \(detail.isEmpty ? "(nothing)" : detail)")
    }

    func start(shell: String = "/bin/zsh", scrollback: Int = TerminalCheck.scrollbackLines) -> TerminalSession {
        let base = TerminalViewController.shellLaunch(shell: shell, directory: NSTemporaryDirectory())
        let launch = ShellLaunch(path: shell, arguments: ["-f", "-i"], environment: base.environment + ["PS1=probe$ ", "RPS1="],
                                 directory: base.directory)
        screen = TerminalScreen()
        let session = TerminalSession(events: screen.events, preferences: TerminalPreferences(scrollbackLines: scrollback)) {
            LocalPTYBackend(launch: launch)
        }
        let grid = Self.grid
        let colors = Self.colors
        session.enqueue { $0.start(grid: grid, colors: colors) }
        self.session = session
        return session
    }

    func type(_ text: String) {
        session?.enqueue { $0.text(text) }
    }

    @discardableResult
    func until(_ seconds: Double = 10, _ condition: () -> Bool) async -> Bool {
        let deadline = ContinuousClock.now + .milliseconds(Int(seconds * 1000))
        while ContinuousClock.now < deadline {
            session?.enqueue { $0.produceFrame() }
            try? await Task.sleep(for: .milliseconds(25))
            guard !Task.isCancelled else { return false }
            session?.enqueue { $0.produceFrame() }
            try? await Task.sleep(for: .milliseconds(5))
            guard !Task.isCancelled else { return false }
            if condition() { return true }
        }
        return false
    }

    func row(where predicate: (String) -> Bool) -> FrameRow? {
        screen.state.withLock { state in
            state.rows.values.first { row in
                var line = row.plainText
                while line.last == " " { line.removeLast() }
                return predicate(line)
            }
        }
    }

    func shows(_ text: String) -> Bool { screen.lines.contains { $0.contains(text) } }

    var frame: TerminalFrame? { screen.state.withLock { $0.frame } }

    func run(_ command: String, until marker: String) async -> Bool {
        type(command + "\r")
        return await until { shows(marker) }
    }

    func shell() async {
        _ = start()
        expect(await until { shows("probe$") }, "a login shell starts on the PTY and shows its prompt", screen.lines.joined(separator: " | "))

        expect(await run("echo hello-$((6*7))", until: "hello-42"), "the output of a command appears on the grid",
               screen.lines.suffix(4).joined(separator: " | "))

        await colours()
        await wideCharacters()
        await alternateScreen()
        await titleAndDirectory()
        await bracketedPaste()
        await scrollback()
        await resize()

        type("exit 7\r")
        let exited = await until { screen.state.withLock { $0.exit } != nil }
        let status = screen.state.withLock { $0.exit }
        expect(exited && status == .exited(7), "the shell's exit is reported with its status", "\(String(describing: status))")
        session?.enqueue { $0.shutdown() }
        session = nil
    }

    private func colours() async {
        let command = #"printf '\e[1;31m%s\e[0m \e[3;4m%s\e[0m \e[38;5;208m%s\e[0m \e[38;2;10;20;30m%s\e[0m\n' RED ITAL ORANGE TRUE"#
        type(command + "\r")
        await until { row { $0 == "RED ITAL ORANGE TRUE" } != nil }
        guard let row = row(where: { $0 == "RED ITAL ORANGE TRUE" }) else {
            return expect(false, "SGR colours and attributes parse", screen.lines.suffix(4).joined(separator: " | "))
        }
        func run(at column: Int) -> FrameRun? {
            guard let cluster = row.cluster(at: column) else { return nil }
            return row.runs.first { Int($0.firstCluster) <= cluster && cluster < Int($0.firstCluster + $0.clusterCount) }
        }
        let red = run(at: 0)
        let italic = run(at: 4)
        let orange = run(at: 9)
        let truecolor = run(at: 16)
        expect(red?.color == Self.ansi[1] && (red?.style ?? 0) & RunStyle.bold != 0, "SGR 1;31 is bold in palette red",
               "colour \(String(red?.color ?? 0, radix: 16)) style \(red?.style ?? 0)")
        expect((italic?.style ?? 0) & RunStyle.italic != 0 && (italic?.style ?? 0) & RunStyle.underline != 0,
               "SGR 3;4 is italic and underlined", "style \(italic?.style ?? 0)")
        expect(orange?.color == 0xFF8700, "SGR 38;5;208 is 256-colour orange", String(orange?.color ?? 0, radix: 16))
        expect(truecolor?.color == 0x0A141E, "SGR 38;2;10;20;30 is true colour", String(truecolor?.color ?? 0, radix: 16))
    }

    private func wideCharacters() async {
        type(#"printf '\u4e2d\u6587e\u0301|\n'"# + "\r")
        await until { row { $0.hasPrefix("中文") } != nil }
        guard let row = row(where: { $0.hasPrefix("中文") }) else {
            return expect(false, "wide and combining characters occupy the right cells", screen.lines.suffix(3).joined(separator: " | "))
        }
        let cells = row.clusterStart.indices.map { cluster in
            "\(String(decoding: row.text[row.utf16Range(first: cluster, count: 1)], as: UTF16.self))@\(row.clusterColumn[cluster])x\(row.clusterWidth[cluster])"
        }
        expect(Array(cells.prefix(4)) == ["中@0x2", "文@2x2", "e\u{301}@4x1", "|@5x1"],
               "wide characters take two cells and a combining mark joins its base", cells.joined(separator: " "))
    }

    private func alternateScreen() async {
        type(#"printf '\e[?1049hALT%s' -MARK"# + "\r")
        let entered = await until { frame?.isAlternateScreen == true && shows("ALT-MARK") }
        expect(entered, "the alternate screen is entered", "alternate \(frame?.isAlternateScreen ?? false)")
        type(#"printf '\e[?1049l'"# + "\r")
        let left = await until { frame?.isAlternateScreen == false && !shows("ALT-MARK") && shows("hello-42") }
        expect(left, "the alternate screen is left and the primary screen comes back", screen.lines.suffix(3).joined(separator: " | "))
    }

    private func titleAndDirectory() async {
        type(#"printf '\e]2;probe-title\a\e]7;file://localhost/private/tmp\a'"# + "\r")
        let reported = await until { screen.state.withLock { $0.title == "probe-title" && $0.directory?.hasSuffix("/private/tmp") == true } }
        let seen = screen.state.withLock { "title \($0.title ?? "nil"), directory \($0.directory ?? "nil")" }
        expect(reported, "the title and working directory reports arrive", seen)
    }

    private func bracketedPaste() async {
        type(#"printf '\e[?2004h'; cat -v"# + "\r")
        await until { frame?.cursor.column == 0 }
        let outcome = Mutex<PasteOutcome?>(nil)
        session?.enqueue { $0.paste("hello\nworld", confirmed: false) { result in outcome.withLock { $0 = result } } }
        type("\r")
        let wrapped = await until { shows("^[[200~hello") && shows("world^[[201~") }
        expect(wrapped && outcome.withLock { $0 } == .pasted, "bracketed paste wraps the pasted text",
               screen.lines.suffix(4).joined(separator: " | "))
        type("\u{4}")
        await until { screen.lines.last(where: { !$0.isEmpty })?.hasPrefix("probe$") == true }
        expect(await run(#"unset zle_bracketed_paste; printf '\e[?2004l'; echo paste-$((1+1))"#, until: "paste-2"),
               "bracketed paste is switched off again", screen.lines.suffix(3).joined(separator: " | "))
        outcome.withLock { $0 = nil }
        session?.enqueue { $0.paste("rm -rf nothing\n", confirmed: false) { result in outcome.withLock { $0 = result } } }
        await until { outcome.withLock { $0 } != nil }
        expect(outcome.withLock { $0 } == .needsConfirmation, "an unbracketed paste with a line break asks first",
               "\(String(describing: outcome.withLock { $0 }))")
    }

    private func scrollback() async {
        type("seq 1 \(Self.printedLines)\r")
        await until(20) { shows("\(Self.printedLines)") && screen.lines.last(where: { !$0.isEmpty })?.hasPrefix("probe$") == true }
        let total = frame?.scrollback.total ?? 0
        let rows = Int(Self.grid.rows)
        expect(total >= Self.scrollbackLines && total < Self.printedLines / 2,
               "scrollback keeps about its \(Self.scrollbackLines)-line cap, pruned by page, after \(Self.printedLines) lines",
               "\(total) rows in total")
        print("      scrollback after \(Self.printedLines) lines: \(total) rows including the \(rows)-row screen")
        let input = ScrollInput(rows: -Self.printedLines, column: 0, row: 0, x: 0, y: 0, modifiers: [])
        session?.enqueue { $0.scroll(input) }
        await until { frame?.scrollback.offset == 0 }
        let top = screen.lines.first.flatMap { Int($0) } ?? 0
        expect(frame?.scrollback.offset == 0 && top > 1, "the oldest lines were dropped from the top of the scrollback",
               "offset \(frame?.scrollback.offset ?? -1), top line \(screen.lines.first ?? "")")
        type(" ")
        type("\u{15}")
        await until { (frame?.scrollback.offset ?? 0) + rows >= total }
    }

    private func resize() async {
        type("clear; printf 'y%.0s' {1..90}; echo\r")
        await until { row { $0 == String(repeating: "y", count: 90) } != nil }
        let narrow = TerminalGrid(columns: 40, rows: Self.grid.rows, cellWidth: Self.grid.cellWidth, cellHeight: Self.grid.cellHeight)
        session?.requestResize(narrow)
        let reflowed = await until {
            frame?.columns == 40 && row { $0 == String(repeating: "y", count: 40) } != nil
                && row { $0 == String(repeating: "y", count: 10) } != nil
        }
        expect(reflowed, "a resize reflows a long line into the new width", screen.lines.prefix(6).joined(separator: " | "))
        expect(await run("stty size", until: "\(Self.grid.rows) 40"), "the child sees the new size",
               screen.lines.suffix(4).joined(separator: " | "))
    }

    func closing() async {
        _ = start()
        await until { shows("probe$") }
        type("sleep 300 & echo PIDS:$$:$!\r")
        await until { screen.lines.contains { $0.hasPrefix("PIDS:") } }
        let pids = (screen.lines.first { $0.hasPrefix("PIDS:") } ?? "").split(separator: ":").dropFirst().compactMap { pid_t($0) }
        expect(pids.count == 2 && pids.allSatisfy { kill($0, 0) == 0 }, "the shell and its background job are running",
               pids.map(String.init).joined(separator: ", "))
        session?.enqueue { $0.shutdown() }
        session = nil
        let gone = await until(5) { pids.allSatisfy { kill($0, 0) != 0 && errno == ESRCH } }
        expect(!pids.isEmpty && gone, "closing the session leaves no child process", pids.map(String.init).joined(separator: ", "))
        for pid in pids where kill(pid, 0) == 0 { kill(pid, SIGKILL) }
    }

    func failedStart() async {
        _ = start(shell: "/nonexistent/shell")
        let ended = await until(5) { screen.state.withLock { $0.exit } != nil }
        let status = screen.state.withLock { $0.exit }
        guard ended, case let .failedToStart(failure) = status else {
            return expect(false, "a shell path that does not exist is a failed start, not a crash", "\(String(describing: status))")
        }
        expect(failure == .system(operation: "Starting /nonexistent/shell", code: ENOENT),
               "a shell path that does not exist is a failed start, not a crash", failure.reason)
        print("      the pane shows: The terminal could not start: \(failure.reason).")
        session?.enqueue { $0.shutdown() }
        session = nil
    }

    func keyTable() {
        let report = TerminalEngine.checkKeyTable()
        expect(report.missing.isEmpty && report.unidentified.isEmpty && report.shared.isEmpty,
               "every one of the \(TerminalKey.allCases.count) keys translates to its own libghostty key",
               "missing \(report.missing), unidentified \(report.unidentified), shared \(report.shared)")
        guard let engine = try? TerminalEngine(grid: Self.grid, colors: Self.colors, preferences: .standard) else {
            return expect(false, "an engine starts for the key encoding check")
        }
        let samples: [(TerminalKey, TerminalModifiers, String, [UInt8])] = [
            (.arrowUp, [], "", Array("\u{1B}[A".utf8)), (.arrowLeft, [], "", Array("\u{1B}[D".utf8)),
            (.f1, [], "", Array("\u{1B}OP".utf8)), (.f5, [], "", Array("\u{1B}[15~".utf8)), (.enter, [], "", [0x0D]),
            (.tab, [], "", [0x09]), (.backspace, [], "", [0x7F]), (.escape, [], "", [0x1B]), (.home, [], "", Array("\u{1B}[H".utf8)),
            (.pageDown, [], "", Array("\u{1B}[6~".utf8)), (.c, .control, "c", [0x03]), (.a, [], "a", Array("a".utf8)),
        ]
        let wrong = samples.compactMap { key, modifiers, text, want -> String? in
            let input = KeyInput(phase: .press, key: key, modifiers: modifiers, consumed: [], text: text,
                                 unshifted: text.unicodeScalars.first?.value ?? 0)
            let got = engine.encode(input)
            return got == want ? nil : "\(key): \(got)"
        }
        expect(wrong.isEmpty, "translated keys encode as the terminal expects (arrows, function keys, Return, Control-C)",
               wrong.joined(separator: ", "))
    }

    func keyEquivalents() {
        _ = NSApplication.shared
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 200, height: 100), styleMask: [.titled],
                              backing: .buffered, defer: true)
        let recorder = KeyRecorder()
        window.contentView = recorder
        window.makeFirstResponder(recorder)
        let keys: [(String, UInt16, String, Bool)] = [
            ("Control-Return", 0x24, "\r", false), ("Control-Return in a view with a menu", 0x24, "\r", true),
            ("Control-slash", 0x2C, "/", false), ("Control-C", 0x08, "c", false),
        ]
        for (name, keyCode, characters, withMenu) in keys {
            recorder.menu = withMenu ? NSMenu(title: "Context") : nil
            recorder.keyDowns = 0
            guard let event = NSEvent.keyEvent(
                with: .keyDown, location: .zero, modifierFlags: .control, timestamp: ProcessInfo.processInfo.systemUptime,
                windowNumber: window.windowNumber, context: nil, characters: characters, charactersIgnoringModifiers: characters,
                isARepeat: false, keyCode: keyCode
            ) else { return expect(false, "a key event for \(name) can be built") }
            let claimed = window.performKeyEquivalent(with: event)
            if !claimed { window.sendEvent(event) }
            print("      \(name): key equivalent claimed \(claimed), keyDown reached the view \(recorder.keyDowns) time(s)")
            expect(!claimed && recorder.keyDowns == 1, "\(name) reaches keyDown without a key equivalent override")
        }
    }

    func typing() {
        typealias Typing = TerminalTyping
        func stroke(had: Bool = false, has: Bool = false, layout: Bool = false, _ typed: [String] = [], key: TerminalKey = .a,
                    _ modifiers: TerminalModifiers = []) -> Typing.Resolution {
            Typing.resolve(Typing.Stroke(hadMarkedText: had, hasMarkedText: has, layoutChanged: layout, accumulated: typed, key: key,
                                         modifiers: modifiers, characters: typed.first ?? ""))
        }
        let cases: [(String, Typing.Resolution, Typing.Resolution)] = [
            ("a plain key with one typed character is sent as that key", stroke(["a"]), .key(text: "a")),
            ("a key that types nothing is sent as a plain key", stroke(key: .arrowUp), .plainKey),
            ("a key that switches the keyboard layout is dropped", stroke(layout: true, ["a"]), .drop),
            ("a layout change while composing does not drop the key", stroke(had: true, has: true, layout: true), .composing),
            ("a key that starts a composition sends nothing", stroke(has: true), .composing),
            ("Backspace that cancels a composition sends nothing", stroke(had: true, key: .backspace), .composing),
            ("Return that commits a composition sends the text and not Return", stroke(had: true, ["日本"], key: .enter),
             .committed(["日本"], replayKey: false)),
            ("an arrow that commits a composition sends the text, then the arrow", stroke(had: true, ["한"], key: .arrowRight),
             .committed(["한"], replayKey: true)),
            ("a plain left arrow after a Korean commit is not replayed", stroke(had: true, ["한"], key: .arrowLeft),
             .committed(["한"], replayKey: false)),
            ("a control character typed while composing is dropped", stroke(had: true, has: true, ["\u{8}"], key: .h, .control),
             .committed([], replayKey: false)),
            ("several committed pieces are sent as text", stroke(["が", "ぎ"]), .texts(["が", "ぎ"])),
        ]
        for (name, got, want) in cases { expect(got == want, "input method: \(name)", "\(got)") }

        var pairing = Typing.SurrogatePairing()
        let emoji = Array("😀".utf16)
        let lead = pairing.accept([emoji[0]])
        let joined = pairing.accept([emoji[1]])
        expect(lead.isEmpty && joined == "😀", "a lone lead surrogate waits for its trail", "\(lead.debugDescription) \(joined.debugDescription)")
        var orphan = Typing.SurrogatePairing()
        expect(orphan.accept([emoji[1]]).isEmpty, "a trail surrogate without a lead is dropped")
        var broken = Typing.SurrogatePairing()
        _ = broken.accept([emoji[0]])
        expect(broken.accept(Array("x".utf16)) == "x" && broken.accept([emoji[1]]).isEmpty, "other text clears a waiting lead")

        let spans: [(Typing.Span, Int, Typing.Span)] = [
            (Typing.Span(location: 2, length: 1), 5, Typing.Span(location: 2, length: 1)),
            (Typing.Span(location: 4, length: 9), 5, Typing.Span(location: 4, length: 1)),
            (Typing.Span(location: NSNotFound, length: 0), 3, Typing.Span(location: 3, length: 0)),
        ]
        for (requested, length, want) in spans {
            let got = Typing.markedSpan(requested: requested, markedLength: length)
            expect(got == want, "candidate window: range \(requested.location),\(requested.length) of \(length) is answered as \(want.location),\(want.length)",
                   "\(got.location),\(got.length)")
        }
    }
}

private final class KeyRecorder: NSView {
    var keyDowns = 0

    override var acceptsFirstResponder: Bool { true }

    override func keyDown(with event: NSEvent) {
        keyDowns += 1
        interpretKeyEvents([event])
    }

    override func doCommand(by selector: Selector) {}
}
