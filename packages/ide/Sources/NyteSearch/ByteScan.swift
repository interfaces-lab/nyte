import Darwin
import Foundation

typealias Lanes = SIMD32<UInt8>

enum ByteScan {
    static let width = Lanes.scalarCount
    static let newline = UInt8(ascii: "\n")

    static func load(_ base: UnsafePointer<UInt8>, _ offset: Int) -> Lanes {
        UnsafeRawPointer(base + offset).loadUnaligned(as: Lanes.self)
    }

    static func countNewlines(_ base: UnsafePointer<UInt8>, from start: Int, to end: Int) -> Int {
        var total = 0
        var index = start
        let splat = Lanes(repeating: newline)
        let one = Lanes(repeating: 1)
        let zero = Lanes(repeating: 0)
        while index + width <= end {
            var sum = zero
            var rounds = 0
            while rounds < 255, index + width <= end {
                sum &+= zero.replacing(with: one, where: load(base, index) .== splat)
                index += width
                rounds += 1
            }
            total += Int(SIMD32<UInt16>(truncatingIfNeeded: sum).wrappedSum())
        }
        while index < end {
            if base[index] == newline { total += 1 }
            index += 1
        }
        return total
    }

    static func lastNewline(_ base: UnsafePointer<UInt8>, before end: Int, notBefore start: Int) -> Int? {
        var index = end - 1
        while index >= start {
            if base[index] == newline { return index }
            index -= 1
        }
        return nil
    }

    static func nextNewline(_ base: UnsafePointer<UInt8>, from start: Int, count: Int) -> Int {
        guard start < count, let found = memchr(base + start, Int32(newline), count - start) else { return count }
        return base.distance(to: found.assumingMemoryBound(to: UInt8.self))
    }

    static func utf16Count(_ base: UnsafePointer<UInt8>, from start: Int, to end: Int) -> Int {
        var units = 0
        var index = start
        while index < end {
            let byte = base[index]
            if byte & 0xC0 != 0x80 { units += 1 }
            if byte >= 0xF0 { units += 1 }
            index += 1
        }
        return units
    }

    static func isBinary(_ base: UnsafePointer<UInt8>, count: Int) -> Bool {
        memchr(base, 0, min(count, 8192)) != nil
    }

    static func rarity(_ byte: UInt8) -> Int {
        Int(frequency[Int(byte)])
    }

    private static let frequency: [UInt8] = {
        var table = [UInt8](repeating: 40, count: 256)
        for byte in 0x80...0xBF { table[byte] = 70 }
        for byte in 0xC2...0xF4 { table[byte] = 60 }
        let ranked: [(String, UInt8)] = [
            (" ", 255), ("\n", 240), ("\t", 200), ("e", 235), ("t", 228), ("a", 222), ("o", 216), ("i", 215), ("n", 214),
            ("s", 213), ("r", 212), ("l", 206), ("c", 202), ("d", 200), ("h", 198), ("u", 196), ("p", 190), ("m", 190),
            ("f", 186), ("g", 182), ("b", 175), ("y", 172), ("w", 170), ("v", 160), ("k", 156), ("x", 145), ("j", 130),
            ("q", 118), ("z", 118), (".", 195), (",", 188), ("(", 186), (")", 186), ("=", 186), ("\"", 180), ("/", 178),
            (":", 175), ("-", 175), ("_", 170), (";", 165), ("{", 165), ("}", 165), ("'", 160), ("<", 150), (">", 150),
            ("[", 150), ("]", 150), ("*", 148), ("0", 165), ("1", 160), ("2", 150), ("3", 140), ("4", 135), ("5", 135),
            ("6", 130), ("7", 128), ("8", 130), ("9", 128), ("#", 130), ("&", 125), ("!", 125), ("+", 130), ("|", 115),
            ("\\", 120), ("$", 110), ("@", 108), ("?", 112), ("%", 105), ("`", 105), ("\r", 100), ("^", 80), ("~", 80),
            ("E", 135), ("T", 135), ("S", 135), ("A", 132), ("I", 130), ("C", 130), ("R", 128), ("N", 128), ("O", 126),
            ("D", 125), ("L", 125), ("P", 124), ("M", 124), ("F", 120), ("U", 118), ("B", 118), ("H", 115), ("G", 115),
            ("V", 110), ("W", 110), ("K", 105), ("Y", 100), ("X", 100), ("J", 95), ("Q", 90), ("Z", 90),
        ]
        for (character, rank) in ranked { table[Int(character.utf8.first ?? 0)] = rank }
        return table
    }()
}

