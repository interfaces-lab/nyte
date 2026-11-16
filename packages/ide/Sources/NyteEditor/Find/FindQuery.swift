import Foundation

struct FindQuery: Equatable, Sendable {
    enum Problem: Equatable, Error {
        case invalidPattern(String)
    }

    struct Found: Equatable, Sendable {
        let ranges: [NSRange]
        let replacements: [String]?
    }

    static let largest = 100_000

    var pattern = ""
    var matchesCase = false
    var wholeWords = false
    var isRegex = false

    var isEmpty: Bool { pattern.isEmpty }

    func expression() -> Result<NSRegularExpression, Problem> {
        let body = isRegex ? pattern : NSRegularExpression.escapedPattern(for: pattern)
        let bounded = wholeWords ? "\\b(?:" + body + ")\\b" : body
        do {
            return .success(try NSRegularExpression(pattern: bounded, options: matchesCase ? [] : [.caseInsensitive]))
        } catch {
            return .failure(.invalidPattern(isRegex ? "This isn’t a valid regular expression." : "This can’t be searched for."))
        }
    }

    static func search(_ query: FindQuery, in buffer: TextBuffer, within scopes: [NSRange]?, replacingWith template: String? = nil)
        -> Result<Found, Problem>? {
        guard !query.isEmpty else { return .success(Found(ranges: [], replacements: nil)) }
        let expression: NSRegularExpression
        switch query.expression() {
        case .success(let compiled): expression = compiled
        case .failure(let problem): return .failure(problem)
        }
        let units = buffer.units(NSRange(location: 0, length: buffer.count))
        let text = NSString(characters: units, length: units.count)
        var ranges: [NSRange] = []
        var replacements: [String] = []
        var cancelled = false
        for scope in scopes ?? [NSRange(location: 0, length: text.length)] {
            expression.enumerateMatches(in: text as String, options: [], range: scope) { result, _, stop in
                if Task.isCancelled || ranges.count >= largest {
                    cancelled = Task.isCancelled
                    stop.pointee = true
                    return
                }
                guard let result, result.range.length > 0 else { return }
                ranges.append(result.range)
                if let template {
                    replacements.append(query.isRegex ? expression.replacementString(for: result, in: text as String, offset: 0, template: template)
                                        : template)
                }
            }
        }
        return cancelled ? nil : .success(Found(ranges: ranges, replacements: template == nil ? nil : replacements))
    }

    static func index(after offset: Int, in ranges: [NSRange], forward: Bool) -> Int? {
        guard !ranges.isEmpty else { return nil }
        var low = 0
        var high = ranges.count
        while low < high {
            let middle = (low + high) / 2
            if ranges[middle].location < offset { low = middle + 1 } else { high = middle }
        }
        if forward { return low < ranges.count ? low : 0 }
        return low > 0 ? low - 1 : ranges.count - 1
    }
}
