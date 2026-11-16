import AppKit
import NyteCore
import NyteLanguage
import NyteUI
@testable import NyteEditor

@MainActor
private var specimens: [EditorSpecimen] = []

@MainActor
private func specimen(_ fixture: String) -> EditorSpecimen {
    let made = EditorSpecimen(fixture: fixture)
    specimens.append(made)
    return made
}

@MainActor
private func settle(_ made: EditorSpecimen, _ path: String) async {
    await made.waitForDiagnostics(in: path)
    await Wait.pause(.seconds(3))
}

@MainActor
private func finish() async {
    let ending = specimens
    specimens.removeAll()
    for made in ending { await made.shutdown() }
}

@MainActor
private func breakpointSpecimen(execution line: Int) -> EditorSpecimen {
    let made = specimen("notifyhub-go")
    let url = made.url("hub/hub.go").standardizedFileURL
    let points = [
        SourceBreakpoint(zeroBasedLine: 49, verification: .verified),
        SourceBreakpoint(zeroBasedLine: 51, isEnabled: false),
        SourceBreakpoint(zeroBasedLine: 53, verification: .unverified),
        SourceBreakpoint(zeroBasedLine: 57, condition: "err != nil", verification: .verified),
        SourceBreakpoint(zeroBasedLine: 64, condition: "h != nil", verification: .unverified),
        SourceBreakpoint(zeroBasedLine: 58, verification: .verified),
        SourceBreakpoint(zeroBasedLine: 54, logMessage: "unknown {message.Channel}", verification: .verified),
        SourceBreakpoint(zeroBasedLine: 61, isEnabled: false, logMessage: "sent"),
        SourceBreakpoint(zeroBasedLine: 66, hitCondition: "> 3", logMessage: "stats", verification: .verified),
    ]
    made.editor.breakpoints = { $0.standardizedFileURL == url ? points : [] }
    made.editor.executionPoint = FileLocation(url: url, range: TextSpan(at: TextPosition(line: line, column: 1)))
    return made
}

@MainActor
private func hover(_ editor: EditorViewController, line: Int) {
    guard let ruler = editor.scrollView.verticalRulerView, let window = ruler.window,
          let start = editor.lineIndex?.start(of: line), let box = editor.rects(for: NSRange(location: start, length: 0)).first
    else { return }
    let y = editor.textView.convert(NSPoint(x: 0, y: box.midY), to: nil).y
    let x = ruler.convert(NSPoint(x: ruler.bounds.midX, y: 0), to: nil).x
    guard let event = NSEvent.mouseEvent(
        with: .mouseMoved, location: NSPoint(x: x, y: y), modifierFlags: [], timestamp: 0, windowNumber: window.windowNumber,
        context: nil, eventNumber: 0, clickCount: 0, pressure: 0
    ) else { return }
    ruler.mouseMoved(with: event)
}

@MainActor
let editorGoPage = GalleryPage(
    name: "editor-go", settle: 1,
    prepare: {
        let made = specimens[0]
        made.open("hub/hub.go", at: 78, column: 6)
        await settle(made, "hub/hub.go")
        await finish()
    },
    build: {
        let made = specimen("notifyhub-go")
        return Gallery.page([Gallery.section(
            "hub.go with gopls", note: "Problems, semantic colours, inlay hints, the error stripe and the caret's occurrences of channel",
            [made.card]
        )])
    }
)

@MainActor
let editorEditingPage = GalleryPage(
    name: "editor-go-editing", settle: 0.05,
    prepare: {
        let made = specimens[0]
        made.open("hub/hub.go", at: 78, column: 6)
        await settle(made, "hub/hub.go")
        let editor = made.editor
        guard let start = editor.lineIndex?.start(of: 75) else { return }
        editor.textView.setSelectedRange(NSRange(location: start, length: 0))
        editor.textView.insertText("var attempts = len(\"retry\")\n", replacementRange: NSRange(location: start, length: 0))
        let ending = specimens
        specimens.removeAll()
        Task {
            await Wait.pause(.seconds(1))
            for made in ending { await made.shutdown() }
        }
    },
    build: {
        let made = specimen("notifyhub-go")
        return Gallery.page([Gallery.section(
            "Just after an edit", note: "A line typed above describe, drawn before gopls answers: everything below moved with it",
            [made.card]
        )])
    }
)

