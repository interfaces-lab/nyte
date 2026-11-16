import Foundation
import os
import Synchronization

public struct GitFailure: Error, Sendable, Equatable {
    public enum Reason: Sendable, Equatable {
        case gitMissing
        case notRepository
        case exited(Int32)
        case timedOut
        case cancelled
        case unreadable
    }

    public let reason: Reason
    public let command: String
    public let message: String

    public init(_ reason: Reason, command: String, message: String) {
        self.reason = reason
        self.command = command
        self.message = message
    }
}

public enum GitLocation: Sendable, Equatable {
    case repository(GitRepository)
    case notRepository(URL)
    case gitMissing(String)
    case failed(GitFailure)
}

public struct GitRepository: Sendable, Hashable {
    public static let systemGit = URL(fileURLWithPath: "/usr/bin/git")
    static let readTimeout: Duration = .seconds(60)
    static let writeTimeout: Duration = .seconds(120)
    static let commitTimeout: Duration = .seconds(900)
    static let inherited = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX", "GIT_OBJECT_DIRECTORY"]
    static let absentMarks = ["does not exist", "exists on disk, but not in", "invalid object name", "not a valid object name"]

    public let root: URL
    public let executable: URL
    public let environment: [String: String]

    public init(root: URL, executable: URL = systemGit, environment: [String: String] = ProcessInfo.processInfo.environment) {
        self.root = root.standardizedFileURL
        self.executable = executable
        var cleaned = environment
        for name in Self.inherited { cleaned[name] = nil }
        cleaned["GIT_TERMINAL_PROMPT"] = "0"
        self.environment = cleaned
    }

    public static func locate(_ folder: URL, executable: URL = systemGit,
                              environment: [String: String] = ProcessInfo.processInfo.environment) async -> GitLocation {
        guard FileManager.default.isExecutableFile(atPath: executable.path) else {
            return .gitMissing("No git at \(executable.path).")
        }
        let probe = GitRepository(root: folder, executable: executable, environment: environment)
        do {
            let output = try await probe.run(["rev-parse", "--show-toplevel"], reading: true)
            let path = String(decoding: output, as: UTF8.self).trimmingCharacters(in: .newlines)
            return .repository(GitRepository(root: URL(fileURLWithPath: path, isDirectory: true), executable: executable,
                                             environment: environment))
        } catch {
            if error.message.contains("not a git repository") || error.message.contains("must be run in a work tree") {
                return .notRepository(folder)
            }
            if error.reason == .gitMissing { return .gitMissing(error.message) }
            do {
                _ = try await probe.run(["--version"], reading: true)
            } catch {
                return .gitMissing(error.message.isEmpty ? "git did not start." : error.message)
            }
            return .failed(error)
        }
    }

    public func url(of path: String) -> URL { root.appendingPathComponent(path) }

    public func status(of paths: [String] = [], includingIgnored: Bool = false) async throws(GitFailure) -> GitStatusReport {
        let scope = paths.isEmpty ? [] : ["--"] + paths
        let ignored = includingIgnored ? ["--ignored=matching"] : []
        let output = try await run(["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"] + ignored + scope,
                                   reading: true)
        return GitStatusReport.parse(output)
    }

    public func lineCounts(staged: Bool) async throws(GitFailure) -> [String: GitLineCount] {
        let arguments = ["diff", "--numstat", "-z", "--no-ext-diff", "--no-renames"] + (staged ? ["--cached"] : [])
        return GitLineCount.parse(try await run(arguments, reading: true))
    }

    public func blob(_ path: String, at revision: GitRevision) async throws(GitFailure) -> Data? {
        do {
            return try await run(["cat-file", "blob", revision.spec(path)], reading: true)
        } catch {
            if case .exited = error.reason, Self.absentMarks.contains(where: error.message.contains) { return nil }
            throw error
        }
    }

    public func headSubject() async throws(GitFailure) -> String {
        let output = try await run(["log", "-1", "--format=%s"], reading: true)
        return String(decoding: output, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public func headMessage() async throws(GitFailure) -> String {
        let output = try await run(["log", "-1", "--format=%B"], reading: true)
        return String(decoding: output, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func run(_ arguments: [String], input: Data? = nil, reading: Bool = false,
             timeout: Duration = readTimeout) async throws(GitFailure) -> Data {
        let full = ["--literal-pathspecs", "-c", "core.quotepath=false"] + (reading ? ["--no-optional-locks"] : []) + arguments
        var environment = environment
        if reading { environment["GIT_OPTIONAL_LOCKS"] = "0" }
        let command = "git " + arguments.joined(separator: " ")
        let launch = ChildProcess.Launch(executable: executable, arguments: full, environment: environment, directory: root)
        let child: ChildProcess
        do {
            child = try ChildProcess(launch)
        } catch {
            Logger.core.error("\(command, privacy: .public) did not start: \(error.localizedDescription, privacy: .public)")
            throw GitFailure(.gitMissing, command: command, message: error.localizedDescription)
        }
        let expired = Mutex(false)
        let deadline = Task {
            try await Task.sleep(for: timeout)
            expired.withLock { $0 = true }
            await child.terminate(grace: .zero)
        }
        defer { deadline.cancel() }
        let result = await withTaskCancellationHandler {
            if let input { await child.send(input) }
            await child.closeInput()
            var output = Data(), diagnostics = Data(), status: Int32 = -1
            for await event in child.events {
                switch event {
                case let .output(data): output.append(data)
                case let .diagnostics(data): diagnostics.append(data)
                case let .exit(code): status = code
                }
            }
            return (status, output, diagnostics)
        } onCancel: {
            Task { await child.terminate(grace: .zero) }
        }
        let diagnostics = String(decoding: result.2, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        let message = diagnostics.isEmpty && result.0 != 0
            ? String(decoding: result.1, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines) : diagnostics
        if Task.isCancelled { throw GitFailure(.cancelled, command: command, message: message) }
        if expired.withLock({ $0 }) {
            Logger.core.error("\(command, privacy: .public) timed out")
            throw GitFailure(.timedOut, command: command, message: message)
        }
        guard result.0 == 0 else {
            if !reading { Logger.core.error("\(command, privacy: .public) failed \(result.0): \(message, privacy: .public)") }
            throw GitFailure(.exited(result.0), command: command, message: message)
        }
        return result.1
    }
}

public enum GitRevision: Sendable, Hashable {
    case head
    case index
    case ours
    case theirs
    case commit(String)

    func spec(_ path: String) -> String {
        switch self {
        case .head: "HEAD:" + path
        case .index: ":0:" + path
        case .ours: ":2:" + path
        case .theirs: ":3:" + path
        case let .commit(name): name + ":" + path
        }
    }
}

public struct GitLineCount: Sendable, Hashable {
    public var added: Int
    public var removed: Int
    public var isBinary: Bool

    public init(added: Int, removed: Int, isBinary: Bool = false) {
        self.added = added
        self.removed = removed
        self.isBinary = isBinary
    }

    static func parse(_ data: Data) -> [String: GitLineCount] {
        var counts: [String: GitLineCount] = [:]
        for record in data.split(separator: 0) {
            let fields = record.split(separator: UInt8(ascii: "\t"), maxSplits: 2, omittingEmptySubsequences: false)
            guard fields.count == 3 else { continue }
            let path = String(decoding: fields[2], as: UTF8.self)
            let added = Int(String(decoding: fields[0], as: UTF8.self))
            let removed = Int(String(decoding: fields[1], as: UTF8.self))
            counts[path] = GitLineCount(added: added ?? 0, removed: removed ?? 0, isBinary: added == nil)
        }
        return counts
    }
}
