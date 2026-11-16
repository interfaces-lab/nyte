import AppKit
import NyteUI

struct PaneDocument {
    let id: String
    let title: String
    let toolTip: String
    let symbol: String
    let controller: NSViewController
}

extension EditorPaneController {
    func show(_ document: PaneDocument) {
        if !documents.contains(where: { $0.id == document.id }) {
            documents.append(document)
            addChild(document.controller)
            let content = document.controller.view
            content.translatesAutoresizingMaskIntoConstraints = false
            documentSlot.addSubview(content)
            NSLayoutConstraint.activate([
                content.topAnchor.constraint(equalTo: documentSlot.topAnchor),
                content.leadingAnchor.constraint(equalTo: documentSlot.leadingAnchor),
                content.trailingAnchor.constraint(equalTo: documentSlot.trailingAnchor),
                content.bottomAnchor.constraint(equalTo: documentSlot.bottomAnchor),
            ])
        }
        shownDocument = document.id
        refreshTabs()
    }

    func closeDocument(_ id: String) {
        guard let index = documents.firstIndex(where: { $0.id == id }) else { return }
        let document = documents.remove(at: index)
        document.controller.view.removeFromSuperview()
        document.controller.removeFromParent()
        if shownDocument == id { shownDocument = documents[safe: min(index, documents.count - 1)]?.id }
        refreshTabs()
    }

    func selectTab(_ index: Int) {
        guard index >= editor.tabs.count else {
            shownDocument = nil
            editor.select(at: index)
            return refreshTabs()
        }
        shownDocument = documents[safe: index - editor.tabs.count]?.id
        refreshTabs()
    }

    func closeTab(_ index: Int) {
        guard index >= editor.tabs.count else { return editor.close(at: index) }
        documents[safe: index - editor.tabs.count].map { closeDocument($0.id) }
    }
}
