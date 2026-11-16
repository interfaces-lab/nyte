import Foundation

@MainActor
final class UndoOutcome: Hashable {
    var result: URL?

    nonisolated static func == (left: UndoOutcome, right: UndoOutcome) -> Bool { left === right }
    nonisolated func hash(into hasher: inout Hasher) { hasher.combine(ObjectIdentifier(self)) }
}

@MainActor
final class FileHistory {
    typealias Finished = (FileOperation, Result<URL, FileOperationFailure>) -> Void

    private let undoManager: () -> UndoManager?
    private let finished: Finished
    private var outcomes: Set<UndoOutcome> = []

    init(undoManager: @escaping () -> UndoManager?, finished: @escaping Finished) {
        self.undoManager = undoManager
        self.finished = finished
    }

    @discardableResult
    func start(_ operation: FileOperation, actionName: String? = nil) -> Task<Result<URL, FileOperationFailure>, Never> {
        let name = actionName ?? operation.actionName
        let outcome = UndoOutcome()
        let manager = undoManager()
        if let manager {
            outcomes.insert(outcome)
            manager.registerUndo(withTarget: outcome) { [weak self] outcome in
                guard let self else { return }
                self.outcomes.remove(outcome)
                guard let result = outcome.result else { return }
                self.start(operation.inverse(result: result), actionName: name)
            }
            manager.setActionName(name)
        }
        return Task {
            let result = await FileOperations.perform(operation)
            switch result {
            case let .success(url):
                outcome.result = url
            case .failure:
                manager?.removeAllActions(withTarget: outcome)
                outcomes.remove(outcome)
            }
            finished(operation, result)
            return result
        }
    }
}
