import AppKit
@testable import NyteUI

@MainActor
enum Forced: String, CaseIterable {
    case rest, hover, pressed, on, disabled

    func apply(to control: Control) {
        switch self {
        case .rest: break
        case .hover: control.isHovered = true
        case .pressed: control.isHovered = true; control.isPressed = true
        case .on: control.isOn = true
        case .disabled: control.isEnabled = false
        }
    }
}

@MainActor
private func states(_ make: () -> Button, _ states: [Forced] = Forced.allCases) -> NSView {
    Gallery.row(states.map { state in
        let button = make()
        state.apply(to: button)
        return Gallery.specimen(state.rawValue, button)
    })
}

@MainActor
private func onVersusPressed(_ make: () -> Button) -> NSView {
    let pressed = make()
    Forced.pressed.apply(to: pressed)
    let on = make()
    Forced.on.apply(to: on)
    let onHovered = make()
    Forced.on.apply(to: onHovered)
    Forced.hover.apply(to: onHovered)
    return Gallery.row([
        Gallery.specimen("rest", make()),
        Gallery.specimen("pressed", pressed),
        Gallery.specimen("on", on),
        Gallery.specimen("on, hovered", onHovered),
    ])
}

@MainActor
let buttonsPage = GalleryPage(name: "buttons") {
    Gallery.page([
        Gallery.section("Variants by state", note: "Hover climbs one fill step, pressed two. On is pressed's fill plus a ring. Labels are regular; a solid label is medium.", onCard: true, [
            states { Button("Ghost") },
            states { Button("Soft", variant: .soft) },
            states { Button("Outline", variant: .outline) },
            states({ Button("Solid", variant: .solid) }, [.rest, .hover, .pressed, .disabled]),
            states({ Button("main.go:18:45", variant: .link) }, [.rest, .hover, .disabled]),
            states({ Button("Refactor", variant: .solid, tone: .primary) }, [.rest, .hover, .pressed, .disabled]),
            states({ Button("Delete", variant: .solid, tone: .danger) }, [.rest, .hover, .pressed, .disabled]),
        ]),
        Gallery.section("On versus pressed", note: "A toggle that is on keeps a ring inside its shape; a press is fill only and lets go.", onCard: true, [
            onVersusPressed { IconButton(symbol: "sidebar.leading", label: "Sidebar") },
            onVersusPressed { Button("Wrap", symbol: "text.word.spacing") },
            onVersusPressed { Button("Filter", variant: .soft) },
            onVersusPressed {
                let button = Button("Claude Opus 5.5", variant: .outline)
                button.trailingSymbol = "chevron.down"
                return button
            },
        ]),
        Gallery.section("Sizes", note: "16, 20, 24, 28, 32, 36. Panes use sm and md.", onCard: true, [
            Gallery.row(Size.allCases.map { size in
                Gallery.specimen("\(Int(size.height))", Button("Run", symbol: "play", variant: .outline, size: size))
            }),
            Gallery.row(Size.allCases.map { size in
                Gallery.specimen("\(Int(size.height))", Button(symbol: "plus", label: "Add", variant: .soft, size: size))
            }),
        ]),
        Gallery.section("Content", onCard: true, [
            Gallery.row([
                Gallery.specimen("glyph and title", Button("New Session", symbol: "plus", variant: .outline)),
                Gallery.specimen("picker", {
                    let button = Button("Claude Opus 5.5", variant: .outline)
                    button.trailingSymbol = "chevron.down"
                    return button
                }()),
                Gallery.specimen("shortcut inside", {
                    let button = Button("Submit", variant: .solid, tone: .primary)
                    button.shortcut = "↩"
                    return button
                }()),
                Gallery.specimen("shortcut, secondary", {
                    let button = Button("Skip", variant: .outline)
                    button.shortcut = "Esc"
                    return button
                }()),
                Gallery.specimen("pill", {
                    let button = Button(Attention.needsInputText, symbol: Attention.symbol, variant: .soft, tone: Attention.tone, size: .sm)
                    button.isPill = true
                    return button
                }()),
                Gallery.specimen("tone, ghost", Button("Stop", symbol: "stop.fill", tone: .danger)),
            ]),
            Gallery.row([
                Gallery.specimen("filter chip, on", {
                    let button = Button("Errors", symbol: "xmark.octagon.fill", size: .sm)
                    button.symbolTone = .danger
                    button.detail = "12"
                    button.isOn = true
                    return button
                }()),
                Gallery.specimen("filter chip, off", {
                    let button = Button("Warnings", symbol: "exclamationmark.triangle.fill", size: .sm)
                    button.symbolTone = .warning
                    button.detail = "3"
                    return button
                }()),
            ]),
        ]),
        Gallery.section("Icon buttons", note: "Pane headers and bars. Bare at rest.", onCard: true, [
            states { IconButton(symbol: "sidebar.leading", label: "Sidebar") },
            states { IconButton(symbol: "magnifyingglass", label: "Search", size: .sm) },
            states { IconButton(symbol: "xmark", label: "Close", size: .xs) },
        ]),
        Gallery.section("On the chrome", note: "The same buttons outside a pane, on the window's ground.", [
            Gallery.row([
                Gallery.specimen("ghost", Button("Open Folder", symbol: "folder")),
                Gallery.specimen("outline", Button("Add Project", symbol: "plus", variant: .outline)),
                Gallery.specimen("solid", Button("New Session", variant: .solid, tone: .primary)),
                Gallery.specimen("soft", Button("Retry", variant: .soft)),
            ]),
        ]),
    ])
}
