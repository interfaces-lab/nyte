import NyteCore

struct CallShape: Sendable, Hashable {
    var parameters: String
    var result: String

    var invocation: CompletionItem.Invocation {
        parameters.filter { !$0.isWhitespace } == "()" ? .withoutArguments : .withArguments
    }

    init?(signature: String, after name: String) {
        var rest = Substring(signature)
        if !name.isEmpty, let found = signature.range(of: name + "(") ?? signature.range(of: name + "<") {
            rest = signature[signature.index(found.upperBound, offsetBy: -1)...]
        } else if let first = rest.firstIndex(where: { $0 == "(" || $0 == "<" }), rest.hasPrefix("func") || first == rest.startIndex {
            rest = rest[first...]
        } else {
            return nil
        }
        guard let end = Self.closingIndex(of: rest) else { return nil }
        parameters = String(rest[...end])
        var result = rest[rest.index(after: end)...].drop { $0 == " " }
        if result.hasPrefix(":") { result = result.dropFirst().drop { $0 == " " } }
        if result.hasPrefix("=>") { result = result.dropFirst(2).drop { $0 == " " } }
        self.result = String(result)
    }

    private static func closingIndex(of text: Substring) -> Substring.Index? {
        var depth = 0
        var index = text.startIndex
        while index < text.endIndex {
            switch text[index] {
            case "(", "<", "[", "{": depth += 1
            case ")", ">", "]", "}":
                depth -= 1
                if depth == 0, text[index] == ")" { return index }
            default: break
            }
            index = text.index(after: index)
        }
        return nil
    }
}
