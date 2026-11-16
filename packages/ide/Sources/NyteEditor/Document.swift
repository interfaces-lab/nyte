import AppKit
import NyteUI
import NyteCore
import os

enum DocumentBody {
    case loading(OSSignpostIntervalState)
    case text
    case notice(String)

    var isText: Bool {
        if case .text = self { return true }
        return false
    }
}

struct ScrollAnchor: Equatable {
    var firstVisibleCharacter: Int
    var distanceFromLeftmost: CGFloat
    var distanceIntoFirstLine: CGFloat
}

enum SavedViewport: Equatable {
    case top
    case anchored(ScrollAnchor)
}

@MainActor
struct Document {
    let id: Int
    let url: URL
    let model = TextModel()
    let undo = UndoManager()
    var language: Language
    var body: DocumentBody
    var isDirty = false
    var isPreview: Bool
    var format = TextFormat(encoding: .utf8, hasBOM: false, lineEnding: .lf)
    var detectedIndent: Indent?
    var viewport = SavedViewport.top
    var modified: Date?
    var savedDigest = 0
    var savedLength = 0
    var revision = 0
    var isOpenInIntelligence = false
    var pendingReveal: TextSpan?
    var pendingState: EditorViewState?

    init(id: Int, url: URL, isPreview: Bool, opening: OSSignpostIntervalState) {
        self.id = id
        self.url = url
        self.isPreview = isPreview
        body = .loading(opening)
        language = Language.detect(url)
    }

    var store: TextStore { model.session.store }
    var lines: LineIndex { model.session.store.lines }
    var text: ShownText { ShownText(model.session.store.buffer) }
    var length: Int { model.session.store.length }
}
