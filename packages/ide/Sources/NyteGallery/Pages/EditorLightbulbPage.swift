import AppKit
import NyteCore
import NyteUI
@testable import NyteEditor

@MainActor private var bulbEditors: [EditorViewController] = []

@MainActor
let editorLightbulbPage = GalleryPage(
    name: "editor-lightbulb", settle: 0.5,
    prepare: {
        for editor in bulbEditors {
            _ = await Wait.until(.seconds(5)) { editor.url != nil }
            editor.textView.setSelectedRange(NSRange(location: editor.textView.store.lineRange(BulbSpecimen.line).location + 1, length: 0))
            editor.ruler.needsDisplay = true
        }
    },
    teardown: { bulbEditors.removeAll() },
    build: {
        bulbEditors = Lightbulb.allKinds.map(BulbSpecimen.make)
        return Gallery.page(zip(["An intention", "A fix for an error", "A fix for a warning"], bulbEditors).map { title, editor in
            Gallery.section(title, note: "Line 28 has the caret and a breakpoint; line 27 a breakpoint", onCard: true,
                            [Gallery.sized(editor.view, width: BulbSpecimen.size.width, height: BulbSpecimen.size.height)])
        })
    }
)

@MainActor
private enum BulbSpecimen {
    static let line = 27
    static let size = NSSize(width: 860, height: 140)

    static func make(_ kind: Lightbulb) -> EditorViewController {
        let root = EditorSpecimen.fixtures.appendingPathComponent("notifyhub-go", isDirectory: true)
        let editor = EditorViewController(workspace: Workspace(root: root))
        let file = root.appendingPathComponent("main.go")
        editor.breakpoints = { _ in [SourceBreakpoint(zeroBasedLine: line - 1, verification: .verified), SourceBreakpoint(zeroBasedLine: line, verification: .verified)] }
        editor.open(file, preview: false)
        editor.reveal(FileLocation(url: file, range: TextSpan(at: TextPosition(line: line, column: 1))), asJump: false)
        editor.ruler.onClickLightbulb = { _ in }
        editor.ruler.lightbulb = { (line, kind) }
        return editor
    }
}

extension Lightbulb {
    static let allKinds: [Lightbulb] = [.intention, .fixesError, .fixesWarning]
}
