import AppKit

@MainActor @objc protocol EditorLineCommands {
    func toggleLineComment(_ sender: Any?)
    func indentLines(_ sender: Any?)
    func outdentLines(_ sender: Any?)
    func goToLine(_ sender: Any?)
    func moveLinesUp(_ sender: Any?)
    func moveLinesDown(_ sender: Any?)
    func duplicateLines(_ sender: Any?)
    func deleteLines(_ sender: Any?)
    func expandSelection(_ sender: Any?)
    func shrinkSelection(_ sender: Any?)
    func nextChange(_ sender: Any?)
    func openLineNote(_ sender: Any?)
    func selectNextOccurrence(_ sender: Any?)
    func selectAllOccurrences(_ sender: Any?)
    func addCaretAbove(_ sender: Any?)
    func addCaretBelow(_ sender: Any?)
    func previousChange(_ sender: Any?)
}
