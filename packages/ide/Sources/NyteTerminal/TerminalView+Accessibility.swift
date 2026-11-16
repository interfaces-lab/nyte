import AppKit

extension TerminalView {
    private static let announceDelay: TimeInterval = 0.3

    var screenText: String {
        if let screenTextCache { return screenTextCache }
        let text = layouts.map { layout in
            var line = layout?.source.plainText ?? ""
            while line.last == " " { line.removeLast() }
            return line
        }.joined(separator: "\n")
        screenTextCache = text
        return text
    }

    var selectedText: String {
        layouts.compactMap { layout -> String? in
            guard let layout, let range = layout.source.selection else { return nil }
            let line = Array(layout.source.plainText)
            let clamped = range.clamped(to: 0...max(0, line.count - 1))
            return line.isEmpty ? "" : String(line[clamped])
        }.joined(separator: "\n")
    }

    var hasSelection: Bool { layouts.contains { $0?.source.selection != nil } }

    override func accessibilityValue() -> Any? { screenText }
    override func accessibilitySelectedText() -> String? { selectedText }
    override func accessibilityNumberOfCharacters() -> Int { (screenText as NSString).length }
    override func accessibilityInsertionPointLineNumber() -> Int { cursor.row }
    override func accessibilityVisibleCharacterRange() -> NSRange { NSRange(location: 0, length: accessibilityNumberOfCharacters()) }

    override func accessibilitySelectedTextRange() -> NSRange {
        let lines = screenText.components(separatedBy: "\n")
        let offset = lines.prefix(cursor.row).reduce(0) { $0 + ($1 as NSString).length + 1 }
        let lineLength = cursor.row < lines.count ? (lines[cursor.row] as NSString).length : 0
        return NSRange(location: offset + min(cursor.column, lineLength), length: 0)
    }

    override func accessibilityString(for range: NSRange) -> String? {
        let text = screenText as NSString
        guard range.location + range.length <= text.length else { return nil }
        return text.substring(with: range)
    }

    override func accessibilityLine(for index: Int) -> Int {
        let text = screenText as NSString
        return text.substring(to: min(index, text.length)).filter { $0 == "\n" }.count
    }

    override func accessibilityRange(forLine line: Int) -> NSRange {
        let lines = screenText.components(separatedBy: "\n")
        guard line < lines.count else { return NSRange(location: NSNotFound, length: 0) }
        let offset = lines.prefix(line).reduce(0) { $0 + ($1 as NSString).length + 1 }
        return NSRange(location: offset, length: (lines[line] as NSString).length)
    }

    func announceCursorLine() {
        NSAccessibility.post(element: self, notification: .valueChanged)
        guard NSWorkspace.shared.isVoiceOverEnabled else { return }
        announcement += 1
        let token = announcement
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.announceDelay) { [weak self] in
            guard let self, self.announcement == token, self.cursor.row < self.layouts.count else { return }
            let line = self.layouts[self.cursor.row]?.source.plainText.trimmingCharacters(in: .whitespaces) ?? ""
            guard !line.isEmpty else { return }
            NSAccessibility.post(element: self, notification: .announcementRequested, userInfo: [
                .announcement: line, .priority: NSAccessibilityPriorityLevel.medium.rawValue,
            ])
        }
    }
}
