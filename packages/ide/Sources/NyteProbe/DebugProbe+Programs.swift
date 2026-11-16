import AppKit
import Foundation
import NyteCore
@testable import NyteDebug

extension DebugCheck {
    static let workers = """
    package main

    import (
    \t"fmt"
    \t"os"
    \t"sync"
    \t"time"
    )

    func main() {
    \tname := "world"
    \tif len(os.Args) > 1 {
    \t\tname = os.Args[1]
    \t}
    \tif name == "panic" {
    \t\tpanic("boom")
    \t}
    \tjobs := make(chan int)
    \tvar wg sync.WaitGroup
    \twg.Add(1)
    \tgo worker(jobs, &wg)
    \ttime.Sleep(100 * time.Millisecond)
    \tfmt.Println("hello", name, os.Getenv("GREETING"))
    \tjobs <- 1
    \tclose(jobs)
    \twg.Wait()
    }

    func worker(jobs chan int, wg *sync.WaitGroup) {
    \tdefer wg.Done()
    \tfor job := range jobs {
    \t\tfmt.Println("job", job)
    \t}
    }

    """

    func goroutinesAndArguments() async {
        guard let folder = scratch("workers", ["go.mod": "module example.com/workers\n\ngo 1.22\n", "main.go": Self.workers]) else { return }
        defer { try? FileManager.default.removeItem(at: folder) }
        let main = folder.appendingPathComponent("main.go")
        let line = Self.workers.split(separator: "\n", omittingEmptySubsequences: false).firstIndex { $0.contains("fmt.Println(\"hello\"") } ?? 0
        let workspace = Workspace(root: folder)
        let debugger = Debugger(workspace: workspace, toolchain: Toolchain(workspace: workspace.root))
        debugger.removeAllBreakpoints()
        defer { debugger.removeAllBreakpoints() }
        debugger.setBreakpoint(line: line, in: main)
        let target = DebugTarget(id: "workers", name: "workers", kind: .goPackage(folder), directory: folder, arguments: ["Ada"],
                                 environment: ["GREETING": "hi"])
        await debugger.start(target, debugging: true)
        guard await wait(debugger, { if case .paused = $0 { true } else { false } }), case let .paused(stopped, _, frame) = debugger.state,
              let frame else { return expect(false, "goroutines: stops in main", "\(debugger.state)") }
        let described = await Patience.until(.seconds(10)) { debugger.threads.contains { $0.state == "chan receive" } }
        let worker = debugger.threads.first { $0.function == "main.worker" }
        let current = debugger.threads.first { $0.id == stopped }
        expect(described && worker?.state == "chan receive" && current?.state == "paused",
               "goroutines: listed with their state, the worker waiting on chan receive",
               debugger.threads.map { "\($0.id) \($0.function) [\($0.state)]" }.joined(separator: "; "))
        let locals = await fields(in: frame, debugger)
        expect(unquoted(locals["name"]?.value) == "Ada", "arguments: the program sees its argument Ada", "\(locals.keys.sorted())")
        if let worker {
            debugger.selectThread(worker.id)
            let frames = await debugger.frames(of: worker.id)
            let top = frames.first { $0.isUserCode }
            let theirs = if let top { await fields(in: top, debugger) } else { [String: DebugVariable]() }
            expect(debugger.selectedThread == worker.id && top?.function == "main.worker" && theirs["jobs"] != nil,
                   "goroutines: switching to the worker shows its frames and its variables",
                   "\(frames.map(\.function)) \(theirs.keys.sorted())")
        }
        debugger.removeAllBreakpoints()
        await debugger.resume()
        let ended = await wait(debugger, { if case .ended = $0 { true } else { false } })
        expect(ended && text(debugger).contains("hello Ada hi") && text(debugger).contains("job 1"),
               "arguments and environment reach the program (hello Ada hi)", text(debugger))

        var panicking = target
        panicking.arguments = ["panic"]
        await debugger.start(panicking, debugging: true)
        let panicked = await wait(debugger, { if case .paused = $0 { true } else { false } })
        let reason = if case let .paused(_, reason, _) = debugger.state { reason } else { "" }
        expect(panicked && (reason == "exception" || reason == "panic"), "go: an unrecovered panic stops on the default exception filter (\(reason))",
               "\(debugger.state)")
        await debugger.stop()
    }

