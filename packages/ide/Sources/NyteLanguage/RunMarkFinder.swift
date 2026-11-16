import Foundation
import NyteCore

enum TestRunner: String, Sendable, Equatable {
    case node, vitest, jest
}

struct GoPackageInfo: Sendable, Equatable {
    var importPath: String
    var directory: URL
}

struct ScriptProject: Sendable, Equatable {
    struct Entry: Sendable, Equatable {
        var name: String
        var file: URL
        var arguments: [String]
        var runtimeArguments: [String]
        var command: [String]
    }

    var root: URL
    var entries: [Entry]
    var runner: TestRunner?
}

enum RunMarkFinder {
    static let testPrefixes = ["Test", "Benchmark", "Fuzz", "Example"]

    static func goMarks(file: URL, text: String, symbols: [DocumentSymbol], package info: GoPackageInfo) -> [RunMark] {
        let lines = LineDiff.lines(text)
        let packageLine = lines.firstIndex { $0.hasPrefix("package ") }
        let packageName = packageLine.map { lines[$0].dropFirst("package ".count).trimmingCharacters(in: .whitespacesAndNewlines) } ?? ""
        let functions = symbols.filter { $0.depth == 0 && $0.kind == .function }
        if !file.lastPathComponent.hasSuffix("_test.go") {
            guard packageName == "main", let main = functions.first(where: { $0.name == "main" }) else { return [] }
            let target = RunTarget(
                name: info.importPath, program: .goPackage(importPath: info.importPath), directory: info.directory,
                command: ["go", "run", info.importPath]
            )
            return [RunMark(line: main.selection.start.line, kind: .program, title: "Run \(info.importPath)", target: target)]
        }
        var marks: [RunMark] = []
        var tests: [String] = []
        for function in functions {
            guard let prefix = testPrefixes.first(where: { isTestName(function.name, prefix: $0) }),
                  hasTestSignature(prefix, at: function.selection.end, in: text)
            else { continue }
            let anchored = "^\(function.name)$"
            if prefix != "Benchmark" { tests.append(function.name) }
            let flags = prefix == "Benchmark" ? ["-test.run", "^$", "-test.bench", anchored] : ["-test.run", anchored]
            marks.append(goTestMark(line: function.selection.start.line, kind: .test, title: "Run \(function.name)", flags: flags, info: info))
            guard prefix == "Test" else { continue }
            for subtest in subtests(in: function.range, of: text) {
                let pattern = "\(anchored)/" + subtest.path.map { "^\(goSubtestPattern($0))$" }.joined(separator: "/")
                marks.append(goTestMark(
                    line: subtest.line, kind: .test, title: "Run \(function.name)/\(subtest.path.joined(separator: "/"))",
                    flags: ["-test.run", pattern], info: info
                ))
            }
        }
        if let packageLine, !tests.isEmpty {
            let pattern = "^(\(tests.joined(separator: "|")))$"
            marks.insert(goTestMark(line: packageLine, kind: .suite, title: "Run all tests in \(file.lastPathComponent)",
                                    flags: ["-test.run", pattern], info: info), at: 0)
        }
        return marks
    }

    static func isTestName(_ name: String, prefix: String) -> Bool {
        guard name.hasPrefix(prefix), name != "TestMain" else { return false }
        let rest = name.dropFirst(prefix.count)
        return rest.first.map { !$0.isLowercase } ?? true
    }

    private static func hasTestSignature(_ prefix: String, at end: TextPosition, in text: String) -> Bool {
        let head = declaration(after: end, in: text)
        let parameters = head.prefix { $0 != ")" }
        switch prefix {
        case "Test": return parameters.contains("*testing.T")
        case "Benchmark": return parameters.contains("*testing.B")
        case "Fuzz": return parameters.contains("*testing.F")
        default: return parameters.drop { $0 != "(" }.dropFirst().allSatisfy(\.isWhitespace)
        }
    }

