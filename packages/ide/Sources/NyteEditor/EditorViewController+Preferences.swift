import AppKit
import NyteUI

extension EditorViewController {
    static let genericIndent = Indent(usesTabs: false, width: Indent.defaultWidth)

    public func apply(_ preferences: EditorPreferences) {
        guard preferences != self.preferences else { return }
        stash()
        let previous = textView.metrics
        self.preferences = preferences
        let metrics = preferences.metrics
        textView.metrics = metrics
        restyle(from: previous, to: metrics)
        ruler.apply(metrics, lines: shown?.lines.count ?? 1)
        show()
    }

    func indent(of document: Document) -> Indent {
        if let detected = document.detectedIndent { return detected }
        return document.language.indent == Self.genericIndent ? preferences.defaultIndent : document.language.indent
    }

    private func restyle(from previous: CodeRowMetrics, to metrics: CodeRowMetrics) {
        let heightRatio = metrics.lineHeight / previous.lineHeight
        let widthRatio = metrics.advance / previous.advance
        for index in documents.indices where documents[index].body.isText {
            documents[index].model.widest *= widthRatio
            if case .anchored(var anchor) = documents[index].viewport {
                anchor.distanceIntoFirstLine *= heightRatio
                anchor.distanceFromLeftmost *= widthRatio
                documents[index].viewport = .anchored(anchor)
            }
        }
    }
}
