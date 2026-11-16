import Foundation

enum CaseFolding {
    static let dotlessI: Unicode.Scalar = "\u{0131}"

    static func key(_ scalar: Unicode.Scalar) -> Unicode.Scalar {
        guard scalar != dotlessI else { return scalar }
        let upper = single(scalar.properties.uppercaseMapping) ?? scalar
        return single(upper.properties.lowercaseMapping) ?? single(scalar.properties.lowercaseMapping) ?? scalar
    }

    static func equivalents(_ scalar: Unicode.Scalar) -> [Unicode.Scalar] {
        var found: [Unicode.Scalar] = [scalar]
        var frontier: [Unicode.Scalar] = [scalar]
        while let next = frontier.popLast() {
            let properties = next.properties
            let candidates = [properties.lowercaseMapping, properties.uppercaseMapping, properties.titlecaseMapping]
                .compactMap(single) + (extras[key(next)] ?? []) + [key(next)]
            for candidate in candidates where !found.contains(candidate) && key(candidate) == key(scalar) {
                found.append(candidate)
                frontier.append(candidate)
            }
        }
        return found.sorted { $0.value < $1.value }
    }

    private static func single(_ mapping: String) -> Unicode.Scalar? {
        var scalars = mapping.unicodeScalars.makeIterator()
        guard let first = scalars.next(), scalars.next() == nil else { return nil }
        return first
    }

    private static let extras: [Unicode.Scalar: [Unicode.Scalar]] = {
        let pairs: [(UInt32, UInt32)] = [
            (0x006B, 0x212A), (0x0073, 0x017F), (0x00E5, 0x212B), (0x03C9, 0x2126), (0x03C3, 0x03C2), (0x03B2, 0x03D0),
            (0x03B8, 0x03D1), (0x03B8, 0x03F4), (0x03C6, 0x03D5), (0x03C0, 0x03D6), (0x03BA, 0x03F0), (0x03C1, 0x03F1),
            (0x03B5, 0x03F5), (0x03B9, 0x0345), (0x03B9, 0x1FBE), (0x03BC, 0x00B5), (0x1E61, 0x1E9B), (0x00DF, 0x1E9E),
            (0x0432, 0x1C80), (0x0434, 0x1C81), (0x043E, 0x1C82), (0x0441, 0x1C83), (0x0442, 0x1C84), (0x0442, 0x1C85),
            (0x044A, 0x1C86), (0x0463, 0x1C87), (0xA64B, 0x1C88),
        ]
        var table: [Unicode.Scalar: [Unicode.Scalar]] = [:]
        for (base, other) in pairs {
            guard let base = Unicode.Scalar(base), let other = Unicode.Scalar(other) else { continue }
            table[key(base), default: []].append(other)
        }
        return table
    }()
}

struct FoldedScanner: Sendable {
    typealias Alternatives = [[UInt8]]

    let classes: [Alternatives]
    private let anchor: Int
    private let anchorBytes: [UInt8]

    init(_ text: String) {
        let built = text.unicodeScalars.map { scalar in
            CaseFolding.equivalents(scalar).map { Array(String($0).utf8) }
        }
        func cost(_ index: Int) -> Int {
            Set(built[index].compactMap(\.first)).reduce(0) { $0 + ByteScan.rarity($1) }
        }
        let chosen = built.indices.min { cost($0) < cost($1) } ?? 0
        classes = built
        anchor = chosen
        anchorBytes = built.isEmpty ? [] : Array(Set(built[chosen].compactMap(\.first))).sorted()
    }

    func find(_ base: UnsafePointer<UInt8>, count: Int, from start: Int) -> Range<Int>? {
        guard !classes.isEmpty else { return nil }
        var index = start
        let splats = anchorBytes.map { Lanes(repeating: $0) }
        while index + ByteScan.width <= count {
            let chunk = ByteScan.load(base, index)
            var hits = chunk .== splats[0]
            for splat in splats.dropFirst() { hits .|= chunk .== splat }
            if any(hits) {
                for lane in 0..<ByteScan.width where hits[lane] {
                    if let found = verify(base, count: count, at: index + lane, from: start) { return found }
                }
            }
            index += ByteScan.width
        }
        while index < count {
            if anchorBytes.contains(base[index]), let found = verify(base, count: count, at: index, from: start) { return found }
            index += 1
        }
        return nil
    }

    private func verify(_ base: UnsafePointer<UInt8>, count: Int, at position: Int, from floor: Int) -> Range<Int>? {
        var end = position
        for index in anchor..<classes.count {
            guard let length = classes[index].first(where: { Self.has($0, base, count, at: end) })?.count else { return nil }
            end += length
        }
        var begin = position
        for index in stride(from: anchor - 1, through: 0, by: -1) {
            guard let alternative = classes[index].first(where: { begin - $0.count >= floor && Self.has($0, base, count, at: begin - $0.count) })
            else { return nil }
            begin -= alternative.count
        }
        return begin..<end
    }

    private static func has(_ bytes: [UInt8], _ base: UnsafePointer<UInt8>, _ count: Int, at index: Int) -> Bool {
        guard index >= 0, index + bytes.count <= count else { return false }
        return bytes.withUnsafeBufferPointer { memcmp(base + index, $0.baseAddress, $0.count) == 0 }
    }
}
