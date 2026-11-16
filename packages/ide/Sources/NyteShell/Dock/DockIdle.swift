import Darwin
import Foundation

enum DockIdle {
    struct Facts: Equatable, Sendable {
        var shown: ToolWindowID?
        var hasForegroundJob: Bool
        var problemCount: Int
        var isDebugging: Bool
    }

    static func isIdle(_ facts: Facts) -> Bool {
        guard !facts.isDebugging else { return false }
        return switch facts.shown {
        case .terminal, .folderTerminal, .run: !facts.hasForegroundJob
        case .problems: facts.problemCount == 0
        case .search, .find, .debug, nil: false
        }
    }
}

enum ReviewLayout: Equatable, Sendable {
    case normal
    case collapsedDock
    case focused(restoresSidebar: Bool, restoresDock: Bool)

    static func entering(isDockOpen: Bool, dockIdle: Bool) -> ReviewLayout {
        isDockOpen && dockIdle ? .collapsedDock : .normal
    }
}

enum ForegroundJobs {
    static func anyRunning(under parent: Int32 = getpid()) -> Bool {
        terminalShells(under: parent).contains { info in info.e_tpgid > 0 && UInt32(info.e_tpgid) != info.pbi_pgid }
    }

    private static func terminalShells(under parent: Int32) -> [proc_bsdinfo] {
        let capacity = 256
        var children = [Int32](repeating: 0, count: capacity)
        let count = proc_listchildpids(parent, &children, Int32(capacity * MemoryLayout<Int32>.size))
        return children.prefix(Int(max(count, 0))).compactMap { pid -> proc_bsdinfo? in
            var info = proc_bsdinfo()
            let size = Int32(MemoryLayout<proc_bsdinfo>.size)
            guard pid > 0, proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size, info.e_tdev != UInt32.max else { return nil }
            return info
        }
    }
}
