import AppKit
import NyteChanges
import NyteCore
import NyteUI

extension ShellViewController {
    static let diskBanner = "disk:"

    func diskDidChange(under url: URL) {
        let url = url.standardizedFileURL
        Task {
            let disk = await Task.detached(priority: .utility) { try? String(contentsOf: url, encoding: .utf8) }.value
            guard editor.tabs.contains(where: { $0.url == url && $0.isDirty }) else { return }
            diskConflicts[url] = disk ?? ""
            showDiskConflict()
        }
    }

    func showDiskConflict() {
        guard let url = editor.selectedURL, diskConflicts[url] != nil else {
            if let banner = editorPane.bannerKey, banner.hasPrefix(Self.diskBanner) { editorPane.clearBanner() }
            return
        }
        let key = Self.diskBanner + url.path
        editorPane.showBanner(key: key, title: "\u{201C}\(url.lastPathComponent)\u{201D} changed on disk while you have unsaved changes.",
                              actions: [
                                  Banner.Action("Compare", primary: true) { [weak self] in self?.compareWithDisk(url) },
                                  Banner.Action("Reload") { [weak self] in self?.reload(url, key: key) },
                                  Banner.Action("Keep Mine") { [weak self] in
                                      self?.keepMine(key)
                                      self?.editorPane.clearBanner(key: key)
                                  },
                              ])
    }

    func keepMine(_ key: String) {
        guard key.hasPrefix(Self.diskBanner) else { return }
        diskConflicts[URL(fileURLWithPath: String(key.dropFirst(Self.diskBanner.count)))] = nil
    }

    private func reload(_ url: URL, key: String) {
        Task {
            guard await editor.revert(url) else { return NSSound.beep() }
            diskConflicts[url] = nil
            editorPane.clearBanner(key: key)
        }
    }

    func revertSelected() {
        guard let url = editor.selectedURL else { return }
        Task {
            if await editor.revert(url) { diskConflicts[url] = nil }
            showDiskConflict()
        }
    }

    func compareWithDisk(_ url: URL) {
        let path = workspace.relativePath(of: url)
        let disk = diskConflicts[url] ?? (try? String(contentsOf: url, encoding: .utf8))
        let diff = DiffViewController(source: .texts(path: path, before: DiffText(title: "On Disk", text: disk),
                                                     after: DiffText(title: "Unsaved", text: editor.text(of: url))))
        diff.root = workspace.root
        openDiff(diff)
    }

    func saveAllFiles() {
        Task {
            let failed = await editor.saveAll()
            guard !failed.isEmpty, let window = view.window else { return }
            let alert = NSAlert()
            let names = failed.map { "\u{201C}\($0.lastPathComponent)\u{201D}" }.joined(separator: ", ")
            alert.messageText = failed.count == 1 ? "\(names) couldn\u{2019}t be saved." : "\(failed.count) files couldn\u{2019}t be saved."
            alert.informativeText = failed.count == 1 ? "Check that the folder still exists and that you can write to it."
                : "\(names) are still unsaved. Check that their folders exist and that you can write to them."
            alert.addButton(withTitle: "OK")
            await alert.beginSheetModal(for: window)
        }
    }
}
