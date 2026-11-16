import Foundation

@MainActor
enum FirstAnswer {
    private final class Gate<Value: Sendable> {
        var continuation: CheckedContinuation<Value?, Never>?
        var timer: Task<Void, Never>?

        func finish(_ value: Value?) {
            timer?.cancel()
            continuation?.resume(returning: value)
            continuation = nil
        }
    }

    static func within<Value: Sendable>(_ deadline: Duration, _ work: @escaping @MainActor () async -> Value) async -> Value? {
        let gate = Gate<Value>()
        return await withCheckedContinuation { continuation in
            gate.continuation = continuation
            let working = Task { @MainActor in gate.finish(await work()) }
            gate.timer = Task { @MainActor in
                try? await Task.sleep(for: deadline)
                guard !Task.isCancelled else { return }
                working.cancel()
                gate.finish(nil)
            }
        }
    }
}
