import Darwin
import Foundation
import Synchronization
@testable import NyteTerminal

extension TerminalCheck {
    struct Usage {
        var footprint: Int
        var threads: Int
        var descriptors: Int
        var children: Int

        static func now() -> Usage {
            _ = malloc_zone_pressure_relief(nil, 0)
            var info = task_vm_info_data_t()
            var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
            let result = withUnsafeMutablePointer(to: &info) {
                $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count) }
            }
            var threads: thread_act_array_t?
            var threadCount: mach_msg_type_number_t = 0
            if task_threads(mach_task_self_, &threads, &threadCount) == KERN_SUCCESS, let threads {
                for index in 0 ..< Int(threadCount) { mach_port_deallocate(mach_task_self_, threads[index]) }
                vm_deallocate(mach_task_self_, vm_address_t(UInt(bitPattern: threads)),
                              vm_size_t(Int(threadCount) * MemoryLayout<thread_act_t>.stride))
            }
            let descriptors = (try? FileManager.default.contentsOfDirectory(atPath: "/dev/fd").count) ?? 0
            var pids = [pid_t](repeating: 0, count: 256)
            let found = pids.withUnsafeMutableBytes { proc_listchildpids(getpid(), $0.baseAddress, Int32($0.count)) }
            return Usage(footprint: result == KERN_SUCCESS ? Int(info.phys_footprint) : 0, threads: Int(threadCount),
                         descriptors: descriptors, children: Int(max(found, 0)))
        }
    }

    final class WeakSession {
        weak var session: TerminalSession?

        init(_ session: TerminalSession) { self.session = session }
    }

    func manyTerminals() async {
        let count = 20
        let megabyte = 1_048_576.0
        for lines in [1_000, 10_000] {
            let base = Usage.now()
            var opened: [(TerminalSession, TerminalScreen)] = []
            for _ in 0 ..< count { opened.append(open(scrollback: lines)) }
            let prompts = await until(30) {
                for (session, _) in opened { session.enqueue { $0.produceFrame() } }
                return opened.allSatisfy { $0.1.lines.contains { $0.hasPrefix("probe$") } }
            }
            for (session, _) in opened { session.enqueue { $0.text("seq 1 12000\r") } }
            let filled = await until(60) {
                for (session, _) in opened { session.enqueue { $0.produceFrame() } }
                return opened.allSatisfy { $0.1.lines.contains("12000") }
            }
            let open = Usage.now()
            let exits = opened.compactMap { $0.1.state.withLock { $0.exit } }
            if !exits.isEmpty { print("      exited early: \(exits)") }
            let weak = opened.map { WeakSession($0.0) }
            print(String(format: "      %d terminals with %d lines of scrollback: %.1f MB each, %d descriptors each, %d threads in all, %d children",
                         count, lines, Double(open.footprint - base.footprint) / megabyte / Double(count),
                         (open.descriptors - base.descriptors) / count, open.threads - base.threads, open.children - base.children))
            expect(prompts && filled && open.children - base.children == count,
                   "\(count) terminals with \(lines) lines of scrollback start and fill", "\(open.children - base.children) children")
            for (session, _) in opened { session.enqueue { $0.shutdown() } }
            opened = []
            let released = await until(10) {
                let now = Usage.now()
                return now.children <= base.children && weak.allSatisfy { $0.session == nil } && now.descriptors <= base.descriptors
            }
            let closed = Usage.now()
            print(String(format: "      after closing: %+.1f MB against before, %+d descriptors, %+d threads, %d children left",
                         Double(closed.footprint - base.footprint) / megabyte, closed.descriptors - base.descriptors,
                         closed.threads - base.threads, closed.children - base.children))
            let grown = max(open.footprint - base.footprint, 1)
            expect(released && closed.footprint - base.footprint < grown / 4,
                   "closing \(count) terminals releases their children, PTYs, sessions and scrollback",
                   "children \(closed.children - base.children), descriptors \(closed.descriptors - base.descriptors), "
                       + "live sessions \(weak.filter { $0.session != nil }.count)")
        }
    }

    private func open(scrollback: Int) -> (TerminalSession, TerminalScreen) {
        let base = TerminalViewController.shellLaunch(shell: "/bin/zsh", directory: NSTemporaryDirectory())
        let launch = ShellLaunch(path: "/bin/zsh", arguments: ["-f", "-i"], environment: base.environment + ["PS1=probe$ ", "RPS1="],
                                 directory: base.directory)
        let screen = TerminalScreen()
        let session = TerminalSession(events: screen.events, preferences: TerminalPreferences(scrollbackLines: scrollback)) {
            LocalPTYBackend(launch: launch)
        }
        let grid = Self.grid
        let colors = Self.colors
        session.enqueue { $0.start(grid: grid, colors: colors) }
        return (session, screen)
    }
}
