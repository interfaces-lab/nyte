import Foundation

struct MatchPlan: Sendable {
    enum Kind: Sendable {
        case literal(LiteralScanner)
        case folded(FoldedScanner)
        case regex(Expression)
    }

    struct Expression: Sendable {
        let pattern: String
        let caseInsensitive: Bool
        let isMultiline: Bool
        let prefilter: Prefilter?
    }

    enum Prefilter: Sendable {
        case literal(LiteralScanner)
        case folded(FoldedScanner)

        func occurs(in base: UnsafePointer<UInt8>, count: Int) -> Bool {
            switch self {
            case let .literal(scanner): scanner.find(base, count: count, from: 0) != nil
            case let .folded(scanner): scanner.find(base, count: count, from: 0) != nil
            }
        }
    }

    let kind: Kind
    let wholeWord: Bool
    let limits: SearchQuery.Limits

    static func make(_ query: SearchQuery) throws(PatternError) -> MatchPlan {
        guard !query.text.isEmpty else { throw PatternError(message: "Type something to search for.") }
        let sensitive = query.isCaseSensitive
        guard query.isRegex else {
            return MatchPlan(kind: literal(query.text, sensitive: sensitive), wholeWord: query.wholeWord, limits: query.limits)
        }
        let pattern = query.wholeWord ? "(?<![\\p{L}\\p{N}_])(?:\(query.text))(?![\\p{L}\\p{N}_])" : query.text
        do {
            _ = try NSRegularExpression(pattern: pattern, options: options(caseInsensitive: !sensitive))
        } catch {
            throw PatternError(message: explain(query.text))
        }
        let prefilter = RegexLiteral.required(in: query.text).map { required -> Prefilter in
            switch literal(required, sensitive: sensitive) {
            case let .literal(scanner): .literal(scanner)
            case let .folded(scanner): .folded(scanner)
            case .regex: .folded(FoldedScanner(required))
            }
        }
        let expression = Expression(pattern: pattern, caseInsensitive: !sensitive, isMultiline: RegexLiteral.isMultiline(query.text),
                                    prefilter: prefilter)
        return MatchPlan(kind: .regex(expression), wholeWord: false, limits: query.limits)
    }

    static func options(caseInsensitive: Bool) -> NSRegularExpression.Options {
        caseInsensitive ? [.anchorsMatchLines, .caseInsensitive] : [.anchorsMatchLines]
    }

    private static func literal(_ text: String, sensitive: Bool) -> Kind {
        let bytes = Array(text.utf8)
        if sensitive { return .literal(LiteralScanner(bytes, foldsCase: false)) }
        let foldsAsASCII = bytes.allSatisfy { $0 < 0x80 }
        return foldsAsASCII ? .literal(LiteralScanner(bytes, foldsCase: true)) : .folded(FoldedScanner(text))
    }

    private static func explain(_ pattern: String) -> String {
        do {
            _ = try Regex(pattern)
        } catch {
            let reason = String(describing: error).split(separator: "\n").first.map(String.init) ?? ""
            return reason.isEmpty ? "This regular expression is not valid." : reason.prefix(1).uppercased() + reason.dropFirst() + "."
        }
        return "This regular expression is not valid."
    }
}

enum WordBoundary {
    static func isWord(_ scalar: Unicode.Scalar) -> Bool {
        if scalar.isASCII {
            let value = scalar.value
            return (value >= 0x30 && value <= 0x39) || (value | 0x20 >= 0x61 && value | 0x20 <= 0x7A) || value == 0x5F
        }
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
             .decimalNumber, .letterNumber, .otherNumber: return true
        default: return false
        }
    }

    static func admits(_ base: UnsafePointer<UInt8>, count: Int, _ range: Range<Int>) -> Bool {
        if range.lowerBound > 0, let before = scalar(endingAt: range.lowerBound, base), isWord(before) { return false }
        if range.upperBound < count, let after = scalar(at: range.upperBound, base, count), isWord(after) { return false }
        return true
    }

    private static func scalar(at index: Int, _ base: UnsafePointer<UInt8>, _ count: Int) -> Unicode.Scalar? {
        let lead = base[index]
        let length = lead < 0x80 ? 1 : lead >= 0xF0 ? 4 : lead >= 0xE0 ? 3 : lead >= 0xC0 ? 2 : 1
        guard index + length <= count else { return nil }
        var parser = Unicode.UTF8.ForwardParser()
        var bytes = UnsafeBufferPointer(start: base + index, count: length).makeIterator()
        guard case let .valid(encoded) = parser.parseScalar(from: &bytes) else { return nil }
        return Unicode.UTF8.decode(encoded)
    }

    private static func scalar(endingAt end: Int, _ base: UnsafePointer<UInt8>) -> Unicode.Scalar? {
        var start = end - 1
        while start > 0, end - start < 4, base[start] & 0xC0 == 0x80 { start -= 1 }
        return scalar(at: start, base, end)
    }
}
