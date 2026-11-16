import AppKit
@testable import NyteUI

@MainActor
enum Specimens {
    static let listWidth: CGFloat = 336
    static let listRows = 9
    static let hoveredRow = 2
    static let selectedRow = 4

    static func icon(_ name: String) -> NSImage {
        FileIcon.forFile(named: name).image(for: NSApp.effectiveAppearance)
    }

    static func list(_ rows: [RowContent], height: CGFloat = Metric.row, outline: Bool = false, hovered: Int? = nil,
                     selected: IndexSet = [], focused: Bool = false, heightOf: ((Int) -> CGFloat)? = nil,
                     width: CGFloat = listWidth) -> NSView {
        let list = ListView()
        list.rowHeight = height
        list.isOutline = outline
        list.rowCount = { rows.count }
        list.content = { rows[$0] }
        list.heightOfRow = heightOf
        list.allowsMultipleSelection = true
        list.showsFocusAlways = focused
        list.acceptsFocus = focused
        list.verticalInset = Space.x1
        if let hovered { list.setHoveredRow(hovered) }
        list.reload()
        list.selectedRows = selected
        let card = PaneCard()
        card.embed(list)
        let total = (0 ..< rows.count).reduce(Space.x1 * 2) { $0 + (heightOf?($1) ?? height) }
        return Gallery.sized(card, width: width, height: total)
    }

    static func states(_ title: String, note: String = "", _ rows: [RowContent], height: CGFloat = Metric.row,
                       outline: Bool = false, hovered: Int = hoveredRow, selected: IndexSet = [selectedRow],
                       heightOf: ((Int) -> CGFloat)? = nil) -> NSView {
        Gallery.section(title, note: note, [Gallery.row([
            Gallery.specimen("typing goes elsewhere; one row hovered", list(rows, height: height, outline: outline,
                                                                           hovered: hovered, selected: selected,
                                                                           heightOf: heightOf)),
            Gallery.specimen("focused from a field: fill only", list(rows, height: height, outline: outline, selected: selected,
                                                  focused: true, heightOf: heightOf)),
        ])])
    }

    static var outline: [RowContent] {
        func symbol(_ letter: Character, _ syntax: SyntaxColor, _ title: String, _ detail: String = "", depth: Int = 0,
                    _ disclosure: RowContent.Disclosure = .none) -> RowContent {
            RowContent(title: title, detail: detail, leading: .mark(.code(letter, syntax)), depth: depth, disclosure: disclosure)
        }
        return [
            symbol("T", .type, "Hub", "struct", .open),
            symbol("f", .property, "clients", "map[*Client]bool", depth: 1),
            symbol("f", .property, "broadcast", "chan []byte", depth: 1),
            symbol("f", .property, "register", "chan *Client", depth: 1),
            symbol("m", .function, "run", "()", depth: 1),
            symbol("m", .function, "shutdown", "(ctx context.Context) error", depth: 1),
            symbol("F", .function, "newHub", "() *Hub"),
            symbol("T", .type, "Client", "struct", .closed),
            symbol("C", .constant, "maxMessageSize", "= 512"),
        ]
    }

    static let boundedMeta: CGFloat = 120
    static let fitWidths: [CGFloat] = [256, 320, 480]

    static var codeMatches: [RowContent] {
        let lines: [(String, String, String, NSRange?, NSRange?)] = [
            ("c.hub.broadcast <- message", "broadcast", ":44", nil, nil),
            ("// broadcast fans out to every client", "broadcast", ":12", nil, nil),
            ("h.broadcast <- msg", "broadcast", ":58", NSRange(location: 2, length: 9), NSRange(location: 11, length: 4)),
        ]
        return lines.map { line, query, place, removed, added in
            var row = RowContent(title: removed == nil ? line : "h.broadcastsend <- msg", meta: place, depth: 1)
            row.monospace = true
            row.syntax = CodeColors.ranges(in: row.title, language: "go")
            row.emphasis = [(row.title as NSString).range(of: query)]
            row.removed = removed.map { [$0] } ?? []
            row.added = added.map { [$0] } ?? []
            return row
        }
    }

    static let shortWidths: [CGFloat] = [176, 216, 300]

