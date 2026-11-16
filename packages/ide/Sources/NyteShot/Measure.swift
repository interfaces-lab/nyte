import AppKit
import Darwin

enum Measure {
    struct Footprint {
        let pid: Int32
        let name: String
        let footprint: UInt64
        let resident: UInt64
    }

    static func megabytes(_ bytes: UInt64) -> String { String(format: "%.1f MB", Double(bytes) / 1_048_576) }

    static func own() -> Footprint {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
        let result = withUnsafeMutablePointer(to: &info) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count) }
        }
        guard result == KERN_SUCCESS else { return Footprint(pid: getpid(), name: "NyteShot", footprint: 0, resident: 0) }
        return Footprint(pid: getpid(), name: "NyteShot", footprint: info.phys_footprint, resident: info.resident_size)
    }

    static func of(_ pid: Int32) -> Footprint? {
        var usage = rusage_info_v4()
        let result = withUnsafeMutablePointer(to: &usage) { pointer in
            pointer.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { proc_pid_rusage(pid, RUSAGE_INFO_V4, $0) }
        }
        guard result == 0 else { return nil }
        var name = [CChar](repeating: 0, count: Int(MAXPATHLEN))
        var path = [CChar](repeating: 0, count: Int(MAXPATHLEN) * 4)
        proc_name(pid, &name, UInt32(name.count))
        proc_pidpath(pid, &path, UInt32(path.count))
        let text = { (buffer: [CChar]) in String(decoding: buffer.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, as: UTF8.self) }
        let shown = text(path).isEmpty ? text(name) : text(path)
        return Footprint(pid: pid, name: shown, footprint: usage.ri_phys_footprint, resident: usage.ri_resident_size)
    }

    static func descendants(of pid: Int32 = getpid()) -> [Int32] {
        let capacity = 512
        var children = [Int32](repeating: 0, count: capacity)
        let bytes = proc_listchildpids(pid, &children, Int32(capacity * MemoryLayout<Int32>.size))
        let direct = Array(children.prefix(Int(max(bytes, 0))).filter { $0 > 0 })
        return direct + direct.flatMap { descendants(of: $0) }
    }

    static func children() -> [Footprint] { descendants().compactMap(of) }

    static func line(_ label: String, _ footprint: Footprint) -> String {
        "\(label): footprint \(megabytes(footprint.footprint)), resident \(megabytes(footprint.resident))"
    }

    static func secondsSinceLaunch() -> Double {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.size
        var name = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        guard sysctl(&name, u_int(name.count), &info, &size, nil, 0) == 0 else { return 0 }
        let start = info.kp_proc.p_un.__p_starttime
        let started = Double(start.tv_sec) + Double(start.tv_usec) / 1_000_000
        return Date().timeIntervalSince1970 - started
    }
}
