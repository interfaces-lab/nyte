import Foundation

extension Diff {
    static let minimumCost = 256

    static func mark(_ classes: LineClasses, changedOld: inout [Bool], changedNew: inout [Bool], effort: Effort) -> Quality {
        let old = classes.old, new = classes.new
        var start = 0
        var oldEnd = old.count, newEnd = new.count
        while start < oldEnd, start < newEnd, old[start] == new[start] { start += 1 }
        while oldEnd > start, newEnd > start, old[oldEnd - 1] == new[newEnd - 1] {
            oldEnd -= 1
            newEnd -= 1
        }
        var inOld = [Int32](repeating: 0, count: classes.count)
        var inNew = [Int32](repeating: 0, count: classes.count)
        for line in old { inOld[Int(line)] += 1 }
        for line in new { inNew[Int(line)] += 1 }
        let minimal = effort.cost == .minimal
        let keptOld = kept(old, start..<oldEnd, others: inNew, limit: minimal ? Int.max : min(manyMatches, roughRoot(old.count)))
        let keptNew = kept(new, start..<newEnd, others: inOld, limit: minimal ? Int.max : min(manyMatches, roughRoot(new.count)))
        var a: [Int32] = [], b: [Int32] = [], mapA: [Int32] = [], mapB: [Int32] = []
        for line in start..<oldEnd {
            if keptOld[line - start] {
                a.append(old[line])
                mapA.append(Int32(line))
            } else {
                changedOld[line + 1] = true
            }
        }
        for line in start..<newEnd {
            if keptNew[line - start] {
                b.append(new[line])
                mapB.append(Int32(line))
            } else {
                changedNew[line + 1] = true
            }
        }
        let limit: Int? = switch effort.cost {
        case .minimal: nil
        case .scaled: max(minimumCost, roughRoot(a.count + b.count + 3))
        case let .bounded(cost): max(1, cost)
        }
        var myers = Myers(a: a, b: b, costLimit: limit, workLimit: effort.workLimit)
        guard myers.run() else {
            for line in start..<oldEnd { changedOld[line + 1] = true }
            for line in start..<newEnd { changedNew[line + 1] = true }
            return .wholeFile
        }
        for index in 0..<a.count where myers.changedA[index] { changedOld[Int(mapA[index]) + 1] = true }
        for index in 0..<b.count where myers.changedB[index] { changedNew[Int(mapB[index]) + 1] = true }
        return myers.usedHeuristic ? .approximate : .minimal
    }

    static let manyMatches = 1_024
    static let scanWindow = 100
    static let keepRun = 4

    // git: the line filter of xdiff's xdl_cleanup_records and xdl_clean_mmatch, which --minimal skips, so ties break as git's do
    static func kept(_ lines: [Int32], _ range: Range<Int>, others: [Int32], limit: Int) -> [Bool] {
        let marks: [UInt8] = range.map { line in
            let matches = Int(others[Int(lines[line])])
            return matches == 0 ? 0 : (matches >= limit ? 2 : 1)
        }
        return marks.indices.map { index in
            switch marks[index] {
            case 1: true
            case 2: !lonelyMany(marks, index)
            default: false
            }
        }
    }

    static func lonelyMany(_ marks: [UInt8], _ index: Int) -> Bool {
        let low = max(0, index - scanWindow), high = min(marks.count - 1, index + scanWindow)
        var unmatchedBefore = 0, manyBefore = 1
        var probe = index - 1
        while probe >= low {
            if marks[probe] == 0 { unmatchedBefore += 1 } else if marks[probe] == 2 { manyBefore += 1 } else { break }
            probe -= 1
        }
        guard unmatchedBefore > 0 else { return false }
        var unmatchedAfter = 0, manyAfter = 1
        probe = index + 1
        while probe <= high {
            if marks[probe] == 0 { unmatchedAfter += 1 } else if marks[probe] == 2 { manyAfter += 1 } else { break }
            probe += 1
        }
        guard unmatchedAfter > 0 else { return false }
        let unmatched = unmatchedBefore + unmatchedAfter, many = manyBefore + manyAfter
        return many * keepRun < many + unmatched
    }

    static func roughRoot(_ value: Int) -> Int {
        var result = 1
        var rest = value
        while rest > 0 {
            result <<= 1
            rest >>= 2
        }
        return result
    }

