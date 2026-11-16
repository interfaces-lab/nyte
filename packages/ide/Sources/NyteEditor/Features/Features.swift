import AppKit
import NyteUI

extension EditorViewController {
    func installFeatures() {
        install(GutterFeature(editor: self))
        install(FoldingFeature(editor: self))
        install(FindFeature(editor: self))
        install(IndentGuidesFeature(editor: self))
        install(LineNotesFeature(editor: self))
        install(RunMarksFeature(editor: self))
        install(GoToLineFeature(editor: self))
        install(ChangeBarsFeature(editor: self))
        install(StickyScopesFeature(editor: self))
        install(HighlightsFeature(editor: self))
        install(DiagnosticsFeature(editor: self))
        install(SemanticTokensFeature(editor: self))
        install(InlayHintsFeature(editor: self))
        install(OutlineFeature(editor: self))
        install(CompletionFeature(editor: self))
        install(SignatureFeature(editor: self))
        install(HoverFeature(editor: self))
        install(NavigationFeature(editor: self))
        install(RenameFeature(editor: self))
        install(ActionsFeature(editor: self))
    }
}
