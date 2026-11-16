import Foundation

struct VariableRow: Sendable {
    enum Kind: Sendable, Equatable { case group, variable, watch, result, failure, more }

    var kind: Kind
    var depth: Int
    var path: String
    var name: String
    var type = ""
    var value = ""
    var reference = 0
    var indexed: Int?
    var isChanged = false
    var isOpen = false
    var count = 0
    var pins = false
    var endsGroup = false
}

struct VariableTree: Sendable {
    static let page = 100
    static let watchesPath = "watches"
    static let resultPath = "result"

    var frameKey = ""
    var scopes: [DebugScope] = []
    var watches: [String] = []
    var watchValues: [String: Result<DebugVariable, DebugFailure>] = [:]
    var result: (expression: String, value: Result<DebugVariable, DebugFailure>)?
    var children: [String: [DebugVariable]] = [:]
    var shown: [String: Int] = [:]
    var totals: [String: Int] = [:]
    var indexedLoaded: [String: Int] = [:]
    var opened: Set<String> = []
    var closed: Set<String> = []
    private(set) var rows: [VariableRow] = []

    func scopePath(_ scope: DebugScope) -> String { frameKey + "/" + scope.name }

    static func watchPath(_ expression: String) -> String { "watch/" + expression }

    func opensByDefault(_ path: String) -> Bool {
        path == Self.watchesPath || scopes.first.map { scopePath($0) == path } == true
    }

    func isOpen(_ path: String) -> Bool {
        opensByDefault(path) ? !closed.contains(path) : opened.contains(path)
    }

    mutating func setOpen(_ path: String, _ open: Bool) {
        if opensByDefault(path) {
            if open { closed.remove(path) } else { closed.insert(path) }
            return
        }
        if open { opened.insert(path) } else { opened.remove(path) }
    }

    mutating func clearFrame() {
        frameKey = ""
        scopes = []
        children = [:]
        shown = [:]
        totals = [:]
        indexedLoaded = [:]
        result = nil
        watchValues = [:]
        rebuild()
    }

    mutating func rebuild() {
        var rows: [VariableRow] = []
        if let result {
            append(result.value, name: result.expression, kind: .result, path: Self.resultPath, depth: 0, into: &rows)
        }
        if !watches.isEmpty {
            let open = isOpen(Self.watchesPath)
            rows.append(VariableRow(kind: .group, depth: 0, path: Self.watchesPath, name: "Watches", isOpen: open, count: watches.count))
            if open {
                for expression in watches {
                    let path = Self.watchPath(expression)
                    guard let value = watchValues[expression] else {
                        rows.append(VariableRow(kind: .watch, depth: 0, path: path, name: expression))
                        continue
                    }
                    append(value, name: expression, kind: .watch, path: path, depth: 0, into: &rows)
                }
            }
        }
        for scope in scopes {
            let path = scopePath(scope)
            let open = isOpen(path)
            rows.append(VariableRow(kind: .group, depth: 0, path: path, name: scope.name, reference: scope.reference, isOpen: open,
                                    count: children[path]?.count ?? 0))
            if open { appendChildren(of: path, depth: 0, into: &rows) }
        }
        self.rows = rows
    }

    private func append(_ value: Result<DebugVariable, DebugFailure>, name: String, kind: VariableRow.Kind, path: String, depth: Int,
                        into rows: inout [VariableRow]) {
        switch value {
        case let .success(variable):
            var named = variable
            named.name = name
            append(named, kind: kind, path: path, depth: depth, into: &rows)
        case let .failure(failure):
            rows.append(VariableRow(kind: .failure, depth: depth, path: path, name: name, value: failure.message))
        }
    }

    private func append(_ variable: DebugVariable, kind: VariableRow.Kind, path: String, depth: Int, into rows: inout [VariableRow]) {
        let open = variable.reference > 0 && opened.contains(path)
        let total = variable.indexedCount ?? totals[path] ?? children[path]?.count ?? 0
        rows.append(VariableRow(
            kind: kind, depth: depth, path: path, name: variable.name, type: variable.type, value: variable.value,
            reference: variable.reference, indexed: variable.indexedCount, isChanged: variable.isChanged, isOpen: open,
            count: total, pins: open && total > Self.page
        ))
        guard open else { return }
        let first = rows.count
        appendChildren(of: path, depth: depth + 1, into: &rows)
        if rows[first - 1].pins, rows.count > first { rows[rows.count - 1].endsGroup = true }
    }

    private func appendChildren(of path: String, depth: Int, into rows: inout [VariableRow]) {
        guard let kids = children[path] else { return }
        let limit = shown[path] ?? Self.page
        for kid in kids.prefix(limit) {
            append(kid, kind: .variable, path: path + "/" + kid.name, depth: depth, into: &rows)
        }
        let remaining = kids.count - min(limit, kids.count) + unloaded(path)
        if remaining > 0 {
            rows.append(VariableRow(kind: .more, depth: depth, path: path, name: "Show more", count: remaining))
        }
    }

    func unloaded(_ path: String) -> Int {
        max(0, (totals[path] ?? 0) - (indexedLoaded[path] ?? 0))
    }

    func reference(at path: String) -> Int? {
        rows.first { $0.path == path && $0.kind != .more }?.reference
    }
}
