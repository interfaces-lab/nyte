import Foundation

enum ThreadStates {
    static let described = 64
    static let depth = 12
    static let parking: Set<String> = ["runtime.gopark", "runtime.goparkunlock", "runtime.notetsleepg"]
    static let reasons: [(prefix: String, state: String)] = [
        ("runtime.chanrecv", "chan receive"), ("runtime.chansend", "chan send"), ("runtime.selectgo", "select"),
        ("time.Sleep", "sleep"), ("runtime.timeSleep", "sleep"), ("sync.(*WaitGroup).Wait", "wait group"),
        ("sync.(*Mutex).Lock", "mutex"), ("sync.(*RWMutex)", "mutex"), ("sync.(*Cond).Wait", "cond wait"),
        ("runtime.netpollblock", "I/O wait"), ("internal/poll.", "I/O wait"), ("runtime.bgsweep", "GC sweep"),
        ("runtime.bgscavenge", "GC scavenge"), ("runtime.forcegchelper", "GC idle"), ("runtime.runfinq", "finalizer wait"),
        ("runtime.gcBgMarkWorker", "GC worker"), ("os/signal.", "signal wait"),
    ]

    static func describe(_ frames: [DebugFrame], isStopped: Bool) -> (state: String, function: String) {
        let function = frames.first(where: \.isUserCode)?.function
            ?? frames.first { !$0.function.hasPrefix("runtime.") && !$0.function.hasPrefix("internal/") && !$0.isLabel }?.function
            ?? frames.first?.function ?? ""
        if isStopped { return ("paused", function) }
        guard let top = frames.first, parking.contains(top.function) else { return (frames.isEmpty ? "" : "runnable", function) }
        let reason = frames.dropFirst().lazy.compactMap { frame in
            reasons.first { frame.function.hasPrefix($0.prefix) }?.state
        }.first
        return (reason ?? "waiting", function)
    }
}
