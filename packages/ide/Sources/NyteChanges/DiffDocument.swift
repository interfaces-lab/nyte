import Foundation
import NyteCore
import NyteUI

public enum DiffComparison: Sendable, Hashable {
    case worktree
    case staged
}

public struct DiffText: Sendable, Hashable {
    public var title: String
    public var text: String?

    public init(title: String, text: String?) {
        self.title = title
        self.text = text
    }
}

public enum DiffSource: Sendable {
    case repository(GitRepository, path: String, comparison: DiffComparison)
    case texts(path: String, before: DiffText, after: DiffText)
    case revisions(GitRepository, path: String, from: String, to: String?)

    var path: String {
        switch self {
        case let .repository(_, path, _), let .texts(path, _, _), let .revisions(_, path, _, _): path
        }
    }
}

struct DiffDocument: Sendable {
    enum Shape: Sendable, Equatable {
        case text
        case identical
        case binary(old: Int?, new: Int?)
        case tooLarge(old: Int, new: Int)
        case unavailable(String)
    }

    var path: String
    var originalPath: String?
    var oldTitle: String
    var newTitle: String
    var old = TextLines.empty
    var new = TextLines.empty
    var oldExists = true
    var newExists = true
    var oldMode: UInt32 = 0
    var newMode: UInt32 = 0
    var conflict: GitEntry.Conflict?
    var submodule = false
    var headExists = true
    var unsaved = false
    var change: GitChange?
    var patch: PatchShape?
    var diff = Diff(hunks: [], quality: .minimal)
    var shape = Shape.text
    var declarations: [Int32] = []
    var columns = 0
    var oldStates: [UInt8] = []
    var newStates: [UInt8] = []
    var language = Language.plain

    static let largestFile = 20_000_000
    static let tabWidth = 4

    init(path: String, oldTitle: String, newTitle: String) {
        self.path = path
        self.oldTitle = oldTitle
        self.newTitle = newTitle
    }

    var isNew: Bool { change.map { $0 == .added || $0 == .untracked } ?? (!oldExists && newExists) }
    var isDeleted: Bool { change.map { $0 == .deleted } ?? (oldExists && !newExists) }
    var comparison: String { oldTitle + " \u{2192} " + newTitle }

    func number(_ side: ReviewComment.Side, _ line: Int) -> Int {
        guard let patch else { return line + 1 }
        let numbers = side == .new ? patch.newNumbers : patch.oldNumbers
        return line < numbers.count ? Int(numbers[line]) : line + 1
    }
    var modeChanged: Bool { oldMode != 0 && newMode != 0 && oldMode != newMode }

    @concurrent static func load(_ source: DiffSource, buffer: String? = nil) async -> DiffDocument {
        switch source {
        case let .texts(path, before, after):
            var document = DiffDocument(path: path, oldTitle: before.title, newTitle: after.title)
            document.oldExists = before.text != nil
            document.newExists = after.text != nil
            return document.comparing(Data((before.text ?? "").utf8), Data((after.text ?? "").utf8))
        case let .repository(repository, path, comparison):
            do {
                return try await loadRepository(repository, path: path, buffer: buffer, comparison: comparison)
            } catch {
                var document = DiffDocument(path: path, oldTitle: "", newTitle: "")
                document.shape = .unavailable(error.message)
                return document
            }
        case let .revisions(repository, path, from, to):
            do {
                var document = DiffDocument(path: path, oldTitle: String(from.prefix(12)), newTitle: to.map { String($0.prefix(12)) } ?? "Working Tree")
                let old = try await repository.blob(path, at: .commit(from))
                let new: Data? = if let to { try await repository.blob(path, at: .commit(to)) } else { disk(repository.url(of: path)) }
                document.oldExists = old != nil
                document.newExists = new != nil
                return document.comparing(old ?? Data(), new ?? Data())
            } catch {
                var document = DiffDocument(path: path, oldTitle: from, newTitle: to ?? "Working Tree")
                document.shape = .unavailable(error.message)
                return document
            }
        }
    }

