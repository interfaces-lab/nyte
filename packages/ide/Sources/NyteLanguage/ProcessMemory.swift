import Darwin

enum ProcessMemory {
    static let childLimit = 256

    @concurrent
    static func resident(of processes: [Int32?]) async -> [Int?] {
        processes.map { $0.map(tree) }
    }

    static func tree(_ pid: Int32) -> Int {
        children(of: pid).reduce(resident(pid)) { $0 + tree($1) }
    }

    static func resident(_ pid: Int32) -> Int {
        var info = proc_taskinfo()
        let size = Int32(MemoryLayout<proc_taskinfo>.size)
        guard proc_pidinfo(pid, PROC_PIDTASKINFO, 0, &info, size) == size else { return 0 }
        return Int(info.pti_resident_size)
    }

    static func children(of pid: Int32) -> [Int32] {
        var pids = [Int32](repeating: 0, count: childLimit)
        let filled = pids.withUnsafeMutableBytes { proc_listchildpids(pid, $0.baseAddress, Int32($0.count)) }
        guard filled > 0 else { return [] }
        return pids.prefix(min(Int(filled), childLimit)).filter { $0 > 0 && $0 != pid }
    }
}
