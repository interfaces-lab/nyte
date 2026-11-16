import Foundation
@testable import NyteCore

extension ChangesCheck {
    static let benchLines = 100_000
    static let benchRuns = 7

    static func bench() {
        var random = SeededRandom(state: 0xD1FF)
        let base = (0..<benchLines).map { "    let value\($0) = compute(\($0 % 977), \"text \($0 * 7)\")\n" }
        let old = TextLines(base.joined())
        print("diff over \(benchLines.formatted()) lines, \(old.bytes.count.formatted()) bytes, median of \(benchRuns)")
        for changes in [1, 100, 10_000] {
            var unique = base, duplicated = base
            let picks = Array((0..<benchLines).shuffled(using: &random).prefix(changes * 2))
            for pair in 0..<changes {
                unique[picks[pair]] = "    let changed = \(picks[pair])\n"
                duplicated[picks[pair]] = base[picks[changes + pair]]
            }
            for (name, lines) in [("new text", unique), ("lines copied from elsewhere", duplicated)] {
                let new = TextLines(lines.joined())
                for effort in [Diff.Effort.standard, .minimal] {
                    var times: [Duration] = []
                    var result = Diff(hunks: [], quality: .minimal)
                    for _ in 0..<benchRuns {
                        let start = ContinuousClock.now
                        result = Diff(from: old, to: new, effort: effort)
                        times.append(ContinuousClock.now - start)
                    }
                    let median = times.sorted()[benchRuns / 2]
                    print("  \(changes.formatted()) changed, \(name), \(effort == .standard ? "standard" : "minimal"): \(median.formatted(.units(allowed: [.milliseconds], fractionalPart: .show(length: 1)))), \(result.hunks.count.formatted()) hunks, \(result.quality)")
                }
            }
        }
        let start = ContinuousClock.now
        _ = TextLines(base.joined())
        print("line table over the file: \((ContinuousClock.now - start).formatted(.units(allowed: [.milliseconds], fractionalPart: .show(length: 1))))")
        let a = ArraySlice(Array("        return hub.send(ctx, message, options)".utf8))
        let b = ArraySlice(Array("        return hub.broadcast(ctx, message, nil)".utf8))
        let spanStart = ContinuousClock.now
        for _ in 0..<10_000 { _ = Diff.spans(a, b) }
        print("intra-line spans: \(((ContinuousClock.now - spanStart) / 10_000).formatted(.units(allowed: [.microseconds], fractionalPart: .show(length: 1)))) a line pair")
    }
}
