import AppKit
@testable import NyteUI

@MainActor
private let fieldWidth: CGFloat = 196

@MainActor
private func input(_ text: String = "", variant: Input.Variant = .raised, size: Size = .md, symbol: String? = nil,
                   focused: Bool = false, invalid: Bool = false, disabled: Bool = false) -> NSView {
    let field = Input(text, placeholder: "Branch name", variant: variant, size: size, symbol: symbol)
    field.field.refusesFirstResponder = true
    field.isFocused = focused
    field.isInvalid = invalid
    if invalid { field.message = "Use hyphens instead of spaces." }
    field.isEnabled = !disabled
    return Gallery.sized(field, width: fieldWidth, height: field.fittingSize.height)
}

@MainActor
private func search(_ text: String = "", count: String = "", focused: Bool = false) -> NSView {
    let field = SearchField(text, placeholder: "Search files")
    field.count = count
    field.isFocused = focused
    return Gallery.sized(field, width: fieldWidth, height: Size.md.height)
}

@MainActor
private func variantRow(_ variant: Input.Variant, size: Size = .md) -> NSView {
    Gallery.row([
        Gallery.specimen("placeholder", input(variant: variant, size: size)),
        Gallery.specimen("text", input("fix-scroll-state", variant: variant, size: size)),
        Gallery.specimen("focused", input("fix-scroll", variant: variant, size: size, focused: true)),
        Gallery.specimen("invalid", input("fix scroll", variant: variant, size: size, invalid: true)),
        Gallery.specimen("disabled", input("main", variant: variant, size: size, disabled: true)),
    ], spacing: Space.x3, alignment: .top)
}

@MainActor
enum FieldCompletionSpecimen {
    static let candidates = ["client.send", "client.sendAll", "client.Close"]
    static var shown: [FieldCompletion] = []

    static func make() -> NSView {
        let field = Input("client.s", placeholder: "Evaluate expression", variant: .quiet)
        field.textStyle = .code
        shown.append(FieldCompletion(input: field))
        return Gallery.sized(field, width: fieldWidth * 2, height: Size.md.height)
    }

    static func show() {
        for completion in shown { completion.show(candidates) }
    }
}

@MainActor
let inputsPage = GalleryPage(name: "inputs", prepare: { FieldCompletionSpecimen.show() }) {
    Gallery.page([
        Gallery.section("Completion for a field", note: "A floating list under the field: arrows move, Return accepts, "
                        + "Tab takes the common prefix, Escape closes.", [
            Gallery.specimen("REPL", FieldCompletionSpecimen.make()),
            Gallery.sized(NSView(), width: fieldWidth, height: Metric.row * CGFloat(FieldCompletionSpecimen.candidates.count)),
        ]),
        Gallery.section("Raised, md", onCard: true, [variantRow(.raised)]),
        Gallery.section("Quiet, md", onCard: true, [variantRow(.quiet)]),
        Gallery.section("lg and glyph", onCard: true, [
            variantRow(.raised, size: .lg),
            Gallery.row([
                Gallery.specimen("leading glyph", input(symbol: "arrow.triangle.branch")),
                Gallery.specimen("glyph and text, lg", input("origin/main", size: .lg, symbol: "arrow.triangle.branch")),
                Gallery.specimen("code type", {
                    let field = Input("message.Subject", placeholder: "Evaluate expression", variant: .quiet)
                    field.textStyle = .code
                    return Gallery.sized(field, width: fieldWidth, height: Size.md.height)
                }()),
                Gallery.specimen("flexible height, a row tall", Gallery.sized(
                    Input("Port the hub", placeholder: "Session name", height: .flexible), width: fieldWidth,
                    height: Metric.rowDouble
                )),
            ], spacing: Space.x3),
        ]),
        Gallery.section("Text area", note: "Grows from three lines to ten, then scrolls; Return inserts a newline and Command-Return "
                        + "submits, or the reverse.", onCard: true, [
            Gallery.row([
                Gallery.specimen("placeholder", Gallery.wide(TextArea(placeholder: "Commit message"), width: fieldWidth * 1.5)),
                Gallery.specimen("text", Gallery.wide({
                    let area = TextArea(placeholder: "Commit message")
                    area.string = "Pin group headers\n\nKeep the title styling the row asked for, and cover the list's inset."
                    return area
                }(), width: fieldWidth * 1.5)),
                Gallery.specimen("invalid", Gallery.wide({
                    let area = TextArea(placeholder: "Commit message")
                    area.isInvalid = true
                    area.message = "Write a summary line."
                    return area
                }(), width: fieldWidth * 1.5)),
            ], spacing: Space.x3, alignment: .top),
            Gallery.row([
                Gallery.specimen("borderless, prose, inside a composer", composer("")),
                Gallery.specimen("grown with its text", composer("Port the hub to the new transport.\nKeep the register "
                                                                  + "channel; drop the polling loop.\nRun the race tests.")),
            ], spacing: Space.x3, alignment: .top),
        ]),
        Gallery.section("Search", onCard: true, [
            Gallery.row([
                Gallery.specimen("empty", search()),
                Gallery.specimen("text, clear button", search("Metrics")),
                Gallery.specimen("count", search("tab", count: "3/12", focused: true)),
            ], spacing: Space.x3),
        ]),
        Gallery.section("On the chrome", [
            Gallery.row([
                Gallery.specimen("search", search("Button")),
                Gallery.specimen("raised", input("feature")),
            ], spacing: Space.x3),
        ]),
    ])
}

@MainActor
private func composer(_ text: String) -> NSView {
    let surface = SurfaceView(fill: Palette.bgElevated, ring: Palette.strokeQuaternary, radius: Radius.composer)
    let area = TextArea(placeholder: "Ask the agent, @ for context", textStyle: .prose, chrome: .borderless, minimumLines: 1,
                        maximumLines: 8)
    area.string = text
    Pin.fill(area, in: surface, insets: NSEdgeInsets(top: Space.x2, left: Space.x3, bottom: Space.x2, right: Space.x3))
    return Gallery.wide(surface, width: fieldWidth * 1.5)
}