    struct Myers {
        let a: [Int32]
        let b: [Int32]
        let costLimit: Int?
        var work: Int
        var changedA: [Bool]
        var changedB: [Bool]
        var usedHeuristic = false
        private var forward: [Int]
        private var backward: [Int]
        private let offset: Int

        init(a: [Int32], b: [Int32], costLimit: Int?, workLimit: Int) {
            self.a = a
            self.b = b
            self.costLimit = costLimit
            work = workLimit
            changedA = [Bool](repeating: false, count: a.count)
            changedB = [Bool](repeating: false, count: b.count)
            forward = [Int](repeating: 0, count: a.count + b.count + 3)
            backward = [Int](repeating: 0, count: a.count + b.count + 3)
            offset = b.count + 1
        }

        mutating func run() -> Bool {
            var pending = [(0, a.count, 0, b.count)]
            while var (off1, lim1, off2, lim2) = pending.popLast() {
                while off1 < lim1, off2 < lim2, a[off1] == b[off2] {
                    off1 += 1
                    off2 += 1
                }
                while off1 < lim1, off2 < lim2, a[lim1 - 1] == b[lim2 - 1] {
                    lim1 -= 1
                    lim2 -= 1
                }
                if off1 == lim1 {
                    for index in off2..<lim2 { changedB[index] = true }
                } else if off2 == lim2 {
                    for index in off1..<lim1 { changedA[index] = true }
                } else {
                    guard let middle = split(off1, lim1, off2, lim2) else { return false }
                    pending.append((middle.0, lim1, middle.1, lim2))
                    pending.append((off1, middle.0, off2, middle.1))
                }
            }
            return true
        }

        private enum Split {
            case found(Int, Int)
            case estimated(Int, Int)
            case exhausted
        }

        private mutating func split(_ off1: Int, _ lim1: Int, _ off2: Int, _ lim2: Int) -> (Int, Int)? {
            let a = self.a, b = self.b, offset = self.offset, costLimit = self.costLimit, budget = work
            var spent = 0
            let answer: Split = forward.withUnsafeMutableBufferPointer { forward in
                backward.withUnsafeMutableBufferPointer { backward in
                    a.withUnsafeBufferPointer { a in
                        b.withUnsafeBufferPointer { b in
                            let dmin = off1 - lim2, dmax = lim1 - off2
                            let fmid = off1 - off2, bmid = lim1 - lim2
                            let odd = (fmid - bmid) & 1 != 0
                            var fmin = fmid, fmax = fmid, bmin = bmid, bmax = bmid
                            forward[fmid + offset] = off1
                            backward[bmid + offset] = lim1
                            var cost = 1
                            while true {
                                if fmin > dmin { fmin -= 1; forward[fmin - 1 + offset] = -1 } else { fmin += 1 }
                                if fmax < dmax { fmax += 1; forward[fmax + 1 + offset] = -1 } else { fmax -= 1 }
                                var d = fmax
                                while d >= fmin {
                                    let below = forward[d - 1 + offset], above = forward[d + 1 + offset]
                                    let start = below >= above ? below + 1 : above
                                    var i1 = start
                                    var i2 = i1 - d
                                    while i1 < lim1, i2 < lim2, a[i1] == b[i2] {
                                        i1 += 1
                                        i2 += 1
                                    }
                                    spent += 1 + i1 - start
                                    forward[d + offset] = i1
                                    if odd, bmin <= d, d <= bmax, backward[d + offset] <= i1 { return .found(i1, i2) }
                                    d -= 2
                                }
                                if bmin > dmin { bmin -= 1; backward[bmin - 1 + offset] = Int.max } else { bmin += 1 }
                                if bmax < dmax { bmax += 1; backward[bmax + 1 + offset] = Int.max } else { bmax -= 1 }
                                d = bmax
                                while d >= bmin {
                                    let below = backward[d - 1 + offset], above = backward[d + 1 + offset]
                                    let start = below < above ? below : above - 1
                                    var i1 = start
                                    var i2 = i1 - d
                                    while i1 > off1, i2 > off2, a[i1 - 1] == b[i2 - 1] {
                                        i1 -= 1
                                        i2 -= 1
                                    }
                                    spent += 1 + start - i1
                                    backward[d + offset] = i1
                                    if !odd, fmin <= d, d <= fmax, i1 <= forward[d + offset] { return .found(i1, i2) }
                                    d -= 2
                                }
                                if spent > budget { return .exhausted }
                                if let costLimit, cost >= costLimit {
                                    var best = -1, best1 = -1
                                    d = fmax
                                    while d >= fmin {
                                        var i1 = min(forward[d + offset], lim1)
                                        var i2 = i1 - d
                                        if lim2 < i2 { i1 = lim2 + d; i2 = lim2 }
                                        if best < i1 + i2 { best = i1 + i2; best1 = i1 }
                                        d -= 2
                                    }
                                    var low = Int.max, low1 = Int.max
                                    d = bmax
                                    while d >= bmin {
                                        var i1 = max(off1, backward[d + offset])
                                        var i2 = i1 - d
                                        if i2 < off2 { i1 = off2 + d; i2 = off2 }
                                        if i1 + i2 < low { low = i1 + i2; low1 = i1 }
                                        d -= 2
                                    }
                                    if (lim1 + lim2) - low < best - (off1 + off2) { return .estimated(best1, best - best1) }
                                    return .estimated(low1, low - low1)
                                }
                                cost += 1
                            }
                        }
                    }
                }
            }
            work -= spent
            switch answer {
            case let .found(i1, i2): return (i1, i2)
            case let .estimated(i1, i2):
                usedHeuristic = true
                return (i1, i2)
            case .exhausted: return nil
            }
        }
    }

