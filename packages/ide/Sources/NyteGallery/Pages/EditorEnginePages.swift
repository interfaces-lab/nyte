import AppKit
import NyteUI
@testable import NyteEditor

@MainActor
final class EngineSpecimen: TextEngineDecorator {
    static let width: CGFloat = 860
    static let height: CGFloat = 200
    static let tallHeight: CGFloat = 290
    static let chipInset = Space.x1
    static let longLine = 1_000_000

    let view = TextEngineView()
    let scroll = NSScrollView()
    var boxes: [Int: [InlineBox]] = [:]
    var notes: [Int: [TrailingNote]] = [:]

    init(_ text: String, file: String, height: CGFloat = EngineSpecimen.height) {
        scroll.documentView = view
        scroll.hasVerticalScroller = true
        scroll.hasHorizontalScroller = true
        scroll.autohidesScrollers = true
        scroll.drawsBackground = false
        view.decorators = [self]
        view.load(TextStore(text, language: Language.detect(URL(fileURLWithPath: file))))
        _ = Gallery.sized(scroll, width: Self.width, height: height)
    }

    func inlineBoxes(forLine line: Int, of view: TextEngineView) -> [InlineBox] { boxes[line] ?? [] }
    func trailingNotes(forLine line: Int, of view: TextEngineView) -> [TrailingNote] { notes[line] ?? [] }

    func chip(_ label: String, at column: Int) -> InlineBox {
        let style = TextStyle.codeSmall
        let width = Draw.width(of: label, style: style, tabular: false) + Self.chipInset * 2
        return InlineBox(column: column, width: width + Self.chipInset) { rect in
            let ground = NSRect(x: rect.minX, y: rect.minY + Space.hair, width: width, height: rect.height - Space.hair * 2)
            Draw.fill(ground, radius: Radius.indicator, color: Palette.fillTertiary)
            Draw.text(label, in: ground.insetBy(dx: Self.chipInset, dy: 0), style: style, ink: Palette.contentTertiary)
        }
    }
}

@MainActor
private var engineSpecimens: [EngineSpecimen] = []

private let engineGo = """
package main

import "fmt"

// Item holds one generated record.
type Item struct {
\tName  string
\tCount int
}

func build(name string, count int) Item {
\ts := fmt.Sprintf("%s-%d", name, count)
\treturn Item{Name: s, Count: count * 2}
}
"""

private let engineTypeScript = """
const greeting = `hello ${name}`
/* a block
   comment */
function total(items: number[]): number {
  return items.reduce((sum, item) => sum + item, 0) // fold
}
export const answer = total([1, 2, 3])
"""

@MainActor
let editorEnginePage = GalleryPage(
    name: "editor-engine",
    prepare: {
        guard let go = engineSpecimens.first else { return }
        go.view.window?.makeFirstResponder(go.view)
        go.view.updateBlink(isFirstResponder: true)
        go.view.needsDisplay = true
        guard let long = engineSpecimens.last else { return }
        let middle = long.view.x(of: long.view.selections.primarySelection.head) - EngineSpecimen.width / 2
        long.scroll.contentView.scroll(to: NSPoint(x: middle, y: 0))
        long.scroll.reflectScrolledClipView(long.scroll.contentView)
    },
    teardown: { engineSpecimens.removeAll() },
    build: {
        engineSpecimens.removeAll()
        let go = EngineSpecimen(engineGo, file: "engine.go", height: EngineSpecimen.tallHeight)
        let store = go.view.store
        go.boxes[10] = [go.chip("name:", at: 11)]
        go.notes[11] = [TrailingNote([TrailingNote.Segment("s = "), TrailingNote.Segment("\"alpha-3\"", color: .string)]), TrailingNote([TrailingNote.Segment("2 usages")])]
        go.notes[12] = [TrailingNote([TrailingNote.Segment("Item{Name: \"alpha-3\", Count: 6, Tags: [\"one\", \"two\", \"three\", \"four\"], Owner: nil}")]), TrailingNote([TrailingNote.Segment("hidden after a cut note")])]
        go.view.select(SelectionSet([
            Selection(caret: store.lineRange(6).location + 1), Selection(caret: store.lineRange(7).location + 1),
            Selection(anchor: store.lineRange(10).location + 5, head: store.lineRange(12).location + 7),
        ], primary: 2), scrolls: false)
        let marked = EngineSpecimen(engineTypeScript, file: "engine.ts")
        marked.view.select(SelectionSet(caret: marked.view.store.lineRange(6).location + 13), scrolls: false)
        let composing = NSMutableAttributedString(string: "こんにちは")
        composing.addAttribute(.underlineStyle, value: NSUnderlineStyle.thick.rawValue, range: NSRange(location: 0, length: 3))
        composing.addAttribute(.underlineStyle, value: NSUnderlineStyle.single.rawValue, range: NSRange(location: 3, length: 2))
        marked.view.setMarkedText(composing, selectedRange: NSRange(location: 3, length: 0), replacementRange: NSRange(location: NSNotFound, length: 0))
        let column = EngineSpecimen(engineTypeScript, file: "column.ts")
        column.view.select(TextCommands.column(from: (0, column.view.metrics.advance * 6), to: (4, column.view.metrics.advance * 14),
                                               in: column.view.store, measure: column.view.columnMeasure), scrolls: false)
        let long = EngineSpecimen("// before\n" + String(repeating: "let value = compute(alpha, beta); ", count: EngineSpecimen.longLine / 34)
                                    + "\n// after", file: "long.ts")
        engineSpecimens = [go, marked, column, long]
        long.view.select(SelectionSet(caret: long.view.store.lineRange(1).location + EngineSpecimen.longLine / 2), scrolls: false)
        return Gallery.page([
            Gallery.section("Go", note: "Three carets, one selection across lines, an inline box and two line-end notes", onCard: true, [go.scroll]),
            Gallery.section("TypeScript", note: "Marked text with the input method's clause underlines", onCard: true, [marked.scroll]),
            Gallery.section("Column selection", note: "Option-drag from column 6 to column 14 over five lines", onCard: true, [column.scroll]),
            Gallery.section("A 1 MB line", note: "Scrolled to its middle; laid out in windows", onCard: true, [long.scroll]),
        ])
    }
)
