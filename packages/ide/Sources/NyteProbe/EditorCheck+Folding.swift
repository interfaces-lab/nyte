import AppKit
import NyteCore
@testable import NyteEditor
import NyteUI

extension EditorCheck {
    static let foldOperations = 10_000
    static let foldLines = 2_000
    static let goFolds = "package main\n\nimport (\n\t\"fmt\"\n\t\"strings\"\n)\n\n// Greeter says hello.\n// It ignores braces like { and (.\n"
        + "type Greeter struct {\n\tName string\n}\n\n/* a block\n   comment with } inside */\n"
        + "func (g Greeter) Hello(names []string) string {\n\tjoined := strings.Join(names, \"}{\")\n\traw := `{\nnot a brace }`\n"
        + "\tif len(names) == 0 {\n\t\treturn fmt.Sprintf(\"hi %s\", g.Name) // }\n\t}\n\treturn joined + raw\n}\n"
    static let typeScriptFolds = "import {\n  readFile,\n  writeFile,\n} from \"fs\"\nimport path from \"path\"\n\n/**\n * Joins with \"{\".\n */\n"
        + "export function join(parts: string[]): string {\n  const open = \"{\"\n  const tpl = `${parts.length} }\nstill template {`\n"
        + "  return [\n    open,\n    tpl,\n  ].join(path.sep)\n}\n"

    func foldRegions() {
        let go = FoldRegions.detect(in: Array(Self.goFolds.utf16), language: Language.detect(fence: "go"))
        let goExpected = [FoldRegion(first: 2, last: 5, kind: .imports), FoldRegion(first: 7, last: 8, kind: .comment),
                          FoldRegion(first: 9, last: 11, kind: .block), FoldRegion(first: 13, last: 14, kind: .comment),
                          FoldRegion(first: 15, last: 23, kind: .block), FoldRegion(first: 19, last: 21, kind: .block)]
        expect(go == goExpected, "Go fold regions: the import block, comment runs, block comments and bracket pairs, skipping brackets in strings, raw strings and comments",
               go.map { "\($0.first)-\($0.last) \($0.kind)" }.joined(separator: ", "))
        let script = FoldRegions.detect(in: Array(Self.typeScriptFolds.utf16), language: Language.detect(fence: "ts"))
        let scriptExpected = [FoldRegion(first: 0, last: 4, kind: .imports), FoldRegion(first: 6, last: 8, kind: .comment),
                              FoldRegion(first: 9, last: 17, kind: .block), FoldRegion(first: 13, last: 16, kind: .block)]
        expect(script == scriptExpected, "TypeScript fold regions: imports through a multi-line import, a doc comment, blocks and arrays, skipping template text",
               script.map { "\($0.first)-\($0.last) \($0.kind)" }.joined(separator: ", "))
    }

    func foldMap() {
        var random = Xorshift(state: 0xF01D_F01D_F01D_F01D)
        var hidden = [Bool](repeating: false, count: Self.foldLines)
        var map = FoldMap()
        var mismatch: String?
        for step in 0..<Self.foldOperations where mismatch == nil {
            switch random.next(3) {
            case 0:
                let first = 1 + random.next(hidden.count - 1)
                let last = min(hidden.count - 1, first + random.next(40))
                map = map.folding(first...last)
                for line in first...last { hidden[line] = true }
            case 1:
                let line = random.next(hidden.count)
                map = map.unfolding(around: line)
                if let run = Self.runs(hidden).first(where: { $0.lowerBound <= line + 1 && line <= $0.upperBound }) {
                    for slot in run { hidden[slot] = false }
                }
            default:
                let line = random.next(hidden.count)
                let removed = random.next(min(4, hidden.count - 1 - line) + 1)
                let inserted = random.next(4)
                let change = LineIndex.Change(line: line, removed: removed, inserted: inserted)
                map = map.shifted(by: change)
                for run in Self.runs(hidden) where run.upperBound >= line
                    && (run.lowerBound <= line + removed || (line == run.lowerBound - 1 && removed + inserted > 0)) {
                    for slot in run { hidden[slot] = false }
                }
                hidden.replaceSubrange((line + 1)..<(line + 1 + removed), with: repeatElement(false, count: inserted))
            }
            if map.ranges != Self.runs(hidden) {
                mismatch = "step \(step): ranges \(map.ranges.prefix(4)) against \(Self.runs(hidden).prefix(4))"
                continue
            }
            guard step % 50 == 0 else { continue }
            var row = -1
            for line in hidden.indices {
                if !hidden[line] { row += 1 }
                if map.row(of: line) != row || map.isHidden(line) != hidden[line] || (!hidden[line] && map.line(atRow: row) != line) {
                    mismatch = "step \(step): line \(line) row \(map.row(of: line)) against \(row)"
                    break
                }
            }
            if mismatch == nil, map.rowCount(lines: hidden.count) != row + 1 { mismatch = "step \(step): row count" }
        }
        expect(mismatch == nil, "the fold line map agrees with a line-by-line model, both ways, across \(Self.foldOperations) folds, unfolds and edits",
               mismatch ?? "")
    }

    static func runs(_ hidden: [Bool]) -> [ClosedRange<Int>] {
        var runs: [ClosedRange<Int>] = []
        var start: Int?
        for line in hidden.indices {
            if hidden[line], start == nil { start = line }
            if !hidden[line], let first = start {
                runs.append(first...(line - 1))
                start = nil
            }
        }
        if let first = start { runs.append(first...(hidden.count - 1)) }
        return runs
    }
}

