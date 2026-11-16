import AppKit
import NyteCore
@testable import NyteEditor
import NyteUI

@MainActor final class BoxDecorator: TextEngineDecorator {
    var boxes: [Int: [InlineBox]] = [:]
    var drewUnder = 0
    func inlineBoxes(forLine line: Int, of view: TextEngineView) -> [InlineBox] { boxes[line] ?? [] }
    func drawUnderText(in rect: NSRect, of view: TextEngineView) { drewUnder += 1 }
}

extension EditorCheck {
    static let boxWidth: CGFloat = 20
    static let longLine = 1_000_000

    func engineView(_ text: String, file: String) -> (view: TextEngineView, undo: UndoManager) {
        let view = TextEngineView()
        let scroll = NSScrollView(frame: EditorBench.pane)
        scroll.hasVerticalScroller = true
        scroll.hasHorizontalScroller = true
        scroll.documentView = view
        window.contentView = scroll
        view.load(TextStore(text, language: Language.detect(URL(fileURLWithPath: file))))
        let undo = UndoManager()
        undo.groupsByEvent = false
        view.undoManagerProvider = { undo }
        window.makeFirstResponder(view)
        return (view, undo)
    }

    func engineViewChecks() {
        engineLoader()
        engineNotes()
        engineTypingDecisions()
        engineKeys()
        engineComposition()
        engineAccessibility()
        engineGeometry()
        engineLongLineView()
    }

    func engineLoader() {
        let wide = String(repeating: "a😀", count: TextBuffer.loadFill)
        let cases: [(String, [UInt8], String?, LineEnding)] = [
            ("ASCII", Array("a\nb\n".utf8), "a\nb\n", .lf),
            ("UTF-8 with BOM", [0xEF, 0xBB, 0xBF] + Array("é\n".utf8), "é\n", .lf),
            ("CRLF in the majority", Array("a\r\nb\r\nc\n".utf8), "a\nb\nc\n", .crlf),
            ("astral scalars across chunk ends", Array(wide.utf8), wide, .lf),
            ("an overlong encoding is refused", [0xC0, 0xAF], nil, .lf),
            ("an encoded surrogate is refused", [0xED, 0xA0, 0x80], nil, .lf),
            ("a NUL byte is refused", [0x61, 0x00], nil, .lf),
        ]
        for (name, bytes, expected, ending) in cases {
            let loaded = TextLoader.load(Data(bytes), language: .plain)
            let agrees = loaded.map { loaded in
                let rebuilt = TextStore(loaded.store.string)
                return loaded.store.lineCount == rebuilt.lineCount
                    && (0..<rebuilt.lineCount).allSatisfy { loaded.store.lines.start(of: $0) == rebuilt.lines.start(of: $0) }
                    && loaded.store.buffer.chunks.allSatisfy { $0.isEmpty || !UTF16.isTrailSurrogate($0[0]) }
            } ?? true
            expect(loaded?.store.string == expected && (loaded == nil || loaded?.format.lineEnding == ending) && agrees,
                   "loader: \(name)", loaded?.store.string.debugDescription ?? "nil")
        }
    }

    func engineNotes() {
        let placed = TrailingNote.place(after: 900, edge: 1_000, widths: [300, 40], separator: 20)
        expect(placed == [TrailingNote.Placement(x: 900 + TrailingNote.gap, width: 100 - TrailingNote.gap, isCut: true), nil]
               && LineNoteLayout.place(after: 900, edge: 1_000, widths: [300, 40], separator: 20).map { $0?.width } == placed.map { $0?.width },
               "the view and the line notes place trailing notes through one rule")
        let capped = TrailingNote.place(after: 0, edge: 1_000, widths: [400, 40], separator: 20)
        expect(capped == [TrailingNote.Placement(x: TrailingNote.gap, width: TrailingNote.cap, isCut: true), nil],
               "a note cut at the cap also hides the notes after it")
    }