    static var signatures: [RowContent] {
        [("send", "(message: string, attachments: File[])", "Promise<void>"), ("Submit", "(ctx context.Context, message string)", "error"),
         ("subscribe", "(topic: string)", "Observable<Event>")].map { name, parameters, result in
            var row = RowContent(title: name, meta: result, leading: .mark(.code(letter: "m", semanticType: "method")))
            row.detail = parameters
            row.detailShort = "(\u{2026})"
            row.detailJoinsTitle = true
            row.detailInk = .secondary
            row.metaInk = .secondary
            if let open = result.firstIndex(of: "<") { row.metaShort = result[..<open] + "<\u{2026}>" }
            return row
        }
    }

    static var debugValues: [RowContent] {
        let rows: [(String, String, String)] = [
            ("user", "&main.User{Name: \"zelda\", Age: 117, Roles: []string{\"admin\"}}", "*main.User"),
            ("limit", "512", "int"),
            ("reply", "nil", "error"),
        ]
        return rows.map { name, value, type in
            var row = RowContent(title: name, meta: type, leading: .mark(.code(letter: "v", semanticType: "variable")))
            row.monospace = true
            row.value = "= " + value
            row.valueInk = .primary
            row.valueSyntax = CodeColors.ranges(in: row.value, language: "go")
            if name == "user" {
                row.description = value
                row.descriptionMonospace = true
                row.descriptionSyntax = CodeColors.ranges(in: value, language: "go")
            }
            return row
        }
    }

    static var changedFiles: [RowContent] {
        [("ChangesModel.swift", "Sources/NyteChanges", 128, 14), ("RowRenderer+Fit.swift", "Sources/NyteUI/Lists", 96, 0),
         ("Package.swift", "", 2, 1)].map { name, folder, added, removed in
            var row = RowContent(title: name, detail: folder, leading: .image(icon(name)))
            row.detailTruncation = .path
            row.diff = (added: added, removed: removed)
            row.status = GitChange.modified.status
            return row
        }
    }


    static var codeRows: [RowContent] {
        let rows: [(String, String, String)] = [
            ("client.send(msg)", "error: send on closed channel\n  goroutine 7 [running]:\n  main.(*Client).send(...)",
             "internal/server/realtime/client.go:88"),
            ("h.clients", "map[*main.Client]bool len: 3", "internal/server/realtime/hub.go:41"),
        ]
        return rows.map { title, description, place in
            var row = RowContent(title: title, meta: place, leading: .mark(.code(letter: "v", semanticType: "variable")))
            row.monospace = true
            row.description = description
            row.descriptionWraps = true
            row.descriptionMonospace = true
            row.metaTruncation = .path
            row.metaMaxWidth = boundedMeta
            return row
        }
    }

    static let pinnedVisibleRows: CGFloat = 6
    static let pinnedWidth: CGFloat = 300
    static var pinnedLists: [(list: ListView, scrollTo: CGFloat)] = []

    static var groupedProblems: [RowContent] {
        func problem(_ message: String, _ source: String, _ line: String) -> RowContent {
            var row = RowContent(title: message, detail: source, meta: line,
                                 leading: .symbol("exclamationmark.triangle.fill", .tone(.warning)), depth: 1)
            row.detailGap = Space.x2
            return row
        }
        func file(_ name: String, _ folder: String, _ count: Int) -> RowContent {
            var row = RowContent(title: name, detail: folder, meta: String(count), leading: .image(icon(name)), disclosure: .open)
            row.isGroupHeader = true
            row.detailTruncation = .path
            return row
        }
        let messages = ["unused parameter: ctx", "should omit type int", "error return value is not checked",
                        "redundant conversion", "loop variable captured", "empty branch"]
        return [file("hub.go", "internal/server/realtime/hub", 6)]
            + messages.enumerated().map { problem($1, "gopls · unusedparams", ":\(12 + $0 * 9)") }
            + [file("client.go", "internal/server/realtime/client", 6)]
            + messages.enumerated().map { problem($1, "staticcheck · SA4006", ":\(20 + $0 * 7)") }
    }

    static func pinned(_ rows: [RowContent], scrolledBy offset: CGFloat) -> NSView {
        let list = ListView()
        list.rowCount = { rows.count }
        list.content = { rows[$0] }
        list.isOutline = true
        list.pinsGroupHeaders = true
        list.verticalInset = Space.x1
        list.reload()
        pinnedLists.append((list, offset))
        let card = PaneCard()
        card.embed(list)
        return Gallery.sized(card, width: pinnedWidth, height: Metric.row * pinnedVisibleRows)
    }

