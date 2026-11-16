import Darwin
import Foundation
import NyteCore
import NyteDebug

extension DebugCheck {
    struct Loop {
        var language: String
        var files: [String: String]
        var source: String
        var tickLine: Int
        var callLine: Int
        var inTick: @Sendable (DebugFrame) -> Bool
        var outside: @Sendable (DebugFrame) -> Bool
        var target: @Sendable (URL) -> DebugTarget

        static let go = Loop(
            language: "go", files: ["go.mod": "module example.com/loop\n\ngo 1.22\n"], source: "main.go", tickLine: 13, callLine: 7,
            inTick: { $0.function == "main.tick" }, outside: { $0.function == "main.main" },
            target: { DebugTarget(id: "loop", name: "loop", kind: .goPackage($0), directory: $0) }
        )
        static let typescript = Loop(
            language: "ts", files: ["package.json": #"{ "type": "module" }"#], source: "loop.ts", tickLine: 1, callLine: 7,
            inTick: { $0.function == "tick" }, outside: { $0.function != "tick" && (7...8).contains($0.line) },
            target: { DebugTarget(id: "loop", name: "loop", kind: .node($0.appendingPathComponent("loop.ts")), directory: $0) }
        )

        var program: String {
            language == "go" ? DebugCheck.goLoop : DebugCheck.typeScriptLoop
        }
    }

    nonisolated static let goLoop = """
    package main

    import "fmt"
    import "time"

    func main() {
    \tfor i := 0; i < 6000; i++ {
    \t\ttick(i)
    \t\ttime.Sleep(5 * time.Millisecond)
    \t}
    }

    func tick(i int) {
    \tif i%100 == 0 {
    \t\tfmt.Println("tick", i)
    \t}
    }

    """

    nonisolated static let typeScriptLoop = """
    function tick(i: number): void {
      if (i % 100 === 0) {
        console.log("tick", i);
      }
    }

    for (let i = 0; i < 6000; i++) {
      tick(i);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    """

    func scratch(_ name: String, _ files: [String: String]) -> URL? {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-dap-\(name)-\(getpid())")
        try? FileManager.default.removeItem(at: folder)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            for (file, text) in files { try text.write(to: folder.appendingPathComponent(file), atomically: true, encoding: .utf8) }
        } catch {
            expect(false, "\(name): scratch fixture", "\(error)")
            return nil
        }
        return folder
    }

    func controls(_ loop: Loop) async {
        let name = "controls \(loop.language)"
        guard let folder = scratch("loop-\(loop.language)", loop.files.merging([loop.source: loop.program]) { $1 }) else { return }
        defer { try? FileManager.default.removeItem(at: folder) }
        let main = folder.appendingPathComponent(loop.source)
        let workspace = Workspace(root: folder)
        let debugger = Debugger(workspace: workspace, toolchain: Toolchain(workspace: workspace.root))
        debugger.removeAllBreakpoints()
        defer { debugger.removeAllBreakpoints() }
        let target = loop.target(folder)
        let isPaused: (Debugger.State) -> Bool = { if case .paused = $0 { true } else { false } }
        let isRunning: (Debugger.State) -> Bool = { $0 == .running }

        await debugger.start(target, debugging: true)
        guard await wait(debugger, isRunning) else { return expect(false, "\(name): the loop starts running", "\(debugger.state)") }
        guard await Patience.pause(.milliseconds(300)) else { return }
        await debugger.pause()
        let paused = await wait(debugger, timeout: .seconds(10), isPaused)
        expect(paused, "\(name): pause() stops a running program", "\(debugger.state)")

        await debugger.resume()
        _ = await wait(debugger, timeout: .seconds(10), isRunning)
        expect(debugger.state == .running, "\(name): continue runs the paused program again", "\(debugger.state)")
        debugger.toggleBreakpoint(line: loop.tickLine, in: main)
        let hit = await wait(debugger, timeout: .seconds(10)) { state in
            if case let .paused(_, _, frame) = state { frame?.line == loop.tickLine } else { false }
        }
        expect(hit, "\(name): a breakpoint toggled on while running stops at \(loop.source):\(loop.tickLine + 1)", "\(debugger.state)")

        await debugger.stepOver()
        let over = await wait(debugger, timeout: .seconds(10)) { state in
            if case let .paused(_, _, frame) = state { frame.map(loop.inTick) == true && frame?.line ?? 0 > loop.tickLine } else { false }
        }
        expect(over, "\(name): step over moves down inside tick", "\(debugger.state)")

        debugger.toggleBreakpoint(line: loop.tickLine, in: main)
        await debugger.resume()
        guard await Patience.pause(.milliseconds(500)) else { return }
        expect(debugger.state == .running && debugger.breakpoints(in: main).isEmpty,
               "\(name): a breakpoint toggled off no longer stops the program", "\(debugger.state)")

        await debugger.pause()
        guard await wait(debugger, timeout: .seconds(10), isPaused) else { return expect(false, "\(name): pause again", "\(debugger.state)") }
        await debugger.runToLine(loop.callLine, in: main)
        let reached = await wait(debugger, timeout: .seconds(10)) { state in
            if case let .paused(_, _, frame) = state { frame?.line == loop.callLine } else { false }
        }
        expect(reached, "\(name): run to cursor stops at \(loop.source):\(loop.callLine + 1)", "\(debugger.state)")

        await debugger.stepInto()
        let into = await wait(debugger, timeout: .seconds(10)) { state in
            if case let .paused(_, _, frame) = state { frame.map(loop.inTick) == true } else { false }
        }
        expect(into, "\(name): step into enters tick", "\(debugger.state)")

        await debugger.stepOut()
        let out = await wait(debugger, timeout: .seconds(10)) { state in
            if case let .paused(_, _, frame) = state { frame.map(loop.outside) == true } else { false }
        }
        expect(out, "\(name): step out returns to the caller", "\(debugger.state)")

        await debugger.resume()
        guard await Patience.pause(.milliseconds(500)) else { return }
        expect(debugger.state == .running, "\(name): the run-to-cursor breakpoint is gone once it was reached", "\(debugger.state)")

        let before = await debugger.processIdentifiers()
        await debugger.restart()
        let restarted = await wait(debugger, isRunning)
        let after = await debugger.processIdentifiers()
        let leftover = await living(before)
        expect(restarted && Set(before).isDisjoint(with: after) && leftover.isEmpty,
               "\(name): restart replaces the adapter and debuggee and leaves none of the old ones",
               "\(debugger.state) before \(before) after \(after) alive \(leftover)")
        await debugger.pause()
        expect(await wait(debugger, timeout: .seconds(10), isPaused), "\(name): the restarted program pauses",
               "\(debugger.state) threads \(debugger.threads) \(debugger.output.filter { $0.category == .console }.map(\.text))")

        await debugger.stop()
        let alive = await living(after)
        expect(alive.isEmpty, "\(name): stop leaves no process", "alive: \(alive)")

        let starting = Task { await debugger.start(target, debugging: true) }
        _ = await wait(debugger, timeout: .seconds(10)) { if case .starting = $0 { true } else { false } }
        let caught = if case .starting = debugger.state { true } else { false }
        await debugger.stop()
        await starting.value
        let cancelled = await wait(debugger, timeout: .seconds(10)) { if case .ended = $0 { true } else { false } }
        guard await Patience.pause(.milliseconds(500)) else { return }
        let late = await debugger.processIdentifiers()
        expect(caught && cancelled && late.isEmpty && debugger.state != .running,
               "\(name): stop while starting ends the session and leaves nothing running", "\(debugger.state) pids \(late)")
    }
}
