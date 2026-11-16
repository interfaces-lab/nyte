import Foundation

enum FileOperation: Sendable {
    case createFile(in: URL)
    case createFolder(in: URL)
    case rename(URL, to: String)
    case trash(URL)
    case duplicate(URL)
    case restore(from: URL, to: URL)

    var actionName: String {
        switch self {
        case .createFile: "New File"
        case .createFolder: "New Folder"
        case .rename: "Rename"
        case .trash, .restore: "Move to Trash"
        case .duplicate: "Duplicate"
        }
    }

    func inverse(result: URL) -> FileOperation {
        switch self {
        case .createFile, .createFolder, .duplicate: .trash(result)
        case let .rename(url, _): .rename(result, to: url.lastPathComponent)
        case let .trash(url): .restore(from: result, to: url)
        case let .restore(_, original): .trash(original)
        }
    }

    func workspaceItem(result: URL) -> URL {
        switch self {
        case let .trash(url): url
        case .createFile, .createFolder, .rename, .duplicate, .restore: result
        }
    }

    var selectsResult: Bool {
        switch self {
        case .trash: false
        case .createFile, .createFolder, .rename, .duplicate, .restore: true
        }
    }

    var failureTitle: String {
        switch self {
        case .createFile: "The file couldn’t be created."
        case .createFolder: "The folder couldn’t be created."
        case let .rename(url, _): "“\(url.lastPathComponent)” couldn’t be renamed."
        case let .trash(url): "“\(url.lastPathComponent)” couldn’t be moved to the Trash."
        case let .duplicate(url): "“\(url.lastPathComponent)” couldn’t be duplicated."
        case let .restore(_, url): "“\(url.lastPathComponent)” couldn’t be put back."
        }
    }
}

struct FileOperationFailure: Error, Sendable {
    let title: String
    let reason: String
}

enum FileNaming {
    enum Problem: Equatable {
        case empty, containsSlash, startsWithDot, taken
    }

    static func problem(with name: String, existing: Set<String>, current: String) -> Problem? {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { return .empty }
        if name.contains("/") || name.contains(":") { return .containsSlash }
        if name == "." || name == ".." { return .startsWithDot }
        if name != current, existing.contains(name) { return .taken }
        return nil
    }

    static func available(_ wanted: String, copy: Bool, existing: Set<String>) -> String {
        let base = (wanted as NSString).deletingPathExtension
        let pathExtension = (wanted as NSString).pathExtension
        let stem = copy ? base + " copy" : base
        func named(_ number: Int) -> String {
            let numbered = number == 1 ? stem : "\(stem) \(number)"
            return pathExtension.isEmpty ? numbered : numbered + "." + pathExtension
        }
        var number = 1
        while existing.contains(named(number)) { number += 1 }
        return named(number)
    }

    static func describe(_ problem: Problem, name: String) -> String {
        switch problem {
        case .empty: "A name can’t be empty."
        case .containsSlash: "A name can’t contain “/” or “:”."
        case .startsWithDot: "“\(name)” is reserved by the system."
        case .taken: "“\(name)” is already taken. Choose a different name."
        }
    }
}

enum FileOperations {
    static let untitledFile = "untitled"
    static let untitledFolder = "untitled folder"

    @concurrent static func perform(_ operation: FileOperation) async -> Result<URL, FileOperationFailure> {
        let manager = FileManager.default
        do {
            switch operation {
            case let .createFile(folder):
                let target = folder.appendingPathComponent(FileNaming.available(untitledFile, copy: false, existing: names(in: folder)))
                guard manager.createFile(atPath: target.path, contents: Data()) else {
                    throw CocoaError(.fileWriteUnknown, userInfo: [NSFilePathErrorKey: target.path])
                }
                return .success(target)
            case let .createFolder(folder):
                let target = folder.appendingPathComponent(FileNaming.available(untitledFolder, copy: false, existing: names(in: folder)),
                                                           isDirectory: true)
                try manager.createDirectory(at: target, withIntermediateDirectories: false)
                return .success(target)
            case let .rename(url, name):
                let target = url.deletingLastPathComponent().appendingPathComponent(name)
                try manager.moveItem(at: url, to: target)
                return .success(target)
            case let .trash(url):
                var trashed: NSURL?
                try manager.trashItem(at: url, resultingItemURL: &trashed)
                guard let trashed = trashed as URL? else { throw CocoaError(.fileNoSuchFile, userInfo: [NSFilePathErrorKey: url.path]) }
                return .success(trashed)
            case let .restore(source, target):
                guard !manager.fileExists(atPath: target.path) else {
                    throw CocoaError(.fileWriteFileExists, userInfo: [NSFilePathErrorKey: target.path])
                }
                try manager.moveItem(at: source, to: target)
                return .success(target)
            case let .duplicate(url):
                let folder = url.deletingLastPathComponent()
                let target = folder.appendingPathComponent(FileNaming.available(url.lastPathComponent, copy: true, existing: names(in: folder)))
                try manager.copyItem(at: url, to: target)
                return .success(target)
            }
        } catch {
            FilesLog.logger.error("\(operation.failureTitle, privacy: .public) \(error.localizedDescription, privacy: .public)")
            return .failure(FileOperationFailure(title: operation.failureTitle, reason: error.localizedDescription))
        }
    }

    @concurrent static func itemCount(in folder: URL) async -> Int {
        (try? FileManager.default.contentsOfDirectory(atPath: folder.path).count) ?? 0
    }

    @concurrent static func siblingNames(of url: URL) async -> Set<String> {
        names(in: url.deletingLastPathComponent())
    }

    private static func names(in folder: URL) -> Set<String> {
        Set((try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? [])
    }
}
