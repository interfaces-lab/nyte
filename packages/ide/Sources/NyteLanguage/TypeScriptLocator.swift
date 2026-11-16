import Foundation
import NyteCore

struct NativeTypeScript: Sendable, Equatable {
    var executable: URL
    var version: String
    var source: ToolSource
    var package: String
}

enum TypeScriptLocator {
    #if arch(arm64)
        static let architecture = "darwin-arm64"
    #else
        static let architecture = "darwin-x64"
    #endif

    static let previewName = "@typescript/native-preview"
    static let machOMagics: Set<UInt32> = [0xFEED_FACF, 0xCAFE_BABE, 0xBEBA_FECA]

    static func find(from root: URL, toolchain: Toolchain) async -> NativeTypeScript? {
        if let found = project(from: root) { return found }
        if let found = await environment(toolchain) { return found }
        return bundled()
    }

    static func project(from root: URL) -> NativeTypeScript? {
        var folder = root.standardizedFileURL
        while folder.path != "/" {
            let found = candidates(in: folder.appendingPathComponent("node_modules"), source: .project)
            if !found.isEmpty { return choose(found, named: dependencies(of: folder)) }
            folder = folder.deletingLastPathComponent()
        }
        return nil
    }

    static func environment(_ toolchain: Toolchain) async -> NativeTypeScript? {
        for name in ["tsgo", "tsc"] {
            guard let tool = await toolchain.resolve(name, from: [.path, .local, .homebrew]) else { continue }
            if let found = program(tool.url, source: tool.source, package: name) { return found }
        }
        guard let root = await toolchain.npmGlobalRoot() else { return nil }
        let found = candidates(in: root, source: .npmGlobal)
        return found.isEmpty ? nil : choose(found, named: [])
    }

    static func bundled() -> NativeTypeScript? {
        let found = candidates(in: Toolchain.managedRoot.appendingPathComponent("node/node_modules"), source: .bundled)
        return found.isEmpty ? nil : choose(found, named: [])
    }

    static func libraryVersion(from root: URL) -> String? {
        var folder = root.standardizedFileURL
        while folder.path != "/" {
            if let package = read(folder.appendingPathComponent("node_modules/typescript")) { return package.version }
            folder = folder.deletingLastPathComponent()
        }
        return nil
    }

    static func candidates(in modules: URL, source: ToolSource) -> [NativeTypeScript] {
        let manager = FileManager.default
        guard manager.fileExists(atPath: modules.path) else { return [] }
        let scope = modules.appendingPathComponent("@typescript")
        let scoped = ((try? manager.contentsOfDirectory(atPath: scope.path)) ?? [])
            .filter { !$0.hasSuffix(architecture) && !$0.hasPrefix(".") }
            .sorted()
            .map { ("@typescript/" + $0, scope.appendingPathComponent($0)) }
        let packages = [("typescript", modules.appendingPathComponent("typescript"))] + scoped
        let installed = packages.compactMap { name, folder in native(at: folder, source: source, package: name) }
        let linked = ["tsc", "tsgo"].compactMap { name in
            program(modules.appendingPathComponent(".bin/\(name)"), source: source, package: ".bin/\(name)")
        }
        return installed + linked
    }

    static func choose(_ found: [NativeTypeScript], named: Set<String>) -> NativeTypeScript? {
        let preferred = found.filter { named.contains($0.package) }
        return (preferred.isEmpty ? found : preferred).max { isOlder($0.version, than: $1.version) }
    }

    static func program(_ url: URL, source: ToolSource, package: String) -> NativeTypeScript? {
        let resolved = url.resolvingSymlinksInPath()
        guard FileManager.default.fileExists(atPath: resolved.path) else { return nil }
        var folder = resolved.deletingLastPathComponent()
        for _ in 0..<3 {
            if FileManager.default.fileExists(atPath: folder.appendingPathComponent("package.json").path) {
                return native(at: folder, source: source, package: package)
            }
            folder = folder.deletingLastPathComponent()
        }
        guard isMachO(resolved) else { return nil }
        return NativeTypeScript(executable: resolved, version: "", source: source, package: package)
    }

    static func native(at folder: URL, source: ToolSource, package: String) -> NativeTypeScript? {
        guard let read = read(folder) else { return nil }
        let base: (name: String, program: String)
        switch read.name {
        case "typescript" where read.major >= 7: base = ("typescript", "tsc")
        case previewName: base = ("native-preview", "tsgo")
        default: return nil
        }
        guard let binary = platformBinary(of: folder, base: base.name, program: base.program) else { return nil }
        return NativeTypeScript(executable: binary, version: read.version, source: source, package: package)
    }

    static func platformBinary(of package: URL, base: String, program: String) -> URL? {
        let platform = "@typescript/\(base)-\(architecture)/lib/\(program)"
        var folder = package.resolvingSymlinksInPath()
        while folder.path != "/" {
            let places = [folder.appendingPathComponent("node_modules/" + platform)]
                + (folder.lastPathComponent == "node_modules" ? [folder.appendingPathComponent(platform)] : [])
            if let binary = places.first(where: { FileManager.default.isExecutableFile(atPath: $0.path) }) { return binary }
            folder = folder.deletingLastPathComponent()
        }
        return nil
    }

    static func read(_ folder: URL) -> (name: String, version: String, major: Int)? {
        guard let data = try? Data(contentsOf: folder.appendingPathComponent("package.json")), let json = JSON.parse(data),
              let version = json["version"]?.string
        else { return nil }
        return (json["name"]?.string ?? "", version, Int(version.prefix { $0.isNumber }) ?? 0)
    }

    static func dependencies(of folder: URL) -> Set<String> {
        guard let data = try? Data(contentsOf: folder.appendingPathComponent("package.json")), let json = JSON.parse(data) else { return [] }
        return Set(["dependencies", "devDependencies", "optionalDependencies"].flatMap { json[$0]?.object?.keys.map(\.self) ?? [] })
    }

    static func isOlder(_ left: String, than right: String) -> Bool {
        let split = { (version: String) -> (numbers: [Int], tag: String?) in
            let parts = version.split(separator: "-", maxSplits: 1)
            return ((parts.first ?? "").split(separator: ".").map { Int($0) ?? 0 }, parts.count > 1 ? String(parts[1]) : nil)
        }
        let one = split(left), two = split(right)
        for index in 0..<max(one.numbers.count, two.numbers.count) {
            let first = index < one.numbers.count ? one.numbers[index] : 0
            let second = index < two.numbers.count ? two.numbers[index] : 0
            if first != second { return first < second }
        }
        switch (one.tag, two.tag) {
        case let (first?, second?): return first.compare(second, options: .numeric) == .orderedAscending
        case (.some, nil): return true
        default: return false
        }
    }

    static func isMachO(_ url: URL) -> Bool {
        guard let handle = try? FileHandle(forReadingFrom: url), let data = try? handle.read(upToCount: 4), data.count == 4 else {
            return false
        }
        let magic = data.withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }
        return machOMagics.contains(magic)
    }
}