@MainActor
let editorTypeScriptPage = GalleryPage(
    name: "editor-ts", settle: 1,
    prepare: {
        let webhook = specimens[0]
        let hub = specimens[1]
        webhook.open("src/channels/webhook.ts", at: 12, column: 14)
        hub.open("src/hub.ts", at: 40, column: 18)
        await settle(webhook, "src/channels/webhook.ts")
        await hub.waitForDiagnostics(in: "src/hub.ts", timeout: .seconds(4))
        await finish()
    },
    build: {
        let webhook = specimen("notifyhub-ts")
        let hub = specimen("notifyhub-ts")
        return Gallery.page([
            Gallery.section("webhook.ts with typescript-language-server", note: "A type error, an unused local, and the caret's occurrences of message", [webhook.card]),
            Gallery.section("hub.ts", note: "Parameter hints", [hub.card]),
        ])
    }
)

@MainActor
let editorBreakpointsPage = GalleryPage(
    name: "editor-breakpoints", settle: 1,
    prepare: {
        specimens[0].open("hub/hub.go", at: 60, column: 0)
        specimens[1].open("hub/hub.go", at: 60, column: 57)
        await settle(specimens[0], "hub/hub.go")
        hover(specimens[0].editor, line: 56)
        await finish()
    },
    build: {
        let stepping = breakpointSpecimen(execution: 59)
        let stopped = breakpointSpecimen(execution: 58)
        return Gallery.page([
            Gallery.section(
                "Paused on a plain line",
                note: "Lines 50 and 59 on; 52 off; 54 not verified; 55 a logpoint; 58 conditional; 62 a logpoint, off; 65 conditional, not verified; 67 a logpoint with a hit count; the pointer over 57",
                [stepping.card]
            ),
            Gallery.section("Paused on a breakpoint", note: "The caret beside a bracket marks its partner", [stopped.card]),
        ])
    }
)

@MainActor
private func debuggerValue(line: Int, label: String, value: String, order: Int, changed: Bool = false) -> LineNote {
    let prefix = (label + " = " as NSString).length
    let syntax = CodeColors.ranges(in: value, language: "go").map { (range: NSRange(location: $0.range.location + prefix, length: $0.range.length), color: $0.color) }
    return LineNote(zeroBasedLine: line, text: label + " = " + value, isChanged: changed, order: order, syntax: changed ? [] : syntax)
}

@MainActor
private func hookedSpecimen() -> EditorSpecimen {
    let made = specimen("notifyhub-go")
    let file = made.url("hub/hub.go").standardizedFileURL
    let points = [SourceBreakpoint(zeroBasedLine: 57, verification: .verified)]
    let target = RunTarget(name: "hub", program: .goTest(importPath: "notifyhub/hub"), directory: made.workspace.root, command: [])
    made.editor.breakpoints = { $0.standardizedFileURL == file ? points : [] }
    made.editor.lineNotes = { url in
        guard url.standardizedFileURL == file else { return [] }
        return [debuggerValue(line: 50, label: "channel", value: "Email{address: \"ops@example.com\", retries: 3, timeout: 30s}", order: 0),
                debuggerValue(line: 50, label: "ok", value: "true", order: 1),
                debuggerValue(line: 57, label: "err", value: "nil", order: 0, changed: true),
                LineNote(zeroBasedLine: 48, text: "1 implementation", isQuiet: true, action: "implementations", order: 2),
                LineNote(zeroBasedLine: 48, text: "3 usages", isQuiet: true, action: "usages", order: 1)]
    }
    made.editor.runMarks = { url in
        guard url.standardizedFileURL == file else { return [] }
        return [RunMark(line: 48, kind: .program, title: "Submit", target: target), RunMark(line: 57, kind: .test, title: "covered", target: target)]
    }
    made.editor.valueHover = { _, _, expression in
        expression == "err" ? HoverValue(value: "nil", type: "error") : nil
    }
    made.editor.baseText = { url in
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        return text.replacingOccurrences(of: "\th.mu.Unlock()\n\tif !ok {", with: "\th.mu.Unlock()\n\tlog.Print(ok)\n\tif !ok {")
            .replacingOccurrences(of: "err := channel.Send(ctx, message)", with: "err := channel.Send(context.Background(), message)")
            .replacingOccurrences(of: "\th.record(channel.Name(), err == nil)\n", with: "")
    }
    return made
}

