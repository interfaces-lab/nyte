import Darwin
import Dispatch
import PtySpawn
import Synchronization

struct ShellLaunch: Sendable {
    let path: String
    let arguments: [String]
    let environment: [String]
    let directory: String
}

final class LocalPTYBackend: TerminalBackend {
    private struct Channel {
        let master: Int32
        let child: pid_t
        let reader: DispatchSourceRead
        let writer: DispatchSourceWrite
        let watcher: DispatchSourceProcess
    }

    private enum Phase {
        case idle
        case running(Channel)
        case hangingUp(child: pid_t, deadline: DispatchTime)
        case closed
    }

    private let launch: ShellLaunch
    private var phase = Phase.idle
    private var isWriterResumed = false
    private var isReaderOpen = false
    private var unsent: [UInt8] = []
    private var buffer = [UInt8](repeating: 0, count: 64 * 1024)

    private static let readBudget = 1 << 20
    private static let hangupGrace: DispatchTimeInterval = .milliseconds(500)

    init(launch: ShellLaunch) {
        self.launch = launch
    }

    deinit {
        switch phase {
        case let .running(channel):
            cancel(channel)
            Self.kill(channel.child)
        case let .hangingUp(child, _):
            Self.kill(child)
        case .idle, .closed:
            break
        }
    }

    func start(grid: TerminalGrid, in session: isolated TerminalSession) throws(TerminalFailure) {
        let (master, slave) = try Self.openPair(Self.windowSize(grid))
        var attributes = termios()
        if tcgetattr(slave, &attributes) == 0 {
            attributes.c_iflag |= tcflag_t(IUTF8)
            if tcsetattr(slave, TCSANOW, &attributes) != 0 {
                TerminalLog.logger.error("tcsetattr IUTF8 failed: \(errno, privacy: .public)")
            }
        }
        _ = fcntl(master, F_SETFD, FD_CLOEXEC)
        _ = fcntl(slave, F_SETFD, FD_CLOEXEC)
        _ = fcntl(master, F_SETFL, fcntl(master, F_GETFL) | O_NONBLOCK)

        let argv = ([launch.path] + launch.arguments).map { strdup($0) } + [nil]
        let envp = launch.environment.map { strdup($0) } + [nil]
        defer { (argv + envp).forEach { free($0) } }
        var spawnError: Int32 = 0
        let child = pty_spawn(master, slave, launch.path, argv, envp, launch.directory, &spawnError)
        Darwin.close(slave)
        guard child > 0 else {
            Darwin.close(master)
            throw .system(operation: "Starting \(launch.path)", code: spawnError)
        }
        let writerDescriptor = dup(master)
        guard writerDescriptor >= 0 else {
            let code = errno
            Darwin.close(master)
            Self.kill(child)
            throw .system(operation: "dup", code: code)
        }

        let queue = session.queue
        let service: @Sendable () -> Void = { [weak session] in session?.assumeIsolated { $0.serviceBackend() } }
        let reader = DispatchSource.makeReadSource(fileDescriptor: master, queue: queue)
        reader.setEventHandler(handler: service)
        reader.setCancelHandler { Darwin.close(master) }
        let writer = DispatchSource.makeWriteSource(fileDescriptor: writerDescriptor, queue: queue)
        writer.setEventHandler(handler: service)
        writer.setCancelHandler { Darwin.close(writerDescriptor) }
        let watcher = DispatchSource.makeProcessSource(identifier: child, eventMask: .exit, queue: queue)
        watcher.setEventHandler(handler: service)
        phase = .running(Channel(master: master, child: child, reader: reader, writer: writer, watcher: watcher))
        isReaderOpen = true
        reader.resume()
        watcher.resume()
    }

    func send(_ bytes: [UInt8], in session: isolated TerminalSession) {
        guard case let .running(channel) = phase, !bytes.isEmpty else { return }
        unsent += bytes
        flush(channel)
    }

    func resize(_ grid: TerminalGrid, in session: isolated TerminalSession) {
        guard case let .running(channel) = phase else { return }
        var size = Self.windowSize(grid)
        if ioctl(channel.master, TIOCSWINSZ, &size) != 0 {
            TerminalLog.logger.error("TIOCSWINSZ failed: \(errno, privacy: .public)")
        }
    }

    func service(in session: isolated TerminalSession) {
        switch phase {
        case let .running(channel):
            readAvailable(channel, budget: Self.readBudget, into: session)
            if !unsent.isEmpty { flush(channel) }
            guard let status = Self.reap(channel.child, blocking: false) else { return }
            readAvailable(channel, budget: .max, into: session)
            cancel(channel)
            phase = .closed
            session.backendExited(status)
        case let .hangingUp(child, deadline):
            if Self.reap(child, blocking: false) == nil {
                guard DispatchTime.now() >= deadline else { return }
                Self.kill(child)
            }
            phase = .closed
            session.backendClosed()
        case .idle, .closed:
            break
        }
    }

