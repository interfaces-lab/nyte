import AppKit
import NyteCore
@testable import NyteEditor
import NyteUI

extension EditorCheck {
    static let hooksSource = "package main\n\nfunc main() {\n\tx := compute(1, [2 + 3])\n\tprintln(x)\n}\n\nfunc TestCompute() {}\n"

    func hooks() async {
        let editor = await openEditor(Self.hooksSource, file: "hooks.go")
        editor.focus()
        expect(window.firstResponder === editor.textView, "focus() makes the text view first responder")
        expect(editor.ruler.clipsToBounds && editor.ruler.layer?.masksToBounds == true, "the line-number ruler clips to its bounds")
        lineNotes(editor)
        await valueHover(editor)
        runMarks(editor)
        breakpointMenu(editor)
        lineActions()
        await selectionScope(editor)
        await beforeSave()
        await changeBars()
        await stickyScopes()
    }

    func stickyScopes() async {
        let body = (0..<80).map { "\t\tstep\($0)()" }.joined(separator: "\n")
        let source = "package main\n\ntype Hub struct{}\n\nfunc (h *Hub) Run() {\n\tfor {\n" + body + "\n\t}\n}\n"
        let editor = await openEditor(source, file: "sticky.go")
        let span = { (from: Int, to: Int) in TextSpan(start: TextPosition(line: from, column: 0), end: TextPosition(line: to, column: 1)) }
        editor.outline = ([DocumentSymbol(name: "Run", kind: .method, range: span(4, 87), selection: span(4, 4), depth: 0),
                           DocumentSymbol(name: "loop", kind: .function, range: span(5, 86), selection: span(5, 5), depth: 1)], [2, 2])
        editor.select(TextSpan(at: TextPosition(line: 60, column: 0)))
        editor.textView.scroll(NSPoint(x: 0, y: editor.textView.visibleRect.minY + TextStyle.code.lineHeight * 5))
        let feature = editor.features.lazy.compactMap { $0 as? StickyScopesFeature }.first
        feature?.update()
        expect(feature?.shownNames == ["Run", "loop"], "sticky scopes pin the enclosing declarations, outermost first",
               "\(String(describing: feature?.shownNames))")
        expect(editor.ruler.pinnedLines()?.lines == [4, 5], "the ruler numbers the pinned lines instead of the lines beneath them")
        editor.select(TextSpan(at: TextPosition(line: 0, column: 0)))
        feature?.update()
        expect(feature?.shownNames == [], "sticky scopes clear at the top of the file")
    }