    static let goEcho = """
    package main

    import (
    \t"bufio"
    \t"fmt"
    \t"os"
    )

    func main() {
    \tfmt.Println("ready")
    \tlines := bufio.NewScanner(os.Stdin)
    \tcount := 0
    \tfor lines.Scan() {
    \t\tcount++
    \t\tfmt.Printf("got %q\\n", lines.Text())
    \t}
    \tfmt.Printf("bye after %d lines\\n", count)
    }

    """

    static let nodeEcho = """
    import { createInterface } from "node:readline";

    console.log("ready");
    let count = 0;
    for await (const line of createInterface({ input: process.stdin })) {
      count++;
      console.log(`got ${JSON.stringify(line)}`);
    }
    console.log(`bye after ${count} lines`);

    """

    func interactiveInput() async {
        let cases: [(String, [String: String], (URL) -> DebugTarget)] = [
            ("go", ["go.mod": "module example.com/echo\n\ngo 1.22\n", "main.go": Self.goEcho],
             { DebugTarget(id: "echo", name: "echo", kind: .goPackage($0), directory: $0) }),
            ("node", ["package.json": #"{ "type": "module" }"#, "echo.mjs": Self.nodeEcho],
             { DebugTarget(id: "echo", name: "echo", kind: .node($0.appendingPathComponent("echo.mjs")), directory: $0) }),
        ]
        for (language, files, makeTarget) in cases {
            guard let folder = scratch("echo-\(language)", files) else { continue }
            defer { try? FileManager.default.removeItem(at: folder) }
            for debugging in [true, false] {
                let mode = debugging ? "debugging" : "without debugging"
                let debugger = Debugger(workspace: Workspace(root: folder), toolchain: Toolchain(workspace: folder))
                let pane = ConsolePane(debugger: debugger)
                debugger.onChange = { [weak pane] change in if case .state = change { pane?.stateDidChange() } }
                await debugger.start(makeTarget(folder), debugging: debugging)
                let alive = await Patience.until(.seconds(30)) { self.text(debugger).contains("ready") }
                guard await Patience.pause(.milliseconds(700)) else { return }
                let waiting = debugger.state == .running && pane.mode == .input && pane.prompt.isEnabled
                for line in ["one", "", "two words"] {
                    pane.prompt.stringValue = line
                    pane.prompt.onSubmit?(line)
                    _ = await Patience.until(.seconds(10)) { self.text(debugger).contains("got \"\(line)\"") }
                }
                pane.prompt.stringValue = ""
                let handled = pane.prompt.onCommand?(#selector(NSResponder.deleteForward(_:))) ?? false
                let ended = await wait(debugger, timeout: .seconds(20), { if case .ended = $0 { true } else { false } })
                pane.stateDidChange()
                let output = text(debugger)
                expect(alive && waiting && handled && ended && output.contains(#"got "one""#) && output.contains(#"got """#)
                    && output.contains(#"got "two words""#) && output.contains("bye after 3 lines"),
                    "\(language) \(mode): an interactive program waits for input, gets typed lines, and ⌃D in the prompt ends its input",
                    "alive \(alive) waiting \(waiting) (\(debugger.state), \(pane.mode)) ⌃D \(handled) ended \(ended) output \(output)")
                expect(!pane.prompt.isEnabled && pane.prompt.placeholder == "The program has exited",
                       "\(language) \(mode): after exit the prompt is disabled and says the program has exited",
                       "enabled \(pane.prompt.isEnabled) \(pane.prompt.placeholder)")
                debugger.onChange = nil
                await debugger.stop()
            }
        }
    }

    func singleTests() async {
        let typeScript = """
        import { test } from "node:test";
        import assert from "node:assert";

        test("email first", () => {
          const channel = "email";
          assert.equal(channel.length, 5);
        });

        test("webhook second", () => {
          const channel = "webhook";
          assert.equal(channel.length, 7);
        });

        """
        let go = """
        package routes

        import "testing"

        func TestRoutes(t *testing.T) {
        \tt.Run("email first", func(t *testing.T) {
        \t\tchannel := "email"
        \t\tif len(channel) != 5 {
        \t\t\tt.Fatal(channel)
        \t\t}
        \t})
        \tt.Run("webhook second", func(t *testing.T) {
        \t\tchannel := "webhook"
        \t\tif len(channel) != 7 {
        \t\t\tt.Fatal(channel)
        \t\t}
        \t})
        }

        """
        let cases: [(String, [String: String], String, (Int, Int), (URL) -> DebugTarget)] = [
            ("ts", ["package.json": #"{ "type": "module" }"#, "routes.test.ts": typeScript], "routes.test.ts", (4, 9), { folder in
                DebugTarget(id: "test", name: "routes.test.ts email first", kind: .node(folder.appendingPathComponent("routes.test.ts")),
                            directory: folder, runtimeArguments: ["--test", "--test-name-pattern=^email first$"])
            }),
            ("go", ["go.mod": "module example.com/routes\n\ngo 1.22\n", "routes_test.go": go], "routes_test.go", (6, 12), { folder in
                DebugTarget(id: "test", name: "TestRoutes/email_first", kind: .goTest(folder, test: nil), directory: folder,
                            arguments: ["-test.run", "^TestRoutes$/^email_first$", "-test.v"])
            }),
        ]
        for (language, files, source, lines, makeTarget) in cases {
            guard let folder = scratch("single-\(language)", files) else { continue }
            defer { try? FileManager.default.removeItem(at: folder) }
            let file = folder.appendingPathComponent(source)
            let workspace = Workspace(root: folder)
            let debugger = Debugger(workspace: workspace, toolchain: Toolchain(workspace: workspace.root))
            debugger.removeAllBreakpoints()
            debugger.setBreakpoint(line: lines.0, in: file)
            debugger.setBreakpoint(line: lines.1, in: file)
            var stops: [Int] = []
            debugger.onChange = { [weak debugger] change in
                if case .state = change, case let .paused(_, _, frame) = debugger?.state, let frame { stops.append(frame.line) }
            }
            await debugger.start(makeTarget(folder), debugging: true)
            let first = await wait(debugger, { if case .paused = $0 { true } else { false } })
            if first { await debugger.resume() }
            let ended = await wait(debugger, { if case .ended = $0 { true } else { false } })
            debugger.onChange = nil
            let output = text(debugger)
            let ranSibling = output.contains("webhook second") || output.contains("webhook_second")
            expect(first && ended && stops == [lines.0] && !ranSibling,
                   "\(language): a single named test stops on its breakpoint and its sibling does not run",
                   "stops \(stops.map { $0 + 1 }) \(debugger.state) \(output)")
            debugger.removeAllBreakpoints()
            await debugger.stop()
        }
    }

    func configurations() async {
        guard let folder = scratch("configs", ["go.mod": "module example.com/workers\n\ngo 1.22\n", "main.go": Self.workers,
                                               "main_test.go": "package main\n\nimport \"testing\"\n\nfunc TestNothing(t *testing.T) {}\n"])
        else { return }
        defer { try? FileManager.default.removeItem(at: folder) }
        let workspace = Workspace(root: folder)
        let debugger = Debugger(workspace: workspace, toolchain: Toolchain(workspace: workspace.root))
        let detected = await debugger.detectedConfigurations(near: nil)
        expect(detected.contains { $0.kind == .goPackage && $0.program == "." } && detected.contains { $0.kind == .goTest && $0.test == nil },
               "configurations: a Go main package and its tests are detected", detected.map(\.name).joined(separator: ", "))
        let typeScript = await Debugger(workspace: Workspace(root: Fixture.typescript.root), toolchain: Toolchain(workspace: folder))
            .detectedConfigurations(near: nil)
        expect(typeScript.contains { $0.name == "npm start" } && typeScript.contains { $0.kind == .node && $0.program == "src/index.ts" },
               "configurations: package.json scripts and the TypeScript entry are detected", typeScript.map(\.name).joined(separator: ", "))

        let greet = RunConfiguration(name: "Greet Ada", kind: .goPackage, program: ".", arguments: ["Ada"], environment: ["GREETING": "hey"])
        do {
            try await debugger.saveRunConfigurations([greet])
        } catch {
            return expect(false, "configurations: save", "\(error)")
        }
        let file = folder.appendingPathComponent(".nyte/run-configurations.json")
        let written = (try? String(contentsOf: file, encoding: .utf8)) ?? ""
        let read = await debugger.runConfigurations()
        let targets = await debugger.targets(near: nil)
        expect(written.contains("\"version\" : 1") && read == [greet] && targets.first?.name == "Greet Ada",
               "configurations: one versioned file in .nyte, read back and listed first", written)
        if let first = targets.first {
            await debugger.start(first, debugging: false)
            let ended = await wait(debugger, { if case .ended = $0 { true } else { false } })
            expect(ended && text(debugger).contains("hello Ada hey"), "configurations: running a saved one passes its arguments and environment",
                   text(debugger))
        }
        try? #"{"version": 99, "configurations": []}"#.write(to: file, atomically: true, encoding: .utf8)
        let ignored = await debugger.runConfigurations()
        expect(ignored.isEmpty, "configurations: a file with an unknown version is ignored and logged", "\(ignored)")
    }

    func manyLocals() async {
        let count = 10_000
        let body = (0..<count).map { "\tv\($0) := \($0)\n\t_ = v\($0)" }.joined(separator: "\n")
        let go = "package main\n\nimport \"fmt\"\n\nfunc main() {\n\(body)\n\tfmt.Println(\"done\")\n}\n"
        let ts = "function many(): void {\n" + (0..<count).map { "  let v\($0) = \($0);" }.joined(separator: "\n")
            + "\n  console.log(\"done\", v0);\n}\nmany();\n"
        let cases: [(String, [String: String], (URL) -> DebugTarget, String, Int)] = [
            ("go", ["go.mod": "module example.com/many\n\ngo 1.22\n", "main.go": go],
             { DebugTarget(id: "many", name: "many", kind: .goPackage($0), directory: $0) }, "main.go", count * 2 + 5),
            ("ts", ["package.json": #"{ "type": "module" }"#, "many.ts": ts],
             { DebugTarget(id: "many", name: "many", kind: .node($0.appendingPathComponent("many.ts")), directory: $0) }, "many.ts", count + 1),
        ]
        for (language, files, makeTarget, source, line) in cases {
            guard let folder = scratch("many-\(language)", files) else { continue }
            defer { try? FileManager.default.removeItem(at: folder) }
            let workspace = Workspace(root: folder)
            let debugger = Debugger(workspace: workspace, toolchain: Toolchain(workspace: workspace.root))
            debugger.removeAllBreakpoints()
            debugger.setBreakpoint(line: line, in: folder.appendingPathComponent(source))
            await debugger.start(makeTarget(folder), debugging: true)
            guard await wait(debugger, timeout: .seconds(120), { if case .paused = $0 { true } else { false } }),
                  case let .paused(_, _, frame) = debugger.state, let frame else {
                expect(false, "\(language): stops after 10,000 locals", "\(debugger.state)")
                debugger.removeAllBreakpoints()
                await debugger.stop()
                continue
            }
            let clock = ContinuousClock()
            let started = clock.now
            let scopes = await debugger.scopes(of: frame)
            let locals = await debugger.children(of: scopes.first?.reference ?? 0)
            let fetched = clock.now - started
            let summaryStart = clock.now
            let shown = locals.prefix(100).map { "\($0.name) = \($0.value)" }.count
            let summarised = clock.now - summaryStart
            expect(locals.filter { $0.name.hasPrefix("v") }.count >= count, "\(language): a stop with 10,000 locals lists them all",
                   "\(locals.count) locals")
            print("      \(language): 10,000 locals fetched in \(fetched) (\(locals.count) variables), first \(shown) rows summarised in \(summarised)")
            debugger.removeAllBreakpoints()
            await debugger.stop()
        }
    }

    func fields(in frame: DebugFrame, _ debugger: Debugger) async -> [String: DebugVariable] {
        var found: [String: DebugVariable] = [:]
        for scope in await debugger.scopes(of: frame) where !scope.isExpensive {
            for variable in await debugger.children(of: scope.reference) where found[variable.name] == nil { found[variable.name] = variable }
        }
        return found
    }
}