    static func scrollPinnedLists() {
        for (list, offset) in pinnedLists {
            list.layoutSubtreeIfNeeded()
            let clip = list.scrollView.contentView
            clip.scroll(to: NSPoint(x: 0, y: offset))
            list.scrollView.reflectScrolledClipView(clip)
        }
        pinnedLists = []
    }

    static var problems: [RowContent] {
        func problem(_ error: Bool, _ title: String, _ line: String) -> RowContent {
            RowContent(title: title, meta: line, leading: .symbol(
                error ? "xmark.octagon.fill" : "exclamationmark.triangle.fill", .tone(error ? .danger : .warning)
            ), depth: 1)
        }
        return [
            .header("hub.go", detail: "3 problems", leading: .image(icon("hub.go")), disclosure: .open),
            problem(true, "undefined: upgrader", ":42"),
            problem(true, "cannot use msg (variable of type string) as []byte value", ":67"),
            problem(false, "unused parameter: ctx", ":93"),
            .header("client.go", detail: "2 problems", leading: .image(icon("client.go")), disclosure: .open),
            problem(false, "error return value of conn.Close is not checked", ":18"),
            problem(false, "should omit type int from declaration", ":31"),
            .header("main.go", detail: "1 problem", leading: .image(icon("main.go")), disclosure: .closed),
            .header("README.md", detail: "4 problems", leading: .image(icon("README.md")), disclosure: .closed),
        ]
    }

    static var findResults: [RowContent] {
        func match(_ line: String, _ number: String, _ query: String) -> RowContent {
            let line = line.trimmingCharacters(in: .whitespaces)
            var row = RowContent(title: line, depth: 1)
            row.number = number
            row.monospace = true
            row.syntax = CodeColors.ranges(in: line, language: "go")
            let range = (line as NSString).range(of: query)
            if range.location != NSNotFound { row.emphasis = [range] }
            row.actions = searchActions
            return row
        }
        return [
            .header("hub.go", detail: "3 results", leading: .image(icon("hub.go")), disclosure: .open),
            match("func (h *Hub) broadcast(msg []byte) {", "24", "broadcast"),
            match("    h.broadcast <- msg", "58", "broadcast"),
            match("case message := <-h.broadcast:", "171", "broadcast"),
            .header("client.go", detail: "2 results", leading: .image(icon("client.go")), disclosure: .open),
            match("c.hub.broadcast <- message", "44", "broadcast"),
            match("// broadcast fans out to every client", "112", "broadcast"),
            .header("hub_test.go", detail: "1 result", leading: .image(icon("hub_test.go")), disclosure: .closed),
            .header("docs/protocol.md", detail: "6 results", leading: .image(icon("protocol.md")), disclosure: .closed),
        ]
    }

    static let searchActions = [
        RowContent.Action("replace", symbol: "arrow.2.squarepath", label: "Replace", key: "r", modifiers: [.command, .shift]),
        RowContent.Action("replace-file", symbol: "doc.on.doc", label: "Replace All in File"),
        RowContent.Action("dismiss", symbol: "xmark", label: "Dismiss", key: "\u{7F}"),
    ]

    static var changesWithActions: [RowContent] {
        let files: [(String, String, GitChange)] = [
            ("ChangesModel.swift", "Sources/NyteChanges", .modified), ("RowRenderer+Fit.swift", "Sources/NyteUI/Lists", .added),
            ("ListView+Actions.swift", "Sources/NyteUI/Lists", .added), ("Package.swift", "", .modified),
            ("TabStripView.swift", "Sources/NyteIDE/Shell", .deleted),
        ]
        return files.map { name, folder, change in
            var row = RowContent(title: name, detail: folder, meta: "2m", leading: .image(icon(name)))
            row.detailTruncation = .path
            row.status = change.status
            row.actions = [
                RowContent.Action("discard", symbol: "arrow.uturn.backward", label: "Discard Changes", key: "\u{7F}", modifiers: .command),
                RowContent.Action("stage", symbol: "plus", label: "Stage", key: "s", modifiers: .command),
            ]
            return row
        }
    }

