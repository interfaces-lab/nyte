import AppKit
import Darwin
import Foundation
import NyteCore
@testable import NyteDebug

@MainActor func runDebugProbe(_ arguments: [String]) async {
    setvbuf(stdout, nil, _IOLBF, 0)
    switch arguments.first {
    case "targets":
        guard arguments.count >= 2 else { fail("NyteProbe dap targets needs a folder; see NyteProbe --help") }
        let workspace = Workspace(root: URL(fileURLWithPath: arguments[1]))
        let debugger = Debugger(workspace: workspace, toolchain: Toolchain(workspace: workspace.root))
        let file = arguments.count > 2 ? URL(fileURLWithPath: arguments[2]) : nil
        for target in await debugger.targets(near: file) {
            print("\(target.name)  \(target.kind)  cwd \(workspace.relativePath(of: target.directory)) \(target.arguments)")
        }
    case "run":
        guard arguments.count >= 2 else { fail("NyteProbe dap run needs a Go folder; see NyteProbe --help") }
        await DebugCheck.runOnce(folder: URL(fileURLWithPath: arguments[1]), debugging: !arguments.contains("--no-debug"),
                                 lines: arguments.dropFirst(2).filter { $0 != "--no-debug" })
    case "check":
        let check = DebugCheck()
        await check.run(DebugCheck.Fixture.go)
        await check.run(DebugCheck.Fixture.typescript)
        await check.breakpointKinds(DebugCheck.Fixture.go)
        await check.breakpointKinds(DebugCheck.Fixture.typescript)
        await check.buildError()
        await check.controls(DebugCheck.Loop.go)
        await check.controls(DebugCheck.Loop.typescript)
        await check.goTest()
        await check.goroutinesAndArguments()
        await check.interactiveInput()
        await check.singleTests()
        await check.configurations()
        await check.manyLocals()
        await check.toolSettings()
        check.consoleBuffer()
        check.inlineSource()
        check.persistence()
        print(check.failures == 0 ? "dap check: all passed" : "dap check: \(check.failures) failed")
        if check.failures > 0 { exit(1) }
    default:
        fail("NyteProbe dap: unknown command; see NyteProbe --help")
    }
}

@MainActor final class DebugCheck {
    struct Fixture: Sendable {
        var language: String
        var root: URL
        var main: URL
        var hub: URL
        var line: Int
        var function: String
        var channel: String
        var subject: String
        var condition: String
        var program: @Sendable (DebugTarget) -> Bool

        static let fixtures = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../Fixtures").standardizedFileURL

        static let go = Fixture(
            language: "go", root: fixtures.appendingPathComponent("notifyhub-go"),
            main: fixtures.appendingPathComponent("notifyhub-go/main.go"), hub: fixtures.appendingPathComponent("notifyhub-go/hub/hub.go"),
            line: 49, function: "Submit", channel: "Channel", subject: "message.Subject", condition: #"message.Channel == "pager""#,
            program: { if case let .goPackage(folder) = $0.kind { folder.path == fixtures.appendingPathComponent("notifyhub-go").path } else { false } }
        )
        static let typescript = Fixture(
            language: "ts", root: fixtures.appendingPathComponent("notifyhub-ts"),
            main: fixtures.appendingPathComponent("notifyhub-ts/src/index.ts"), hub: fixtures.appendingPathComponent("notifyhub-ts/src/hub.ts"),
            line: 38, function: "submit", channel: "channel", subject: "message.subject", condition: #"message.channel === "pager""#,
            program: { if case let .node(file) = $0.kind { file.lastPathComponent == "index.ts" } else { false } }
        )
    }

    var failures = 0
    private static let summary = "3 submitted, 2 delivered, 1 failed"

