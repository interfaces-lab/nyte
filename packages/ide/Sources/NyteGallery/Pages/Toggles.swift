import AppKit
@testable import NyteUI

@MainActor
private func forced<T: Control>(_ make: () -> T, _ states: [Forced]) -> NSView {
    Gallery.row(states.map { state in
        let control = make()
        state.apply(to: control)
        return Gallery.specimen(state.rawValue, control)
    })
}

@MainActor
private func segmented(_ size: Size, sizing: Segmented.Sizing = .equal, hover: Int? = nil, press: Int? = nil,
                       disabled: Bool = false, segments: [Segmented.Segment]) -> Segmented {
    let control = Segmented(segments, selectedIndex: 0, size: size, sizing: sizing, label: "View")
    control.hoveredSegment = hover
    control.pressedSegment = press
    control.isEnabled = !disabled
    return control
}

@MainActor
private let words: [Segmented.Segment] = [.init("Files"), .init("Changes"), .init("Commits")]
@MainActor
private let navigator: [Segmented.Segment] = [
    .init(symbol: "folder", label: "Files"), .init(symbol: "magnifyingglass", label: "Search"),
    .init(symbol: "arrow.triangle.branch", label: "Source Control"), .init(symbol: "exclamationmark.triangle", label: "Problems"),
]

@MainActor
let segmentedPage = GalleryPage(name: "segmented") {
    Gallery.page([
        Gallery.section("Filter group", note: "Several filters, each on or off: one track, a quiet tile under each on filter, an off "
                        + "filter plain with its label a step lower, counts in tabular digits. One keyboard stop; arrows move, Space toggles.",
                        onCard: true, [
            Gallery.row([
                Gallery.specimen("all on", FilterGroup(problemFilters([true, true, true]), label: "Severity")),
                Gallery.specimen("warnings off", FilterGroup(problemFilters([true, false, true]), label: "Severity")),
                Gallery.specimen("all off", FilterGroup(problemFilters([false, false, false]), label: "Severity")),
            ]),
        ]),
        Gallery.section("Segmented, sm", onCard: true, [
            Gallery.row([
                Gallery.specimen("rest", segmented(.sm, segments: words)),
                Gallery.specimen("hover second", segmented(.sm, hover: 1, segments: words)),
                Gallery.specimen("press third", segmented(.sm, press: 2, segments: words)),
                Gallery.specimen("disabled", segmented(.sm, disabled: true, segments: words)),
            ]),
        ]),
        Gallery.section("Segmented, md and hug", onCard: true, [
            Gallery.row([
                Gallery.specimen("md equal", segmented(.md, segments: words)),
                Gallery.specimen("md hug", segmented(.md, sizing: .hug, segments: words)),
                Gallery.specimen("glyph and title", segmented(.sm, segments: [
                    .init("Agent", symbol: "bubble.left"), .init("Terminal", symbol: "terminal"),
                ])),
            ]),
        ]),
        Gallery.section("Navigator switcher", note: "Icon only, on the chrome.", [
            Gallery.row([
                Gallery.specimen("sm", segmented(.sm, sizing: .hug, segments: navigator)),
                Gallery.specimen("sm, hover", segmented(.sm, sizing: .hug, hover: 2, segments: navigator)),
                Gallery.specimen("md", segmented(.md, sizing: .hug, segments: navigator)),
                Gallery.specimen("sm, badge", segmented(.sm, sizing: .hug, segments: badged(navigator, 12))),
            ]),
            Gallery.row([
                Gallery.specimen("past two digits", segmented(.sm, sizing: .hug, segments: badged(navigator, 140))),
                Gallery.specimen("host tone", segmented(.sm, sizing: .hug, segments: badged(navigator, 3, tone: .danger))),
                Gallery.specimen("titled, selected", segmented(.sm, sizing: .hug, segments: {
                    var changes = Segmented.Segment("Changes")
                    changes.badge = 8
                    return [changes, .init("History")]
                }())),
            ]),
        ]),
    ])
}

