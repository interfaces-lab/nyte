import Foundation
import NyteCore

enum TargetFinder {
    private static let folderLimit = 2_000
    private static let nodeExtensions: Set<String> = ["js", "mjs", "cjs", "ts", "mts"]
    private static let headBytes = 8_192

    static func targets(in workspace: Workspace, near file: URL?) -> [DebugTarget] {
        var found: [DebugTarget] = []
        var scripts: [URL] = []
        var tests: [DebugTarget] = []
        var folders = [workspace.root]
        var visited = 0
        while let folder = folders.popLast(), visited < folderLimit {
            visited += 1
            let entries = (try? FileManager.default.contentsOfDirectory(
                at: folder, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles]
            )) ?? []
            var isMain = false
            var hasTests = false
            for entry in entries.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
                let name = entry.lastPathComponent
                if (try? entry.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true {
                    if name != "vendor", name != "node_modules" { folders.append(entry) }
                } else if name == "package.json" {
                    scripts.append(entry)
                } else if !isMain, name.hasSuffix(".go"), !name.hasSuffix("_test.go") {
                    isMain = declaresMain(entry)
                } else if !hasTests, name.hasSuffix("_test.go") {
                    hasTests = !testNames(in: entry).isEmpty
                }
            }
            if hasTests {
                let package = folder.path == workspace.root.path ? workspace.name : workspace.relativePath(of: folder)
                tests.append(DebugTarget(id: "test:" + folder.path, name: "Tests in \(package)", kind: .goTest(folder, test: nil),
                                         directory: folder))
            }
            if isMain {
                let relative = workspace.relativePath(of: folder)
                let name = folder.path == workspace.root.path ? workspace.name : relative
                found.append(DebugTarget(id: "go:" + folder.path, name: name, kind: .goPackage(folder), directory: folder))
            }
        }
        found.sort { $0.name < $1.name }
        if let file { found += targets(near: file.standardizedFileURL, in: workspace) }
        found += tests.sorted { $0.name < $1.name }
        let manifests = scripts.sorted { $0.path < $1.path }
        found += manifests.flatMap { nodeScripts(in: $0, workspace: workspace) }
        found += manifests.compactMap { nodeEntry(in: $0, workspace: workspace) }
        var seen: Set<String> = []
        return found.filter { seen.insert($0.id).inserted }
    }

    static let entryCandidates = ["src/index.ts", "src/main.ts", "index.ts", "main.ts", "src/index.js", "index.js"]

    private static func nodeEntry(in manifest: URL, workspace: Workspace) -> DebugTarget? {
        let folder = manifest.deletingLastPathComponent()
        let declared = (try? Data(contentsOf: manifest)).flatMap { JSON.parse($0)?["main"]?.string }
        let candidates = [declared].compactMap { $0 } + entryCandidates
        guard let file = candidates.lazy.map({ folder.appendingPathComponent($0).standardizedFileURL })
            .first(where: { nodeExtensions.contains($0.pathExtension) && FileManager.default.fileExists(atPath: $0.path) })
        else { return nil }
        return DebugTarget(id: "node:" + file.path, name: workspace.relativePath(of: file), kind: .node(file), directory: folder)
    }

    private static func targets(near file: URL, in workspace: Workspace) -> [DebugTarget] {
        let folder = file.deletingLastPathComponent()
        if file.lastPathComponent.hasSuffix("_test.go") {
            let package = workspace.relativePath(of: folder)
            let whole = DebugTarget(id: "test:" + folder.path, name: "Tests in \(package)", kind: .goTest(folder, test: nil), directory: folder)
            return [whole] + testNames(in: file).map { name in
                DebugTarget(id: "test:\(folder.path):\(name)", name: name, kind: .goTest(folder, test: name), directory: folder)
            }
        }
        guard nodeExtensions.contains(file.pathExtension) else { return [] }
        return [DebugTarget(
            id: "node:" + file.path, name: workspace.relativePath(of: file), kind: .node(file), directory: nodeFolder(for: file, in: workspace)
        )]
    }

    private static func nodeScripts(in manifest: URL, workspace: Workspace) -> [DebugTarget] {
        guard let data = try? Data(contentsOf: manifest), let scripts = JSON.parse(data)?["scripts"]?.object else { return [] }
        let folder = manifest.deletingLastPathComponent()
        return scripts.keys.sorted().compactMap { name in
            let words = (scripts[name]?.string ?? "").split(separator: " ").map(String.init)
            guard words.first == "node", let index = words.dropFirst().firstIndex(where: { !$0.hasPrefix("-") }) else { return nil }
            let file = folder.appendingPathComponent(words[index]).standardizedFileURL
            guard nodeExtensions.contains(file.pathExtension) else { return nil }
            let place = folder.path == workspace.root.path ? "" : " in \(workspace.relativePath(of: folder))"
            return DebugTarget(
                id: "script:\(manifest.path):\(name)", name: "npm \(name)\(place)", kind: .node(file), directory: folder,
                arguments: Array(words[(index + 1)...])
            )
        }
    }

    private static func declaresMain(_ file: URL) -> Bool {
        guard let handle = try? FileHandle(forReadingFrom: file) else { return false }
        defer { try? handle.close() }
        let head = String(decoding: (try? handle.read(upToCount: headBytes)) ?? Data(), as: UTF8.self)
        return head.split(separator: "\n").contains { $0.trimmingCharacters(in: .whitespaces) == "package main" }
    }

    private static func testNames(in file: URL) -> [String] {
        guard let text = try? String(contentsOf: file, encoding: .utf8) else { return [] }
        return text.split(separator: "\n").compactMap { line in
            guard line.hasPrefix("func Test"), let open = line.firstIndex(of: "(") else { return nil }
            return String(line[line.index(line.startIndex, offsetBy: 5)..<open])
        }
    }

    static func nodeFolder(for file: URL, in workspace: Workspace) -> URL {
        var folder = file.deletingLastPathComponent()
        while folder.path.hasPrefix(workspace.root.path), folder.path != workspace.root.path {
            if FileManager.default.fileExists(atPath: folder.appendingPathComponent("package.json").path) { return folder }
            folder = folder.deletingLastPathComponent()
        }
        return workspace.root
    }
}
