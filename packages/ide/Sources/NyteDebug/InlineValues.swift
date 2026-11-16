import Foundation

enum InlineValues {
    static let lookBack = 400
    static let valueLimit = 40
    static let keywords: Set<String> = [
        "func", "return", "if", "else", "for", "range", "var", "const", "let", "type", "struct", "interface", "map", "chan",
        "go", "defer", "select", "switch", "case", "default", "break", "continue", "package", "import", "nil", "true", "false",
        "function", "async", "await", "new", "this", "class", "throw", "try", "catch", "finally", "of", "in", "typeof",
        "instanceof", "undefined", "null", "void", "export", "static", "readonly", "private", "public", "while", "do",
    ]

    static func functionStart(before current: Int, line text: (Int) -> String?) -> Int {
        var depth = 0
        var index = current
        while index >= 0, current - index < lookBack, let line = text(index) {
            let code = stripped(line)
            if index == current, code.hasPrefix("func ") { return index }
            if index < current {
                for character in code.reversed() {
                    if character == "}" { depth += 1 }
                    if character == "{" { depth -= 1 }
                }
            }
            if depth < 0, isFunctionHeader(code) { return index }
            if depth < 0 { depth = 0 }
            if index < current, code.hasPrefix("func ") { return index }
            index -= 1
        }
        return max(index + 1, 0)
    }

    static func isFunctionHeader(_ code: String) -> Bool {
        let trimmed = code.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("func ") || trimmed.contains("function") || trimmed.contains("=>") { return true }
        guard let open = trimmed.firstIndex(of: "("), trimmed.hasSuffix("{") else { return false }
        let head = trimmed[..<open].split(separator: " ").last.map(String.init) ?? ""
        let control: Set<String> = ["if", "for", "while", "switch", "catch", "with"]
        return !head.isEmpty && !control.contains(head) && head.allSatisfy { $0.isLetter || $0.isNumber || $0 == "_" || $0 == "$" || $0 == "#" }
    }

    static func values(lines: [(line: Int, text: String)], locals: [String: DebugVariable]) -> [InlineValue] {
        lines.flatMap { line, text in
            var shown: Set<String> = []
            return identifiers(in: stripped(text)).compactMap { name -> InlineValue? in
                guard let variable = locals[name], shown.insert(name).inserted else { return nil }
                return InlineValue(line: line, name: name, text: display(variable), isChanged: variable.isChanged)
            }
        }
    }

    static func display(_ variable: DebugVariable) -> String {
        let text = variable.reference > 0
            ? DebugText.summary(variable.value, type: variable.type, indexedCount: variable.indexedCount, limit: valueLimit)
            : DebugText.value(variable.value, type: variable.type)
        return DebugText.excerpt(text, limit: valueLimit)
    }

    static func identifiers(in code: String) -> [String] {
        var found: [String] = []
        var current = ""
        var previous: Character = " "
        var afterDot = false
        for character in code + " " {
            if character.isLetter || character == "_" || character == "$" || (character.isNumber && !current.isEmpty) {
                if current.isEmpty { afterDot = previous == "." }
                current.append(character)
            } else {
                if !current.isEmpty, !afterDot, !keywords.contains(current) { found.append(current) }
                current = ""
            }
            if !character.isWhitespace { previous = character }
        }
        return found
    }

    static func stripped(_ line: String) -> String {
        var result = ""
        var quote: Character?
        var escaped = false
        var last: Character = " "
        for character in line {
            if let open = quote {
                if escaped {
                    escaped = false
                } else if character == "\\" {
                    escaped = true
                } else if character == open {
                    quote = nil
                    result.append(character)
                }
                continue
            }
            if character == "/", last == "/" {
                result.removeLast()
                break
            }
            if DebugText.quotes.contains(character) {
                quote = character
            }
            result.append(character)
            last = character
        }
        return result
    }
}
