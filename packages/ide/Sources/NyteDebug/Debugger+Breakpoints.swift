import Foundation
import NyteCore

extension Debugger {
    public func breakpoints(in url: URL) -> [SourceBreakpoint] {
        store[url.standardizedFileURL].map(\.source)
    }

    public func breakpoint(line: Int, in url: URL) -> Breakpoint? {
        store[url.standardizedFileURL].first { $0.line == line }
    }

    public var filesWithBreakpoints: [URL] {
        store.files.keys.sorted { $0.path < $1.path }
    }

    public var placedBreakpoints: [PlacedBreakpoint] {
        filesWithBreakpoints.flatMap { url in store[url].map { PlacedBreakpoint(url: url, breakpoint: $0) } }
    }

    public var exceptionBreakpoints: [ExceptionBreakpoint] { store.exceptionBreakpoints() }

    public func toggleBreakpoint(line: Int, in url: URL) {
        let url = url.standardizedFileURL
        var list = store[url]
        if let index = list.firstIndex(where: { $0.line == line }) {
            list.remove(at: index)
        } else {
            list.append(Breakpoint(line: line))
        }
        update(url, list)
    }

    public func setBreakpoint(line: Int, in url: URL, enabled: Bool = true, condition: String = "") {
        let kept = breakpoint(line: line, in: url) ?? Breakpoint(line: line)
        var changed = kept
        changed.isEnabled = enabled
        changed.condition = condition
        setBreakpoint(changed, in: url)
    }

    public func setBreakpoint(_ breakpoint: Breakpoint, in url: URL) {
        let url = url.standardizedFileURL
        update(url, store[url].filter { $0.line != breakpoint.line } + [breakpoint])
    }

    public func removeBreakpoint(line: Int, in url: URL) {
        let url = url.standardizedFileURL
        update(url, store[url].filter { $0.line != line })
    }

    public func removeAllBreakpoints() {
        let urls = Array(store.files.keys)
        store.removeAll()
        for url in urls {
            sync(url)
            onChange?(.breakpoints(url))
        }
    }

    public func setExceptionBreakpoint(_ filter: String, adapter: String, enabled: Bool) {
        store.choose(filter, adapter: adapter, enabled: enabled)
        guard let session, lastStart?.debugging == true else { return }
        let plan = store.plan
        let previous = syncing
        syncing = Task {
            await previous?.value
            await session.setExceptionBreakpoints(plan)
        }
    }

    public func shift(in url: URL, fromLine: Int, by delta: Int) {
        let url = url.standardizedFileURL
        guard delta != 0, !store[url].isEmpty else { return }
        let removed = delta < 0 ? fromLine..<(fromLine - delta) : fromLine..<fromLine
        let list = store[url].filter { !removed.contains($0.line) }.map { breakpoint in
            var moved = breakpoint
            if moved.line >= fromLine { moved.line += delta }
            return moved
        }
        update(url, list)
    }

    func update(_ url: URL, _ list: [Breakpoint]) {
        let running = session != nil && lastStart?.debugging == true
        store[url] = list.map { breakpoint in
            var changed = breakpoint
            changed.verification = switch (running, breakpoint.verification) {
            case (false, _): .notDebugging
            case (true, .verified): .verified
            case (true, .unverified), (true, .notDebugging): .unverified
            }
            return changed
        }
        sync(url)
        onChange?(.breakpoints(url))
    }

    func sync(_ url: URL) {
        guard let session, lastStart?.debugging == true else { return }
        var list = store[url]
        if runToLine == url, let line = temporaryLine { list.append(Breakpoint(line: line)) }
        let previous = syncing
        syncing = Task { [list] in
            await previous?.value
            await session.setBreakpoints(url, list)
        }
    }
}
