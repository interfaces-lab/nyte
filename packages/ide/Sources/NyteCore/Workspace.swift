import Foundation

/// The folder a window is working in.
public struct Workspace: Sendable, Equatable {
    public let root: URL

    public init(root: URL) {
        self.root = root.standardizedFileURL
    }

    public var name: String { root.lastPathComponent }

    /// A path relative to the root, or the full path for a file outside it.
    public func relativePath(of url: URL) -> String {
        let path = url.standardizedFileURL.path
        let prefix = root.path.hasSuffix("/") ? root.path : root.path + "/"
        return path.hasPrefix(prefix) ? String(path.dropFirst(prefix.count)) : path
    }
}
