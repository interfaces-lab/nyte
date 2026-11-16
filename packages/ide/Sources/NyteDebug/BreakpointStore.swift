import Foundation
import NyteCore
import os

public struct Breakpoint: Sendable, Hashable, Codable {
    public var line: Int
    public var isEnabled: Bool
    public var condition: String
    public var hitCondition: String
    public var logMessage: String
    public var verification = SourceBreakpoint.Verification.notDebugging

    enum CodingKeys: String, CodingKey {
        case line, isEnabled, condition, hitCondition, logMessage
    }

    public init(line: Int, isEnabled: Bool = true, condition: String = "", hitCondition: String = "", logMessage: String = "") {
        self.line = line
        self.isEnabled = isEnabled
        self.condition = condition
        self.hitCondition = hitCondition
        self.logMessage = logMessage
    }

    public var isLogpoint: Bool { !logMessage.isEmpty }

    var source: SourceBreakpoint {
        SourceBreakpoint(zeroBasedLine: line, isEnabled: isEnabled, condition: condition, hitCondition: hitCondition,
                         logMessage: logMessage, verification: verification)
    }
}

public struct PlacedBreakpoint: Sendable, Hashable {
    public var url: URL
    public var breakpoint: Breakpoint
}

public struct ExceptionBreakpoint: Sendable, Hashable {
    public var adapter: String
    public var filter: ExceptionFilter
    public var isEnabled: Bool

    public var adapterName: String {
        switch adapter {
        case "go": "Go"
        case "pwa-node": "JavaScript"
        default: adapter
        }
    }
}

struct BreakpointSet: Sendable, Equatable, Codable {
    static let currentVersion = 1

    var version = BreakpointSet.currentVersion
    var files: [String: [Breakpoint]] = [:]
    var exceptionChoices: [String: Bool] = [:]
    var exceptionFilters: [String: [ExceptionFilter]] = [:]
}

struct BreakpointPlan: Sendable {
    var files: [URL: [Breakpoint]]
    var exceptionChoices: [String: Bool]

    static let none = BreakpointPlan(files: [:], exceptionChoices: [:])

    func enabledFilters(_ filters: [ExceptionFilter], adapter: String) -> [String] {
        filters.filter { exceptionChoices[adapter + "/" + $0.id] ?? $0.isDefault }.map(\.id)
    }
}

struct BreakpointStore {
    private(set) var files: [URL: [Breakpoint]] = [:]
    private(set) var exceptionChoices: [String: Bool] = [:]
    private(set) var exceptionFilters: [String: [ExceptionFilter]] = [:]
    private let key: String

    init(workspace: Workspace) {
        key = "sh.nyte.ide.breakpoints.v1:" + workspace.root.path
        guard let data = UserDefaults.standard.data(forKey: key) else { return }
        let saved: BreakpointSet
        do {
            saved = try JSONDecoder().decode(BreakpointSet.self, from: data)
        } catch {
            Logger.debugger.error("decode breakpoints failed, starting empty: \(error.localizedDescription, privacy: .public)")
            return
        }
        guard saved.version == BreakpointSet.currentVersion else {
            Logger.debugger.error("breakpoints have version \(saved.version), expected \(BreakpointSet.currentVersion); starting empty")
            return
        }
        for (path, list) in saved.files {
            files[URL(fileURLWithPath: path).standardizedFileURL] = list.filter { $0.line >= 0 }.sorted { $0.line < $1.line }
        }
        exceptionChoices = saved.exceptionChoices
        exceptionFilters = saved.exceptionFilters
    }

    subscript(url: URL) -> [Breakpoint] {
        get { files[url] ?? [] }
        set {
            var unique: [Int: Breakpoint] = [:]
            for breakpoint in newValue where breakpoint.line >= 0 { unique[breakpoint.line] = breakpoint }
            files[url] = unique.isEmpty ? nil : unique.values.sorted { $0.line < $1.line }
            save()
        }
    }

    var plan: BreakpointPlan {
        BreakpointPlan(files: files, exceptionChoices: exceptionChoices)
    }

    mutating func removeAll() {
        files.removeAll()
        save()
    }

    mutating func choose(_ filter: String, adapter: String, enabled: Bool) {
        exceptionChoices[adapter + "/" + filter] = enabled
        save()
    }

    mutating func remember(_ filters: [ExceptionFilter], adapter: String) {
        guard exceptionFilters[adapter] != filters else { return }
        exceptionFilters[adapter] = filters.isEmpty ? nil : filters
        save()
    }

    func exceptionBreakpoints() -> [ExceptionBreakpoint] {
        exceptionFilters.keys.sorted().flatMap { adapter in
            (exceptionFilters[adapter] ?? []).map { filter in
                ExceptionBreakpoint(adapter: adapter, filter: filter,
                                    isEnabled: exceptionChoices[adapter + "/" + filter.id] ?? filter.isDefault)
            }
        }
    }

    mutating func setVerification(_ verification: SourceBreakpoint.Verification, in url: URL, line: Int? = nil) {
        guard var list = files[url] else { return }
        for index in list.indices where line == nil || list[index].line == line {
            list[index].verification = verification
        }
        files[url] = list
    }

    private func save() {
        var saved = BreakpointSet()
        saved.files = Dictionary(uniqueKeysWithValues: files.map { ($0.key.path, $0.value) })
        saved.exceptionChoices = exceptionChoices
        saved.exceptionFilters = exceptionFilters
        do {
            UserDefaults.standard.set(try JSONEncoder().encode(saved), forKey: key)
        } catch {
            Logger.debugger.error("encode breakpoints failed: \(error.localizedDescription, privacy: .public)")
        }
    }
}
