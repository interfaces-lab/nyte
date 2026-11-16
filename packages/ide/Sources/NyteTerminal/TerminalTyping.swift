enum TerminalTyping {
    struct Stroke: Equatable {
        var hadMarkedText: Bool
        var hasMarkedText: Bool
        var layoutChanged: Bool
        var accumulated: [String]
        var key: TerminalKey
        var modifiers: TerminalModifiers
        var characters: String
    }

    enum Resolution: Equatable {
        case drop
        case composing
        case key(text: String)
        case plainKey
        case texts([String])
        case committed([String], replayKey: Bool)
    }

    static func resolve(_ stroke: Stroke) -> Resolution {
        if !stroke.hadMarkedText, stroke.layoutChanged { return .drop }
        let composing = stroke.hasMarkedText || stroke.hadMarkedText
        let texts = stroke.accumulated.filter { !isComposingControl($0, composing: composing) && !$0.isEmpty }
        if stroke.hadMarkedText, !stroke.accumulated.isEmpty {
            return .committed(texts, replayKey: replaysAfterCommit(stroke.key, modifiers: stroke.modifiers))
        }
        if !stroke.accumulated.isEmpty {
            guard texts.count == 1, let text = texts.first else { return texts.isEmpty ? .drop : .texts(texts) }
            return .key(text: text)
        }
        if composing { return .composing }
        return .plainKey
    }

    static func replaysAfterCommit(_ key: TerminalKey, modifiers: TerminalModifiers) -> Bool {
        switch key {
        case .arrowDown, .arrowRight, .arrowUp: true
        case .arrowLeft: !modifiers.isDisjoint(with: [.shift, .control, .option, .command])
        default: false
        }
    }

    static func isComposingControl(_ text: String, composing: Bool) -> Bool {
        guard composing, text.unicodeScalars.count == 1, let scalar = text.unicodeScalars.first else { return false }
        return scalar.value < 0x20
    }

    struct SurrogatePairing: Equatable {
        private var lead: UInt16?

        init() {}

        mutating func accept(_ units: [UInt16]) -> String {
            guard units.count == 1, let unit = units.first else {
                lead = nil
                return String(decoding: units, as: UTF16.self)
            }
            if UTF16.isLeadSurrogate(unit) {
                lead = unit
                return ""
            }
            if UTF16.isTrailSurrogate(unit) {
                defer { lead = nil }
                guard let lead else { return "" }
                return String(decoding: [lead, unit], as: UTF16.self)
            }
            lead = nil
            return String(decoding: units, as: UTF16.self)
        }
    }

    struct Span: Equatable {
        var location: Int
        var length: Int
    }

    static func markedSpan(requested: Span, markedLength: Int) -> Span {
        let location = min(max(requested.location, 0), markedLength)
        let length = min(max(requested.length, 0), markedLength - location)
        return Span(location: location, length: length)
    }
}