    func engineTypingDecisions() {
        typealias Stroke = TypingDecision.Stroke
        let letter = [TypingDecision.Action.insert("a", replacing: nil)]
        let resolutions: [(String, Stroke, TypingDecision.Resolution)] = [
            ("a plain key performs what it produced", Stroke(hadMarkedText: false, hasMarkedText: false, layoutChanged: false, pending: letter),
             .perform(letter)),
            ("a key that switched the keyboard layout is dropped",
             Stroke(hadMarkedText: false, hasMarkedText: false, layoutChanged: true, pending: letter), .drop),
            ("a key that commits a composition keeps what it produced even when the layout changed",
             Stroke(hadMarkedText: true, hasMarkedText: false, layoutChanged: true, pending: letter), .perform(letter)),
            ("a key that starts a composition is never dropped", Stroke(hadMarkedText: false, hasMarkedText: true, layoutChanged: true, pending: []),
             .perform([])),
        ]
        for (name, stroke, expected) in resolutions {
            expect(TypingDecision.resolve(stroke) == expected, "typing: \(name)")
        }
        expect(TypingDecision.arrival(isHandlingKey: true, isComposing: false) == .later
               && TypingDecision.arrival(isHandlingKey: true, isComposing: true) == .now
               && TypingDecision.arrival(isHandlingKey: false, isComposing: false) == .now,
               "typing: text waits for the end of its key unless it belongs to a composition or arrives outside a key (dictation, emoji)")
        let targets: [(NSRange, NSRange?, TypingDecision.Target)] = [
            (NSRange(location: NSNotFound, length: 0), nil, .selections),
            (NSRange(location: 2, length: 3), nil, .range(NSRange(location: 2, length: 3))),
            (NSRange(location: 8, length: 9), nil, .range(NSRange(location: 8, length: 2))),
            (NSRange(location: 1, length: 1), NSRange(location: 4, length: 2), .marked(NSRange(location: 4, length: 2))),
        ]
        for (replacement, marked, expected) in targets {
            expect(TypingDecision.target(replacementRange: replacement, markedRange: marked, length: 10) == expected,
                   "typing: committed text replaces \(expected) for replacement \(replacement)")
        }
        expect(TypingDecision.firstLine(of: NSRange(location: 3, length: 20), lineRange: NSRange(location: 0, length: 8))
               == NSRange(location: 3, length: 5), "the candidate window's rectangle stops at the end of the requested range's first line")
        expect(TypingDecision.reachesFeatures(isKeyPress: true, commitsComposition: false)
               && !TypingDecision.reachesFeatures(isKeyPress: true, commitsComposition: true)
               && !TypingDecision.reachesFeatures(isKeyPress: false, commitsComposition: false),
               "features see typed keys, not committed compositions or dictation")
        let marked = NSMutableAttributedString(string: "かな")
        marked.addAttribute(.underlineStyle, value: NSUnderlineStyle.thick.rawValue, range: NSRange(location: 0, length: 1))
        marked.addAttribute(.underlineStyle, value: NSUnderlineStyle.single.rawValue, range: NSRange(location: 1, length: 1))
        expect(TypingDecision.underlines(marked).map(\.isThick) == [true, false], "marked text keeps the input method's clause underlines")
        expect(CaretBlink.mode(isFirstResponder: true, isKey: true, isVisible: true, isOccluded: false) == .blinking
               && CaretBlink.mode(isFirstResponder: true, isKey: false, isVisible: true, isOccluded: false) == .hidden
               && CaretBlink.mode(isFirstResponder: false, isKey: true, isVisible: true, isOccluded: false) == .hidden
               && CaretBlink.mode(isFirstResponder: true, isKey: true, isVisible: true, isOccluded: true) == .hidden,
               "carets blink only in the key window's first responder, visible and not occluded")
        expect(TextEngineView.dropOperation(ownDrag: true, copying: false) == .move && TextEngineView.dropOperation(ownDrag: true, copying: true) == .copy
               && TextEngineView.dropOperation(ownDrag: false, copying: false) == .copy, "dragging text within the view moves it, Option copies")
        expect(TextEngineView.extend(anchor: NSRange(location: 4, length: 3), to: NSRange(location: 1, length: 2)) == Selection(anchor: 7, head: 1),
               "dragging a word selection backwards keeps the whole first word")
    }

