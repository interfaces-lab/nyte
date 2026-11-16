import AppKit
import NyteCore
import NyteUI

extension FindInFilesViewController {
    static let chooseFolderTitle = "Folder\u{2026}"

    func configureScope() {
        bar.scope.menuProvider = { [weak self] in self?.scopeMenu() }
        bar.folderChip.onRemove = { [weak self] in self?.choose(.workspace) }
        bar.folderChip.onPress = { [weak self] in self?.chooseFolder() }
        bar.grouping.onPress = { [weak self] in
            guard let self else { return }
            setGroupsByFolder(!groupsByFolder)
        }
    }

    func scopeMenu() -> NSMenu {
        var items = [
            MenuItem("Workspace", checked: scope == .workspace) { [weak self] in self?.choose(.workspace) },
            MenuItem("Open Files", enabled: openFiles != nil, checked: scope == .openFiles) { [weak self] in self?.choose(.openFiles) },
        ]
        if changedFiles != nil {
            items.append(MenuItem("Changed Files", checked: scope == .changedFiles) { [weak self] in self?.choose(.changedFiles) })
        }
        let inFolder = if case .folder = scope { true } else { false }
        items.append(.separator)
        items.append(MenuItem(Self.chooseFolderTitle, checked: inFolder) { [weak self] in self?.chooseFolder() })
        return Menu.make(items)
    }

    func choose(_ next: Scope) {
        scope = next
        updateScopes()
        startSearch()
    }

    func updateScopes() {
        guard isViewLoaded else { return }
        if scope == .changedFiles, changedFiles == nil { scope = .workspace }
        bar.scope.title = switch scope {
        case .workspace: "Workspace"
        case .openFiles: "Open Files"
        case .changedFiles: "Changed Files"
        case .folder: "Folder"
        }
        bar.scope.setAccessibilityValue(bar.scope.title)
        guard case let .folder(path) = scope else {
            bar.folderChip.isHidden = true
            return
        }
        bar.folderChip.title = (path as NSString).lastPathComponent
        bar.folderChip.toolTip = path
        bar.folderChip.setAccessibilityLabel("Folder \(path)")
        bar.folderChip.isHidden = false
    }

    var scopePlace: String {
        switch scope {
        case .workspace: "in this workspace"
        case .openFiles: "in the open files"
        case .changedFiles: "in the changed files"
        case let .folder(path): "in \(path)"
        }
    }

    func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Search"
        panel.message = "Choose a folder in \(workspace.name) to search."
        panel.directoryURL = if case let .folder(path) = scope { workspace.root.appendingPathComponent(path) } else { workspace.root }
        guard let window = view.window else { return }
        panel.beginSheetModal(for: window) { [weak self] response in
            guard response == .OK, let url = panel.url else { return }
            self?.pick(folder: url)
        }
    }

    func pick(folder url: URL) {
        let relative = workspace.relativePath(of: url)
        guard relative != url.standardizedFileURL.path else {
            clearBanner()
            let banner = Banner("That folder is outside \(workspace.name)", detail: "Find in Files searches inside the workspace.", tone: .warning)
            banner.onDismiss = { [weak self] in self?.clearBanner() }
            bannerHost.addArrangedSubview(banner)
            banner.widthAnchor.constraint(equalTo: bannerHost.widthAnchor).isActive = true
            return
        }
        choose(relative.isEmpty ? .workspace : .folder(relative))
    }
}
