import AppKit
import NyteEditor

extension ShellViewController {
    static let closedTabLimit = 20

    func close(_ url: URL) {
        editor.tabs.firstIndex { $0.url == url }.map(editor.close)
    }

    func closeTabs(where shouldClose: (URL) -> Bool) {
        for url in editor.tabs.map(\.url).reversed() where shouldClose(url) { close(url) }
    }

    func closeTabs(rightOf index: Int) {
        let right = Set(editor.tabs.suffix(from: min(index + 1, editor.tabs.count)).map(\.url))
        closeTabs { right.contains($0) }
    }

    func closeOtherTabs() {
        guard let url = editor.selectedURL else { return }
        closeTabs { $0 != url }
    }

    func closeSelectedTab() {
        if let document = editorPane.shownDocument { return editorPane.closeDocument(document) }
        editor.selectedIndex.map(editor.close)
    }

    func reopenClosedTab() {
        guard let url = closedTabs.popLast() else { return }
        editor.open(url, preview: false)
        editor.focus()
    }

    func noteTabs() {
        let now = editor.tabs
        let open = Set(now.map(\.url))
        for tab in openTabs where tab.isDirty && now.contains(where: { $0.url == tab.url && !$0.isDirty }) { diskConflicts[tab.url] = nil }
        let closed = openTabs.filter { !$0.isPreview && !open.contains($0.url) }.map(\.url)
        closedTabs = Array((closedTabs.filter { !open.contains($0) && !closed.contains($0) } + closed).suffix(Self.closedTabLimit))
        openTabs = now
        recentTabs = recentTabs.filter(open.contains)
        if let url = editor.selectedURL { recentTabs = [url] + recentTabs.filter { $0 != url } }
    }
}
