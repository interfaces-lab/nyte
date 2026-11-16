import AppKit

@MainActor @objc protocol UndoCommands {
    func undo(_ sender: Any?)
    func redo(_ sender: Any?)
}