    static func runOnce(folder: URL, debugging: Bool, lines: [String]) async {
        let workspace = Workspace(root: folder)
        let debugger = Debugger(workspace: workspace, toolchain: Toolchain(workspace: folder))
        let started = ContinuousClock.now
        await debugger.start(DebugTarget(id: "run", name: folder.lastPathComponent, kind: .goPackage(folder), directory: folder),
                             debugging: debugging)
        print("state after launch: \(debugger.state)")
        for line in lines {
            print("send \(line): \(await debugger.sendInput(line + "\n"))")
        }
        _ = await Patience.until(.seconds(5)) { if case .ended = debugger.state { true } else { false } }
        print("state after 5 s: \(debugger.state) at \(ContinuousClock.now - started)")
        print(debugger.output.map { "[\($0.category)] \($0.text)" }.joined(), terminator: "")
        await debugger.stop()
    }

    func expect(_ condition: Bool, _ name: String, _ saw: @autoclosure () -> String) {
        if condition { return print("ok    \(name)") }
        failures += 1
        let detail = saw()
        print("FAIL  \(name)\n      saw: \(detail.isEmpty ? "(nothing)" : detail)")
    }

    func run(_ fixture: Fixture) async {
        let name = fixture.language
        let workspace = Workspace(root: fixture.root)
        let debugger = Debugger(workspace: workspace, toolchain: Toolchain(workspace: workspace.root))
        debugger.removeAllBreakpoints()
        defer { debugger.removeAllBreakpoints() }

        let targets = await debugger.targets(near: fixture.main)
        guard let target = targets.first(where: fixture.program) else {
            return expect(false, "\(name): target discovery finds the program", targets.map(\.name).joined(separator: ", "))
        }
        expect(true, "\(name): target discovery finds the program (\(target.name))", "")
        let filesBefore = Self.files(in: fixture.root)

        debugger.setBreakpoint(line: fixture.line, in: fixture.hub)
        let started = ContinuousClock.now
        await debugger.start(target, debugging: true)
        guard await wait(debugger, { if case .paused = $0 { true } else { false } }) else {
            return expect(false, "\(name): stops at the breakpoint", "\(debugger.state)")
        }
        print("      \(name): launch to first stop \(ContinuousClock.now - started)")

        expect(debugger.breakpoints(in: fixture.hub).first?.verification == .verified, "\(name): breakpoint set before launch is verified",
               "\(debugger.breakpoints(in: fixture.hub))")
        guard case let .paused(thread, _, top) = debugger.state, let top else { return expect(false, "\(name): paused with a frame", "\(debugger.state)") }
        expect(top.url?.path == fixture.hub.path && top.line == fixture.line, "\(name): stops on \(fixture.hub.lastPathComponent):\(fixture.line + 1)",
               "\(top.url?.path ?? "no file"):\(top.line + 1)")
        let frames = await debugger.frames(of: thread)
        expect(frames.first?.function.hasSuffix(fixture.function) == true && frames.first?.isUserCode == true,
               "\(name): top frame is \(fixture.function) and user code", "\(frames.first.map { "\($0.function) user=\($0.isUserCode)" } ?? "none")")
        let library = frames.dropFirst().first { !$0.isUserCode }
        expect(library != nil, "\(name): a library frame below is not user code (\(library?.function ?? "-"))",
               frames.map { "\($0.function) \($0.url?.lastPathComponent ?? "-") user=\($0.isUserCode)" }.joined(separator: "; "))

        let first = await fields(of: "message", in: top, debugger)
        expect(unquoted(first[fixture.channel]?.value) == "email", "\(name): locals have message.\(fixture.channel) = \"email\"", "\(first)")
        let subject = await debugger.evaluate(fixture.subject, in: top, context: .watch)
        expect((try? unquoted(subject.get().value)) == "Deploy finished", "\(name): evaluate \(fixture.subject) = \"Deploy finished\"", "\(subject)")
        await inspect(fixture, debugger, top: top, frames: frames)

        await debugger.stepOver()
        let stepped = await wait(debugger, { if case .paused = $0 { true } else { false } })
        if case let .paused(_, _, frame) = debugger.state, stepped, let frame {
            expect(frame.function == top.function && frame.line > top.line, "\(name): step over moves to a later line (\(frame.line + 1))",
                   "\(frame.function):\(frame.line + 1)")
        } else {
            expect(false, "\(name): step over stops again", "\(debugger.state)")
        }

        await debugger.resume()
        guard await wait(debugger, { if case let .paused(_, _, frame) = $0 { frame?.line == fixture.line } else { false } }) else {
            return expect(false, "\(name): resume stops at the breakpoint again", "\(debugger.state)")
        }
        guard case let .paused(_, _, second) = debugger.state, let second else { return }
        let fieldsTwo = await fields(of: "message", in: second, debugger)
        let channelTwo = fieldsTwo[fixture.channel]
        expect(unquoted(channelTwo?.value) == "webhook" && channelTwo?.isChanged == true,
               "\(name): second stop marks message.\(fixture.channel) changed", "\(String(describing: channelTwo))")
        let subjectTwo = fieldsTwo[fixture.subject.split(separator: ".").last.map(String.init) ?? ""]
        expect(subjectTwo?.isChanged == false, "\(name): an unchanged field is not marked changed", "\(String(describing: subjectTwo))")
        let inlineTwo = await inlineValues(fixture, debugger)
        let message = inlineTwo.first { $0.name == "message" }
        expect(message?.isChanged == true && message?.text.contains("webhook") == true,
               "\(name): inline values mark message changed at the second stop", "\(inlineTwo)")

        debugger.setBreakpoint(line: fixture.line, in: fixture.hub, condition: fixture.condition)
        await debugger.resume()
        if await wait(debugger, { if case .paused = $0 { true } else { false } }), case let .paused(_, _, frame) = debugger.state {
            let channel = await debugger.evaluate(fixture.subject.replacingOccurrences(of: ".Subject", with: ".Channel")
                .replacingOccurrences(of: ".subject", with: ".channel"), in: frame, context: .repl)
            expect((try? unquoted(channel.get().value)) == "pager", "\(name): conditional breakpoint stops only for the third message", "\(channel)")
        } else {
            expect(false, "\(name): conditional breakpoint stops", "\(debugger.state)")
        }

        debugger.removeAllBreakpoints()
        await debugger.resume()
        let ended = await wait(debugger, { if case .ended = $0 { true } else { false } })
        expect(ended && debugger.state == .ended(exitCode: 0), "\(name): finishes with exit code 0", "\(debugger.state)")
        expect(text(debugger).contains(Self.summary), "\(name): output has the summary", text(debugger))

        debugger.setBreakpoint(line: fixture.line, in: fixture.hub)
        var paused = false
        debugger.onChange = { [weak debugger] change in
            if case .state = change, case .paused = debugger?.state { paused = true }
        }
        await debugger.start(target, debugging: false)
        let ran = await wait(debugger, { if case .ended = $0 { true } else { false } })
        debugger.onChange = nil
        expect(ran && !paused && debugger.state == .ended(exitCode: 0) && text(debugger).contains(Self.summary),
               "\(name): runs without debugging to the same output", "\(debugger.state) paused=\(paused) \(text(debugger))")

        await debugger.start(target, debugging: true)
        guard await wait(debugger, { if case .paused = $0 { true } else { false } }) else {
            return expect(false, "\(name): pauses before stop", "\(debugger.state)")
        }
        let pids = await debugger.processIdentifiers()
        await debugger.stop()
        let alive = await living(pids)
        expect(pids.count >= 2 && alive.isEmpty, "\(name): stop leaves no adapter or debuggee (pids \(pids))", "alive: \(alive)")
        let added = Self.files(in: fixture.root).subtracting(filesBefore)
        expect(added.isEmpty, "\(name): debugging leaves no new file in the workspace", added.sorted().joined(separator: ", "))
    }

