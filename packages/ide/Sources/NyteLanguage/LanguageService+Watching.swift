import Foundation
import NyteCore

extension LanguageService {
    nonisolated static let externalFolderLimit = 8

    func updateWatchers(_ index: Int, _ registering: Bool, _ params: JSON) {
        let entries = (registering ? params["registrations"] : params["unregisterations"] ?? params["unregistrations"])?.array ?? []
        for entry in entries where entry["method"]?.string == ClientFeature.didChangeWatchedFiles.method {
            guard let id = entry["id"]?.string else { continue }
            servers[index].watchers[id] = registering
                ? (entry["registerOptions"]?["watchers"]?.array ?? []).compactMap(FileWatcher.init) : nil
        }
        watchOutsideWorkspace()
    }

    func watchOutsideWorkspace() {
        let roots = Self.externalRoots(servers.flatMap { $0.watchers.values.flatMap { $0 } }.compactMap(\.root), workspace: workspace.root)
        guard roots != externalRoots else { return }
        externalRoots = roots
        let aliases = roots.map { (resolved: URL(fileURLWithPath: $0).resolvingSymlinksInPath().path, root: $0) }
        externalStream = roots.isEmpty ? nil : FileEventStream(paths: roots) { [weak self] urls in
            let named = urls.map { url in
                aliases.first { url.path.hasPrefix($0.resolved + "/") }
                    .map { URL(fileURLWithPath: $0.root + url.path.dropFirst($0.resolved.count)) } ?? url
            }
            Task { @MainActor in self?.filesDidChange(named) }
        }
    }

    nonisolated static func externalRoots(_ candidates: [URL], workspace: URL) -> [String] {
        let fold = FileWatcher.folded
        let home = fold(FileManager.default.homeDirectoryForCurrentUser.standardizedFileURL.path)
        let top = fold(workspace.path)
        var seen: Set<String> = []
        let paths = candidates.map { $0.standardizedFileURL.path }.filter { path in
            var isFolder: ObjCBool = false
            let key = fold(path)
            return key != "/" && key != home && key != top && !key.hasPrefix(top + "/") && !top.hasPrefix(key + "/")
                && FileManager.default.fileExists(atPath: path, isDirectory: &isFolder) && isFolder.boolValue && seen.insert(key).inserted
        }
        let outermost = paths.filter { path in !paths.contains { fold(path).hasPrefix(fold($0) + "/") } }
        return Array(outermost.sorted().prefix(externalFolderLimit))
    }
}
