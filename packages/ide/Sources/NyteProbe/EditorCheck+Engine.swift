import AppKit
import NyteCore
@testable import NyteEditor
import NyteUI

extension EditorCheck {
    static let bufferEdits = 100_000
    static let bufferCeiling = 40_000
    static let storeEdits = 3_000
    static let storeCheckEvery = 50
    static let historyOperations = 600
    static let identifiers = ["foo", "barBaz", "x1", "HTTPServer", "snake_case", "go", "ünï", "a"]
    static let punctuation = [" ", "(", ")", "\"", ".", "{", "}", ", ", " = ", "'"]

    func runEngine() async -> Int {
        engineModel()
        engineViewChecks()
        return failures
    }

    func engineModel() {
        engineBuffer()
        engineStore(Self.goSource, language: Language.detect(URL(fileURLWithPath: "check.go")))
        engineStore(Self.typeScriptSource, language: Language.detect(URL(fileURLWithPath: "check.ts")))
        engineLongLine()
        engineHistory()
        engineSelectionSet()
        engineCommandTables()
        engineSeveralCarets()
    }

    func engineBuffer() {
        var random = Xorshift(state: 0xC2B2_AE3D_27D4_EB4F)
        var reference: [UInt16] = Array("start\n".utf16)
        var buffer = TextBuffer("start\n")
        var snapshot: (buffer: TextBuffer, reference: [UInt16])?
        var mismatch: String?
        var spanning = 0
        for step in 0..<Self.bufferEdits {
            let location = random.next(reference.count + 1)
            let big = random.next(500) == 0
            let removable = reference.count - location
            let removed = min(removable, reference.count > Self.bufferCeiling ? random.next(4_000) : random.next(big ? 12_000 : 6))
            let inserted: [UInt16] = (0..<(big ? random.next(14_000) : random.next(5))).map { _ in
                [UInt16(0x61 + random.next(26)), LineIndex.newline, 0xD83D, 0xDE00, 0x20][random.next(5)]
            }
            reference.replaceSubrange(location..<location + removed, with: inserted)
            buffer.replace(NSRange(location: location, length: removed), with: inserted)
            if step % 997 == 0, reference.count > 2 {
                let start = random.next(reference.count - 1)
                let range = NSRange(location: start, length: random.next(min(10_000, reference.count - start)))
                let read = buffer.withUnits(range) { Array($0) }
                if buffer.chunk(containing: range.location) != buffer.chunk(containing: max(range.location, NSMaxRange(range) - 1)) { spanning += 1 }
                if read != Array(reference[range.location..<NSMaxRange(range)]), mismatch == nil { mismatch = "read \(range) at step \(step)" }
            }
            if step % 9_973 == 0 {
                if let snapshot, Array(snapshot.buffer.units(NSRange(location: 0, length: snapshot.buffer.count))) != snapshot.reference,
                   mismatch == nil {
                    mismatch = "a snapshot changed after later edits, step \(step)"
                }
                snapshot = (buffer, reference)
                if buffer.units(NSRange(location: 0, length: buffer.count)) != reference, mismatch == nil { mismatch = "content at step \(step)" }
            }
        }
        let same = buffer.count == reference.count && buffer.units(NSRange(location: 0, length: buffer.count)) == reference
        expect(same && mismatch == nil, "TextBuffer equals a plain array after \(Self.bufferEdits) random edits, with snapshots unchanged",
               mismatch ?? "\(buffer.count) units against \(reference.count)")
        expect(spanning > 0 && buffer.chunks.count > 2, "reads that span chunks were exercised (\(spanning)), over \(buffer.chunks.count) chunks")
        let chunked = buffer.chunks.allSatisfy { $0.count <= TextBuffer.chunkCapacity }
        expect(chunked, "no chunk grows past its capacity", "\(buffer.chunks.map(\.count).max() ?? 0)")
    }

