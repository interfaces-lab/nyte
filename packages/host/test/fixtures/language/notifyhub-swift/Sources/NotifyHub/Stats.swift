struct Counts {
    var submitted = 0
    var delivered = 0
    var failed = 0
}

struct Stats {
    var total = Counts()
    var channels: [String: Counts] = [:]

    func names() -> [String] {
        channels.keys.sorted()
    }

    mutating func track(_ name: String) {
        if channels[name] == nil {
            channels[name] = Counts()
        }
    }

    mutating func add(name: String, delivered: Bool) {
        total = bump(total, delivered: delivered)
        if name.isEmpty {
            return
        }
        let current = channels[name] ?? Counts()
        channels[name] = bump(current, delivered: delivered)
    }
}

func bump(_ counts: Counts, delivered: Bool) -> Counts {
    var next = counts
    next.submitted += 1
    if delivered {
        next.delivered += 1
    } else {
        next.failed += 1
    }
    return next
}
