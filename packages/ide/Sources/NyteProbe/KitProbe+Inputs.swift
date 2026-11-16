import AppKit
@testable import NyteUI

extension KitCheck {
    func inputs() {
        let window = KitProbeWindow(size: NSSize(width: 400, height: 120))
        let input = Input(placeholder: "Name")
        var changes: [String] = [], submits: [String] = [], cancels = 0
        input.onChange = { changes.append($0) }
        input.onSubmit = { submits.append($0) }
        input.onCancel = { cancels += 1 }
        window.place(input, at: NSPoint(x: 20, y: 20), size: NSSize(width: 200, height: Size.md.height))
        window.makeFirstResponder(input.field)
        expect("Input: focus shows at once, before any key", input.isFocused)
        press(Keys.letterA, in: window)
        expect("Input: typing reaches the field and onChange", input.stringValue == "a" && changes == ["a"], "\(input.stringValue) \(changes)")
        press(Keys.returnKey, in: window)
        expect("Input: Return submits", submits == ["a"], "\(submits)")
        press(Keys.escape, in: window)
        expect("Input: Escape cancels", cancels == 1, "\(cancels)")
        let editor = window.fieldEditor(false, for: input.field) as? NSTextView
        editor?.setMarkedText("か", selectedRange: NSRange(location: 1, length: 0), replacementRange: NSRange(location: NSNotFound, length: 0))
        press(Keys.returnKey, in: window)
        expect("Input: Return while an input method holds marked text does not submit", submits == ["a"], "\(submits)")
        editor?.unmarkText()
        expect("Input: the field is labelled by its placeholder", input.field.accessibilityLabel() == "Name")
        window.makeFirstResponder(nil)
        expect("Input: focus clears when it leaves", !input.isFocused)

        let search = SearchField()
        var searchSubmits = 0
        search.onSubmit = { _ in searchSubmits += 1 }
        window.place(search, at: NSPoint(x: 20, y: 70), size: NSSize(width: 240, height: Size.md.height))
        window.makeFirstResponder(search.field)
        press(Keys.letterR, in: window)
        press(Keys.returnKey, in: window)
        expect("SearchField: typing and Return submit", search.stringValue == "r" && searchSubmits == 1, "\(search.stringValue) \(searchSubmits)")
        press(Keys.escape, in: window)
        expect("SearchField: Escape clears text first", search.stringValue.isEmpty && window.firstResponder != nil)
        press(Keys.escape, in: window)
        expect("SearchField: Escape on an empty field gives up focus", !search.isFocused && !(window.firstResponder is NSTextView))
        expect("SearchField: a search field subrole", search.field.accessibilitySubrole() == .searchField)
        window.close()
    }
}

extension KitCheck {
    func textArea() {
        let window = KitProbeWindow(size: NSSize(width: 400, height: 400))
        let area = TextArea(placeholder: "Commit message")
        var submitted: [String] = [], taken: [Selector] = []
        area.onSubmit = { submitted.append($0) }
        area.onCommand = { command in
            guard command == #selector(NSResponder.moveUp(_:)) else { return false }
            taken.append(command)
            return true
        }
        window.place(area, at: NSPoint(x: 10, y: 10), size: NSSize(width: 300, height: TextArea.height(lines: 3)))
        area.translatesAutoresizingMaskIntoConstraints = false
        area.widthAnchor.constraint(equalToConstant: 300).isActive = true
        let heights = [1, 5, 30].map { lines -> CGFloat in
            area.string = Array(repeating: "line", count: lines).joined(separator: "\n")
            window.contentView?.layoutSubtreeIfNeeded()
            return area.textView.enclosingScrollView?.frame.height ?? 0
        }
        expect("TextArea: grows from its minimum to its maximum number of lines, then scrolls",
               heights == [TextArea.height(lines: 3), TextArea.height(lines: 5), TextArea.height(lines: 10)], "\(heights)")
        area.string = "Pin headers"
        window.makeFirstResponder(area.textView)
        area.textView.doCommand(by: #selector(NSResponder.insertNewline(_:)))
        let newline = area.string.contains("\n") && submitted.isEmpty
        area.textView.keyDown(with: key((code: Keys.returnKey.code, text: "\r"), .command, in: window))
        let commandSubmits = submitted.count == 1
        area.returnKey = .submit
        area.textView.setMarkedText("か", selectedRange: NSRange(location: 1, length: 0),
                                    replacementRange: NSRange(location: NSNotFound, length: 0))
        area.textView.doCommand(by: #selector(NSResponder.insertNewline(_:)))
        let compositionSafe = submitted.count == 1
        area.textView.unmarkText()
        area.textView.doCommand(by: #selector(NSResponder.insertNewline(_:)))
        area.textView.doCommand(by: #selector(NSResponder.moveUp(_:)))
        expect("TextArea: Return adds a line and Command-Return submits, or the reverse; marked text never submits; onCommand first",
               newline && commandSubmits && compositionSafe && submitted.count == 2 && taken.count == 1,
               "\(newline) \(commandSubmits) \(compositionSafe) \(submitted.count) \(taken.count)")
        area.isInvalid = true
        area.message = "Write a summary line."
        expect("TextArea: a text area to accessibility, labelled, with the message as help",
               area.textView.accessibilityRole() == .textArea && area.textView.accessibilityLabel() == "Commit message"
                   && area.textView.accessibilityHelp() == "Write a summary line.")
        window.makeFirstResponder(nil)
        window.close()
    }

    func longBanner() {
        let window = KitProbeWindow(size: NSSize(width: 500, height: 600))
        let output = (1...20).map { "lint: hub.go:\($0): line is longer than 140 characters and keeps going past the edge" }
            .joined(separator: "\n")
        let banner = Banner("The pre-commit hook failed", detail: output, tone: .danger)
        let short = Banner("Saved", detail: "One line.")
        for (index, view) in [banner, short].enumerated() {
            view.translatesAutoresizingMaskIntoConstraints = false
            window.contentView?.addSubview(view)
            view.widthAnchor.constraint(equalToConstant: 400).isActive = true
            view.leadingAnchor.constraint(equalTo: window.contentView?.leadingAnchor ?? view.leadingAnchor).isActive = true
            view.topAnchor.constraint(equalTo: window.contentView?.topAnchor ?? view.topAnchor, constant: CGFloat(index) * 300).isActive = true
        }
        window.contentView?.layoutSubtreeIfNeeded()
        window.contentView?.layoutSubtreeIfNeeded()
        let collapsed = banner.frame.height
        expect("Banner: a long detail shows two lines and a Show more; a short one does not", banner.overflowsTwoLines && !short.overflowsTwoLines)
        banner.setExpanded(true)
        window.contentView?.layoutSubtreeIfNeeded()
        expect("Banner: Show more expands to the whole text", banner.isExpanded && banner.frame.height > collapsed * 3,
               "\(collapsed) to \(banner.frame.height)")
        window.close()
    }
}
