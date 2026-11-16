import AppKit
import NyteUI

extension EditorViewController {
    static let foldCommands: [Selector: FoldCommand] = [
        #selector(TextEngineView.foldCode(_:)): .fold, #selector(TextEngineView.unfoldCode(_:)): .unfold,
        #selector(TextEngineView.toggleFolding(_:)): .toggle, #selector(TextEngineView.foldAll(_:)): .foldAll,
        #selector(TextEngineView.unfoldAll(_:)): .unfoldAll, #selector(TextEngineView.foldBlockComments(_:)): .foldComments,
        #selector(TextEngineView.foldImports(_:)): .foldImports,
    ]

    var folding: FoldingFeature? { features.lazy.compactMap { $0 as? FoldingFeature }.first }
    var finding: FindFeature? { features.lazy.compactMap { $0 as? FindFeature }.first }

    func setFindBarShown(_ shown: Bool) {
        guard findBar.isHidden == shown else { return }
        findBar.isHidden = !shown
        scrollAtTop?.isActive = !shown
        scrollUnderBar?.isActive = shown
        view.layoutSubtreeIfNeeded()
        if !shown { errorStripe.showMatches([]) }
    }

    public func foldState(of url: URL) -> [ClosedRange<Int>] {
        document(for: url)?.model.rowMap.folds.ranges ?? []
    }

    public func restoreFolds(_ ranges: [ClosedRange<Int>], in url: URL) {
        guard let index = documents.firstIndex(where: { $0.url == url.standardizedFileURL }) else { return }
        let model = documents[index].model
        if textView.model === model { return textView.setFolds(ranges) }
        let count = model.session.store.lineCount
        model.rowMap = RowMap(folds: FoldMap(hiding: ranges.filter { $0.lowerBound >= 1 && $0.upperBound < count }))
    }
}

extension TextEngineView {
    override func performTextFinderAction(_ sender: Any?) {
        guard let action = Self.finderAction(sender) else { return }
        _ = onFinderAction?(action)
    }

    static func finderAction(_ sender: Any?) -> NSTextFinder.Action? {
        let tag = (sender as? NSValidatedUserInterfaceItem)?.tag ?? (sender as? NSControl)?.tag ?? 0
        return NSTextFinder.Action(rawValue: tag)
    }

    @objc func toggleMatchCase(_ sender: Any?) { _ = onFinderToggle?(.matchCase) }
    @objc func toggleWholeWord(_ sender: Any?) { _ = onFinderToggle?(.wholeWords) }
    @objc func toggleRegularExpression(_ sender: Any?) { _ = onFinderToggle?(.regex) }

    @objc func foldCode(_ sender: Any?) { _ = onEditorCommand?(#selector(foldCode(_:))) }
    @objc func unfoldCode(_ sender: Any?) { _ = onEditorCommand?(#selector(unfoldCode(_:))) }
    @objc func toggleFolding(_ sender: Any?) { _ = onEditorCommand?(#selector(toggleFolding(_:))) }
    @objc func foldAll(_ sender: Any?) { _ = onEditorCommand?(#selector(foldAll(_:))) }
    @objc func unfoldAll(_ sender: Any?) { _ = onEditorCommand?(#selector(unfoldAll(_:))) }
    @objc func foldBlockComments(_ sender: Any?) { _ = onEditorCommand?(#selector(foldBlockComments(_:))) }
    @objc func foldImports(_ sender: Any?) { _ = onEditorCommand?(#selector(foldImports(_:))) }
}
