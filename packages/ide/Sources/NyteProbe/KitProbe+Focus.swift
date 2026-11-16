import AppKit
@testable import NyteUI

extension KitCheck {
    static let inkTolerance = 0.02
    static let inkSample = "fix-scroll-state"

    func keyFocus() {
        let table: [(holds: Bool, key: Bool, shows: Bool)] = [(true, true, true), (true, false, false), (false, true, false), (false, false, false)]
        expect("Key focus: focus shows only for the first responder of the key window",
               table.allSatisfy { KeyFocus.shows(holdsFocus: $0.holds, windowIsKey: $0.key) == $0.shows })
        let window = KitProbeWindow(size: NSSize(width: 300, height: 200))
        let list = ListView()
        list.rowCount = { 5 }
        list.content = { RowContent(title: "Row \($0)") }
        window.place(list, at: .zero, size: NSSize(width: 300, height: 150))
        list.reload()
        list.selectedRow = 0
        list.focus()
        let input = Input(placeholder: "Find")
        window.place(input, at: NSPoint(x: 0, y: 160), size: NSSize(width: 200, height: Size.md.height))
        input.isFocused = true
        let focus = { (list.table.rowView(atRow: 0, makeIfNecessary: true) as? RowCell)?.focus }
        let keyed = (focus(), input.showsFocus)
        window.isKey = false
        NotificationCenter.default.post(name: NSWindow.didResignKeyNotification, object: window)
        let resigned = (focus(), input.showsFocus)
        window.isKey = true
        NotificationCenter.default.post(name: NSWindow.didBecomeKeyNotification, object: window)
        let regained = (focus(), input.showsFocus)
        expect("Key focus: a list and a field lose their focus look when the window resigns key and regain it with key",
               keyed == (.focused, true) && resigned == (RowCell.Focus.none, false) && regained == (.focused, true),
               "\(keyed) \(resigned) \(regained)")

        let panel = FloatingPanel()
        let proxied = ListView()
        proxied.rowCount = { 3 }
        proxied.content = { RowContent(title: "Candidate \($0)") }
        proxied.showsFocusAlways = true
        proxied.acceptsFocus = false
        panel.content = proxied
        panel.show(size: NSSize(width: 200, height: 90), anchoredTo: input.bounds, in: input)
        proxied.reload()
        proxied.selectedRow = 0
        proxied.updateFocus()
        let panelFocus = { (proxied.table.rowView(atRow: 0, makeIfNecessary: true) as? RowCell)?.focus }
        let shown = panelFocus()
        window.isKey = false
        NotificationCenter.default.post(name: NSWindow.didResignKeyNotification, object: window)
        let behind = panelFocus()
        window.isKey = true
        NotificationCenter.default.post(name: NSWindow.didBecomeKeyNotification, object: window)
        expect("Key focus: a field-driven list in a non-key panel follows its parent window's key state, without the ring",
               shown == .driven && behind == RowCell.Focus.none && panelFocus() == .driven,
               "\(String(describing: shown)) \(String(describing: behind))")
        panel.dismiss()
        window.close()
    }

    func textInk() {
        let window = KitProbeWindow(size: NSSize(width: 200, height: 160))
        let label = Label(Self.inkSample, style: .base)
        let input = Input(Self.inkSample)
        let drawn = InkSpecimen(frame: NSRect(x: 0, y: 0, width: 160, height: Metric.row)) { rect in
            Draw.text(Self.inkSample, in: rect, style: .base, ink: Palette.contentPrimary)
        }
        let row = InkSpecimen(frame: NSRect(x: 0, y: 0, width: 200, height: Metric.row)) { rect in
            RowRenderer.draw(RowContent(title: Self.inkSample), in: rect, scale: 2, state: RowRenderer.State(),
                             appearance: NSAppearance(named: .aqua) ?? NSApp.effectiveAppearance)
        }
        window.place(label, at: NSPoint(x: 0, y: 0), size: NSSize(width: 160, height: Metric.row))
        window.place(input, at: NSPoint(x: 0, y: 40), size: NSSize(width: 200, height: Size.md.height))
        window.place(drawn, at: NSPoint(x: 0, y: 80), size: drawn.frame.size)
        window.place(row, at: NSPoint(x: 0, y: 120), size: row.frame.size)
        let inks = [("label", ink(label)), ("field", ink(input.field)), ("drawn", ink(drawn)), ("row", ink(row))]
        let reference = inks[0].1
        print("     ink of \"\(Self.inkSample)\": " + inks.map { "\($0.0) \(Int($0.1))" }.joined(separator: ", "))
        expect("Text ink: a label, a field, drawn text and a row lay down the same ink within 2%",
               inks.allSatisfy { abs($0.1 - reference) / reference <= Self.inkTolerance })
        window.close()
    }

    func ink(_ view: NSView) -> Double {
        guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return 0 }
        view.cacheDisplay(in: view.bounds, to: bitmap)
        var total = 0.0
        for x in 0..<bitmap.pixelsWide {
            for y in 0..<bitmap.pixelsHigh {
                guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.sRGB) else { continue }
                total += Double(color.alphaComponent * (1 - color.redComponent))
            }
        }
        return total
    }

    func inputCommands() {
        let window = KitProbeWindow(size: NSSize(width: 300, height: 260))
        let input = Input(placeholder: "Evaluate expression")
        var taken: [Selector] = [], submitted: [String] = []
        input.onCommand = { command in
            guard command == #selector(NSResponder.moveUp(_:)) else { return false }
            taken.append(command)
            return true
        }
        input.onSubmit = { submitted.append($0) }
        window.place(input, at: NSPoint(x: 10, y: 200), size: NSSize(width: 260, height: Size.md.height))
        window.makeFirstResponder(input.field)
        let editor = window.fieldEditor(false, for: input.field) as? NSTextView
        editor?.doCommand(by: #selector(NSResponder.moveUp(_:)))
        editor?.doCommand(by: #selector(NSResponder.insertNewline(_:)))
        expect("Input: onCommand takes the keys it wants and passes the rest on",
               taken == [#selector(NSResponder.moveUp(_:))] && submitted == [""], "\(taken) \(submitted)")

        input.stringValue = "client.s"
        var accepted: [String] = []
        let completion = FieldCompletion(input: input)
        completion.onAccept = { accepted.append($0) }
        completion.show(["client.send", "client.sendAll"])
        let shown = completion.isShown
        editor?.doCommand(by: #selector(NSResponder.insertTab(_:)))
        let completed = input.stringValue
        editor?.doCommand(by: #selector(NSResponder.moveDown(_:)))
        editor?.doCommand(by: #selector(NSResponder.insertNewline(_:)))
        expect("Field completion: Tab takes the common prefix, Down moves, Return accepts and closes",
               shown && completed == "client.send" && accepted == ["client.sendAll"] && input.stringValue == "client.sendAll",
               "\(completed) \(accepted) \(input.stringValue)")
        completion.show(["client.Close"])
        editor?.doCommand(by: #selector(NSResponder.cancelOperation(_:)))
        spin()
        expect("Field completion: Escape closes without accepting", !completion.isShown && accepted == ["client.sendAll"])
        window.makeFirstResponder(nil)
        window.close()
    }
}

@MainActor final class InkSpecimen: NSView {
    let paint: (NSRect) -> Void

    init(frame: NSRect, paint: @escaping (NSRect) -> Void) {
        self.paint = paint
        super.init(frame: frame)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isFlipped: Bool { true }
    override func draw(_ dirtyRect: NSRect) { paint(bounds) }
}
