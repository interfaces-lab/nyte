import Darwin
import Dispatch
import Foundation
import os
import Synchronization

public actor ChildProcess {
    public struct Launch: Sendable {
        public var executable: URL
        public var arguments: [String]
        public var environment: [String: String]
        public var directory: URL?

        public init(executable: URL, arguments: [String] = [], environment: [String: String], directory: URL? = nil) {
            self.executable = executable
            self.arguments = arguments
            self.environment = environment
            self.directory = directory
        }
    }

    public enum Event: Sendable {
        case output(Data)
        case diagnostics(Data)
        case exit(status: Int32)
    }

    public struct Output: Sendable {
        public var status: Int32
        public var output: Data
        public var diagnostics: Data

        public var text: String { String(decoding: output, as: UTF8.self) }
    }

    public nonisolated let events: AsyncStream<Event>
    public nonisolated let identifier: Int32

    nonisolated let queue: DispatchSerialQueue
    public nonisolated var unownedExecutor: UnownedSerialExecutor { queue.asUnownedSerialExecutor() }

    private let process: Process
    private let input: FileHandle
    private var inputClosed = false

    public init(_ launch: Launch) throws {
        queue = DispatchSerialQueue(label: "sh.nyte.ide.child." + launch.executable.lastPathComponent)
        let process = Process()
        process.executableURL = launch.executable
        process.arguments = launch.arguments
        process.environment = launch.environment
        process.currentDirectoryURL = launch.directory
        let stdin = Pipe(), stdout = Pipe(), stderr = Pipe()
        process.standardInput = stdin
        process.standardOutput = stdout
        process.standardError = stderr

        let (events, emit) = AsyncStream.makeStream(of: Event.self)
        let ending = Ending(emit)
        stdout.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard data.isEmpty else { return _ = emit.yield(.output(data)) }
            handle.readabilityHandler = nil
            ending.streamEnded()
        }
        stderr.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard data.isEmpty else { return _ = emit.yield(.diagnostics(data)) }
            handle.readabilityHandler = nil
            ending.streamEnded()
        }
        process.terminationHandler = { ending.exited($0.terminationStatus) }

        _ = fcntl(stdin.fileHandleForWriting.fileDescriptor, F_SETNOSIGPIPE, 1)
        do {
            try process.run()
        } catch {
            stdout.fileHandleForReading.readabilityHandler = nil
            stderr.fileHandleForReading.readabilityHandler = nil
            emit.finish()
            throw error
        }
        self.process = process
        self.events = events
        input = stdin.fileHandleForWriting
        identifier = process.processIdentifier
    }

    public func send(_ data: Data) {
        guard !inputClosed else { return }
        do {
            try input.write(contentsOf: data)
        } catch {
            Logger.core.error("write to \(self.identifier, privacy: .public) failed: \(error.localizedDescription, privacy: .public)")
            closeInput()
        }
    }

    public func closeInput() {
        guard !inputClosed else { return }
        inputClosed = true
        try? input.close()
    }

    public func terminate(grace: Duration = .seconds(2)) {
        closeInput()
        guard process.isRunning else { return }
        process.terminate()
        Task {
            do { try await Task.sleep(for: grace) } catch { return }
            self.killIfRunning()
        }
    }

    private func killIfRunning() {
        if process.isRunning { kill(identifier, SIGKILL) }
    }

    public static func run(_ launch: Launch, input: Data? = nil, timeout: Duration = .seconds(30)) async -> Output? {
        let child: ChildProcess
        do {
            child = try ChildProcess(launch)
        } catch {
            Logger.core.error("run \(launch.executable.path, privacy: .public) failed: \(error.localizedDescription, privacy: .public)")
            return nil
        }
        if let input { await child.send(input) }
        await child.closeInput()
        let expired = Mutex(false)
        let deadline = Task {
            try await Task.sleep(for: timeout)
            expired.withLock { $0 = true }
            await child.terminate(grace: .zero)
        }
        defer { deadline.cancel() }
        var result = Output(status: -1, output: Data(), diagnostics: Data())
        for await event in child.events {
            switch event {
            case let .output(data): result.output.append(data)
            case let .diagnostics(data): result.diagnostics.append(data)
            case let .exit(status): result.status = status
            }
        }
        return expired.withLock { $0 } ? nil : result
    }
}

private final class Ending: Sendable {
    private let emit: AsyncStream<ChildProcess.Event>.Continuation
    private let state = Mutex<(streams: Int, status: Int32?)>((2, nil))

    init(_ emit: AsyncStream<ChildProcess.Event>.Continuation) {
        self.emit = emit
    }

    func streamEnded() {
        finish(state.withLock { state in
            state.streams -= 1
            return state.streams == 0 ? state.status : nil
        })
    }

    func exited(_ status: Int32) {
        finish(state.withLock { state in
            state.status = status
            return state.streams == 0 ? status : nil
        })
    }

    private func finish(_ status: Int32?) {
        guard let status else { return }
        emit.yield(.exit(status: status))
        emit.finish()
    }
}
