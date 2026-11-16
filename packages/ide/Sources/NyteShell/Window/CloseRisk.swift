import AppKit

struct CloseRisk: Equatable, Sendable {
    var project: String
    var unsaved: [String] = []
    var program: String?

    var isEmpty: Bool { unsaved.isEmpty && program == nil }
}

enum CloseAction: Sendable {
    case quit, close
}

struct CloseWarning: Equatable, Sendable {
    let message: String
    let detail: String
    let button: String

    static let namedFiles = 3

    static func decide(_ risks: [CloseRisk], action: CloseAction, asksForPrograms: Bool) -> CloseWarning? {
        let counted = risks.map { risk in
            var kept = risk
            if !asksForPrograms { kept.program = nil }
            return kept
        }.filter { !$0.isEmpty }
        guard !counted.isEmpty else { return nil }
        let several = risks.count > 1
        let losses = counted.flatMap { risk -> [String] in
            let place = several ? " in \(risk.project)" : ""
            var parts: [String] = []
            if !risk.unsaved.isEmpty { parts.append("discards changes to \(files(risk.unsaved))\(place)") }
            if let program = risk.program { parts.append("stops \(program)\(place), which is running under the debugger") }
            return parts
        }
        let verb = action == .quit ? "Quitting" : "Closing the window"
        let detail = "\(verb) \(sentence(losses))."
        return switch action {
        case .quit: CloseWarning(message: "Quit Nyte IDE?", detail: detail, button: "Quit")
        case .close: CloseWarning(message: "Close \(counted[0].project)?", detail: detail, button: "Close")
        }
    }

    private static func files(_ names: [String]) -> String {
        let quoted = names.prefix(namedFiles).map { "\u{201C}\($0)\u{201D}" }
        let rest = names.count - quoted.count
        guard rest > 0 else { return sentence(quoted) }
        return quoted.joined(separator: ", ") + (rest == 1 ? " and 1 other file" : " and \(rest) other files")
    }

    private static func sentence(_ parts: [String]) -> String {
        guard parts.count > 1, let last = parts.last else { return parts.first ?? "" }
        return parts.dropLast().joined(separator: ", ") + " and " + last
    }

    @MainActor
    func alert() -> NSAlert {
        let alert = NSAlert()
        alert.messageText = message
        alert.informativeText = detail
        alert.addButton(withTitle: button).hasDestructiveAction = true
        alert.addButton(withTitle: "Cancel")
        return alert
    }
}