    private static func goTestMark(line: Int, kind: RunMark.Kind, title: String, flags: [String], info: GoPackageInfo) -> RunMark {
        let words = stride(from: 0, to: flags.count, by: 2).flatMap { ["-" + flags[$0].dropFirst("-test.".count), flags[$0 + 1]] }
        let target = RunTarget(
            name: String(title.dropFirst("Run ".count)) + " in " + info.importPath, program: .goTest(importPath: info.importPath),
            directory: info.directory, arguments: flags, command: ["go", "test", info.importPath] + words
        )
        return RunMark(line: line, kind: kind, title: title, target: target)
    }

    static func goSubtestPattern(_ name: String) -> String {
        regexEscaped(name.replacingOccurrences(of: " ", with: "_"))
    }

    static func regexEscaped(_ text: String) -> String {
        let special = Set("\\.+*?()|[]{}^$")
        return text.map { special.contains($0) ? "\\\($0)" : String($0) }.joined()
    }

    private static func declaration(after position: TextPosition, in text: String) -> Substring {
        let offset = LanguageService.offset(of: position, in: text.utf16)
        guard let start = text.utf16.index(text.utf16.startIndex, offsetBy: offset, limitedBy: text.utf16.endIndex)?
            .samePosition(in: text)
        else { return "" }
        return text[start...].prefix(SymbolDetail.declarationReach)
    }

    struct Call: Sendable, Equatable {
        var line: Int
        var path: [String]
        var isSuite: Bool
    }

    static func subtests(in range: TextSpan, of text: String) -> [Call] {
        let lines = LineDiff.lines(text)
        guard range.start.line < lines.count else { return [] }
        let body = lines[range.start.line...min(range.end.line, lines.count - 1)].joined()
        return calls(in: body, names: [".Run"], firstLine: range.start.line, quotes: ["\""]).map { call in
            Call(line: call.line, path: call.path, isSuite: false)
        }
    }

    static func scriptMarks(file: URL, text: String, project: ScriptProject) -> [RunMark] {
        let relative = String(file.path.dropFirst(project.root.path.count + 1))
        var marks = project.entries.filter { $0.file == file }.prefix(1).map { entry in
            RunMark(line: 0, kind: .program, title: "Run \(entry.name)", target: RunTarget(
                name: entry.name, program: .node(script: entry.file), directory: project.root, arguments: entry.arguments,
                runtimeArguments: entry.runtimeArguments, command: entry.command
            ))
        }
        guard let runner = runner(for: text) ?? project.runner else { return marks }
        let found = calls(in: text, names: ["describe", "suite", "it", "test"], firstLine: 0, quotes: ["\"", "'", "`"])
        guard !found.isEmpty else { return marks }
        marks.append(RunMark(line: 0, kind: .suite, title: "Run all tests in \(file.lastPathComponent)",
                             target: scriptTest(runner, file: file, relative: relative, pattern: nil, project: project)))
        for call in found {
            let joined = call.path.map(regexEscaped).joined(separator: " ")
            let pattern = call.isSuite ? "^\(joined)( |$)" : "^\(joined)$"
            marks.append(RunMark(line: call.line, kind: call.isSuite ? .suite : .test, title: "Run \(call.path.joined(separator: " › "))",
                                 target: scriptTest(runner, file: file, relative: relative, pattern: pattern, project: project)))
        }
        return marks
    }

    static func runner(for text: String) -> TestRunner? {
        if text.contains("from \"vitest\"") || text.contains("from 'vitest'") { return .vitest }
        if text.contains("\"node:test\"") || text.contains("'node:test'") { return .node }
        if text.contains("@jest/globals") { return .jest }
        return nil
    }

