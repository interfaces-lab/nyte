import Foundation

struct IgnoreRules: Sendable {
    struct Rule: Sendable {
        let glob: Glob
        let isNegated: Bool
        let base: [UInt8]
    }

    private(set) var rules: [Rule] = []

    var count: Int { rules.count }

    mutating func add(_ text: [UInt8], base: [UInt8]) {
        for raw in text.split(separator: UInt8(ascii: "\n"), omittingEmptySubsequences: true) {
            var line = Array(raw)
            if line.last == UInt8(ascii: "\r") { line.removeLast() }
            while let last = line.last, last == UInt8(ascii: " "), line.count < 2 || line[line.count - 2] != UInt8(ascii: "\\") {
                line.removeLast()
            }
            guard let first = line.first, first != UInt8(ascii: "#") else { continue }
            var negated = false
            if first == UInt8(ascii: "!") {
                negated = true
                line.removeFirst()
            } else if first == UInt8(ascii: "\\"), line.count > 1, line[1] == UInt8(ascii: "!") || line[1] == UInt8(ascii: "#") {
                line.removeFirst()
            }
            guard !line.isEmpty else { continue }
            rules.append(Rule(glob: Glob(String(decoding: line, as: UTF8.self)), isNegated: negated, base: base))
        }
    }

    mutating func truncate(to count: Int) {
        rules.removeSubrange(count...)
    }

    func isIgnored(_ path: UnsafeBufferPointer<UInt8>, isDirectory: Bool) -> Bool {
        let name = path.lastIndex(of: UInt8(ascii: "/")).map { $0 + 1 } ?? 0
        for rule in rules.reversed() {
            if rule.glob.isDirectoryOnly, !isDirectory { continue }
            guard rule.base.count < path.count || rule.base.isEmpty else { continue }
            let hasBase = rule.base.withUnsafeBufferPointer { base in
                base.isEmpty || memcmp(base.baseAddress, path.baseAddress, base.count) == 0
            }
            guard hasBase else { continue }
            let subject = rule.glob.isAnchored
                ? UnsafeBufferPointer(rebasing: path[rule.base.count...])
                : UnsafeBufferPointer(rebasing: path[max(name, rule.base.count)...])
            if Glob.matches(rule.glob.pattern[...], subject) { return !rule.isNegated }
        }
        return false
    }
}

struct IgnoreSources: Sendable {
    var home: URL
    var environment: [String: String]

    static var user: IgnoreSources {
        IgnoreSources(home: FileManager.default.homeDirectoryForCurrentUser, environment: ProcessInfo.processInfo.environment)
    }

    func base(for root: String) -> IgnoreRules {
        var rules = IgnoreRules()
        if let global = globalExcludesFile(), let text = FileManager.default.contents(atPath: global.path) {
            rules.add(Array(text), base: [])
        }
        if let text = FileManager.default.contents(atPath: root + "/.git/info/exclude") {
            rules.add(Array(text), base: [])
        }
        return rules
    }

    func globalExcludesFile() -> URL? {
        let configHome = environment["XDG_CONFIG_HOME"].map { URL(fileURLWithPath: $0) } ?? home.appendingPathComponent(".config")
        let configs = [configHome.appendingPathComponent("git/config"), home.appendingPathComponent(".gitconfig")]
        let named = configs.compactMap { url in
            FileManager.default.contents(atPath: url.path).flatMap { Self.excludesFile(in: String(decoding: $0, as: UTF8.self)) }
        }.last
        guard let named else { return configHome.appendingPathComponent("git/ignore") }
        if named.hasPrefix("~/") { return home.appendingPathComponent(String(named.dropFirst(2))) }
        return URL(fileURLWithPath: named)
    }

    static func excludesFile(in config: String) -> String? {
        var inCore = false
        var found: String?
        for raw in config.split(whereSeparator: \.isNewline) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("[") {
                inCore = line.lowercased().hasPrefix("[core")
                continue
            }
            guard inCore, let equals = line.firstIndex(of: "=") else { continue }
            guard line[..<equals].trimmingCharacters(in: .whitespaces).lowercased() == "excludesfile" else { continue }
            var value = line[line.index(after: equals)...].trimmingCharacters(in: .whitespaces)
            if value.hasPrefix("\""), value.hasSuffix("\""), value.count >= 2 { value = String(value.dropFirst().dropLast()) }
            found = value
        }
        return found
    }
}
