import AppKit

enum TypingDecision {
    enum Action: Equatable {
        case insert(String, replacing: NSRange?)
        case command(String)
    }

    struct Stroke: Equatable {
        var hadMarkedText: Bool
        var hasMarkedText: Bool
        var layoutChanged: Bool
        var pending: [Action]
    }

    enum Resolution: Equatable {
        case drop
        case perform([Action])
    }

    static func resolve(_ stroke: Stroke) -> Resolution {
        if !stroke.hadMarkedText, !stroke.hasMarkedText, stroke.layoutChanged { return .drop }
        return .perform(stroke.pending)
    }

    enum Arrival: Equatable {
        case later
        case now
    }

    static func arrival(isHandlingKey: Bool, isComposing: Bool) -> Arrival {
        isHandlingKey && !isComposing ? .later : .now
    }

    enum Target: Equatable {
        case marked(NSRange)
        case range(NSRange)
        case selections
    }

    static func target(replacementRange: NSRange, markedRange: NSRange?, length: Int) -> Target {
        if let markedRange { return .marked(markedRange) }
        guard replacementRange.location != NSNotFound else { return .selections }
        let location = min(max(0, replacementRange.location), length)
        return .range(NSRange(location: location, length: min(max(0, replacementRange.length), length - location)))
    }

    static func clamp(_ requested: NSRange, within length: Int) -> NSRange {
        guard requested.location != NSNotFound else { return NSRange(location: 0, length: 0) }
        let location = min(max(0, requested.location), length)
        return NSRange(location: location, length: min(max(0, requested.length), length - location))
    }

    static func firstLine(of requested: NSRange, lineRange: NSRange) -> NSRange {
        let location = min(max(requested.location, lineRange.location), NSMaxRange(lineRange))
        let end = min(max(location, NSMaxRange(requested)), NSMaxRange(lineRange))
        return NSRange(location: location, length: end - location)
    }

    static func reachesFeatures(isKeyPress: Bool, commitsComposition: Bool) -> Bool {
        isKeyPress && !commitsComposition
    }

    static func underlines(_ marked: NSAttributedString) -> [(range: NSRange, isThick: Bool)] {
        var spans: [(range: NSRange, isThick: Bool)] = []
        marked.enumerateAttribute(.underlineStyle, in: NSRange(location: 0, length: marked.length)) { value, range, _ in
            let style = (value as? NSNumber)?.intValue ?? NSUnderlineStyle.single.rawValue
            spans.append((range, style & NSUnderlineStyle.thick.rawValue == NSUnderlineStyle.thick.rawValue))
        }
        return spans.isEmpty ? [(NSRange(location: 0, length: marked.length), false)] : spans
    }
}

enum CaretBlink {
    enum State {
        case idle
        case blinking(Timer)
    }

    enum Mode: Equatable {
        case hidden
        case blinking
    }

    static func mode(isFirstResponder: Bool, isKey: Bool, isVisible: Bool, isOccluded: Bool) -> Mode {
        isFirstResponder && isKey && isVisible && !isOccluded ? .blinking : .hidden
    }

    static let millisecondsPerSecond: TimeInterval = 1_000

    static var onPeriod: TimeInterval { period("NSTextInsertionPointBlinkPeriodOn") }
    static var offPeriod: TimeInterval { period("NSTextInsertionPointBlinkPeriodOff") }

    private static func period(_ key: String) -> TimeInterval {
        let milliseconds = UserDefaults.standard.double(forKey: key)
        return milliseconds > 0 ? milliseconds / millisecondsPerSecond : 0.5
    }
}