extension EditorCheck {
    static let viewFoldOperations = 1_500
    static let foldBudget = Duration.milliseconds(16)
    static let largeFoldLines = 100_000

    func viewFolding() async {
        let lines = (0..<Self.foldLines).map { "line \($0)" }.joined(separator: "\n")
        let (view, _) = engineView(lines, file: "folds.txt")
        var random = Xorshift(state: 0xF0F0_1234_ABCD_9876)
        var problem: String?
        for step in 0..<Self.viewFoldOperations where problem == nil {
            let count = view.store.lineCount
            switch random.next(5) {
            case 0, 1:
                let first = 1 + random.next(count - 2)
                view.fold(first...min(count - 1, first + random.next(30)))
            case 2:
                view.unfold(around: random.next(count))
            case 3:
                view.select(SelectionSet(caret: view.store.lineRange(random.next(count)).location))
            default:
                let line = random.next(count)
                view.select(SelectionSet(caret: view.store.lineRange(line).location))
                view.insertText(random.next(2) == 0 ? "x" : "\n", replacementRange: NSRange(location: NSNotFound, length: 0))
            }
            let hidden = view.selections.selections.contains { view.rowMap.folds.isHidden(view.store.line(at: $0.head)) }
            let height = CGFloat(view.rowCount) * view.metrics.lineHeight + TextEngineView.verticalInset * 2
            let visible = view.store.lineCount - view.rowMap.folds.hiddenCount
            let row = random.next(max(1, view.rowCount))
            let line = view.rowMap.line(atRow: row)
            if hidden { problem = "step \(step): a caret rests in hidden text" }
            if view.rowCount != visible { problem = "step \(step): \(view.rowCount) rows for \(visible) visible lines" }
            if abs(view.frame.height - max(height, view.visibleRect.height)) > 1 { problem = "step \(step): frame \(view.frame.height) against \(height)" }
            if view.rowMap.folds.isHidden(line) || view.top(ofLine: line) != TextEngineView.verticalInset + CGFloat(row) * view.metrics.lineHeight {
                problem = "step \(step): row \(row) maps to line \(line) at \(view.top(ofLine: line))"
            }
        }
        expect(problem == nil, "folding in the view: \(Self.viewFoldOperations) random folds, unfolds, moves and edits keep rows, the frame and every caret outside hidden text",
               problem ?? "")
        let large = (0..<Self.largeFoldLines).map { "x\($0)" }.joined(separator: "\n")
        let (big, _) = engineView(large, file: "big.txt")
        let started = ContinuousClock.now
        big.fold(1...(Self.largeFoldLines - 2))
        big.displayIfNeeded()
        let elapsed = ContinuousClock.now - started
        expect(big.rowCount == 2 && elapsed < Self.foldBudget, "folding \(Self.largeFoldLines) lines takes under a frame", "\(elapsed)")
        await editorFolding()
    }

    func editorFolding() async {
        let editor = await openEditor(Self.goFolds, file: "folding.go")
        guard let folding = editor.folding else { return expect(false, "the folding feature is installed") }
        await settle { !folding.regions.isEmpty }
        let view = editor.textView
        expect(editor.ruler.foldMark(9) == .foldable, "the ruler marks a foldable block")
        editor.ruler.onClickFold?(9)
        expect(view.foldedRanges == [10...11] && editor.ruler.foldMark(9) == .folded, "a click on the chevron folds the block, and the chevron turns",
               "\(view.foldedRanges)")
        let chip = folding.chipRect(onLine: 9)
        let lineBox = view.rects(for: NSRange(location: view.store.lineRange(9).location, length: 0)).first
        expect(chip != nil && lineBox != nil && abs((chip?.minY ?? 0) - (lineBox?.minY ?? 1)) < 1,
               "a folded block shows a placeholder at the end of its first line")
        let state = editor.foldState(of: editor.url ?? folder)
        editor.select(TextSpan(at: TextPosition(line: 10, column: 1)))
        expect(view.foldedRanges.isEmpty, "a jump into a fold unfolds it")
        view.setSelectedRange(NSRange(location: 0, length: 0))
        if let url = editor.url { editor.restoreFolds(state, in: url) }
        expect(view.foldedRanges == [10...11], "fold state is handed out and restored as a plain value", "\(state)")
        if let chip { _ = folding.handleClick(at: NSPoint(x: chip.midX, y: chip.midY), event: NSEvent()) }
        expect(view.foldedRanges.isEmpty, "a click on the placeholder unfolds")
        let foldImports = NSMenuItem(title: "Fold Imports", action: #selector(TextEngineView.foldImports(_:)), keyEquivalent: "")
        let enabled = view.validateUserInterfaceItem(foldImports)
        view.foldImports(nil)
        view.foldBlockComments(nil)
        expect(enabled && view.foldedRanges == [3...5, 8...8, 14...14], "Fold Imports and Fold All Block Comments fold their regions",
               "\(view.foldedRanges)")
        view.unfoldAll(nil)
        view.foldAll(nil)
        let folded = view.foldedRanges
        view.select(SelectionSet(caret: view.store.lineRange(16).location))
        view.insertText("q", replacementRange: NSRange(location: NSNotFound, length: 0))
        expect(!folded.isEmpty && !view.foldedRanges.contains { $0.contains(16) }, "an edit inside a fold unfolds it")
        view.unfoldAll(nil)
    }
}