    static func loadRepository(_ repository: GitRepository, path: String, buffer: String? = nil,
                               comparison: DiffComparison) async throws(GitFailure) -> DiffDocument {
        var report = try await repository.status(of: [path])
        if report.entries.first(where: { $0.path == path })?.index == .added { report = try await repository.status() }
        let entry = report.entries.first { $0.path == path }
        var document: DiffDocument
        let old: Data?, new: Data?
        switch comparison {
        case .worktree:
            document = DiffDocument(path: path, oldTitle: entry?.conflict == nil ? "Index" : "Ours", newTitle: "Working Tree")
            document.conflict = entry?.conflict
            if entry?.isUntracked == true {
                old = nil
            } else {
                old = try await repository.blob(path, at: entry?.conflict == nil ? .index : .ours)
            }
            let saved = disk(repository.url(of: path))
            let edited = buffer.map { Data($0.utf8) }
            new = edited ?? saved
            document.unsaved = edited != nil && edited != saved
            if document.unsaved { document.newTitle = "Unsaved" }
            document.oldMode = entry?.indexMode ?? 0
            document.newMode = entry?.worktreeMode ?? 0
        case .staged:
            document = DiffDocument(path: path, oldTitle: "HEAD", newTitle: "Index")
            document.originalPath = entry?.originalPath
            old = try await repository.blob(entry?.originalPath ?? path, at: .head)
            new = try await repository.blob(path, at: .index)
            document.oldMode = entry?.headMode ?? 0
            document.newMode = entry?.indexMode ?? 0
        }
        document.submodule = entry?.submodule != nil
        document.headExists = report.branch.commit != nil
        document.oldExists = old != nil
        document.newExists = new != nil
        return document.comparing(old ?? Data(), new ?? Data())
    }

    static func disk(_ url: URL) -> Data? {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), !isDirectory.boolValue else { return nil }
        return try? Data(contentsOf: url, options: .mappedIfSafe)
    }

    func comparing(_ oldData: Data, _ newData: Data) -> DiffDocument {
        var document = self
        if submodule {
            document.shape = .unavailable("This is a submodule. Open it as its own repository to review its changes.")
            return document
        }
        guard oldData.count <= Self.largestFile, newData.count <= Self.largestFile else {
            document.shape = .tooLarge(old: oldData.count, new: newData.count)
            return document
        }
        let old = TextLines(bytes: [UInt8](oldData)), new = TextLines(bytes: [UInt8](newData))
        if old.isBinary || new.isBinary {
            document.shape = .binary(old: oldExists ? oldData.count : nil, new: newExists ? newData.count : nil)
            return document
        }
        document.old = old
        document.new = new
        document.diff = Diff(from: old, to: new)
        document.shape = document.diff.hunks.isEmpty ? .identical : .text
        document.declarations = document.diff.hunks.map { hunk in
            Int32(new.declarationLine(before: hunk.new.lowerBound) ?? -1)
        }
        document.columns = max(Self.widest(old), Self.widest(new))
        document.language = Language.detect(fileName: (path as NSString).lastPathComponent)
        document.oldStates = Self.entryStates(old, document.language)
        document.newStates = Self.entryStates(new, document.language)
        return document
    }

    static func entryStates(_ lines: TextLines, _ language: Language) -> [UInt8] {
        guard language.family != .plain else { return [] }
        var states = [UInt8](repeating: 0, count: lines.count)
        var tokens: [UInt64] = []
        var state = LexState.normal
        var units: [UInt16] = []
        for line in 0..<lines.count {
            states[line] = state
            units.removeAll(keepingCapacity: true)
            units.append(contentsOf: String(decoding: lines.content(of: line), as: UTF8.self).utf16)
            tokens.removeAll(keepingCapacity: true)
            state = units.withUnsafeBufferPointer { buffer in
                Lexer.line(buffer, state: state, language: language, offset: 0, tokens: &tokens, emit: false)
            }
        }
        return states
    }

    static func widest(_ lines: TextLines) -> Int {
        var widest = 0
        lines.bytes.withUnsafeBufferPointer { bytes in
            for line in 0..<lines.count {
                let range = lines.contentRange(of: line)
                guard range.count > widest else { continue }
                var columns = 0
                for index in range {
                    let byte = bytes[index]
                    if byte == UInt8(ascii: "\t") {
                        columns += tabWidth - columns % tabWidth
                    } else if byte & 0xC0 != 0x80 {
                        columns += 1
                    }
                }
                widest = max(widest, columns)
            }
        }
        return widest
    }
}
