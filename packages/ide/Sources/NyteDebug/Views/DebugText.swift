import AppKit
import NyteUI

enum DebugText {
    static let askAboutStop = "Ask Nyte About This Stop"
    static let constants: Set<String> = ["true", "false", "nil", "null", "undefined", "NaN", "Infinity", "-Infinity"]
    static let quotes: Set<Character> = ["\"", "'", "`"]

    static func ink(for value: String) -> RowContent.Ink {
        guard let first = value.first else { return .primary }
        if quotes.contains(first) { return .syntax(.string) }
        if constants.contains(value) { return .syntax(.constant) }
        if isNumber(value) { return .syntax(.number) }
        return .primary
    }

    static func isNumber(_ value: String) -> Bool {
        if Double(value) != nil { return true }
        let digits = value.hasPrefix("-") ? value.dropFirst() : Substring(value)
        if digits.hasPrefix("0x"), digits.count > 2 { return digits.dropFirst(2).allSatisfy(\.isHexDigit) }
        return digits.hasSuffix("n") && digits.count > 1 && digits.dropLast().allSatisfy(\.isNumber)
    }

    static func displayType(_ type: String) -> String {
        let short = shortType(type)
        guard short.hasSuffix(")"), !short.hasPrefix("func"), let open = short.firstIndex(of: "("), open != short.startIndex else { return short }
        return String(short[short.index(after: open)..<short.index(before: short.endIndex)])
    }

    static func failureText(_ message: String) -> String {
        let prefix = "Unable to evaluate expression: "
        return message.hasPrefix(prefix) ? String(message.dropFirst(prefix.count)) : message
    }

    static func shortType(_ type: String) -> String {
        var result = ""
        var segment = ""
        for character in type {
            if character == "/" {
                segment = ""
                continue
            }
            if character.isLetter || character.isNumber || character == "." || character == "_" || character == "-" || character == "~" {
                segment.append(character)
                continue
            }
            result += segment
            segment = ""
            result.append(character)
        }
        return result + segment
    }

    static func value(_ value: String, type: String) -> String {
        let short = shortType(type)
        for prefix in [type, short] where !prefix.isEmpty && value.hasPrefix(prefix + " ") {
            return String(value.dropFirst(prefix.count + 1))
        }
        return value
    }

    static let summaryFields = 3
    static let collectionPrefixes = ["[]", "[", "map[", "chan "]
    static let nameBudget = 40

    static func excerpt(_ text: String, limit: Int) -> String {
        guard text.count > limit else { return text }
        if let quote = text.first, quotes.contains(quote), text.last == quote, text.count > 1 {
            return String(text.prefix(limit - 2)) + "\u{2026}" + String(quote)
        }
        if let closing = text.last, closing == "}" || closing == "]" {
            return String(text.prefix(limit - 2)) + "\u{2026}" + String(closing)
        }
        return String(text.prefix(limit - 1)) + "\u{2026}"
    }

    static func summary(_ value: String, type: String, indexedCount: Int?, limit: Int) -> String {
        var fields = summaryFields
        var shown = summary(value, type: type, indexedCount: indexedCount, fields: fields)
        while shown.count > limit, fields > 1 {
            fields -= 1
            shown = summary(value, type: type, indexedCount: indexedCount, fields: fields)
        }
        return shown
    }

    static func summary(_ value: String, type: String, indexedCount: Int?) -> String {
        summary(value, type: type, indexedCount: indexedCount, fields: summaryFields)
    }

    static func summary(_ value: String, type: String, indexedCount: Int?, fields shownFields: Int) -> String {
        let shown = Self.value(value, type: type)
        if collectionPrefixes.contains(where: type.hasPrefix) {
            let length = shown.firstRange(of: /len: (\d+)/).flatMap { Int(shown[$0].dropFirst("len: ".count)) } ?? indexedCount
            return length.map { "len: \($0)" } ?? shown
        }
        guard let open = shown.firstIndex(where: { $0 == "{" || $0 == "[" }) else { return shown }
        let closing: Character = shown[open] == "{" ? "}" : "]"
        let fields = topLevelFields(in: shown[shown.index(after: open)...])
        let head = String(shown[..<open])
        let scalars = fields.filter(isScalarField)
        let kept = scalars.isEmpty ? fields.compactMap(fieldName) : Array(scalars)
        guard !kept.isEmpty else { return head + String(shown[open]) + String(closing) }
        let more = kept.count > shownFields || (!scalars.isEmpty && scalars.count < fields.count) ? ", \u{2026}" : ""
        return head + String(shown[open]) + kept.prefix(shownFields).joined(separator: ", ") + more + String(closing)
    }

    static func valueSyntax(_ value: String, language: String) -> [(range: NSRange, color: SyntaxColor)] {
        let summary = "len: "
        guard value.hasPrefix(summary) else { return CodeColors.ranges(in: value, language: language) }
        return [(NSRange(location: summary.utf16.count, length: value.utf16.count - summary.utf16.count), .number)]
    }

    static func isScalarField(_ field: String) -> Bool {
        guard let name = fieldName(field) else { return isScalar(field) }
        return isScalar(field.dropFirst(name.count + 1).trimmingCharacters(in: .whitespaces))
    }

