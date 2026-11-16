import AppKit
import NyteUI
import os

extension EditorViewController {
    func stash() {
        guard let index = selectedIndex, documents.indices.contains(index), documents[index].body.isText,
              textView.model === documents[index].model
        else { return }
        documents[index].viewport = currentViewport
    }

    var currentViewport: SavedViewport {
        let visible = scrollView.contentView.bounds
        guard textView.store.lineCount > 0 else { return .top }
        let line = textView.line(atY: visible.minY)
        return .anchored(ScrollAnchor(
            firstVisibleCharacter: textView.store.lineRange(line).location,
            distanceFromLeftmost: visible.minX - leftmostScrollX,
            distanceIntoFirstLine: visible.minY - textView.top(ofLine: line)
        ))
    }

    func show() {
        guard let index = selectedIndex else { return showNothing(notice: nil) }
        let document = documents[index]
        switch document.body {
        case .loading: return showBlank()
        case .notice(let text): return showNothing(notice: text)
        case .text: break
        }
        notice.isHidden = true
        scrollView.isHidden = false
        textView.isEditable = true
        textView.attach(document.model)
        textView.indent = indent(of: document)
        textView.setAccessibilityLabel(document.url.lastPathComponent)
        ruler.updateThickness(lines: document.lines.count)
        restore(document.viewport)
        textView.needsDisplay = true
        ruler.needsDisplay = true
        repaint()
        reportPosition()
        for feature in features { feature.documentDidChange() }
    }

    private func showBlank() {
        notice.isHidden = true
        scrollView.isHidden = false
        attachBlank()
        ruler.needsDisplay = true
        onPositionChange?(nil)
        for feature in features { feature.documentDidChange() }
    }

    private func showNothing(notice text: String?) {
        attachBlank()
        scrollView.isHidden = true
        notice.stringValue = text ?? ""
        notice.isHidden = text == nil
        onPositionChange?(nil)
        for feature in features { feature.documentDidChange() }
    }

    private func attachBlank() {
        textView.isEditable = false
        textView.attach(blank)
    }

    func restore(_ viewport: SavedViewport) {
        textView.fitFrame()
        guard case .anchored(let anchor) = viewport else { return scroll(to: NSPoint(x: leftmostScrollX, y: 0)) }
        scroll(to: anchor)
    }

    func scroll(to anchor: ScrollAnchor) {
        let store = textView.store
        let line = store.line(at: min(anchor.firstVisibleCharacter, store.length))
        scroll(to: NSPoint(x: leftmostScrollX + anchor.distanceFromLeftmost, y: textView.top(ofLine: line) + anchor.distanceIntoFirstLine))
    }

    var leftmostScrollX: CGFloat {
        let clip = scrollView.contentView
        var pastLeftEdge = clip.bounds
        pastLeftEdge.origin.x = textView.frame.minX - clip.bounds.width
        return clip.constrainBoundsRect(pastLeftEdge).minX
    }

    func scroll(to origin: NSPoint) {
        let clip = scrollView.contentView
        clip.scroll(to: clip.constrainBoundsRect(NSRect(origin: origin, size: clip.bounds.size)).origin)
        scrollView.reflectScrolledClipView(clip)
    }

    func reportPosition() {
        guard let document = shown else {
            onPositionChange?(nil)
            return
        }
        let caret = textView.selectedRange().location
        let line = document.lines.line(at: caret)
        onPositionChange?(EditorPosition(
            line: line + 1, column: caret - document.lines.start(of: line) + 1,
            selected: textView.selections.ranges.reduce(0) { $0 + $1.length }, language: document.language.name,
            usesTabs: indent(of: document).usesTabs, indentWidth: indent(of: document).width
        ))
    }

    @objc func visibleRegionDidChange() {
        let signpost = OSSignposter.editor.beginInterval("scroll")
        defer { OSSignposter.editor.endInterval("scroll", signpost) }
        paint()
        ruler.needsDisplay = true
        for feature in features { feature.viewportDidChange() }
    }

    @objc func clipDidResize() {
        textView.fitFrame()
        visibleRegionDidChange()
    }

    func executionPointDidChange() {
        textView.needsDisplay = true
        ruler.needsDisplay = true
        for feature in features { feature.viewportDidChange() }
    }
}
