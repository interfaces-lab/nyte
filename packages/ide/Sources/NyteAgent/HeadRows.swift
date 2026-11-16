import Foundation

struct HeadRows: Sendable {
    enum Moved: Equatable {
        case applied
        case stale
        case old
    }

    let head: String
    private(set) var seq: Int
    private(set) var order: [String]
    private(set) var leadingPrompt: String?
    private(set) var messages: [String: Wire.Message] = [:]
    private(set) var parts: [String: Wire.Part] = [:]
    private(set) var turns: [String: Wire.Turn] = [:]
    private(set) var headRow: Wire.HeadRow?
    private(set) var settings: Wire.SettingsRow?
    private(set) var background: [String: Wire.BackgroundRow] = [:]
    private(set) var earlier: [String] = []
    private(set) var catalog: String?

    init(head: String, window: Wire.HeadWindow) {
        self.head = head
        seq = window.seq
        order = window.order
        leadingPrompt = window.leadingPrompt
        write(window.tables)
    }

    mutating func apply(_ change: Wire.SessionChange) -> Moved {
        guard change.seq >= seq else { return .old }
        seq = change.seq
        write(change.tables)
        for path in change.paths where path.head == head {
            guard move(path) else { return .stale }
        }
        return .applied
    }

    var resumePoint: Wire.Resume { Wire.Resume(seq: seq, from: order.first) }

    mutating func resume(_ window: Wire.HeadWindow) {
        seq = window.seq
        order = window.order
        leadingPrompt = window.leadingPrompt
        if window.complete {
            messages = [:]
            turns = [:]
            parts = [:]
            background = [:]
            earlier = []
        }
        background = background.filter { $0.value.head != head }
        write(window.tables)
        let kept = Set(earlier + order + (headRow?.queue ?? []) + [leadingPrompt].compactMap { $0 })
        messages = messages.filter { kept.contains($0.key) }
        let used = Set(messages.values.compactMap(\.turn))
        turns = turns.filter { used.contains($0.key) }
    }

    mutating func prepend(_ page: Wire.HistoryPage) -> Int {
        let held = Set(earlier + order)
        let fresh = page.messages.filter { !held.contains($0.id) }
        for message in fresh { messages[message.id] = message }
        for turn in page.turns { turns[turn.id] = turn }
        earlier = fresh.map(\.id) + earlier
        return fresh.count
    }

    var transcript: [String] {
        let shown = earlier + order
        guard let leadingPrompt, !shown.contains(leadingPrompt) else { return shown }
        return [leadingPrompt] + shown
    }

    var oldest: String? { earlier.first ?? order.first }

    var selectedModel: ModelRef? { settings?.selected }
    var effectiveModel: ModelRef? { settings?.selected ?? settings?.effective }

    private mutating func write(_ tables: Wire.Tables) {
        Self.replace(&messages, tables.messages, key: \.id)
        Self.replace(&turns, tables.turns, key: \.id)
        Self.replace(&parts, tables.parts, key: \.id)
        Self.replace(&background, tables.background, key: \.key)
        if let heads = tables.heads {
            if heads.drop.contains(head) { headRow = nil }
            headRow = heads.upsert.last { $0.name == head } ?? headRow
        }
        if let rows = tables.catalog {
            if let id = catalog, rows.drop.contains(id) { catalog = nil }
            catalog = rows.upsert.last?.id ?? catalog
        }
        if let rows = tables.settings {
            if rows.drop.contains(head) { settings = nil }
            settings = rows.upsert.last { $0.name == head } ?? settings
        }
    }

    private static func replace<Row>(_ rows: inout [String: Row], _ table: Wire.Table<Row>?, key: KeyPath<Row, String>) {
        guard let table else { return }
        for row in table.upsert { rows[row[keyPath: key]] = row }
        for id in table.drop { rows.removeValue(forKey: id) }
    }

    private mutating func move(_ path: Wire.PathChange) -> Bool {
        guard let after = path.after else {
            let kept = order.first.flatMap { path.ids.firstIndex(of: $0) }
            order = kept.map { Array(path.ids[$0...]) } ?? path.ids
            if kept == nil { leadingPrompt = nil }
            return true
        }
        guard let at = order.firstIndex(of: after) else { return false }
        order = Array(order[...at]) + path.ids
        return true
    }
}
