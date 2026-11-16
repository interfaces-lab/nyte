import AppKit
import NyteEditor
import NyteUI

extension ShellViewController {
    func tabMenu(_ index: Int) -> NSMenu? {
        guard editor.tabs.indices.contains(index) else { return nil }
        let url = editor.tabs[index].url
        let hasRight = index < editor.tabs.count - 1
        return Menu.make([
            MenuItem("Close") { [weak self] in self?.close(url) },
            MenuItem("Close Others", enabled: editor.tabs.count > 1) { [weak self] in self?.closeTabs { $0 != url } },
            MenuItem("Close to the Right", enabled: hasRight) { [weak self] in self?.closeTabs(rightOf: index) },
            .separator,
            MenuItem("Copy Path") { Self.copy(url.path) },
            .separator,
            MenuItem("Reveal in Finder", symbol: "folder", showsIcon: true) {
                NSWorkspace.shared.activateFileViewerSelecting([url])
            },
        ])
    }

    func textMenu() -> NSMenu {
        let entries: [(CommandID, String)] = [
            (.goToDefinition, "Go to Definition"), (.findUsages, "Find Usages"), (.rename, "Rename…"),
            (.formatDocument, "Format Document"),
        ]
        let code = entries.compactMap { id, title -> MenuItem? in
            guard let command = Commands.command(id) else { return nil }
            return MenuItem(title, key: command.key?.character ?? "", modifiers: command.key?.modifiers ?? [],
                            enabled: canRun(command)) { [weak self] in self?.run(id, from: nil) }
        }
        let edits: [(String, Selector, Key)] = [
            ("Cut", #selector(NSText.cut(_:)), Key("x")), ("Copy", #selector(NSText.copy(_:)), Key("c")),
            ("Paste", #selector(NSText.paste(_:)), Key("v")),
        ]
        let clipboard = edits.map { title, selector, key in
            MenuItem(title, key: key.character, modifiers: key.modifiers) { NSApp.sendAction(selector, to: nil, from: nil) }
        }
        return Menu.make(code + [.separator] + clipboard)
    }
}