    private static func scriptTest(_ runner: TestRunner, file: URL, relative: String, pattern: String?, project: ScriptProject) -> RunTarget {
        let name = relative + (pattern.map { " \($0)" } ?? "")
        switch runner {
        case .node:
            let filter = pattern.map { ["--test-name-pattern=\($0)"] } ?? []
            return RunTarget(name: name, program: .node(script: file), directory: project.root, runtimeArguments: ["--test"] + filter,
                             command: ["node", "--test"] + filter + [relative])
        case .vitest:
            let filter = pattern.map { ["-t", $0] } ?? []
            return RunTarget(name: name, program: .node(script: project.root.appendingPathComponent("node_modules/vitest/vitest.mjs")),
                             directory: project.root, arguments: ["run", relative] + filter,
                             command: ["npx", "vitest", "run", relative] + filter)
        case .jest:
            let filter = pattern.map { ["-t", $0] } ?? []
            return RunTarget(name: name, program: .node(script: project.root.appendingPathComponent("node_modules/jest/bin/jest.js")),
                             directory: project.root, arguments: [relative] + filter, command: ["npx", "jest", relative] + filter)
        }
    }

    static func calls(in text: String, names: [String], firstLine: Int, quotes: Set<Character>) -> [Call] {
        let units = Array(text.unicodeScalars)
        var found: [Call] = []
        var open: [(depth: Int, name: String)] = []
        var depth = 0
        var line = firstLine
        var index = 0
        func at(_ offset: Int) -> Character? { offset < units.count ? Character(units[offset]) : nil }
        func skipString(_ quote: Character) {
            index += 1
            while let character = at(index), character != quote {
                if character == "\\" { index += 1 }
                if character == "\n" { line += 1 }
                index += 1
            }
        }
        while let character = at(index) {
            switch character {
            case "\n": line += 1
            case "/" where at(index + 1) == "/":
                while let next = at(index), next != "\n" { index += 1 }
                continue
            case "/" where at(index + 1) == "*":
                index += 2
                while let next = at(index), !(next == "*" && at(index + 1) == "/") {
                    if next == "\n" { line += 1 }
                    index += 1
                }
                index += 1
            case "\"", "'", "`": skipString(character)
            case "{": depth += 1
            case "}":
                depth -= 1
                while let last = open.last, last.depth >= depth { open.removeLast() }
            default:
                guard let name = names.first(where: { word($0, at: index, in: units) }) else { break }
                var cursor = index + name.unicodeScalars.count
                while let next = at(cursor), next == "." {
                    var end = cursor + 1
                    while let letter = at(end), letter.isLetter { end += 1 }
                    let modifier = String(String.UnicodeScalarView(units[(cursor + 1)..<end]))
                    guard ["only", "skip", "todo", "concurrent", "sequential"].contains(modifier) else { break }
                    cursor = end
                }
                while let next = at(cursor), next == " " { cursor += 1 }
                guard at(cursor) == "(" else { break }
                cursor += 1
                while let next = at(cursor), next == " " || next == "\n" { cursor += 1 }
                guard let quote = at(cursor), quotes.contains(quote) else { break }
                var end = cursor + 1
                while let next = at(end), next != quote, next != "\n", !(quote == "`" && next == "$" && at(end + 1) == "{") { end += 1 }
                guard at(end) == quote else { break }
                let title = String(String.UnicodeScalarView(units[(cursor + 1)..<end]))
                let isSuite = name == "describe" || name == "suite"
                let path = open.map(\.name) + [title]
                found.append(Call(line: line, path: path, isSuite: isSuite))
                if isSuite || name == ".Run" { open.append((depth, title)) }
                index = end
            }
            index += 1
        }
        return found
    }

    private static func word(_ name: String, at index: Int, in units: [Unicode.Scalar]) -> Bool {
        let scalars = Array(name.unicodeScalars)
        guard index + scalars.count <= units.count, Array(units[index..<index + scalars.count]) == scalars else { return false }
        if name.hasPrefix(".") { return index > 0 && Character(units[index - 1]).isLetter }
        let before = index > 0 ? Character(units[index - 1]) : " "
        let after = index + scalars.count < units.count ? Character(units[index + scalars.count]) : " "
        return !(before.isLetter || before.isNumber || before == "_" || before == "." || before == "$")
            && !(after.isLetter || after.isNumber || after == "_")
    }
}
