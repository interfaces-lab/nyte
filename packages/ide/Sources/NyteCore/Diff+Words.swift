import Foundation

extension Diff {
    enum Words {
        static let longestLine = 4_000
        static let workLimit = 2_000_000
        static let leastShared = 0.3

        enum Kind: UInt8 { case word, space, mark }

        struct Tokens {
            var starts: [Int32] = []
            var ends: [Int32] = []
            var kinds: [Kind] = []
            var classes: [Int32] = []
        }

        static func spans(_ old: ArraySlice<UInt8>, _ new: ArraySlice<UInt8>) -> DiffSpans? {
            guard old.count <= longestLine, new.count <= longestLine else { return nil }
            var vocabulary: [ArraySlice<UInt8>: Int32] = [:]
            let left = tokens(old, &vocabulary), right = tokens(new, &vocabulary)
            var myers = Myers(a: left.classes, b: right.classes, costLimit: nil, workLimit: workLimit)
            guard myers.run() else { return nil }
            let shared = solidBytes(left, keeping: myers.changedA)
            let total = max(solidBytes(left, keeping: nil), solidBytes(right, keeping: nil))
            if total > 0, Double(shared) / Double(total) < leastShared { return nil }
            return DiffSpans(removed: ranges(left, myers.changedA), added: ranges(right, myers.changedB))
        }

        static func tokens(_ bytes: ArraySlice<UInt8>, _ vocabulary: inout [ArraySlice<UInt8>: Int32]) -> Tokens {
            var tokens = Tokens()
            var index = bytes.startIndex
            while index < bytes.endIndex {
                let kind = kind(of: bytes[index])
                var end = index + 1
                if kind != .mark {
                    while end < bytes.endIndex, Self.kind(of: bytes[end]) == kind { end += 1 }
                }
                let piece = bytes[index..<end]
                let id: Int32
                if let known = vocabulary[piece] {
                    id = known
                } else {
                    id = Int32(vocabulary.count)
                    vocabulary[piece] = id
                }
                tokens.starts.append(Int32(index - bytes.startIndex))
                tokens.ends.append(Int32(end - bytes.startIndex))
                tokens.kinds.append(kind)
                tokens.classes.append(id)
                index = end
            }
            return tokens
        }

        static func kind(of byte: UInt8) -> Kind {
            switch byte {
            case UInt8(ascii: " "), UInt8(ascii: "\t"): .space
            case UInt8(ascii: "a")...UInt8(ascii: "z"), UInt8(ascii: "A")...UInt8(ascii: "Z"), UInt8(ascii: "0")...UInt8(ascii: "9"),
                 UInt8(ascii: "_"), 0x80...0xFF: .word
            default: .mark
            }
        }

        static func solidBytes(_ tokens: Tokens, keeping changed: [Bool]?) -> Int {
            var total = 0
            for index in tokens.kinds.indices where tokens.kinds[index] != .space && changed?[index] != true {
                total += Int(tokens.ends[index] - tokens.starts[index])
            }
            return total
        }

        static func ranges(_ tokens: Tokens, _ changed: [Bool]) -> [Range<Int>] {
            var ranges: [Range<Int>] = []
            var index = 0
            while index < changed.count {
                guard changed[index] else {
                    index += 1
                    continue
                }
                let start = Int(tokens.starts[index])
                var end = Int(tokens.ends[index])
                index += 1
                while index < changed.count {
                    if changed[index] {
                        end = Int(tokens.ends[index])
                        index += 1
                    } else if tokens.kinds[index] == .space, index + 1 < changed.count, changed[index + 1] {
                        end = Int(tokens.ends[index + 1])
                        index += 2
                    } else {
                        break
                    }
                }
                ranges.append(start..<end)
            }
            return ranges
        }
    }
}
