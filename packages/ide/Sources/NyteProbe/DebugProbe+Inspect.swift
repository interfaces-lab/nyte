import AppKit
import Foundation
import NyteCore
@testable import NyteDebug

extension DebugCheck {
    func inspect(_ fixture: Fixture, _ debugger: Debugger, top: DebugFrame, frames: [DebugFrame]) async {
        let name = fixture.language
        let capabilities = debugger.capabilities
        let filters = capabilities.exceptionFilters.map(\.id)
        let expected = fixture.language == "go" ? ["unrecovered-panic", "runtime-fatal-throw"] : ["all", "uncaught"]
        expect(filters == expected && capabilities.supportsLogPoints && capabilities.supportsHitConditionalBreakpoints,
               "\(name): the adapter offers exception filters \(expected), logpoints and hit counts", "\(capabilities)")
        let remembered = debugger.exceptionBreakpoints.map(\.filter.id)
        expect(remembered == expected, "\(name): the offered exception filters are remembered for the Breakpoints list", "\(remembered)")

        let here = FileLocation(url: fixture.hub, range: TextSpan(start: TextPosition(line: fixture.line, column: 0),
                                                                  end: TextPosition(line: fixture.line, column: 0)))
        let hover = await debugger.hoverValue(of: fixture.subject, at: here)
        let hovered = hover.flatMap { try? $0.get() }
        expect(unquoted(hovered?.value) == "Deploy finished", "\(name): hover evaluates \(fixture.subject)", "\(String(describing: hover))")
        let object = await debugger.hoverValue(of: "message", at: here).flatMap { try? $0.get() }
        let children = await debugger.children(of: object?.reference ?? 0)
        expect((object?.reference ?? 0) > 0 && children.contains { $0.name == fixture.channel },
               "\(name): a hovered object expands lazily into its fields", children.map(\.name).joined(separator: ", "))
        let call = await debugger.hoverValue(of: fixture.language == "go" ? "h.Stats()" : "this.stats()", at: here)
        let elsewhere = await debugger.hoverValue(of: "message", at: FileLocation(url: fixture.main, range: here.range))
        expect(call == nil && elsewhere == nil, "\(name): hover never calls a function and ignores files the frame is not in",
               "call \(String(describing: call)) elsewhere \(String(describing: elsewhere))")
        let cancelled = Task { @MainActor in
            withUnsafeCurrentTask { $0?.cancel() }
            return await debugger.hoverValue(of: fixture.subject, at: here)
        }
        let late = await cancelled.value
        expect(late == nil, "\(name): a cancelled hover answers nothing", "\(String(describing: late))")

        let inline = await inlineValues(fixture, debugger)
        let message = inline.first { $0.name == "message" }
        let summary = fixture.language == "go" ? #"{Channel: "email", …}"# : "{channel: 'email', …}"
        expect(message?.line == fixture.line - 1 && message?.text == summary && message?.isChanged == false
            && inline.allSatisfy { $0.text.count <= 40 && !$0.text.hasPrefix($0.name + ":") },
               "\(name): inline values give message on the function's first line as one short summary, \(summary)", "\(inline)")
        print("      \(name): inline values \(inline.map { "\($0.line + 1): \($0.name) \($0.text)" }.joined(separator: " | "))")

        await replKeys(fixture, debugger)
        await askNyte(fixture, debugger, top: top)

        guard fixture.language == "ts" else { return }
        let completions = await debugger.completions(for: "mess", column: 4)
        expect(completions.contains { $0.label == "message" }, "ts: completions for mess include message",
               completions.map(\.label).joined(separator: ", "))
        let labels = frames.filter(\.isLabel).map(\.function)
        expect(!labels.isEmpty, "ts: the stack carries an async label (\(labels.first ?? "-"))", frames.map(\.function).joined(separator: "; "))
    }

