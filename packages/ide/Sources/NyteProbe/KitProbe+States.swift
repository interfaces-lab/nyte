import AppKit
@testable import NyteUI

extension KitCheck {
    static let placeholderFloor = 4.5

    func placeholderContrast() {
        let input = Input(placeholder: "Filter symbols")
        let ink = input.field.placeholderAttributedString?.attribute(.foregroundColor, at: 0, effectiveRange: nil) as? NSColor
        let font = input.field.placeholderAttributedString?.attribute(.font, at: 0, effectiveRange: nil) as? NSFont
        let panelInk = CommandView(placeholder: "Go to file").field.placeholderAttributedString?
            .attribute(.foregroundColor, at: 0, effectiveRange: nil) as? NSColor
        expect("Placeholders: the tertiary content step in Input, SearchField and the command panel; entry is 13 pt regular primary",
               ink === Palette.contentTertiary && panelInk === Palette.contentTertiary && Input.placeholderInk === Palette.contentTertiary
                   && font == TextStyle.base.font() && input.field.font == TextStyle.base.font() && CommandView.text.size == 13
                   && SearchField().field.textColor === Palette.contentPrimary)
        let grounds: [(String, () -> NSColor)] = [
            ("raised field", { Palette.bgElevated }),
            ("quiet field on base", { Palette.composite(Palette.bgMutedTranslucent, over: Palette.bgBase) }),
            ("quiet field on chrome", { Palette.composite(Palette.bgMutedTranslucent, over: Palette.bgChrome) }),
        ]
        var readings: [String] = []
        var lowest = Double.infinity
        for name in [NSAppearance.Name.aqua, .darkAqua] {
            NSAppearance(named: name)?.performAsCurrentDrawingAppearance {
                for (label, resolve) in grounds {
                    let ground = Palette.composite(resolve(), over: Palette.bgBase)
                    let ratio = Palette.contrast(Palette.composite(Input.placeholderInk, over: ground), ground)
                    lowest = min(lowest, ratio)
                    readings.append("\(label) \(name == .aqua ? "light" : "dark") \(String(format: "%.2f", ratio))")
                }
            }
        }
        print("     placeholder contrast: " + readings.joined(separator: "; "))
        expect("Placeholders: at least 4.5:1 on every field ground in both appearances", lowest >= Self.placeholderFloor, "\(lowest)")
    }

    func sessionMarks() {
        let accent = Palette.color(.contentAccent, tone: Attention.tone)
        let roles: [(TaskMark.Status, NSColor)] = [
            (.working, Palette.contentSecondary), (.retrying, Palette.contentSecondary), (.waiting, accent),
            (.unread, Palette.contentSecondary), (.failed, Palette.dangerInk),
        ]
        expect("Task marks: working, retrying and unread are neutral; waiting is the accent; failed is danger",
               roles.allSatisfy { TaskMark.ink($0.0) === $0.1 })
        let hue = { (status: TaskMark.Status, appearance: NSAppearance.Name) -> (spread: CGFloat, inked: Int) in
            let side = Int(Glyph.lg.rawValue)
            guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side, bitsPerSample: 8,
                                                samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                                bytesPerRow: 0, bitsPerPixel: 0),
                  let context = NSGraphicsContext(bitmapImageRep: bitmap) else { return (1, 0) }
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = context
            NSAppearance(named: appearance)?.performAsCurrentDrawingAppearance {
                TaskMark.draw(status, in: NSRect(x: 0, y: 0, width: side, height: side))
            }
            NSGraphicsContext.restoreGraphicsState()
            let pixels = (0..<side).flatMap { x in (0..<side).compactMap { bitmap.colorAt(x: x, y: $0) } }.filter { $0.alphaComponent > 0.9 }
            let spread = pixels.map { max($0.redComponent, $0.greenComponent, $0.blueComponent)
                - min($0.redComponent, $0.greenComponent, $0.blueComponent) }.max() ?? 1
            return (spread, pixels.count)
        }
        let neutral = [TaskMark.Status.working, .retrying, .unread].flatMap { status in
            [NSAppearance.Name.aqua, .darkAqua].map { hue(status, $0) }
        }
        expect("Task marks: the working spinner, the retry ring and the unread dot draw grey, not blue-grey or amber",
               neutral.allSatisfy { $0.inked > 0 && $0.spread < 0.04 }, "\(neutral)")
        expect("Task marks: retrying is a ring, not the spinner", TaskMark.isMoving(.retrying)
               && hue(.retrying, .aqua).inked != hue(.working, .aqua).inked)
        let request = RowContent.Badge.request(.approval)
        var row = RowContent(title: "Add support for sorting tasks by priority", meta: "1m", leading: .mark(.task(.waiting)))
        row.badge = request
        let width = Draw.width(of: "Approval", style: RowRenderer.labelStyle, weight: .medium)
        expect("Task marks: Approval and Question are trailing accent words that reserve their own width",
               request.isLabel && request.tone == Attention.tone && RowContent.Badge.request(.question).text == "Question"
                   && RowRenderer.badgeWidth(row, compact: true) == width + RowCell.Geometry.gap, "\(width)")
    }

    func sessionFacts() {
        var row = RowContent(title: "Add configuration defaults and validation", meta: "13m", leading: .mark(.task(.failed)))
        row.diff = (added: 171, removed: 3)
        row.alignsFacts = true
        row.yieldOrder = [.title, .counts]
        var plain = row
        plain.diff = nil
        let fits = [256, 320, 400].map { row.fitted(width: CGFloat($0)) }
        expect("Session facts: age and totals stay at 256, 320 and 400 pt while the title gives way",
               fits.allSatisfy { $0.meta == "13m" && $0.showsCounts } && fits[0].titleTruncated && fits[0].titleWidth >= RowRenderer.shortestTitle,
               "\(fits)")
        let tiny = row.fitted(width: 140)
        let floor = row.fitted(width: 176)
        expect("Session facts: totals drop only after the title is down to its floor; age never yields",
               !tiny.showsCounts && tiny.meta == "13m" && (floor.showsCounts || floor.titleWidth <= RowRenderer.shortestTitle),
               "\(tiny) / \(floor)")
        let ages = [row, plain].compactMap { candidate -> Int? in
            inkColumns(candidate, state: RowRenderer.State(), width: 256).max()
        }
        expect("Session facts: the age ends at the same edge with or without totals", ages.count == 2 && ages[0] == ages[1], "\(ages)")
    }

    func denseStrip() {
        let window = KitProbeWindow(size: NSSize(width: 320, height: 160))
        let tool = ToolWindowView(header: .dense)
        let picker = Button("Thread 1", size: .sm)
        let field = SearchField(placeholder: "Evaluate", size: .sm)
        tool.header.setViews(leading: [picker], trailing: [field])
        window.place(tool, at: .zero, size: NSSize(width: 320, height: 160))
        tool.layoutSubtreeIfNeeded()
        let header = tool.header.frame
        let pickerFrame = tool.convert(picker.frame, from: picker.superview)
        let fieldFrame = tool.convert(field.frame, from: field.superview)
        expect("Strip density: a 24 pt dense strip holds sm controls at full height, centred, inside the strip",
               header.height == Size.sm.height && pickerFrame.height == Size.sm.height && fieldFrame.height == Size.sm.height
                   && abs(pickerFrame.midY - header.midY) < 0.5 && abs(fieldFrame.midY - header.midY) < 0.5
                   && header.contains(pickerFrame) && header.contains(fieldFrame), "\(header) \(pickerFrame) \(fieldFrame)")
        window.close()
    }
}
