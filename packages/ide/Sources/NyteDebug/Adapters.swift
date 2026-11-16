import Darwin
import Foundation
import NyteCore

struct AdapterPlan: Sendable {
    enum Port: Sendable {
        case announced(after: String)
        case fixed(UInt16)
    }

    var executable: URL
    var arguments: [String]
    var directory: URL
    var environment: [String: String]
    var port: Port
    var adapterID: String
    var launch: JSON
    var buildFolder: URL?

    static let jsDebugServer = Toolchain.managedRoot.appendingPathComponent("js-debug/src/dapDebugServer.js")

    static func make(for target: DebugTarget, in workspace: Workspace, debugging: Bool, toolchain: Toolchain,
                     settings: DebugSettings) async throws -> AdapterPlan {
        let environment = await toolchain.environment()
        let arguments = JSON.array(target.arguments.map(JSON.string))
        let env = JSON.object(target.environment.mapValues(JSON.string))
        switch target.kind {
        case let .goPackage(folder), let .goTest(folder, _):
            let dlv = try await ToolResolver.resolve(.delve, settings: settings, toolchain: toolchain)
            let buildFolder = Self.buildFolder(for: workspace)
            try FileManager.default.createDirectory(at: buildFolder, withIntermediateDirectories: true)
            var programArguments = arguments
            var mode: JSON = "debug"
            if case let .goTest(_, test) = target.kind {
                mode = "test"
                if let test { programArguments = .array(["-test.run", .string("^\(test)$")] + target.arguments.map(JSON.string)) }
            }
            return AdapterPlan(
                executable: dlv, arguments: ["dap", "--listen=127.0.0.1:0"], directory: URL(fileURLWithPath: Kernel.realPath(target.directory)),
                environment: environment, port: .announced(after: "DAP server listening at:"), adapterID: "go",
                launch: [
                    "type": "go", "request": "launch", "name": .string(target.name), "mode": mode,
                    "program": .string(Kernel.realPath(folder)), "cwd": .string(Kernel.realPath(target.directory)), "args": programArguments,
                    "env": env, "noDebug": .bool(!debugging), "outputMode": "remote",
                    "output": .string(buildFolder.appendingPathComponent("__debug_bin").path),
                ],
                buildFolder: buildFolder
            )
        case let .node(file):
            let server = try await ToolResolver.resolve(.jsDebug, settings: settings, toolchain: toolchain)
            let node = try await ToolResolver.resolve(.node, settings: settings, toolchain: toolchain)
            let port = try freePort()
            return AdapterPlan(
                executable: node, arguments: [server.path, String(port), "127.0.0.1"],
                directory: server.deletingLastPathComponent(), environment: environment, port: .fixed(port),
                adapterID: "pwa-node",
                launch: [
                    "type": "pwa-node", "request": "launch", "name": .string(target.name), "program": .string(file.path),
                    "cwd": .string(target.directory.path), "runtimeExecutable": .string(node.path), "args": arguments,
                    "runtimeArgs": .array(target.runtimeArguments.map(JSON.string)), "env": env,
                    "console": "integratedTerminal", "noDebug": .bool(!debugging),
                    "skipFiles": ["<node_internals>/**"],
                ],
                buildFolder: nil
            )
        }
    }

    static let cacheRoot = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("sh.nyte.ide/delve", isDirectory: true)

    static func buildFolder(for workspace: Workspace) -> URL {
        let directory = workspace.root
        let path = directory.path
        let hash = path.utf8.reduce(UInt64(14_695_981_039_346_656_037)) { ($0 ^ UInt64($1)) &* 1_099_511_628_211 }
        return cacheRoot.appendingPathComponent(directory.lastPathComponent + "-" + String(hash, radix: 16), isDirectory: true)
    }

    private static func freePort() throws -> UInt16 {
        let socket = Darwin.socket(AF_INET, SOCK_STREAM, 0)
        guard socket >= 0 else { throw DebugFailure("Could not open a socket.") }
        defer { close(socket) }
        var address = sockaddr_in()
        address.sin_family = sa_family_t(AF_INET)
        address.sin_addr.s_addr = inet_addr("127.0.0.1")
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        let bound = withUnsafeMutablePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { generic in
                bind(socket, generic, length) == 0 && getsockname(socket, generic, &length) == 0
            }
        }
        guard bound else { throw DebugFailure("Could not find a free port for the debug adapter.") }
        return UInt16(bigEndian: address.sin_port)
    }
}

enum Kernel {
    static func realPath(_ url: URL) -> String {
        guard let resolved = realpath(url.path, nil) else { return url.path }
        defer { free(resolved) }
        return String(cString: resolved)
    }

    static func descendants(of pid: Int32) -> [Int32] {
        var buffer = [Int32](repeating: 0, count: 256)
        let count = buffer.withUnsafeMutableBytes { proc_listchildpids(pid, $0.baseAddress, Int32($0.count)) }
        guard count > 0 else { return [] }
        let children = Array(buffer.prefix(Int(count)))
        return children + children.flatMap(descendants(of:))
    }
}
