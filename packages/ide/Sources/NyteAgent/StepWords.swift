import Foundation

enum StepKind: CaseIterable, Sendable {
    case read, list, edit, shell, delegate, question, tool
}

enum StepOutcome: CaseIterable, Sendable {
    case running, done, failed, denied, stopped, interrupted, timedOut
}

enum StepWords {
    private struct Words {
        let running: String
        let done: String
        let noun: String
    }

    private static func words(_ kind: StepKind) -> Words {
        switch kind {
        case .read: Words(running: "Reading", done: "Read", noun: "Read")
        case .list: Words(running: "Listing", done: "Listed", noun: "List")
        case .edit: Words(running: "Editing", done: "Edited", noun: "Edit")
        case .shell: Words(running: "Running", done: "Ran", noun: "Command")
        case .delegate: Words(running: "Delegating", done: "Delegated", noun: "Subagent")
        case .question: Words(running: "Asking a question", done: "Asked a question", noun: "Question")
        case .tool: Words(running: "Using", done: "Used", noun: "Tool")
        }
    }

    static func title(_ kind: StepKind, _ outcome: StepOutcome) -> String {
        let words = words(kind)
        return switch outcome {
        case .running: words.running
        case .done: words.done
        case .failed: words.noun + " failed"
        case .denied: words.noun + " denied"
        case .stopped: words.noun + " stopped"
        case .interrupted: words.noun + " interrupted"
        case .timedOut: words.noun + " timed out"
        }
    }

    static func glyph(_ kind: StepKind, _ outcome: StepOutcome) -> ToolGlyph {
        if outcome == .denied { return .denied }
        return switch kind {
        case .read: .read
        case .list: .list
        case .edit: .edit
        case .shell: .shell
        case .delegate: .delegate
        case .question, .tool: .other
        }
    }

    static func row(key: String, part: String = "", kind: StepKind, outcome: StepOutcome, subject: String, version: Int = 0,
                    added: Int = 0, removed: Int = 0) -> RowSpec {
        var spec = RowSpec(kind: .tool, key: key, part: part, lead: title(kind, outcome), text: subject, version: version,
                           running: outcome == .running, failed: isFailure(outcome), glyph: glyph(kind, outcome),
                           expandable: expands(kind, outcome))
        if showsChanges(kind, outcome) {
            spec.added = added
            spec.removed = removed
        }
        return spec
    }

    static func isFailure(_ outcome: StepOutcome) -> Bool {
        outcome == .failed || outcome == .timedOut
    }

    static func showsChanges(_ kind: StepKind, _ outcome: StepOutcome) -> Bool {
        kind == .edit && outcome == .done
    }

    static func expands(_ kind: StepKind, _ outcome: StepOutcome) -> Bool {
        switch kind {
        case .edit: outcome == .done
        case .shell: outcome != .running && outcome != .denied
        case .read, .list, .delegate, .question, .tool: false
        }
    }
}
