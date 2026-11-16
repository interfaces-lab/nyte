import Foundation
import NyteCore

extension LanguageService {
    public func runMarks(in url: URL) async -> [RunMark] {
        let url = Wire.canonical(url)
        guard let index = document(at: url) else { return [] }
        let version = documents[index].version
        if let cached = marks[url], cached.version == version { return cached.marks }
        let text = documents[index].text
        let top = workspace.root
        let found: [RunMark]
        if documents[index].language == "go" {
            let symbols = await outline(url)
            guard let info = await Self.goPackage(for: url, top: top) else { return [] }
            found = await Self.goMarks(file: url, text: text, symbols: symbols, info: info)
        } else {
            guard let project = await Self.scriptProject(for: url, top: top) else { return [] }
            found = await Self.scriptMarks(file: url, text: text, project: project)
        }
        if let now = document(at: url), documents[now].version == version { marks[url] = (version, found) }
        return found
    }

    func outline(_ url: URL) async -> [DocumentSymbol] {
        guard let index = document(at: url) else { return [] }
        let version = documents[index].version
        if let cached = outlines[url], cached.version == version { return cached.symbols }
        let symbols = await symbols(in: url)
        if let now = document(at: url), documents[now].version == version, !symbols.isEmpty { outlines[url] = (version, symbols) }
        return symbols
    }

    @concurrent
    private static func goMarks(file: URL, text: String, symbols: [DocumentSymbol], info: GoPackageInfo) async -> [RunMark] {
        RunMarkFinder.goMarks(file: file, text: text, symbols: symbols, package: info)
    }

    @concurrent
    private static func scriptMarks(file: URL, text: String, project: ScriptProject) async -> [RunMark] {
        RunMarkFinder.scriptMarks(file: file, text: text, project: project)
    }

    @concurrent
    static func goPackage(for file: URL, top: URL) async -> GoPackageInfo? {
        let directory = file.deletingLastPathComponent()
        var folder = directory
        while folder.path.hasPrefix(top.path), folder.path != "/" {
            let manifest = folder.appendingPathComponent("go.mod")
            if let text = try? String(contentsOf: manifest, encoding: .utf8) {
                guard let line = text.split(separator: "\n").first(where: { $0.hasPrefix("module ") }) else { return nil }
                let module = line.dropFirst("module ".count).trimmingCharacters(in: .whitespaces)
                let relative = String(directory.path.dropFirst(folder.path.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                return GoPackageInfo(importPath: relative.isEmpty ? module : module + "/" + relative, directory: directory)
            }
            folder = folder.deletingLastPathComponent()
        }
        return nil
    }

    @concurrent
    static func scriptProject(for file: URL, top: URL) async -> ScriptProject? {
        var folder = file.deletingLastPathComponent()
        while folder.path.hasPrefix(top.path), folder.path != "/" {
            if let data = try? Data(contentsOf: folder.appendingPathComponent("package.json")), let manifest = JSON.parse(data) {
                return project(manifest, root: folder)
            }
            folder = folder.deletingLastPathComponent()
        }
        return nil
    }

    nonisolated static func project(_ manifest: JSON, root: URL) -> ScriptProject {
        let place = { (path: String) in Wire.canonical(root.appendingPathComponent(path)) }
        let scripts = manifest["scripts"]?.object ?? [:]
        var entries: [ScriptProject.Entry] = scripts.keys.sorted().compactMap { name in
            let words = (scripts[name]?.string ?? "").split(separator: " ").map(String.init)
            guard words.first == "node", let file = words.dropFirst().firstIndex(where: { !$0.hasPrefix("-") }) else { return nil }
            return ScriptProject.Entry(
                name: name, file: place(words[file]), arguments: Array(words[(file + 1)...]),
                runtimeArguments: Array(words[1..<file]), command: ["npm", "run", name]
            )
        }
        let package = manifest["name"]?.string ?? root.lastPathComponent
        var bins: [(String, String)] = []
        if let bin = manifest["bin"]?.string { bins.append((package, bin)) }
        for (name, path) in manifest["bin"]?.object ?? [:] { if let path = path.string { bins.append((name, path)) } }
        if let main = manifest["main"]?.string { bins.append((package, main)) }
        entries += bins.sorted { $0.0 < $1.0 }.map { name, path in
            ScriptProject.Entry(name: name, file: place(path), arguments: [], runtimeArguments: [], command: ["node", path])
        }
        let dependencies = Set((manifest["dependencies"]?.object ?? [:]).keys).union((manifest["devDependencies"]?.object ?? [:]).keys)
        let test = scripts["test"]?.string ?? ""
        let runner: TestRunner? = if dependencies.contains("vitest") || test.contains("vitest") {
            .vitest
        } else if dependencies.contains("jest") || test.contains("jest") {
            .jest
        } else if test.contains("--test") {
            .node
        } else {
            nil
        }
        return ScriptProject(root: root, entries: entries, runner: runner)
    }
}