@MainActor
let editorHooksPage = GalleryPage(
    name: "editor-hooks", settle: 1,
    prepare: {
        let made = specimens[0]
        made.open("hub/hub.go", at: 57, column: 2)
        await settle(made, "hub/hub.go")
        made.editor.perform(.showDocumentation)
        await Wait.pause(.milliseconds(500))
        await finish()
    },
    build: {
        let made = hookedSpecimen()
        return Gallery.page([Gallery.section(
            "Values while paused, run marks, changes against the base, and the value of err on hover",
            note: "Usage counts after Submit; line-end values on 51 and 58 (58 changed); run marks on 49 and, under its breakpoint, 58; a removed line above 54, "
                + "a modified 58 and an added 59",
            [made.card]
        )])
    }
)

@MainActor
let editorStickyPage = GalleryPage(
    name: "editor-sticky", settle: 1,
    prepare: {
        let made = specimens[0]
        made.open("hub/hub.go", at: 20, column: 0)
        await settle(made, "hub/hub.go")
        let editor = made.editor
        _ = await Wait.until(.seconds(20)) { !editor.outline.symbols.isEmpty }
        if let start = editor.lineIndex?.start(of: 52), let box = editor.rects(for: NSRange(location: start, length: 0)).first {
            editor.textView.scroll(NSPoint(x: editor.leftmostScrollX, y: box.minY))
        }
        await Wait.pause(.milliseconds(300))
        await finish()
    },
    build: {
        let made = specimen("notifyhub-go")
        return Gallery.page([Gallery.section("Scrolled into Submit", note: "Its declaration stays pinned above the text", [made.card])])
    }
)

@MainActor
let editorGoToLinePage = GalleryPage(
    name: "editor-go-to-line", settle: 0.6,
    prepare: {
        let made = specimens[0]
        made.open("hub/hub.go", at: 30, column: 4)
        await settle(made, "hub/hub.go")
        made.editor.textView.goToLine(nil)
        await finish()
    },
    build: {
        let made = specimen("notifyhub-go")
        return Gallery.page([Gallery.section("Go to Line", note: "Opened at the caret's line and column", [made.card])])
    }
)

@MainActor
let editorCaretsPage = GalleryPage(
    name: "editor-carets", settle: 0.6,
    prepare: {
        let made = specimens[0]
        made.open("hub/hub.go", at: 64, column: 1)
        await settle(made, "hub/hub.go")
        let text = made.editor.textView
        text.addCaretBelow(nil)
        text.addCaretBelow(nil)
        text.moveWordRightAndModifySelection(nil)
        await finish()
    },
    build: {
        let made = specimen("notifyhub-go")
        return Gallery.page([Gallery.section("Three carets", note: "Add Caret Below twice, then Shift-Option-Right selects a word at each",
                                             [made.card])])
    }
)

@MainActor
let editorPreferencesPage = GalleryPage(
    name: "editor-preferences", settle: 1,
    prepare: {
        let made = specimens[0]
        made.editor.apply(EditorPreferences(fontSize: TextStyle.prose.size, lineHeight: TextStyle.prose.lineHeight, showsIndentGuides: false, showsInlayHints: false))
        made.open("hub/hub.go", at: 50, column: 0)
        await settle(made, "hub/hub.go")
        await finish()
    },
    build: {
        let made = specimen("notifyhub-go")
        return Gallery.page([Gallery.section("14 pt on 22 pt lines", note: "Indent guides and inlay hints off", [made.card])])
    }
)

@MainActor
let editorAnnotationPages: [GalleryPage] = [
    editorCaretsPage, editorPreferencesPage,
    editorGoPage, editorEditingPage, editorTypeScriptPage, editorBreakpointsPage, editorHooksPage, editorStickyPage, editorGoToLinePage,
    editorEnginePage, editorLightbulbPage,
]