    func engineKeys() {
        let (view, undo) = engineView("func main() {\n\tx := 1\n}\n", file: "keys.go")
        view.select(SelectionSet(caret: 12))
        for character in "ok(" { view.keyDown(with: EditorBench.key(String(character))) }
        expect(view.store.string == "func main() ok({\n\tx := 1\n}\n" && view.selections.primarySelection.head == 15,
               "keys type through the input context, and an opening bracket before code is not paired", view.store.string.debugDescription)
        expect(undo.undoMenuItemTitle == "Undo Typing", "the window's undo manager names the step", undo.undoMenuItemTitle)
        undo.undo()
        expect(view.store.string == "func main() {\n\tx := 1\n}\n" && view.selections.primarySelection.head == 12,
               "one undo takes back the typed run and restores the caret", view.store.string.debugDescription)
        undo.redo()
        expect(view.store.string == "func main() ok({\n\tx := 1\n}\n", "redo puts it back")
        view.select(SelectionSet(caret: 0))
        view.doCommand(by: #selector(NSResponder.deleteToEndOfParagraph(_:)))
        view.doCommand(by: #selector(NSResponder.yank(_:)))
        view.doCommand(by: #selector(NSResponder.yank(_:)))
        expect(view.store.string.hasPrefix("func main() ok({func main() ok({\n"), "Control-K kills and Control-Y yanks", view.store.string.debugDescription)
        view.select(SelectionSet(caret: 0))
        view.addCaretBelow(nil)
        view.addCaretBelow(nil)
        view.keyDown(with: EditorBench.key("#"))
        expect(view.store.string.components(separatedBy: "\n").prefix(3).allSatisfy { $0.hasPrefix("#") } && view.selections.count == 3,
               "a key types at every caret", view.store.string.debugDescription)
        view.doCommand(by: #selector(NSResponder.cancelOperation(_:)))
        expect(view.selections.count == 1, "Escape returns to the primary caret")
        let unanswered = TextEngineView.keyCommands.keys.filter { !view.responds(to: $0) }
        expect(unanswered.isEmpty && TextEngineView.keyCommands.count > 80, "every standard key binding selector is answered (\(TextEngineView.keyCommands.count))",
               unanswered.map(NSStringFromSelector).joined(separator: ", "))
        view.selectAll(nil)
        view.copy(nil)
        expect(NSPasteboard.general.string(forType: .string) == view.store.string && NSPasteboard.general.data(forType: .rtf) != nil,
               "copy writes plain and coloured rich text")
        view.select(SelectionSet(caret: 0))
        view.paste(nil)
        expect(undo.undoMenuItemTitle == "Undo Paste", "paste is its own undo step", undo.undoMenuItemTitle)
    }

    func engineComposition() {
        let (view, undo) = engineView("ab\ncd\n", file: "compose.txt")
        view.select(SelectionSet(caret: 1))
        let none = NSRange(location: NSNotFound, length: 0)
        view.setMarkedText("k", selectedRange: NSRange(location: 1, length: 0), replacementRange: none)
        view.setMarkedText("か", selectedRange: NSRange(location: 1, length: 0), replacementRange: none)
        expect(view.hasMarkedText() && view.markedRange() == NSRange(location: 1, length: 1) && view.store.string == "aかb\ncd\n"
               && view.selectedRange() == NSRange(location: 2, length: 0), "marked text sits in the line with its own selection",
               "\(view.markedRange()) \(view.store.string.debugDescription)")
        var actual = NSRange()
        let rect = view.firstRect(forCharacterRange: NSRange(location: 1, length: 1), actualRange: &actual)
        let local = view.convert(view.window?.convertFromScreen(rect) ?? .zero, from: nil)
        expect(actual == NSRange(location: 1, length: 1) && abs(local.minX - view.x(of: 1)) < 1 && local.width > 0,
               "the candidate window's rectangle covers the requested marked range", "\(local) actual \(actual)")
        view.insertText("火", replacementRange: none)
        expect(!view.hasMarkedText() && view.store.string == "a火b\ncd\n" && view.selections.primarySelection.head == 2,
               "committing replaces the marked text once", view.store.string.debugDescription)
        undo.undo()
        expect(view.store.string == "ab\ncd\n" && view.selections.primarySelection.head == 1, "a committed composition is one undo step",
               view.store.string.debugDescription)
        view.select(SelectionSet([Selection(anchor: 0, head: 2)]))
        view.setMarkedText("x", selectedRange: NSRange(location: 1, length: 0), replacementRange: none)
        view.setMarkedText("", selectedRange: NSRange(location: 0, length: 0), replacementRange: none)
        expect(!view.hasMarkedText() && view.store.string == "ab\ncd\n" && view.selections.primarySelection.range == NSRange(location: 0, length: 2),
               "cancelling a composition restores the text and selection it replaced", view.store.string.debugDescription)
        view.select(SelectionSet(caret: 3))
        view.insertText("🙂", replacementRange: none)
        expect(view.store.string == "ab\n🙂cd\n", "text from outside a key (the emoji picker, dictation) is inserted at once")
        view.insertText("CD", replacementRange: NSRange(location: 5, length: 2))
        expect(view.store.string == "ab\n🙂CD\n", "dictation's replacement range is honoured", view.store.string.debugDescription)
    }

    func engineAccessibility() {
        let (view, _) = engineView("alpha\nbéta\ngamma", file: "access.txt")
        view.select(SelectionSet([Selection(anchor: 6, head: 8)]))
        let answers: [(String, Bool)] = [
            ("role is a text area", view.accessibilityRole() == .textArea),
            ("value is the text", view.accessibilityValue() as? String == "alpha\nbéta\ngamma"),
            ("number of characters is the UTF-16 length", view.accessibilityNumberOfCharacters() == 16),
            ("selected range", view.accessibilitySelectedTextRange() == NSRange(location: 6, length: 2)),
            ("selected text", view.accessibilitySelectedText() == "bé"),
            ("insertion point line", view.accessibilityInsertionPointLineNumber() == 1),
            ("line for an index", view.accessibilityLine(for: 12) == 2),
            ("range for a line includes its newline", view.accessibilityRange(forLine: 1) == NSRange(location: 6, length: 5)),
            ("string for a range", view.accessibilityString(for: NSRange(location: 0, length: 5)) == "alpha"),
            ("range for an index is its composed character", view.accessibilityRange(for: 7) == NSRange(location: 7, length: 1)),
            ("visible character range starts at the top", view.accessibilityVisibleCharacterRange().location == 0
                && view.accessibilityVisibleCharacterRange().length == 16),
            ("frame for a range is on screen and one line high", view.accessibilityFrame(for: NSRange(location: 6, length: 4)).height
                == view.metrics.lineHeight),
        ]
        for (name, passed) in answers { expect(passed, "accessibility: \(name)") }
        let frame = view.accessibilityFrame(for: NSRange(location: 12, length: 1))
        expect(view.accessibilityRange(for: NSPoint(x: frame.minX + 1, y: frame.midY)).location == 12, "accessibility: range for a point inverts frame for a range")
        view.setAccessibilitySelectedTextRange(NSRange(location: 2, length: 1))
        view.setAccessibilitySelectedText("P")
        expect(view.store.string.hasPrefix("alPha"), "accessibility: assistive technology edits the selection")
    }

    func engineGeometry() {
        let lines = (0..<2_000).map { "line \($0)" }.joined(separator: "\n")
        let (view, _) = engineView(lines, file: "geometry.txt")
        let decorator = BoxDecorator()
        decorator.boxes[3] = [InlineBox(column: 2, width: Self.boxWidth) { _ in }]
        view.decorators = [decorator]
        view.invalidateLayout(lines: 3...3)
        let start = view.store.lineRange(3).location
        let gap = view.x(of: start + 3) - view.x(of: start + 2)
        expect(abs(gap - Self.boxWidth - view.metrics.advance) < 0.5, "an inline box takes its width inside the line, after the caret before it", "\(gap)")
        expect(abs(view.frame.height - (CGFloat(2_000) * view.metrics.lineHeight + TextEngineView.verticalInset * 2)) < 1,
               "the document is rows times the line height", "\(view.frame.height)")
        view.run(.documentEnd, extending: false)
        let caret = view.caretRect(at: view.selections.primarySelection.head)
        expect(caret.minY == view.top(ofLine: 1_999) && view.visibleRect.contains(caret), "Move to End draws the last line at its row and shows it")
        let point = NSPoint(x: view.x(of: view.store.lineRange(1_500).location + 3) + 1, y: view.top(ofLine: 1_500) + 2)
        expect(view.offset(at: point) == view.store.lineRange(1_500).location + 3, "hit testing is a division and a line lookup")
        let bitmap = view.bitmapImageRepForCachingDisplay(in: view.visibleRect)
        if let bitmap { view.cacheDisplay(in: view.visibleRect, to: bitmap) }
        expect(decorator.drewUnder > 0, "features draw under the text")
    }

    func engineLongLineView() {
        let long = String(repeating: "abcdefghij", count: Self.longLine / 10)
        let (view, _) = engineView("before\n" + long + "\nafter", file: "long.txt")
        let middle = 7 + Self.longLine / 2
        let x = view.x(of: middle)
        expect(abs(x - CGFloat(Self.longLine / 2) * view.metrics.advance) < 1, "a 1 MB line places a column by arithmetic across windows", "\(x)")
        let hit = view.offset(at: NSPoint(x: x + view.metrics.advance / 4, y: view.top(ofLine: 1) + 2))
        expect(hit == middle, "hit testing inside a 1 MB line finds the column", "\(hit) against \(middle)")
        view.select(SelectionSet(caret: middle))
        view.keyDown(with: EditorBench.key("Z"))
        expect(view.store[middle] == UInt16(UInt8(ascii: "Z")), "typing inside a 1 MB line edits it")
        engineMixedScripts()
    }

    func engineMixedScripts() {
        let piece = "let 名前 = \"😀👍🏽 e\u{301}x\" + 漢字; /* コメント */\t"
        let long = String(repeating: piece, count: TextEngineView.windowedLineLength * 3 / piece.utf16.count)
        let (view, _) = engineView("a\n" + long + "\nb", file: "mixed.ts")
        let span = view.store.lineRange(1)
        let table = view.windows(of: 1)
        let total = long.count
        let aligned = table.starts.allSatisfy { start in
            let units = view.store.units(NSRange(location: span.location, length: start))
            return String(decoding: units, as: UTF16.self).count + String(decoding: view.store.units(NSRange(location: span.location + start, length: span.length - start)), as: UTF16.self).count == total
        }
        let fitted = (0..<table.count).allSatisfy { abs(view.layout(line: 1, window: $0).width - table.widths[$0]) < 0.5 }
        var offset = span.location
        var previous = -CGFloat.infinity
        var ordered = true
        while offset < NSMaxRange(span) {
            let x = view.x(of: offset)
            ordered = ordered && x > previous
            previous = x
            offset = TextUnits.clusterEnd(after: offset, in: view.store)
        }
        expect(table.count > 2 && aligned && fitted && ordered,
               "a long line of mixed scripts is laid out in windows that start on grapheme boundaries and abut with no overlap or gap",
               "windows \(table.count) aligned \(aligned) fitted \(fitted) ordered \(ordered)")
        let runs = CTLineGetGlyphRuns(view.layout(line: 1, window: 1).line) as? [CTRun] ?? []
        let inks = Set(runs.compactMap { (CTRunGetAttributes($0) as? [NSAttributedString.Key: Any])?[.foregroundColor] as? NSColor })
        expect(span.length <= TextStore.longestLexedLine && inks.count > 2, "a long line under the lexing bound keeps its syntax colour in every window",
               "\(inks.count) inks")
    }
}
