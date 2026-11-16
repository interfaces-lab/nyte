import AppKit
import NyteCore
import NyteDebug
@testable import NyteShell

@MainActor
enum MeasureRun {
    static let terminalLines = 360_000
    static let terminalWait = Duration.seconds(40)
    static let serverWait = Duration.seconds(20)

    static func run(_ mode: String, shell: ShellViewController, window: NSWindow, launch: (firstFrame: Double, editable: Double?)) async {
        switch mode {
        case "launch":
            print(String(format: "launch to first frame: %.0f ms", launch.firstFrame * 1000))
            print(launch.editable.map { String(format: "launch to an editable file: %.0f ms", $0 * 1000) } ?? "no file became editable")
        case "terminal":
            shell.showToolWindow(.terminal)
            shell.terminal.focusTerminal()
            await Wait.pause(.seconds(2))
            type("yes \"$(printf '%0.s=' $(seq 1 118))\" | head -n \(terminalLines); touch /tmp/nyteshot-terminal-measured\r", into: shell.terminal.view, window: window)
            await Wait.pause(terminalWait)
            report(app: "after \(terminalLines.formatted()) lines of 120 columns in the terminal")
        case "servers":
            await servers(shell)
        default:
            report(app: mode)
        }
    }

    static func report(app label: String) {
        print(Measure.line("app process, \(label)", Measure.own()))
        for child in Measure.children() { print("  child", Measure.line("\(child.pid) \(child.name)", child)) }
    }

    static func type(_ text: String, into view: NSView, window: NSWindow) {
        for character in text {
            let string = String(character)
            guard let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                               windowNumber: window.windowNumber, context: nil, characters: string,
                                               charactersIgnoringModifiers: string, isARepeat: false, keyCode: string == "\r" ? 36 : 0)
            else { continue }
            view.keyDown(with: event)
        }
    }

    static func servers(_ shell: ShellViewController) async {
        await Wait.pause(serverWait)
        _ = await shell.services.language.sampleMemory()
        for status in shell.services.language.statuses {
            print("server \(status.name): \(status.residentBytes.map { Measure.megabytes(UInt64($0)) } ?? "not sampled") as the language service samples it")
        }
        report(app: "with language servers running")
        let debugger = shell.services.debugger
        let file = shell.editor.selectedURL
        let targets = await debugger.targets(near: file)
        guard let target = targets.first(where: { if case .goTest = $0.kind { return false }; return true }) ?? targets.first else {
            return print("no debug target near \(file?.lastPathComponent ?? "nothing")")
        }
        if let file { debugger.setBreakpoint(line: firstStatement(in: file), in: file) }
        shell.start(target, debugging: true)
        let paused = await Wait.until(.seconds(60)) { if case .paused = debugger.state { return true }; return false }
        print("debugging \(target.name): \(paused ? "paused at a breakpoint" : "state \(debugger.state)")")
        report(app: "while debugging \(target.name)")
        await debugger.stop()
        debugger.removeAllBreakpoints()
    }

    static func firstStatement(in url: URL) -> Int {
        let lines = ((try? String(contentsOf: url, encoding: .utf8)) ?? "").components(separatedBy: "\n")
        if let main = lines.firstIndex(where: { $0.hasPrefix("func main()") }) { return main + 1 }
        return lines.firstIndex { $0.hasPrefix("const ") } ?? 0
    }
}