    func buildError() async {
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-dap-\(getpid())")
        try? FileManager.default.removeItem(at: temporary)
        defer { try? FileManager.default.removeItem(at: temporary) }
        do {
            try FileManager.default.copyItem(at: Fixture.go.root, to: temporary)
            let main = temporary.appendingPathComponent("main.go")
            let source = try String(contentsOf: main, encoding: .utf8)
            try source.replacingOccurrences(of: "h := hub.New()", with: "h := hub.New(").write(to: main, atomically: true, encoding: .utf8)
        } catch {
            return expect(false, "go: build error fixture", "\(error)")
        }
        let workspace = Workspace(root: temporary)
        let debugger = Debugger(workspace: workspace, toolchain: Toolchain(workspace: workspace.root))
        let target = DebugTarget(id: "broken", name: "broken", kind: .goPackage(workspace.root), directory: workspace.root)
        await debugger.start(target, debugging: true)
        let failed = await wait(debugger, { if case .failed = $0 { true } else { false } })
        guard failed, case let .failed(message) = debugger.state else { return expect(false, "go: build error ends in failed", "\(debugger.state)") }
        expect(message.contains("main.go:") && message.contains("syntax error"), "go: build error ends in failed with the compiler message", message)
        let failure = debugger.failure
        expect(failure?.place == "main.go:18:45" && failure?.message.hasPrefix("syntax error: unexpected newline") == true
            && failure?.location?.url.lastPathComponent == "main.go" && failure?.location?.range.start.line == 17
            && failure?.location?.range.start.column == 44 && failure?.otherErrors == 1,
            "go: the failure leads with main.go:18:45 and its message, linked to line 18 column 45",
            "\(String(describing: failure.map { ($0.place, $0.message, $0.location, $0.otherErrors) }))")
        expect(failure?.output.contains("go build") == true && failure?.output.contains("__debug_bin") == true,
               "go: the build command and temporary paths stay in the full output", failure?.output ?? "")
        print("      go: failure summary: \(failure?.headline ?? "-")")
        let controller = DebugViewController(debugger: debugger)
        _ = controller.view
        var asked: [AgentContext] = []
        controller.onAskAgent = { asked.append($0) }
        let item = NSMenuItem(title: "", action: #selector(DebugViewController.askAgentToFixLaunch(_:)), keyEquivalent: "")
        let enabled = controller.validateUserInterfaceItem(item)
        controller.askAgentToFixLaunch(nil)
        if case let .terminal(terminal)? = asked.first {
            expect(enabled && terminal.text.contains("syntax error") && terminal.directory?.path == workspace.root.path,
                   "go: Ask Nyte to Fix hands the build output and the directory to the agent",
                   "enabled \(enabled) \(terminal.directory?.path ?? "-") \(terminal.text.prefix(80))")
        } else {
            expect(false, "go: Ask Nyte to Fix reports the launch failure", "\(asked)")
        }
    }

    func goTest() async {
        let fixture = Fixture.go
        let workspace = Workspace(root: fixture.root)
        let debugger = Debugger(workspace: workspace, toolchain: Toolchain(workspace: workspace.root))
        debugger.removeAllBreakpoints()
        defer { debugger.removeAllBreakpoints() }
        let file = fixture.root.appendingPathComponent("hub/hub_test.go")
        let targets = await debugger.targets(near: file)
        guard let target = targets.first(where: { if case .goTest(_, test: "TestSubmitCountsPerChannel") = $0.kind { true } else { false } }) else {
            return expect(false, "go test: target discovery finds TestSubmitCountsPerChannel", targets.map(\.name).joined(separator: ", "))
        }
        debugger.setBreakpoint(line: fixture.line, in: fixture.hub)
        await debugger.start(target, debugging: true)
        guard await wait(debugger, { if case .paused = $0 { true } else { false } }),
              case let .paused(thread, _, frame) = debugger.state else {
            return expect(false, "go test: stops at the breakpoint", "\(debugger.state)")
        }
        let frames = await debugger.frames(of: thread)
        expect(frame?.line == fixture.line && frames.contains { $0.function.hasSuffix("TestSubmitCountsPerChannel") },
               "go test: stops in Submit called from TestSubmitCountsPerChannel", frames.map(\.function).joined(separator: "; "))
        debugger.removeAllBreakpoints()
        await debugger.resume()
        let ended = await wait(debugger, { if case .ended = $0 { true } else { false } })
        expect(ended && debugger.state == .ended(exitCode: 0) && text(debugger).contains("PASS"),
               "go test: the test passes with exit code 0", "\(debugger.state) \(text(debugger))")
        guard let package = targets.first(where: { if case .goTest(_, test: nil) = $0.kind { true } else { false } }) else {
            return expect(false, "go test: the whole package is a target", targets.map(\.name).joined(separator: ", "))
        }
        await debugger.start(package, debugging: false)
        let passed = await wait(debugger, { if case .ended = $0 { true } else { false } })
        expect(passed && debugger.state == .ended(exitCode: 0) && text(debugger).contains("PASS"),
               "go test: \(package.name) runs every test and passes", "\(debugger.state) \(text(debugger))")
    }

    func persistence() {
        let workspace = Workspace(root: Fixture.go.root)
        let toolchain = Toolchain(workspace: workspace.root)
        let file = Fixture.go.main
        let first = Debugger(workspace: workspace, toolchain: toolchain)
        first.removeAllBreakpoints()
        first.setBreakpoint(line: 20, in: file)
        first.setBreakpoint(line: 30, in: file, enabled: false, condition: "x > 1")
        first.setBreakpoint(Breakpoint(line: 40, condition: "ok", hitCondition: "> 2", logMessage: "seen {x}"), in: file)
        first.setExceptionBreakpoint("unrecovered-panic", adapter: "go", enabled: false)
        let second = Debugger(workspace: workspace, toolchain: toolchain)
        let restored = second.breakpoints(in: file)
        let logpoint = second.breakpoint(line: 40, in: file)
        expect(restored.map(\.zeroBasedLine) == [20, 30, 40] && restored[1].condition == "x > 1" && !restored[1].isEnabled
            && logpoint?.hitCondition == "> 2" && logpoint?.logMessage == "seen {x}" && logpoint?.condition == "ok",
            "breakpoints with condition, hit count and log message persist across two Debugger instances", "\(restored) \(String(describing: logpoint))")
        let panics = second.exceptionBreakpoints.first { $0.adapter == "go" && $0.filter.id == "unrecovered-panic" }
        expect(panics?.isEnabled == false, "an exception breakpoint choice persists, with the filters the adapter offered",
               "\(second.exceptionBreakpoints)")
        second.setExceptionBreakpoint("unrecovered-panic", adapter: "go", enabled: true)
        second.shift(in: file, fromLine: 25, by: 3)
        second.shift(in: file, fromLine: 10, by: -2)
        let third = Debugger(workspace: workspace, toolchain: toolchain)
        expect(third.breakpoints(in: file).map(\.zeroBasedLine) == [18, 31, 41], "shift moves breakpoints and the move persists",
               "\(third.breakpoints(in: file).map(\.zeroBasedLine))")
        third.removeAllBreakpoints()
    }

    func fields(of name: String, in frame: DebugFrame, _ debugger: Debugger) async -> [String: DebugVariable] {
        for scope in await debugger.scopes(of: frame) where !scope.isExpensive {
            guard let variable = await debugger.children(of: scope.reference).first(where: { $0.name == name }) else { continue }
            let children = await debugger.children(of: variable.reference)
            return Dictionary(children.map { ($0.name, $0) }, uniquingKeysWith: { first, _ in first })
        }
        return [:]
    }

    func unquoted(_ value: String?) -> String? {
        value?.trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
    }

    func text(_ debugger: Debugger) -> String {
        debugger.output.filter { $0.category != .console }.map(\.text).joined()
    }

    func wait(_ debugger: Debugger, timeout: Duration = .seconds(60), _ done: @escaping (Debugger.State) -> Bool) async -> Bool {
        _ = await Patience.until(timeout) {
            if case .failed = debugger.state { return true }
            return done(debugger.state)
        }
        return done(debugger.state)
    }

    static func files(in root: URL) -> Set<String> {
        let found = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil)?.compactMap { $0 as? URL } ?? []
        return Set(found.map { Workspace(root: root).relativePath(of: $0) })
    }

    func living(_ pids: [Int32]) async -> [Int32] {
        let launch = ChildProcess.Launch(executable: URL(fileURLWithPath: "/usr/bin/pgrep"), arguments: ["."], environment: [:])
        let listed = Set((await ChildProcess.run(launch)?.text ?? "").split(separator: "\n").compactMap { Int32($0) })
        return pids.filter(listed.contains)
    }
}
