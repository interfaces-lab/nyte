import Foundation

enum RegexLiteral {
    static func literalCharacters(of pattern: String) -> String {
        var kept = String.UnicodeScalarView()
        var escaped = false
        for scalar in pattern.unicodeScalars {
            if escaped {
                escaped = false
            } else if scalar == "\\" {
                escaped = true
            } else {
                kept.append(scalar)
            }
        }
        return String(kept)
    }

    static func required(in pattern: String) -> String? {
        let scalars = Array(pattern.unicodeScalars)
        var runs: [String.UnicodeScalarView] = []
        var run = String.UnicodeScalarView()
        func cut() {
            if !run.isEmpty { runs.append(run) }
            run = String.UnicodeScalarView()
        }
        var index = 0
        while index < scalars.count {
            let scalar = scalars[index]
            switch scalar {
            case "|":
                return nil
            case "\\":
                guard index + 1 < scalars.count else { return nil }
                let next = scalars[index + 1]
                if next == "Q" { return nil }
                index += 2
                if next.properties.isAlphabetic || next.properties.numericType != nil {
                    cut()
                    continue
                }
                run.append(next)
                continue
            case "[":
                cut()
                index = classEnd(scalars, from: index)
                continue
            case "(":
                if index + 1 < scalars.count, scalars[index + 1] == "?", hasFlags(scalars, from: index + 2) { return nil }
                cut()
                guard let end = groupEnd(scalars, from: index) else { return nil }
                index = end
                continue
            case ".", "^", "$", ")":
                cut()
            case "*", "?", "{":
                if !run.isEmpty { run.removeLast() }
                cut()
                if scalar == "{" { index = scalars[index...].firstIndex(of: "}") ?? scalars.count }
            case "+":
                cut()
            default:
                run.append(scalar)
            }
            index += 1
        }
        cut()
        return runs.map(String.init).max { $0.utf8.count < $1.utf8.count }
    }

    static func isMultiline(_ pattern: String) -> Bool {
        pattern.contains("\\n") || pattern.contains("\n") || pattern.contains("\\r")
    }

    private static func hasFlags(_ scalars: [Unicode.Scalar], from start: Int) -> Bool {
        var index = start
        while index < scalars.count, scalars[index].properties.isAlphabetic || scalars[index] == "-" {
            index += 1
        }
        return index > start
    }

    private static func classEnd(_ scalars: [Unicode.Scalar], from start: Int) -> Int {
        var index = start + 1
        if index < scalars.count, scalars[index] == "^" { index += 1 }
        if index < scalars.count, scalars[index] == "]" { index += 1 }
        var depth = 1
        while index < scalars.count {
            switch scalars[index] {
            case "\\": index += 1
            case "[": depth += 1
            case "]":
                depth -= 1
                if depth == 0 { return index + 1 }
            default: break
            }
            index += 1
        }
        return scalars.count
    }

    private static func groupEnd(_ scalars: [Unicode.Scalar], from start: Int) -> Int? {
        var depth = 0
        var index = start
        while index < scalars.count {
            switch scalars[index] {
            case "\\": index += 1
            case "[": index = classEnd(scalars, from: index) - 1
            case "(": depth += 1
            case ")":
                depth -= 1
                if depth == 0 { return index + 1 }
            case "|" where depth == 1: break
            default: break
            }
            index += 1
        }
        return nil
    }
}