    func shutdown(in session: isolated TerminalSession) {
        guard case let .running(channel) = phase else {
            phase = .closed
            return session.backendClosed()
        }
        cancel(channel)
        unsent.removeAll()
        if killpg(channel.child, SIGHUP) != 0, errno != ESRCH {
            TerminalLog.logger.error("killpg SIGHUP failed: \(errno, privacy: .public)")
        }
        _ = Darwin.kill(channel.child, SIGHUP)
        let deadline = DispatchTime.now() + Self.hangupGrace
        phase = .hangingUp(child: channel.child, deadline: deadline)
        session.queue.asyncAfter(deadline: deadline) { [session] in session.assumeIsolated { $0.serviceBackend() } }
    }

    private func readAvailable(_ channel: Channel, budget: Int, into session: isolated TerminalSession) {
        var remaining = budget
        while remaining > 0, isReaderOpen {
            let count = buffer.withUnsafeMutableBytes { Darwin.read(channel.master, $0.baseAddress, $0.count) }
            if count > 0 {
                buffer.withUnsafeBytes { session.backendOutput(UnsafeRawBufferPointer(rebasing: $0[0..<count])) }
                remaining -= count
                continue
            }
            if count < 0, errno == EINTR { continue }
            if count < 0, errno == EAGAIN { return }
            if count < 0, errno != EIO { TerminalLog.logger.error("read from the terminal failed: \(errno, privacy: .public)") }
            isReaderOpen = false
            return
        }
    }

    private func flush(_ channel: Channel) {
        let descriptor = Int32(channel.writer.handle)
        while !unsent.isEmpty {
            let count = unsent.withUnsafeBytes { Darwin.write(descriptor, $0.baseAddress, $0.count) }
            if count > 0 {
                unsent.removeFirst(count)
                continue
            }
            if count < 0, errno == EINTR { continue }
            if count < 0, errno != EAGAIN {
                TerminalLog.logger.error("write to the terminal failed: \(errno, privacy: .public)")
                unsent.removeAll()
            }
            break
        }
        if unsent.isEmpty, isWriterResumed {
            channel.writer.suspend()
            isWriterResumed = false
        }
        if !unsent.isEmpty, !isWriterResumed {
            channel.writer.resume()
            isWriterResumed = true
        }
    }

    private func cancel(_ channel: Channel) {
        channel.watcher.cancel()
        if !isWriterResumed { channel.writer.resume() }
        isWriterResumed = true
        channel.writer.cancel()
        channel.reader.cancel()
        isReaderOpen = false
    }

    private static func reap(_ child: pid_t, blocking: Bool) -> TerminalExit? {
        var status: Int32 = 0
        var result: pid_t
        repeat { result = waitpid(child, &status, blocking ? 0 : WNOHANG) } while result < 0 && errno == EINTR
        if result < 0 {
            TerminalLog.logger.error("waitpid failed: \(errno, privacy: .public)")
            return .exited(-1)
        }
        guard result == child else { return nil }
        let signal = status & 0x7F
        return signal == 0 ? .exited((status >> 8) & 0xFF) : .signaled(signal)
    }

    private static func kill(_ child: pid_t) {
        _ = killpg(child, SIGKILL)
        _ = Darwin.kill(child, SIGKILL)
        _ = reap(child, blocking: true)
    }

    // Darwin: posix_openpt fails now and then when terminals start together, so they are created one at a time
    private static let creation = Mutex(())

    private static func openPair(_ size: winsize) throws(TerminalFailure) -> (master: Int32, slave: Int32) {
        try creation.withLock { _ throws(TerminalFailure) in try createPair(size) }
    }

    private static func createPair(_ size: winsize) throws(TerminalFailure) -> (master: Int32, slave: Int32) {
        let master = posix_openpt(O_RDWR | O_NOCTTY)
        guard master >= 0 else { throw .system(operation: "posix_openpt", code: errno) }
        var name = [CChar](repeating: 0, count: Int(PATH_MAX))
        guard grantpt(master) == 0, unlockpt(master) == 0, ptsname_r(master, &name, name.count) == 0 else {
            let code = errno
            Darwin.close(master)
            throw .system(operation: "Preparing the terminal device", code: code)
        }
        let path = String(decoding: name.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, as: UTF8.self)
        let slave = Darwin.open(path, O_RDWR | O_NOCTTY)
        guard slave >= 0 else {
            let code = errno
            Darwin.close(master)
            throw .system(operation: "Opening the terminal device", code: code)
        }
        var size = size
        if ioctl(master, TIOCSWINSZ, &size) != 0 {
            TerminalLog.logger.error("TIOCSWINSZ failed on a new terminal: \(errno, privacy: .public)")
        }
        return (master, slave)
    }

    private static func windowSize(_ grid: TerminalGrid) -> winsize {
        winsize(
            ws_row: grid.rows,
            ws_col: grid.columns,
            ws_xpixel: UInt16(clamping: UInt32(grid.columns) * grid.cellWidth),
            ws_ypixel: UInt16(clamping: UInt32(grid.rows) * grid.cellHeight)
        )
    }
}
