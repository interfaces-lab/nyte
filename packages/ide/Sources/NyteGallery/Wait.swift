import Foundation

enum Wait {
    static let poll = Duration.milliseconds(50)

    @MainActor
    static func until(_ timeout: Duration = .seconds(30), _ condition: @MainActor () -> Bool) async -> Bool {
        let deadline = ContinuousClock.now + timeout
        while !condition() {
            guard ContinuousClock.now < deadline, await pause(poll) else { return false }
        }
        return true
    }

    @discardableResult
    static func pause(_ duration: Duration) async -> Bool {
        try? await Task.sleep(for: duration)
        return !Task.isCancelled
    }
}