struct LiteralScanner: Sendable {
    let needle: [UInt8]
    let foldsCase: Bool
    private let first: Int
    private let second: Int
    private let firstByte: UInt8
    private let secondByte: UInt8
    private let firstFold: UInt8
    private let secondFold: UInt8

    init(_ bytes: [UInt8], foldsCase: Bool) {
        self.foldsCase = foldsCase
        needle = foldsCase ? bytes.map(Self.lower) : bytes
        let lowered = needle
        func cost(_ index: Int) -> Int {
            let byte = lowered[index]
            guard foldsCase, Self.isLetter(byte) else { return ByteScan.rarity(byte) }
            return ByteScan.rarity(byte) + ByteScan.rarity(byte - 32) / 2
        }
        let folded = needle
        let ranked = folded.indices.sorted { cost($0) < cost($1) }
        let rarest = ranked.first ?? 0
        let next = ranked.dropFirst().first { folded[$0] != folded[rarest] } ?? ranked.dropFirst().first ?? rarest
        first = rarest
        second = next
        let fold = { (byte: UInt8) -> UInt8 in foldsCase && Self.isLetter(byte) ? 0x20 : 0 }
        firstByte = folded.isEmpty ? 0 : folded[rarest]
        secondByte = folded.isEmpty ? 0 : folded[next]
        firstFold = folded.isEmpty ? 0 : fold(folded[rarest])
        secondFold = folded.isEmpty ? 0 : fold(folded[next])
    }

    static func lower(_ byte: UInt8) -> UInt8 { byte >= 0x41 && byte <= 0x5A ? byte | 0x20 : byte }
    static func isLetter(_ byte: UInt8) -> Bool { (byte | 0x20) >= 0x61 && (byte | 0x20) <= 0x7A }

    func find(_ base: UnsafePointer<UInt8>, count: Int, from start: Int) -> Int? {
        let length = needle.count
        guard length > 0, count - start >= length else { return nil }
        let last = count - length
        var index = start
        let reach = max(first, second) + ByteScan.width
        if index + reach <= count {
            let a = Lanes(repeating: firstByte), b = Lanes(repeating: secondByte)
            let foldA = Lanes(repeating: firstFold), foldB = Lanes(repeating: secondFold)
            let base1 = base + first, base2 = base + second
            while index + reach <= count {
                let hits = (ByteScan.load(base1, index) | foldA .== a) .& (ByteScan.load(base2, index) | foldB .== b)
                if any(hits) {
                    for lane in 0..<ByteScan.width where hits[lane] {
                        let candidate = index + lane
                        if candidate <= last, verify(base, at: candidate) { return candidate }
                    }
                }
                index += ByteScan.width
            }
        }
        while index <= last {
            if Self.fold(base[index + first], firstFold) == firstByte, verify(base, at: index) { return index }
            index += 1
        }
        return nil
    }

    private static func fold(_ byte: UInt8, _ mask: UInt8) -> UInt8 { byte | mask }

    func verify(_ base: UnsafePointer<UInt8>, at index: Int) -> Bool {
        needle.withUnsafeBufferPointer { wanted in
            guard foldsCase else { return memcmp(base + index, wanted.baseAddress, wanted.count) == 0 }
            for offset in 0..<wanted.count where Self.lower(base[index + offset]) != wanted[offset] { return false }
            return true
        }
    }
}