    func changeBars() async {
        let base = "one\ntwo\nthree\nfour\n"
        let editor = await openEditor("one\nTWO\nfour\nfive\n", file: "changes.txt")
        editor.baseText = { _ in base }
        let feature = editor.features.lazy.compactMap { $0 as? ChangeBarsFeature }.first
        await settle { (feature?.hunkCount ?? 0) > 0 }
        let kinds = (0..<5).map { editor.ruler.change($0) }
        expect(kinds == [nil, .modified, .deleted, .added, nil] || kinds == [nil, .modified, nil, .added, nil],
               "change bars mark modified, deleted and added lines against the base", "\(kinds)")
        editor.textView.setSelectedRange(NSRange(location: 0, length: 0))
        editor.textView.nextChange(nil)
        expect(editor.lineIndex?.line(at: editor.caretRange.location) == 1, "Next Change moves to the first hunk")
        editor.replaceUntracked(NSRange(location: 0, length: 0), with: "zero\n")
        expect(editor.ruler.change(2) == .modified, "change bars shift with a line inserted above before the next diff")
        await settle { (feature?.hunkCount ?? 0) >= 3 }
        if let slot = feature?.hunk(on: 2) { feature?.revert(slot) }
        await settle { editor.ruler.change(2) == nil }
        expect(editor.shownText.string.hasPrefix("zero\none\ntwo\n"), "Revert puts the hunk's old lines back",
               editor.shownText.string.debugDescription)
        let item = NSMenuItem(title: "Next Change", action: #selector(TextEngineView.nextChange(_:)), keyEquivalent: "")
        expect(editor.textView.validateUserInterfaceItem(item), "Next Change is enabled while there are changes")
        editor.baseText = nil
    }

    func lineNotes(_ editor: EditorViewController) {
        var notes = [LineNote(zeroBasedLine: 3, text: "x = 7"), LineNote(zeroBasedLine: 4, text: "x = 8", isChanged: true)]
        editor.lineNotes = { _ in notes }
        let feature = editor.features.lazy.compactMap { $0 as? LineNotesFeature }.first
        expect(feature?.shown.map(\.zeroBasedLine) == [3, 4], "line notes load from the provider", "\(String(describing: feature?.shown))")
        editor.replaceUntracked(NSRange(location: 14, length: 0), with: "// added\n")
        expect(feature?.shown.map(\.zeroBasedLine) == [4, 5], "line notes follow a line inserted above them", "\(String(describing: feature?.shown))")
        editor.textView.display()
        var opened: [String] = []
        editor.onLineNote = { _, note in opened.append(note.text) }
        notes = [LineNote(zeroBasedLine: 2, text: "1 implementation", isQuiet: true, action: "implementations", order: 2),
                 LineNote(zeroBasedLine: 2, text: "3 usages", isQuiet: true, action: "usages", order: 1)]
        editor.lineNotesDidChange()
        expect(feature?.shown.map(\.text) == ["3 usages", "1 implementation"], "notes on one line follow their order, not arrival")
        let visible = editor.textView.visibleRect
        if let bitmap = editor.textView.bitmapImageRepForCachingDisplay(in: visible) { editor.textView.cacheDisplay(in: visible, to: bitmap) }
        let lineRange = editor.lineIndex?.range(of: 2, length: editor.shownText.length) ?? NSRange(location: 0, length: 0)
        let line = editor.rects(for: NSRange(location: lineRange.location, length: 0)).first ?? .zero
        let end = editor.rects(for: NSRange(location: NSMaxRange(lineRange), length: 0)).first?.minX ?? 0
        let point = NSPoint(x: end + LineNoteLayout.gap + 2, y: line.midY)
        _ = feature?.handleClick(at: point, event: NSEvent())
        editor.textView.setSelectedRange(NSRange(location: lineRange.location + 1, length: 0))
        let open = NSMenuItem(title: "Open", action: #selector(TextEngineView.openLineNote(_:)), keyEquivalent: "")
        let enabled = editor.textView.validateUserInterfaceItem(open)
        editor.textView.openLineNote(nil)
        expect(opened == ["3 usages", "3 usages"] && enabled, "an actionable note answers a click and the keyboard action on its line",
               "\(opened)")
        lineNoteLayout()
        notes = [LineNote(zeroBasedLine: 2, text: String(repeating: "value ", count: 60), action: "inspect")]
        editor.lineNotesDidChange()
        editor.textView.display()
        let edge = editor.textView.visibleRect.maxX - ErrorStripe.width
        let drawn = feature?.actionRects.first
        expect(drawn.map { $0.width <= LineNoteLayout.cap && $0.maxX <= edge && $0.minX >= end + LineNoteLayout.gap } == true,
               "a long note starts a gap after the code, stops at its cap and never passes the visible edge", "\(String(describing: drawn))")
        notes = []
        editor.lineNotesDidChange()
        expect(feature?.shown.isEmpty == true, "line notes clear when the provider returns none")
        editor.onLineNote = nil
        editor.replaceUntracked(NSRange(location: 14, length: 9), with: "")
    }

    func valueHover(_ editor: EditorViewController) async {
        let text = "\th.stats.Total" as NSString
        let dotted = ValueExpression.range(at: 10, selection: NSRange(location: 0, length: 0), in: text)
        expect(dotted.map(text.substring(with:)) == "h.stats.Total", "value hover asks for the whole member chain under the pointer")
        let selected = ValueExpression.range(at: 3, selection: NSRange(location: 1, length: 7), in: text)
        expect(selected == NSRange(location: 1, length: 7), "value hover asks for the selection when the pointer is inside it")
        var asked: [String] = []
        editor.valueHover = { _, _, expression in
            asked.append(expression)
            return expression == "x" ? HoverValue(value: "5", type: "int") : nil
        }
        let caret = editor.shownText.range(of: "println(x)").location + 8
        editor.textView.setSelectedRange(NSRange(location: caret, length: 0))
        for child in window.childWindows ?? [] { child.orderOut(nil) }
        editor.perform(.showDocumentation)
        await settle { !asked.isEmpty && (window.childWindows ?? []).contains(where: \.isVisible) }
        expect(asked == ["x"] && (window.childWindows ?? []).contains(where: \.isVisible),
               "value hover asks the provider first and shows its answer", "\(asked)")
        let shown = (window.childWindows ?? []).filter(\.isVisible)
        let inside = editor.textView.visibleRect.insetBy(dx: Space.x8, dy: Space.x8)
        if let moved = NSEvent.mouseEvent(with: .mouseMoved, location: editor.textView.convert(NSPoint(x: inside.midX, y: inside.midY), to: nil),
                                          modifierFlags: [], timestamp: 0, windowNumber: window.windowNumber, context: nil,
                                          eventNumber: 0, clickCount: 0, pressure: 0) {
            editor.textView.mouseMoved(with: moved)
        }
        expect(!shown.isEmpty && shown.allSatisfy { !$0.canBecomeKey } && window.firstResponder === editor.textView && NSCursor.current == .iBeam,
               "a hover panel never takes key status, the text keeps focus and the pointer stays an I-beam over text")
        let short = HoverFeature.width(of: "```go\nfunc Printf(format string) (n int)\n```\n\nPrintf formats.", notes: [])
        let long = HoverFeature.width(of: "```go\nfunc Printf(" + String(repeating: "argument string, ", count: 20) + ")\n```", notes: [])
        expect(short < DocumentationView.maxWidth && short >= DocumentationView.minWidth && long == DocumentationView.maxWidth,
               "a hover is as wide as its content up to a maximum, so a long signature wraps", "\(short) \(long)")
        for child in window.childWindows ?? [] { child.orderOut(nil) }
        editor.valueHover = nil
    }

    func lineNoteLayout() {
        typealias Segment = LineNoteLayout.Segment
        let gap = LineNoteLayout.gap
        let cap = LineNoteLayout.cap
        let cases: [(String, CGFloat, CGFloat, [CGFloat], [Segment?])] = [
            ("a short note sits a gap after the code", 100, 1000, [50], [Segment(x: 100 + gap, width: 50, isCut: false)]),
            ("a long note stops at the cap, marked cut", 100, 1000, [400], [Segment(x: 100 + gap, width: cap, isCut: true)]),
            ("two notes follow each other with the separator between", 100, 1000, [50, 80],
             [Segment(x: 100 + gap, width: 50, isCut: false), Segment(x: 100 + gap + 50 + 20, width: 80, isCut: false)]),
            ("a note near the edge is cut at the edge", 900, 1000, [300], [Segment(x: 900 + gap, width: 100 - gap, isCut: true)]),
            ("a cut note hides the notes after it", 900, 1000, [300, 40], [Segment(x: 900 + gap, width: 100 - gap, isCut: true), nil]),
            ("code that reaches the edge gets no note", 995, 1000, [40], [nil]),
        ]
        let wrong = cases.filter { LineNoteLayout.place(after: $0.1, edge: $0.2, widths: $0.3, separator: 20) != $0.4 }.map(\.0)
        expect(wrong.isEmpty, "line note placement: gap, cap with an ellipsis, and the visible edge", wrong.joined(separator: "; "))
    }

    func runMarks(_ editor: EditorViewController) {
        var opened: [RunMark] = []
        let target = RunTarget(name: "check", program: .goTest(importPath: "check"), directory: folder, command: [])
        editor.runMarks = { _ in
            [RunMark(line: 7, kind: .test, title: "TestCompute", target: target), RunMark(line: 2, kind: .program, title: "main", target: target)]
        }
        editor.runMarkMenu = { _, mark in
            opened.append(mark)
            return NSMenu(title: mark.title)
        }
        let feature = editor.features.lazy.compactMap { $0 as? RunMarksFeature }.first
        expect(editor.ruler.runMark(7) == .test && editor.ruler.runMark(2) == .program && editor.ruler.runMark(3) == nil,
               "run marks reach the ruler by line")
        let menu = feature?.menu(for: 7)
        expect(menu?.title == "TestCompute" && opened.map(\.title) == ["TestCompute"], "a run mark's menu comes from the host with that mark")
        let cases: [(Bool, Bool, Bool, Bool, GutterClick)] = [
            (false, false, true, false, .runMark), (false, false, true, true, .breakpoint), (true, true, true, false, .lightbulb),
            (false, true, false, false, .breakpoint),
        ]
        expect(cases.allSatisfy { GutterClick.decide(inBulbLane: $0.0, hasBulb: $0.1, hasRunMark: $0.2, hasBreakpoint: $0.3) == $0.4 },
               "a gutter click goes to the lightbulb, the run mark, or the breakpoint, and a breakpoint wins over a run mark")
        editor.runMarks = nil
    }

    func breakpointMenu(_ editor: EditorViewController) {
        var asked: [Int] = []
        editor.breakpoints = { _ in [SourceBreakpoint(zeroBasedLine: 3, logMessage: "x is {x}")] }
        editor.breakpointMenu = { _, line in
            asked.append(line)
            return NSMenu(title: "Breakpoint")
        }
        editor.breakpointsDidChange()
        guard let rect = editor.rectOfBreakpoint(line: 3), let window = editor.rulerView.window else {
            return expect(false, "the breakpoint mark has a rectangle in the ruler")
        }
        expect(editor.rulerView.bounds.contains(rect), "the breakpoint mark's rectangle lies in the ruler", "\(rect)")
        let point = editor.rulerView.convert(NSPoint(x: rect.midX, y: rect.midY), to: nil)
        let click = NSEvent.mouseEvent(with: .rightMouseDown, location: point, modifierFlags: [], timestamp: 0,
                                       windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)
        let menu = click.flatMap { editor.rulerView.menu(for: $0) }
        expect(menu?.title == "Breakpoint" && asked == [3], "a right-click on a breakpoint asks the host for its menu with the line",
               "\(asked)")
        editor.breakpoints = nil
        editor.breakpointMenu = nil
    }

    func lineActions() {
        let text = TextStore("a\nb\nc")
        let apply = { (transaction: TextTransaction?) -> String in
            var store = text
            transaction?.apply(to: &store)
            return store.string
        }
        expect(apply(TextCommands.movingLines(SelectionSet(caret: 2), up: true, in: text)) == "b\na\nc", "Move Line Up swaps with the line above")
        let down = TextCommands.movingLines(SelectionSet(caret: 2), up: false, in: text)
        expect(apply(down) == "a\nc\nb" && down?.after.primarySelection.head == 4, "Move Line Down at the last line keeps the final newline out",
               apply(down).debugDescription)
        expect(apply(TextCommands.duplicatingLines(SelectionSet(caret: 4), in: text)) == "a\nb\nc\nc", "Duplicate Line copies the line")
        let deleted = TextCommands.deletingLines(SelectionSet(caret: 4), in: text)
        expect(deleted.replacements.first?.range == NSRange(location: 3, length: 2), "Delete Line on the last line takes the newline before it")
        let parsed = ["12", "12:5", " 3 ", "0", "4:0", "x"].map { GoToLine.parse($0) }
        expect(parsed == [TextPosition(line: 11, column: 0), TextPosition(line: 11, column: 4), TextPosition(line: 2, column: 0), nil, nil, nil],
               "Go to Line reads line and line:column", "\(parsed)")
    }

    func selectionScope(_ editor: EditorViewController) async {
        let start = editor.shownText.range(of: "2 + 3").location + 4
        editor.textView.setSelectedRange(NSRange(location: start, length: 0))
        var steps: [String] = []
        for _ in 0..<5 {
            editor.textView.expandSelection(nil)
            steps.append(editor.shownText.substring(with: editor.textView.selectedRange()))
        }
        expect(steps == ["3", "2 + 3", "[2 + 3]", "1, [2 + 3]", "(1, [2 + 3])"], "Expand Selection climbs word, contents, brackets", "\(steps)")
        editor.textView.shrinkSelection(nil)
        editor.textView.shrinkSelection(nil)
        expect(editor.shownText.substring(with: editor.textView.selectedRange()) == "[2 + 3]", "Shrink Selection walks back the same steps")
        let shrink = NSMenuItem(title: "Shrink", action: #selector(TextEngineView.shrinkSelection(_:)), keyEquivalent: "")
        editor.textView.setSelectedRange(NSRange(location: start, length: 0))
        expect(!editor.textView.validateUserInterfaceItem(shrink), "Shrink Selection is disabled once the caret moves elsewhere")
        let goTo = NSMenuItem(title: "Go to Line", action: #selector(TextEngineView.goToLine(_:)), keyEquivalent: "g")
        expect(editor.textView.validateUserInterfaceItem(goTo), "Go to Line is enabled with a file open")
        editor.textView.selectedRanges = [NSValue(range: NSRange(location: 0, length: 1)), NSValue(range: NSRange(location: 3, length: 1))]
        editor.textView.insertText("Z", replacementRange: NSRange(location: NSNotFound, length: 0))
        expect(editor.shownText.substring(with: NSRange(location: 0, length: 6)) == "ZacZag",
               "typing with several selections types into each of them",
               editor.shownText.substring(with: NSRange(location: 0, length: 6)))
    }

    func beforeSave() async {
        let editor = await openEditor("package main\nfunc main(){}  ", file: "save.go")
        let url = folder.appendingPathComponent("save.go")
        editor.beforeSaveDeadline = .milliseconds(200)
        editor.beforeSave = { _, _ in
            [TextEdit(range: TextSpan(at: TextPosition(line: 2, column: 11)), text: " ")]
        }
        editor.apply(EditorPreferences(trimsTrailingWhitespace: true, ensuresFinalNewline: true))
        editor.replaceUntracked(NSRange(location: 0, length: 0), with: "// x\n")
        editor.textView.setSelectedRange(NSRange(location: 0, length: 0))
        await editor.save(editor.shown?.id ?? -1)
        let formatted = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        editor.shown?.undo.undo()
        expect(formatted == "// x\npackage main\nfunc main() {}\n" && editor.shownText.string == "// x\npackage main\nfunc main(){}  ",
               "before-save edits, trimmed whitespace and the final newline are written and undo in one step",
               formatted.debugDescription + " then " + editor.shownText.string.debugDescription)
        editor.apply(EditorPreferences())
        editor.beforeSave = nil
        await editor.save(editor.shown?.id ?? -1)
        editor.shown?.undo.undo()
        expect(editor.shownText.string == "package main\nfunc main(){}  ", "a save with nothing to change adds no undo step",
               editor.shownText.string.debugDescription)
        editor.beforeSave = { _, _ in
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return [] }
            return [TextEdit(range: TextSpan(at: TextPosition(line: 0, column: 0)), text: "late ")]
        }
        let clock = ContinuousClock.now
        await editor.save(editor.shown?.id ?? -1)
        let waited = ContinuousClock.now - clock
        let saved = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        expect(waited < .seconds(1) && !saved.hasPrefix("late"), "a before-save provider past its deadline does not hold the save",
               "\(waited) \(saved.debugDescription)")
    }
}