    static func fieldName(_ field: String) -> String? {
        guard let colon = field.firstIndex(of: ":") else { return nil }
        let name = field[..<colon]
        guard !name.isEmpty, name.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "_" || $0 == "#" || $0 == "$" }) else { return nil }
        return String(name)
    }

    static func isScalar(_ value: String) -> Bool {
        if let first = value.first, quotes.contains(first) { return true }
        if constants.contains(value) || isNumber(value) { return true }
        return value.range(of: #"^[\w.]+\(\d+\)$"#, options: .regularExpression) != nil
    }

    static func budgeted(_ text: String, _ budget: Int) -> String {
        guard text.count > budget else { return text }
        let half = (budget - 1) / 2
        return String(text.prefix(budget - 1 - half)) + "\u{2026}" + String(text.suffix(half))
    }

    static func topLevelFields(in body: Substring) -> [String] {
        var fields: [String] = []
        var field = ""
        var depth = 0
        var quote: Character?
        var escaped = false
        for character in body {
            if let open = quote {
                field.append(character)
                if escaped { escaped = false } else if character == "\\" { escaped = true } else if character == open { quote = nil }
                continue
            }
            switch character {
            case _ where quotes.contains(character):
                quote = character
                field.append(character)
            case "{", "[", "(":
                depth += 1
                field.append(character)
            case "}", "]", ")":
                guard depth > 0 else {
                    fields.append(field.trimmingCharacters(in: .whitespaces))
                    return fields.filter { !$0.isEmpty }
                }
                depth -= 1
                field.append(character)
            case "," where depth == 0:
                fields.append(field.trimmingCharacters(in: .whitespaces))
                field = ""
            default:
                field.append(character)
            }
        }
        fields.append(field.trimmingCharacters(in: .whitespaces))
        return fields.filter { !$0.isEmpty }
    }

    static func threadName(_ name: String) -> String {
        var name = name.hasPrefix("* ") ? String(name.dropFirst(2)) : name
        if name.hasPrefix("[Go "), let close = name.firstIndex(of: "]") {
            let number = name[name.index(name.startIndex, offsetBy: "[Go ".count)..<close]
            name = "Goroutine \(number)" + name[name.index(after: close)...]
        }
        if let open = name.range(of: " (Thread ", options: .backwards), name.hasSuffix(")") {
            name = String(name[..<open.lowerBound])
        }
        return name
    }

    static func threadTitle(_ thread: DebugThread) -> String {
        let name = threadName(thread.name)
        guard name.hasPrefix("Goroutine ") else { return name }
        let words = name.split(separator: " ", maxSplits: 2).map(String.init)
        let number = words.count > 1 ? words[1] : ""
        let function = thread.function.isEmpty ? (words.count > 2 ? words[2] : "") : thread.function
        return function.isEmpty ? "Goroutine \(number)" : "Goroutine \(number) · \(function)"
    }

    static func reasonWord(_ reason: String) -> String {
        switch reason {
        case "panic": "exception"
        case "pause": "paused"
        case "goto": "run to line"
        default: reason
        }
    }

    static func asyncLabel(_ name: String) -> String {
        let trimmed = name.trimmingCharacters(in: CharacterSet(charactersIn: "- ").union(.whitespaces))
        return trimmed.isEmpty || trimmed == "await" ? "Async stack" : "Async stack: " + trimmed
    }

    static func name(_ name: String) -> String {
        guard name.hasSuffix(")"), let open = name.range(of: " (loaded ", options: .backwards) else { return name }
        return String(name[..<open.lowerBound])
    }

    static func frameParts(_ frame: DebugFrame) -> (function: String, module: String) {
        let name = frame.function
        guard let slash = name.lastIndex(of: "/") else {
            return (name, goPackage(name) ?? moduleFromFile(frame))
        }
        let tail = String(name[name.index(after: slash)...])
        let package = tail.split(separator: ".", maxSplits: 1).first.map(String.init) ?? tail
        return (tail, String(name[..<slash]) + "/" + package)
    }

    static func goPackage(_ name: String) -> String? {
        guard let dot = name.firstIndex(of: "."), !name.contains(" ") else { return nil }
        let head = name[..<dot]
        guard head.first?.isLowercase == true, head.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "_" }) else { return nil }
        return String(head)
    }

    static func moduleFromFile(_ frame: DebugFrame) -> String {
        guard let url = frame.url else { return "" }
        let components = url.deletingLastPathComponent().pathComponents
        if let index = components.lastIndex(of: "node_modules"), index + 1 < components.count { return components[index + 1] }
        return components.last ?? ""
    }

    static func location(_ frame: DebugFrame) -> String {
        guard let url = frame.url else { return "" }
        return "(\(url.lastPathComponent):\(frame.line + 1))"
    }

    static func status(_ state: Debugger.State) -> String {
        switch state {
        case .idle: ""
        case let .starting(target): startingWords(target.kind)
        case .running: "Running"
        case .paused: ""
        case let .ended(code): code.map { "Exited with code \($0)" } ?? "Stopped"
        case .failed: "Failed to start"
        }
    }

    static func startingWords(_ kind: DebugTarget.Kind) -> String {
        switch kind {
        case .goPackage: "Building…"
        case .goTest: "Building tests…"
        case .node: "Starting…"
        }
    }
}
