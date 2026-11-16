import AppKit
@testable import NyteShell

@MainActor
enum CommandCheck {
    enum Focus: String, CaseIterable {
        case editor, terminal, navigator, diff, composer, noDocument = "no document"
    }

    struct Tally {
        var validations = 0
        var failures: [String] = []
    }

    static func table() -> [String] {
        var failures: [String] = []
        var seen: [String: CommandID] = [:]
        for command in Commands.all {
            if command.title.trimmingCharacters(in: .whitespaces).isEmpty { failures.append("\(command.id.rawValue) has no title") }
            guard let key = command.key else { continue }
            let name = chord(key)
            if let other = seen[name] { failures.append("\(command.id.rawValue) and \(other.rawValue) share \(key.display)") }
            seen[name] = command.id
        }
        let missing = CommandID.allCases.filter { id in !Commands.all.contains { $0.id == id } }
        failures += missing.map { "\($0.rawValue) is not in the table" }
        return failures
    }

    static func validate(in focus: Focus, shell: ShellViewController) -> Tally {
        var tally = Tally()
        var enabledKeys: [String: CommandID] = [:]
        for command in Commands.all {
            let item = MainMenu.item(for: command)
            let enabled = shell.validateMenuItem(item)
            tally.validations += 1
            if item.title.isEmpty { tally.failures.append("\(focus.rawValue): \(command.id.rawValue) validated to an empty title") }
            guard enabled, let key = command.key else { continue }
            let name = chord(key)
            if let other = enabledKeys[name] {
                tally.failures.append("\(focus.rawValue): \(command.id.rawValue) and \(other.rawValue) both take \(key.display)")
            }
            enabledKeys[name] = command.id
        }
        return tally
    }

    static func focusDescription(_ shell: ShellViewController) -> String {
        guard let responder = shell.view.window?.firstResponder else { return "nothing" }
        return String(describing: type(of: responder))
    }

    private static func chord(_ key: Key) -> String {
        "\(key.modifiers.intersection([.command, .shift, .option, .control]).rawValue)-\(key.character.lowercased())"
    }
}