@MainActor
let togglesPage = GalleryPage(name: "toggles") {
    Gallery.page([
        Gallery.section("Checkbox", onCard: true, [
            forced({ Checkbox(label: "Off") }, [.rest, .hover, .pressed, .disabled]),
            forced({ Checkbox(label: "On", state: .on) }, [.rest, .hover, .pressed, .disabled]),
            forced({ Checkbox(label: "Mixed", state: .mixed) }, [.rest, .hover, .pressed, .disabled]),
            Gallery.row([
                Gallery.specimen("titled", Checkbox("Format on save", state: .on)),
                Gallery.specimen("titled, off", Checkbox("Trim trailing whitespace")),
                Gallery.specimen("titled, disabled", { let box = Checkbox("Use tabs"); box.isEnabled = false; return box }()),
            ]),
        ]),
        Gallery.section("Switch", onCard: true, [
            forced({ Switch(label: "Off") }, [.rest, .hover, .pressed, .disabled]),
            forced({ Switch(label: "On", isOn: true) }, [.rest, .hover, .pressed, .disabled]),
        ]),
        Gallery.section("On the chrome", [
            Gallery.row([
                Gallery.specimen("checkbox", Checkbox("Show hidden files", state: .on)),
                Gallery.specimen("switch", Switch(label: "Wrap", isOn: true)),
                Gallery.specimen("switch off", Switch(label: "Wrap")),
            ]),
        ]),
    ])
}

@MainActor
private func split(_ variant: SplitButton.Variant, tone: Tone = .neutral, size: Size = .md,
                   hover: SplitButton.Half? = nil, press: SplitButton.Half? = nil, open: Bool = false,
                   disabled: Bool = false) -> SplitButton {
    let button = SplitButton("New Session", symbol: "plus", variant: variant, tone: tone, size: size, menu: { nil })
    button.hoveredHalf = hover
    button.isHovered = hover != nil
    button.pressedHalf = press
    button.menuOpen = open
    button.isEnabled = !disabled
    return button
}

@MainActor
private func splitStates(_ variant: SplitButton.Variant, tone: Tone = .neutral) -> NSView {
    Gallery.row([
        Gallery.specimen("rest", split(variant, tone: tone)),
        Gallery.specimen("hover action", split(variant, tone: tone, hover: .action)),
        Gallery.specimen("press action", split(variant, tone: tone, hover: .action, press: .action)),
        Gallery.specimen("hover chevron", split(variant, tone: tone, hover: .chevron)),
        Gallery.specimen("menu open", split(variant, tone: tone, open: true)),
        Gallery.specimen("disabled", split(variant, tone: tone, disabled: true)),
    ])
}

@MainActor
let splitButtonPage = GalleryPage(name: "split-button") {
    Gallery.page([
        Gallery.section("Outline", onCard: true, [splitStates(.outline)]),
        Gallery.section("Solid", onCard: true, [splitStates(.solid, tone: .primary), splitStates(.solid)]),
        Gallery.section("Sizes", onCard: true, [
            Gallery.row([Size.sm, .md, .lg].map { size in
                Gallery.specimen("\(Int(size.height))", SplitButton("Run", symbol: "play", size: size, menu: { nil }))
            }),
        ]),
        Gallery.section("On the chrome", [
            Gallery.row([
                Gallery.specimen("outline", split(.outline)),
                Gallery.specimen("solid", split(.solid, tone: .primary)),
            ]),
        ]),
    ])
}

@MainActor
private func badged(_ segments: [Segmented.Segment], _ count: Int, tone: Tone? = nil) -> [Segmented.Segment] {
    segments.enumerated().map { index, segment in
        var badged = segment
        badged.badge = index == segments.count - 1 ? count : nil
        badged.badgeTone = tone
        return badged
    }
}

@MainActor
private func problemFilters(_ on: [Bool]) -> [FilterGroup.Filter] {
    [("Errors", "xmark.octagon.fill", Tone.danger, 0), ("Warnings", "exclamationmark.triangle.fill", .warning, 1),
     ("Notes", "info.circle.fill", .primary, 2)].enumerated().map { index, filter in
        FilterGroup.Filter(filter.0, symbol: filter.1, tone: filter.2, count: filter.3, isOn: on[index])
    }
}