    static func compact(_ records: [Int32], _ changed: inout [Bool], against other: [Bool]) {
        let count = records.count
        let otherCount = other.count - 2
        var group = (start: 0, end: 0)
        var otherGroup = (start: 0, end: 0)
        while changed[group.end + 1] { group.end += 1 }
        while other[otherGroup.end + 1] { otherGroup.end += 1 }

        func slideDown(_ group: inout (start: Int, end: Int), _ changed: inout [Bool]) -> Bool {
            guard group.end < count, records[group.start] == records[group.end] else { return false }
            changed[group.start + 1] = false
            group.start += 1
            changed[group.end + 1] = true
            group.end += 1
            while changed[group.end + 1] { group.end += 1 }
            return true
        }
        func slideUp(_ group: inout (start: Int, end: Int), _ changed: inout [Bool]) -> Bool {
            guard group.start > 0, records[group.start - 1] == records[group.end - 1] else { return false }
            group.start -= 1
            changed[group.start + 1] = true
            group.end -= 1
            changed[group.end + 1] = false
            while changed[group.start] { group.start -= 1 }
            return true
        }
        func next(_ group: inout (start: Int, end: Int), _ changed: [Bool], _ limit: Int) -> Bool {
            guard group.end < limit else { return false }
            group.start = group.end + 1
            group.end = group.start
            while changed[group.end + 1] { group.end += 1 }
            return true
        }
        func previous(_ group: inout (start: Int, end: Int), _ changed: [Bool]) -> Bool {
            guard group.start > 0 else { return false }
            group.end = group.start - 1
            group.start = group.end
            while changed[group.start] { group.start -= 1 }
            return true
        }

        while true {
            if group.end != group.start {
                var size = 0
                var earliestEnd = 0
                var matchingEnd = -1
                repeat {
                    size = group.end - group.start
                    matchingEnd = -1
                    while slideUp(&group, &changed) {
                        guard previous(&otherGroup, other) else { return assertionFailure("diff groups lost sync sliding up") }
                    }
                    earliestEnd = group.end
                    if otherGroup.end > otherGroup.start { matchingEnd = group.end }
                    while slideDown(&group, &changed) {
                        guard next(&otherGroup, other, otherCount) else {
                            return assertionFailure("diff groups lost sync sliding down")
                        }
                        if otherGroup.end > otherGroup.start { matchingEnd = group.end }
                    }
                } while size != group.end - group.start
                if group.end != earliestEnd, matchingEnd != -1 {
                    while otherGroup.end == otherGroup.start {
                        guard slideUp(&group, &changed), previous(&otherGroup, other) else {
                            return assertionFailure("diff groups lost sync aligning")
                        }
                    }
                }
            }
            guard next(&group, changed, count) else { return }
            guard next(&otherGroup, other, otherCount) else { return assertionFailure("diff groups lost sync moving on") }
        }
    }
}