    func engineStore(_ source: String, language: Language) {
        var random = Xorshift(state: UInt64(source.utf16.count) &* 0x9E37_79B9_7F4A_7C15)
        var store = TextStore(source, language: language)
        var firstDifference: String?
        for step in 1...Self.storeEdits {
            let location = random.next(store.length + 1)
            let removed = random.next(min(3, store.length - location) + 1)
            store.replace(NSRange(location: location, length: removed), with: Array(Self.fragments[random.next(Self.fragments.count)].utf16))
            guard step % Self.storeCheckEvery == 0, firstDifference == nil else { continue }
            let rebuilt = TextStore(store.string, language: language)
            let line = (0..<rebuilt.lineCount).first {
                store.lines.start(of: $0) != rebuilt.lines.start(of: $0) || store.lines.entryState(of: $0) != rebuilt.lines.entryState(of: $0)
            }
            if store.lineCount != rebuilt.lineCount || line != nil { firstDifference = "step \(step), line \(line ?? -1)" }
        }
        expect(firstDifference == nil, "\(language.name): TextStore's line index and lexer states equal a rebuilt store after each of \(Self.storeEdits / Self.storeCheckEvery) checkpoints",
               firstDifference ?? "")
    }

    func engineLongLine() {
        let language = Language.detect(URL(fileURLWithPath: "long.ts"))
        let long = String(repeating: "/* x ", count: TextStore.longestLexedLine / 4)
        var store = TextStore("a\n" + long + "\nb = 1\n", language: language)
        let before = store.lines.entryState(of: 2)
        store.replace(NSRange(location: 3, length: 0), with: Array("q".utf16))
        let rebuilt = TextStore(store.string, language: language)
        expect(before == LexState.normal && store.lines.entryState(of: 2) == rebuilt.lines.entryState(of: 2),
               "a line past the lexing bound passes its entry state through unchanged")
    }

    func engineHistory() {
        let language = Language.detect(URL(fileURLWithPath: "history.go"))
        var session = EditSession(TextStore(Self.goSource, language: language))
        var random = Xorshift(state: 0x1656_67B1_9E37_79F9)
        var states: [(text: String, selections: SelectionSet)] = []
        let measure = { (store: TextStore) in ColumnMeasure.monospace(store, tabWidth: 4, pageRows: 5) }
        for _ in 0..<Self.historyOperations {
            if random.next(4) == 0 {
                let a = random.next(session.store.length + 1)
                let b = min(session.store.length, a + random.next(6))
                session.select(SelectionSet([Selection(anchor: a, head: b), Selection(caret: random.next(session.store.length + 1))]))
                continue
            }
            let store = session.store
            let set = session.selections
            let transaction: TextTransaction? = switch random.next(9) {
            case 0: TextCommands.typing(["x", "(", "\"", "é", "👍"][random.next(5)], set, in: store, context: session.context)
            case 1: TextCommands.deleting(set, TextCommands.Deletion.allCases[random.next(TextCommands.Deletion.allCases.count)],
                                          in: store, context: session.context)
            case 2: TextCommands.newline(set, in: store, context: session.context)
            case 3: TextCommands.movingLines(set, up: random.next(2) == 0, in: store)
            case 4: TextCommands.togglingComment(set, in: store, context: session.context)
            case 5: TextCommands.duplicatingLines(set, in: store)
            case 6: TextCommands.shiftingLines(set, right: random.next(2) == 0, in: store, context: session.context)
            case 7: TextCommands.pasting("one\ntwo", set, in: store)
            default: TextCommands.transposing(set, in: store)
            }
            if random.next(3) == 0 {
                session.select(TextCommands.moved(set, .right, extending: false, in: store, context: session.context, measure: measure(store)))
            }
            guard let transaction else { continue }
            let text = session.store.string
            let applied = session.apply(transaction)
            if case .opened = applied.recorded { states.append((text, transaction.before)) }
        }
        let final = (session.store.string, session.selections)
        var mismatch: String?
        for index in states.indices.reversed() {
            _ = session.undo()
            if session.store.string != states[index].text || session.selections != states[index].selections.clamped(to: session.store.length) {
                mismatch = mismatch ?? "undo step \(index)"
            }
        }
        expect(mismatch == nil && !session.history.canUndo, "undo of \(states.count) steps restores the text and selections before each step",
               mismatch ?? "")
        while session.redo() != nil {}
        expect(session.store.string == final.0 && session.selections == final.1, "redo of every step restores the final text and selections")
        let rebuilt = TextStore(session.store.string, language: language)
        let agrees = (0..<rebuilt.lineCount).allSatisfy {
            session.store.lines.start(of: $0) == rebuilt.lines.start(of: $0) && session.store.lines.entryState(of: $0) == rebuilt.lines.entryState(of: $0)
        }
        expect(agrees && rebuilt.lineCount == session.store.lineCount, "after undo and redo the line index and lexer states agree with a rebuilt store")
        var typing = EditSession(TextStore("", language: language))
        for character in ["a", "b", "c"] {
            typing.apply(TextCommands.typing(character, typing.selections, in: typing.store, context: typing.context))
        }
        typing.apply(TextCommands.deleting(typing.selections, .backward, in: typing.store, context: typing.context))
        typing.select(SelectionSet(caret: 0))
        typing.apply(TextCommands.typing("z", typing.selections, in: typing.store, context: typing.context))
        expect(typing.history.undoSteps.count == 2 && typing.history.undoSteps[0].title == "Typing",
               "typing and deleting coalesce into one Typing step until the selection moves", "\(typing.history.undoSteps.map(\.forward.count))")
    }