    static var refactorPreview: [RowContent] {
        func change(_ line: String, _ number: String, _ old: String, _ new: String, checked: Bool = true) -> RowContent {
            let start = (line as NSString).range(of: old).location
            var row = RowContent(title: (line as NSString).replacingCharacters(in: NSRange(location: start + old.utf16.count, length: 0),
                                                                                with: new), depth: 1)
            row.number = number
            row.monospace = true
            row.removed = [NSRange(location: start, length: old.utf16.count)]
            row.added = [NSRange(location: start + old.utf16.count, length: new.utf16.count)]
            row.check = checked ? .on : .off
            return row
        }
        func file(_ name: String, _ detail: String, _ count: String, _ check: Checkbox.State) -> RowContent {
            var row = RowContent(title: name, detail: detail, meta: count, leading: .image(icon(name)), disclosure: .open)
            row.titleWeight = .medium
            row.check = check
            return row
        }
        return [
            file("stats.go", "hub", "3 changes", .on),
            change("type Counts struct {", "6", "Counts", "Totals"),
            change("Total    Counts", "15", "Counts", "Totals"),
            change("Channels map[string]Counts", "16", "Counts", "Totals"),
            file("hub_test.go", "hub", "2 changes", .mixed),
            change("if got, want := stats.Total, (Counts{Submitted: 3});", "26", "Counts", "Totals"),
            change("if got, want := stats.Channels[\"email\"], (Counts{});", "29", "Counts", "Totals", checked: false),
        ]
    }

    static var frames: [RowContent] {
        func frame(_ name: String, _ location: String, library: Bool = false) -> RowContent {
            var row = RowContent(title: name, detail: location, leading: .symbol("function", library ? .tertiary : .secondary))
            if library { row.titleInk = .tertiary }
            return row
        }
        return [
            frame("main.verifyPassword", "(main.go:93)"),
            frame("main.tellUserPassword", "(main.go:81)"),
            frame("main.main", "(main.go:72)"),
            frame("runtime.main", "(proc.go:302)", library: true),
            frame("runtime.goexit", "(asm_arm64.s:1039)", library: true),
            {
                var row = RowContent.header("Async stack trace")
                row.showsRuleAbove = true
                return row
            }(),
            frame("net/http.(*conn).serve", "(server.go:2039)", library: true),
            frame("main.handler", "(main.go:40)"),
            frame("main.route", "(main.go:22)"),
        ]
    }

    static var variables: [RowContent] {
        func variable(_ letter: Character, _ name: String, _ type: String, _ value: String, _ syntax: SyntaxColor,
                      depth: Int = 0, _ disclosure: RowContent.Disclosure = .none) -> RowContent {
            var row = RowContent(title: name, detail: "= {\(type)}", leading: .mark(.code(letter, letter == "f" ? .property : .variable)), depth: depth,
                                 disclosure: disclosure)
            row.value = value
            row.valueInk = .syntax(syntax)
            return row
        }
        return [
            variable("p", "s", "string", "\"myZelda@\"", .string),
            variable("p", "sixOrMore", "bool", "false", .keyword),
            variable("p", "upper", "bool", "true", .keyword),
            variable("v", "letters", "int", "0", .number),
            variable("v", "c", "int32", "109", .number),
            variable("v", "user", "*main.User", "0x14000126000", .plain, .open),
            variable("f", "Name", "string", "\"zelda\"", .string, depth: 1),
            {
                var row = variable("f", "Bio", "string", "\"Princess of Hyrule, keeper of the Triforce of Wisdom, and wielder of the bow\"",
                                   .string, depth: 1)
                row.valueTruncation = .byTruncatingMiddle
                return row
            }(),
            variable("f", "Roles", "[]string", "len:2", .plain, depth: 1, .closed),
            variable("f", "Active", "bool", "true", .keyword, depth: 1),
        ]
    }

    static var sessions: [RowContent] {
        func session(_ status: TaskMark.Status, _ title: String, _ age: String, cost: String,
                     diff: (added: String, removed: String)? = nil, request: TaskMark.Request? = nil,
                     description: String = "") -> RowContent {
            var row = RowContent(title: title, meta: age, leading: .mark(.task(status)))
            row.diff = diff.map { (added: Int($0.added) ?? 0, removed: Int($0.removed) ?? 0) }
            row.badge = request.map(RowContent.Badge.request)
            row.titleWeight = status == .unread ? .medium : .regular
            row.description = description
            row.descriptionMeta = cost
            row.yieldOrder = [.secondaryMeta, .counts, .meta, .title]
            return row
        }
        return [
            session(.waiting, "Add support for sorting tasks by priority", "1m", cost: "$0.04", request: .question,
                    description: "Asked which field breaks ties"),
            session(.working, "Port the hub to context cancellation", "2m", cost: "$0.31", description: "Running go test ./..."),
            session(.retrying, "Add Taskly data import and export", "13m", cost: "$0.02", diff: ("377", "0"),
                    description: "Retrying: rate limited, next try in 20s"),
            session(.unread, "Explain the first option", "2h", cost: "$0.01", description: "Answered"),
            session(.failed, "Add configuration defaults and validation", "1d", cost: "$0.12", diff: ("171", "3"),
                    description: "The model provider refused the request"),
            session(.none, "Add support for reusable task templates", "5d", cost: "$1.08", description: "Archived"),
        ]
    }

