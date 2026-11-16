import Foundation
import NyteCore

enum SymbolDetail {
    static let callableKinds: Set<SymbolKind> = [.function, .method, .constructor]
    static let typedKinds: Set<SymbolKind> = [.field, .property, .variable, .constant, .enumMember]
    static let declarationReach = 400

    static func compact(_ symbols: [DocumentSymbol], source: String) -> [DocumentSymbol] {
        let units = source.utf16
        let package = goPackage(in: source)
        let lines = LineDiff.lines(source)
        let declared = symbols.filter { symbol in
            symbol.depth > 0 || symbol.range.start.line >= lines.count
                || !lines[symbol.range.start.line].trimmingCharacters(in: .whitespaces).hasPrefix("import ")
        }
        return declared.map { symbol in
            var compacted = symbol
            let declared = declaration(after: symbol.selection.end, in: source, units: units)
            compacted.detail = detail(of: symbol, declaration: declared, package: package)
            compacted.signature = signature(of: symbol, declaration: declared, package: package) ?? compacted.detail
            return compacted
        }
    }

    static func detail(of symbol: DocumentSymbol, declaration: Substring, package: String?) -> String {
        if callableKinds.contains(symbol.kind) {
            let signature = symbol.detail.hasPrefix("func") ? Substring(symbol.detail) : declaration
            guard let shape = CallShape(signature: String(signature), after: "") else { return "" }
            let names = parameters(in: shape.parameters).map(name(of:)).joined(separator: ", ")
            let result = unqualified(clipped(shape.result), package: package)
            return "(\(names))" + (result.isEmpty ? "" : " " + result)
        }
        guard typedKinds.contains(symbol.kind) else { return "" }
        if !symbol.detail.isEmpty, !symbol.detail.hasPrefix("struct{"), !symbol.detail.hasPrefix("interface{") {
            return unqualified(symbol.detail, package: package)
        }
        let typed = declaration.drop { $0 == "?" || $0 == "!" || $0 == " " }
        guard typed.hasPrefix(":") else { return "" }
        return clipped(String(typed.dropFirst()))
    }

    static func signature(of symbol: DocumentSymbol, declaration: Substring, package: String?) -> String? {
        guard callableKinds.contains(symbol.kind) else { return nil }
        let source = symbol.detail.hasPrefix("func") ? Substring(symbol.detail) : declaration
        guard let shape = CallShape(signature: String(source), after: "") else { return nil }
        let result = unqualified(clipped(shape.result), package: package)
        return unqualified(shape.parameters, package: package) + (result.isEmpty ? "" : " " + result)
    }

    static func parameters(in list: String) -> [String] {
        let inner = list.drop { $0 != "(" }.dropFirst().dropLast()
        var parts: [String] = []
        var part = ""
        var depth = 0
        for character in inner {
            switch character {
            case "(", "<", "[", "{": depth += 1
            case ")", ">", "]", "}": depth -= 1
            case "," where depth == 0:
                parts.append(part.trimmingCharacters(in: .whitespacesAndNewlines))
                part = ""
                continue
            default: break
            }
            part.append(character)
        }
        parts.append(part.trimmingCharacters(in: .whitespacesAndNewlines))
        return parts.filter { !$0.isEmpty }
    }

    static func name(of parameter: String) -> String {
        if parameter.hasPrefix("{") || parameter.hasPrefix("[") {
            return parameter.first == "{" ? "{…}" : "[…]"
        }
        if let colon = parameter.firstIndex(of: ":") { return String(parameter[..<colon]).trimmingCharacters(in: .whitespaces) }
        return String(parameter.prefix { $0 != " " })
    }

    private static func clipped(_ text: String) -> String {
        let end = text.firstIndex { "{;=\n".contains($0) } ?? text.endIndex
        return text[..<end].trimmingCharacters(in: .whitespaces)
    }

    private static func unqualified(_ text: String, package: String?) -> String {
        guard let package else { return text }
        return text.replacingOccurrences(of: package + ".", with: "")
    }

    private static func goPackage(in source: String) -> String? {
        let line = source.split(separator: "\n", maxSplits: 64).first { $0.hasPrefix("package ") }
        return line.map { String($0.dropFirst("package ".count)).trimmingCharacters(in: .whitespaces) }
    }

    private static func declaration(after position: TextPosition, in source: String, units: String.UTF16View) -> Substring {
        let offset = LanguageService.offset(of: position, in: units)
        guard offset < units.count, let start = units.index(units.startIndex, offsetBy: offset).samePosition(in: source) else { return "" }
        return source[start...].prefix(declarationReach)
    }
}