    func engineSelectionSet() {
        let merged = SelectionSet([Selection(anchor: 0, head: 3), Selection(caret: 3), Selection(anchor: 6, head: 4), Selection(caret: 9)], primary: 2)
        expect(merged.ranges == [NSRange(location: 0, length: 3), NSRange(location: 4, length: 2), NSRange(location: 9, length: 0)]
               && merged.primary == 1 && merged.primarySelection.isReversed,
               "selections sort, merge when they touch, and keep the primary and its direction", "\(merged)")
        let store = TextStore("abc\nde\nfghij")
        let measure = ColumnMeasure.monospace(store, tabWidth: 4)
        let context = EditContext()
        let down = TextCommands.moved(SelectionSet([Selection(caret: 2), Selection(caret: 6)]), .down, extending: false,
                                      in: store, context: context, measure: measure)
        expect(down.selections.map(\.head) == [6, 9], "moving several carets down keeps each column, clamped to the line", "\(down.ranges)")
        let downAgain = TextCommands.moved(TextCommands.moved(SelectionSet(caret: 2), .down, extending: false, in: store, context: context,
                                                              measure: measure), .down, extending: false, in: store, context: context, measure: measure)
        expect(downAgain.primarySelection.head == 9, "the goal column survives a shorter line in between", "\(downAgain.ranges)")
        var extended = SelectionSet([Selection(caret: 1), Selection(caret: 5)])
        for _ in 0..<2 { extended = TextCommands.moved(extended, .right, extending: true, in: store, context: context, measure: measure) }
        expect(extended.ranges == [NSRange(location: 1, length: 2), NSRange(location: 5, length: 2)], "Shift-Right extends each caret")
        let pasted = TextCommands.pasting("1\n2\n", SelectionSet([Selection(caret: 0), Selection(caret: 4)]), in: store)
        expect(pasted.replacements.map { String(decoding: $0.text, as: UTF16.self) } == ["1", "2"],
               "pasting as many lines as carets gives each caret its own line")
        let column = TextCommands.column(from: (0, 1), to: (2, 3), in: store, measure: measure)
        expect(column.ranges == [NSRange(location: 1, length: 2), NSRange(location: 5, length: 1), NSRange(location: 8, length: 2)],
               "a column selection takes the same columns on every line, clamped", "\(column.ranges)")
        let occurrences = TextStore("let a = item\nlet b = item\nlet c = item\n")
        var next = SelectionSet(caret: occurrences.string.utf16.count / 3 - 3)
        for _ in 0..<3 { next = TextCommands.addingNextOccurrence(to: next, in: occurrences, context: context) ?? next }
        expect(next.count == 3 && next.ranges.allSatisfy { occurrences.string($0) == "item" },
               "Select Next Occurrence selects the word, then each next match", "\(next.ranges)")
        let all = TextCommands.selectingAllOccurrences(of: SelectionSet(caret: 9), in: occurrences)
        expect(all?.count == 3, "Select All Occurrences finds every match")
        let below = TextCommands.addingCaret(to: SelectionSet(caret: 4), below: true, in: occurrences,
                                             measure: ColumnMeasure.monospace(occurrences, tabWidth: 4))
        expect(below?.selections.map(\.head) == [4, 17], "Add Caret Below keeps the column")
    }
}