    static let factWidths: [CGFloat] = [256, 320, 400]
    static let navigatorWidth: CGFloat = 220

    static var navigatorTree: [RowContent] {
        let entries: [(String, Int, Bool, GitChange?)] = [("internal", 0, true, nil), ("server", 1, true, nil), ("hub.go", 2, false, .modified),
                                                          ("hub_test.go", 2, false, .added), ("client.go", 2, false, nil),
                                                          ("stats.go", 2, false, .deleted), ("go.mod", 0, false, .modified)]
        return entries.map { name, depth, folder, change in
            var row = RowContent(title: name, leading: folder ? FileIcon.folderLeading(open: true, ink: .secondary) : .image(icon(name)),
                                 depth: depth, disclosure: folder ? .open : .none)
            row.layout = .tree
            row.titleInk = folder ? .secondary : .primary
            row.status = change?.status
            row.marksFollowTitle = true
            if folder, depth == 1 { row.changeDot = Palette.gitContainsChange }
            return row
        }
    }

    static var sessionStates: [RowContent] {
        let rows: [(TaskMark.Status, String, String, (Int, Int)?, TaskMark.Request?)] = [
            (.working, "Port the hub to context cancellation", "2m", (42, 7), nil),
            (.retrying, "Add Taskly data import and export", "13m", (377, 0), nil),
            (.waiting, "Add support for sorting tasks by priority", "1m", nil, .approval),
            (.waiting, "Explain the retry budget", "4m", (3, 1), .question),
            (.unread, "Explain the first option", "2h", nil, nil),
            (.failed, "Add configuration defaults and validation", "1d", (171, 3), nil),
        ]
        return rows.map { status, title, age, diff, request in
            var row = RowContent(title: title, meta: age, leading: .mark(.task(status)))
            row.diff = diff.map { (added: $0.0, removed: $0.1) }
            row.badge = request.map(RowContent.Badge.request)
            row.titleWeight = status == .unread ? .medium : .regular
            row.alignsFacts = true
            row.yieldOrder = [.title]
            row.showsFrom = [.counts: RowContent.roomForColumns]
            row.toolTip = diff.map { "\(title)\n+\($0.0) \u{2212}\($0.1)" }
            return row
        }
    }

    static var folders: [RowContent] {
        [("internal", true, RowContent.Ink.secondary, 0), ("server", true, .secondary, 1), ("realtime", false, .secondary, 2),
         ("node_modules", false, .tertiary, 0), ("docs", false, .secondary, 0)].map { name, open, ink, depth in
            var row = RowContent(title: name, leading: FileIcon.folderLeading(open: open, ink: ink), depth: depth,
                                 disclosure: open ? .open : .closed)
            row.layout = .tree
            row.titleInk = ink
            return row
        }
    }

    static var choices: [RowContent] {
        [
            ("Template task CLI", "A command that creates tasks from templates with overrides."),
            ("Template variables", "Placeholders such as {{issue}}, checked when a template is applied, so a missing value fails before the task is made."),
            ("Skip", ""),
        ].map { choice in
            var row = RowContent(title: choice.0)
            row.description = choice.1
            row.descriptionInk = .tertiary
            row.descriptionWraps = true
            return row
        }
    }

    static var completion: [RowContent] {
        func item(_ letter: Character, _ syntax: SyntaxColor, _ name: String, _ tail: String, _ type: String) -> RowContent {
            var row = RowContent(title: name, detail: tail, meta: type, leading: .mark(.code(letter, syntax)))
            row.monospace = true
            row.detailJoinsTitle = tail.hasPrefix("(")
            row.emphasizeMatches(of: "br")
            return row
        }
        return [
            item("m", .function, "broadcast", "(msg []byte)", ""),
            item("f", .property, "broadcastCount", "", "int"),
            item("m", .function, "bringOnline", "(id string)", "error"),
            item("v", .variable, "brokers", "", "[]*Broker"),
            item("F", .function, "bridgeOf", "(c *Client)", "*Bridge"),
            item("T", .type, "Broker", "", "struct"),
            item("k", .keyword, "break", "", ""),
        ]
    }
}
