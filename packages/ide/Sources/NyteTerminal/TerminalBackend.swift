import Darwin

struct TerminalGrid: Sendable, Equatable {
    var columns: UInt16
    var rows: UInt16
    var cellWidth: UInt32
    var cellHeight: UInt32
}

enum TerminalFailure: Error, Sendable, Equatable {
    case library(operation: String, reason: String)
    case system(operation: String, code: Int32)

    var reason: String {
        switch self {
        case let .library(operation, reason): "\(operation) failed: \(reason)"
        case let .system(operation, code): "\(operation) failed: \(String(cString: strerror(code)))"
        }
    }
}

enum TerminalExit: Sendable, Equatable {
    case exited(Int32)
    case signaled(Int32)
    case failedToStart(TerminalFailure)
}

protocol TerminalBackend: AnyObject {
    func start(grid: TerminalGrid, in session: isolated TerminalSession) throws(TerminalFailure)
    func send(_ bytes: [UInt8], in session: isolated TerminalSession)
    func resize(_ grid: TerminalGrid, in session: isolated TerminalSession)
    func service(in session: isolated TerminalSession)
    func shutdown(in session: isolated TerminalSession)
}