    func askNyte(_ fixture: Fixture, _ debugger: Debugger, top: DebugFrame) async {
        let name = fixture.language
        let controller = DebugViewController(debugger: debugger)
        _ = controller.view
        await controller.selectFrame(at: 0)
        let item = NSMenuItem(title: "", action: #selector(DebugViewController.askAgentAboutStop(_:)), keyEquivalent: "")
        let hiddenWithoutClosure = !controller.validateUserInterfaceItem(item) && controller.variables.onAskAboutStop == nil
        var asked: [AgentContext] = []
        controller.onAskAgent = { asked.append($0) }
        let enabled = controller.validateUserInterfaceItem(item)
        controller.askAgentAboutStop(nil)
        let menu = controller.variables.list.menuForRow?(0)?.items.map(\.title) ?? []
        guard case let .stop(stop)? = asked.first else {
            return expect(false, "\(name): Ask Nyte About This Stop reports the stop", "\(asked)")
        }
        expect(hiddenWithoutClosure && enabled && item.title == DebugText.askAboutStop && menu.contains(DebugText.askAboutStop),
               "\(name): Ask Nyte About This Stop is validated, in the variables menu, and absent without the closure",
               "hidden \(hiddenWithoutClosure) enabled \(enabled) menu \(menu)")
        let message = stop.locals.first { $0.name == "message" }
        expect(stop.file.path == fixture.hub.path && stop.line == fixture.line + 1 && stop.function == top.function
            && message?.value.contains("Deploy finished") == true && message?.type.isEmpty == false,
               "\(name): the stop names \(fixture.hub.lastPathComponent):\(fixture.line + 1) in \(top.function) with message's type and value",
               "\(stop.file.lastPathComponent):\(stop.line) \(stop.function) \(stop.locals)")
        print("      \(name): ask context locals \(stop.locals.map { "\($0.name) \($0.type) = \($0.value)" }.joined(separator: " | "))")
    }

    func replKeys(_ fixture: Fixture, _ debugger: Debugger) async {
        let name = fixture.language
        let pane = ConsolePane(debugger: debugger)
        let field = fixture.channel == "channel" ? "message.channel" : "message.Channel"
        for line in [fixture.subject, field] {
            let before = pane.console.buffer.count
            pane.prompt.stringValue = line
            pane.prompt.onSubmit?(line)
            _ = await Patience.until(.seconds(10)) { pane.console.buffer.count >= before + 2 }
        }
        let lines = (0..<pane.console.buffer.count).map(pane.console.buffer.line)
        expect(lines.contains("› " + fixture.subject) && lines.contains { $0.contains("Deploy finished") } && pane.prompt.stringValue.isEmpty,
               "\(name): Return in the console prompt evaluates in the selected frame and echoes the expression", lines.joined(separator: " | "))
        await pane.console.applyFilter(fixture.subject)
        let shown = pane.console.text.textStorage
        let echo = (shown?.string ?? "" as String) as NSString
        let place = echo.range(of: "› " + fixture.subject)
        var inks = 0
        if let shown, place.location != NSNotFound {
            shown.enumerateAttribute(.foregroundColor, in: place) { _, _, _ in inks += 1 }
        }
        expect(inks > 1, "\(name): the filtered console keeps the REPL's code colours", "\(inks) ink runs in \(echo)")
        await pane.console.applyFilter("")
        let key = { (selector: Selector) in pane.prompt.onCommand?(selector) ?? false }
        var walked: [String] = []
        for selector in [#selector(NSResponder.moveUp(_:)), #selector(NSResponder.moveUp(_:)), #selector(NSResponder.moveDown(_:)),
                         #selector(NSResponder.moveDown(_:))] {
            _ = key(selector)
            walked.append(pane.prompt.stringValue)
        }
        expect(walked == [field, fixture.subject, field, ""], "\(name): ↑ and ↓ handed to the prompt walk the history back to the draft",
               "\(walked)")
        pane.prompt.stringValue = name == "ts" ? "message.bo" : "message.Bo"
        let tabbed = key(#selector(NSResponder.insertTab(_:)))
        await pane.settleCompletion()
        if name == "ts" {
            expect(tabbed && pane.prompt.stringValue == "message.body", "ts: Tab handed to the prompt completes message.bo to message.body",
                   "handled \(tabbed) field \(pane.prompt.stringValue)")
        } else {
            expect(!tabbed && pane.prompt.stringValue == "message.Bo", "go: Tab passes on to focus, since Delve offers no completions",
                   "handled \(tabbed) field \(pane.prompt.stringValue)")
        }
    }

    func toolSettings() async {
        let workspace = Workspace(root: Fixture.go.root)
        let toolchain = Toolchain(workspace: workspace.root)
        let debugger = Debugger(workspace: workspace, toolchain: toolchain)
        let found = await debugger.toolStatus()
        print("      tools: " + found.map { "\($0.tool.title) \($0.version ?? "?") from \($0.source?.words ?? "-") (\($0.searched.count) places)" }
            .joined(separator: "; "))
        expect(found.count == 3 && found.allSatisfy { $0.path != nil && $0.version != nil && !$0.isOverride && !$0.searched.isEmpty },
               "tools: Delve, js-debug and node resolve with a version and the places searched", "\(found)")
        let delve = found.first { $0.tool == .delve }
        let offer = delve?.install
        let offered = delve?.source == .bundled
            ? offer?.title == "Install Delve with your Go" && offer?.shown == "go install github.com/go-delve/delve/cmd/dlv@latest"
                && offer?.command.contains("install") == true
            : offer == nil
        expect(found.allSatisfy { $0.source != nil } && offered,
               "tools: each tool says where it came from (\(found.map { $0.source?.words ?? "-" }.joined(separator: ", "))), and Nyte IDE's copy of Delve offers Install Delve with your Go",
               "\(String(describing: delve?.source)) \(String(describing: offer))")
        guard let dlv = found.first(where: { $0.tool == .delve })?.path,
              let folder = scratch("override", ["go.mod": "module example.com/override\n\ngo 1.22\n",
                                                "main.go": "package main\n\nimport \"fmt\"\n\nfunc main() {\n\tfmt.Println(\"override\")\n}\n"])
        else { return }
        defer { try? FileManager.default.removeItem(at: folder) }
        let link = folder.appendingPathComponent("dlv-override")
        try? FileManager.default.createSymbolicLink(at: link, withDestinationURL: dlv)
        let scratchDebugger = Debugger(workspace: Workspace(root: folder), toolchain: Toolchain(workspace: folder),
                                       settings: DebugSettings(delvePath: link.path))
        scratchDebugger.removeAllBreakpoints()
        scratchDebugger.setBreakpoint(line: 5, in: folder.appendingPathComponent("main.go"))
        let status = await scratchDebugger.toolStatus().first { $0.tool == .delve }
        await scratchDebugger.start(DebugTarget(id: "o", name: "o", kind: .goPackage(folder), directory: folder), debugging: true)
        _ = await wait(scratchDebugger, { if case .paused = $0 { true } else { false } })
        let adapter = await scratchDebugger.processIdentifiers().first
        let launch = ChildProcess.Launch(executable: URL(fileURLWithPath: "/bin/ps"), arguments: ["-o", "command=", "-p", "\(adapter ?? 0)"],
                                         environment: [:])
        let command = await ChildProcess.run(launch)?.text ?? ""
        expect(status?.isOverride == true && status?.path == link && command.contains("dlv-override"),
               "tools: a Delve override is shown and is the adapter that runs", "\(String(describing: status)) ps: \(command)")
        scratchDebugger.removeAllBreakpoints()
        await scratchDebugger.stop()

        scratchDebugger.settings = DebugSettings(delvePath: "/nowhere/dlv")
        await scratchDebugger.start(DebugTarget(id: "o", name: "o", kind: .goPackage(folder), directory: folder), debugging: true)
        expect(scratchDebugger.state == .failed("Delve is set to /nowhere/dlv in Settings, but there is no program there that can run."),
               "tools: a bad Delve path fails the next session with a sentence", "\(scratchDebugger.state)")
        scratchDebugger.settings = DebugSettings(jsDebugServerPath: "/nowhere/dapDebugServer.js", nodePath: "~/nowhere/node")
        let bad = await scratchDebugger.toolStatus()
        expect(bad.first { $0.tool == .jsDebug }?.problem == "js-debug is set to /nowhere/dapDebugServer.js in Settings, but there is no file there."
            && bad.first { $0.tool == .node }?.problem?.hasPrefix("Node is set to ") == true,
            "tools: bad js-debug and node paths are reported as sentences for the Tools pane", "\(bad.map { $0.problem ?? "-" })")
    }

    func inlineValues(_ fixture: Fixture, _ debugger: Debugger) async -> [InlineValue] {
        let source = (try? String(contentsOf: fixture.hub, encoding: .utf8)) ?? ""
        let lines = source.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        return await debugger.inlineValues(in: fixture.hub) { lines.indices.contains($0) ? lines[$0] : nil }
    }

    func breakpointKinds(_ fixture: Fixture) async {
        let name = fixture.language
        let workspace = Workspace(root: fixture.root)
        let debugger = Debugger(workspace: workspace, toolchain: Toolchain(workspace: workspace.root))
        debugger.removeAllBreakpoints()
        defer { debugger.removeAllBreakpoints() }
        guard let target = await debugger.targets(near: fixture.main).first(where: fixture.program) else {
            return expect(false, "\(name): breakpoint kinds target", "")
        }
        let field = fixture.subject.replacingOccurrences(of: ".Subject", with: ".Channel").replacingOccurrences(of: ".subject", with: ".channel")
        debugger.setBreakpoint(Breakpoint(line: fixture.line, logMessage: "sent {\(field)}"), in: fixture.hub)
        debugger.setBreakpoint(Breakpoint(line: fixture.line + 1, hitCondition: "== 2"), in: fixture.hub)
        await debugger.start(target, debugging: true)
        guard await wait(debugger, { if case .paused = $0 { true } else { false } }), case let .paused(_, _, frame) = debugger.state else {
            return expect(false, "\(name): the hit-count breakpoint stops", "\(debugger.state)")
        }
        let channel = await debugger.evaluate(field, in: frame, context: .repl)
        expect(frame?.line == fixture.line + 1 && (try? unquoted(channel.get().value)) == "webhook",
               "\(name): a breakpoint with hit count == 2 stops on the second message only", "\(String(describing: frame)) \(channel)")
        let logged = debugger.output.map(\.text).joined()
        let quoted = logged.contains("sent \"email\"") && logged.contains("sent \"webhook\"")
        expect(quoted || logged.contains("sent email") && logged.contains("sent webhook"),
               "\(name): the logpoint logs each message without stopping", logged)

        if fixture.language == "ts" {
            debugger.setExceptionBreakpoint("all", adapter: "pwa-node", enabled: true)
            await debugger.resume()
            let stopped = await wait(debugger, { if case let .paused(_, reason, _) = $0 { reason == "exception" } else { false } })
            expect(stopped, "ts: turning on Caught Exceptions while paused stops on the pager's thrown error", "\(debugger.state)")
            debugger.setExceptionBreakpoint("all", adapter: "pwa-node", enabled: false)
        }
        await debugger.stop()
    }

    func inlineSource() {
        let go = [
            "func (h *Hub) Submit(ctx context.Context, message Message) error {",
            "\th.mu.Lock() // message is not here",
            "\tchannel, ok := h.channels[message.Channel]",
            "\tif !ok {",
            "\t\treturn fmt.Errorf(\"%w: %q\", ErrUnknownChannel, message.Channel)",
            "\t}",
            "\terr := channel.Send(ctx, message)",
        ]
        let start = InlineValues.functionStart(before: 6) { go.indices.contains($0) ? go[$0] : nil }
        let typescript = ["export class Hub {", "  stats(): Stats {", "    return 1;", "  }", "  async submit(message: Message): Promise<void> {",
                          "    if (!message) {", "      return;", "    }", "    const channel = this.find(message.channel);"]
        let method = InlineValues.functionStart(before: 8) { typescript.indices.contains($0) ? typescript[$0] : nil }
        expect(start == 0 && method == 4, "inline values find the enclosing function in Go and in a TypeScript method",
               "go \(start) ts \(method)")
        let locals = Dictionary(uniqueKeysWithValues: ["h", "ctx", "message", "channel", "ok", "err"].map { name in
            (name, DebugVariable(name: name, value: "\"\(name)\"", type: "string", reference: 0, childCount: nil, indexedCount: nil,
                                 isChanged: name == "ok"))
        })
        let values = InlineValues.values(lines: go.enumerated().map { ($0.offset, $0.element) }, locals: locals)
        let second = values.filter { $0.line == 1 }.map(\.name)
        let third = values.filter { $0.line == 2 }.map(\.name)
        let changed = values.first { $0.name == "ok" }?.isChanged
        let long = InlineValues.display(DebugVariable(name: "s", value: "\"" + String(repeating: "x", count: 80) + "\"", type: "string",
                                                      reference: 0, childCount: nil, indexedCount: nil, isChanged: false))
        let list = InlineValues.display(DebugVariable(name: "l", value: "[]int len: 3, cap: 3, [1,2,3]", type: "[]int", reference: 7,
                                                      childCount: 3, indexedCount: 3, isChanged: false))
        expect(second == ["h"] && third == ["channel", "ok", "h", "message"] && changed == true && long.count == 40
            && long.hasSuffix("…\"") && list == "len: 3",
               "inline values skip comments, strings and fields, keep the changed mark, cut strings inside their quotes, give len for a collection",
               "\(values) \(long) \(list)")
    }

    func consoleBuffer() {
        var buffer = ConsoleBuffer(limit: 50_000, slack: 5_000)
        let clock = ContinuousClock()
        let started = clock.now
        var dropped = 0
        for chunk in 0..<1_000 {
            let text = (0..<100).map { "\(chunk * 100 + $0) GET /api/hubs took \($0)ms" }.joined(separator: "\n") + "\n"
            _ = buffer.append(text, stream: chunk % 10 == 0 ? .stderr : .stdout)
            dropped += buffer.trim()
        }
        let appended = clock.now - started
        let filterStart = clock.now
        let match = buffer.matching("took 42ms")
        let filtered = clock.now - filterStart
        expect(buffer.count <= 55_000 && buffer.dropped == dropped && buffer.dropped + buffer.count == 100_000
            && buffer.line(buffer.count - 1) == "99999 GET /api/hubs took 99ms",
            "the console keeps a bounded buffer of 100,000 lines and counts what it dropped", "kept \(buffer.count) dropped \(buffer.dropped)")
        expect(match.lines == buffer.count / 100, "the console filter finds every matching kept line", "\(match.lines)")
        _ = buffer.append("partial", stream: .stdout)
        _ = buffer.append(" line\nnext", stream: .stdout)
        let broke = buffer.append("error\n", stream: .stderr)
        let tail = (buffer.count - 3..<buffer.count).map(buffer.line)
        expect(tail == ["partial line", "next", "error"] && broke && buffer.streams.last == .stderr,
               "console lines join partial writes and break where the stream changes", "\(tail) broke \(broke)")
        print("      console buffer: 100,000 lines appended in \(appended), kept \(buffer.count), dropped \(buffer.dropped); filter over the kept lines \(filtered)")
    }
}
