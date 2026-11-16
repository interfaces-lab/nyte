import Foundation
import NyteCore

struct FileWatcher: Sendable {
    struct Kinds: OptionSet, Sendable {
        let rawValue: Int
        static let created = Kinds(rawValue: 1)
        static let changed = Kinds(rawValue: 2)
        static let deleted = Kinds(rawValue: 4)
        static let all: Kinds = [.created, .changed, .deleted]
    }

    var pattern: String
    var base: URL?
    var kinds: Kinds
    var expression: NSRegularExpression

    init?(_ json: JSON) {
        let glob = json["globPattern"]
        if let text = glob?.string {
            pattern = text
            base = nil
        } else if let text = glob?["pattern"]?.string {
            pattern = text
            let uri = glob?["baseUri"]?.string ?? glob?["baseUri"]?["uri"]?.string
            base = uri.flatMap(URL.init(string:)).map { Wire.canonical($0) }
        } else {
            return nil
        }
        kinds = json["kind"]?.int.map { Kinds(rawValue: $0) } ?? .all
        let anchor = base != nil || pattern.hasPrefix("/") ? "^" : "(?:^|/)"
        let options: NSRegularExpression.Options = Self.ignoresCase ? [.caseInsensitive] : []
        guard let expression = try? NSRegularExpression(pattern: anchor + Self.expression(for: pattern) + "$", options: options) else {
            return nil
        }
        self.expression = expression
    }

    func matches(_ url: URL, kind: Kinds) -> Bool {
        guard kinds.contains(kind) else { return false }
        var path = url.path
        if let base {
            guard Self.folded(path).hasPrefix(Self.folded(base.path) + "/") else { return false }
            path = String(path.dropFirst(base.path.count + 1))
        }
        let whole = NSRange(location: 0, length: (path as NSString).length)
        return expression.firstMatch(in: path, range: whole) != nil
    }

    var root: URL? {
        if let base { return base }
        guard pattern.hasPrefix("/") else { return nil }
        let literal = pattern.split(separator: "/").prefix { !$0.contains(where: { "*?[{".contains($0) }) }
        return literal.isEmpty ? nil : URL(fileURLWithPath: "/" + literal.joined(separator: "/"))
    }

    static let ignoresCase = (try? URL(fileURLWithPath: "/").resourceValues(forKeys: [.volumeSupportsCaseSensitiveNamesKey]))?
        .volumeSupportsCaseSensitiveNames == false

    static func folded(_ path: String) -> String { ignoresCase ? path.lowercased() : path }

    static func expression(for glob: String) -> String {
        var result = ""
        var characters = Array(glob)[...]
        var braces = 0
        while let character = characters.popFirst() {
            switch character {
            case "*" where characters.first == "*":
                characters.removeFirst()
                if characters.first == "/" {
                    characters.removeFirst()
                    result += "(?:.*/)?"
                } else {
                    result += ".*"
                }
            case "*": result += "[^/]*"
            case "?": result += "[^/]"
            case "{":
                braces += 1
                result += "(?:"
            case "}" where braces > 0:
                braces -= 1
                result += ")"
            case "," where braces > 0: result += "|"
            case "[":
                result += "["
                if characters.first == "!" {
                    characters.removeFirst()
                    result += "^"
                }
            case "]": result += "]"
            default: result += NSRegularExpression.escapedPattern(for: String(character))
            }
        }
        return result
    }
}
