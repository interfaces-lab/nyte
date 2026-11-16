import AppKit
@testable import NyteUI

@MainActor
private let meterWidth: CGFloat = 240
@MainActor
private let breadcrumbWidths: [CGFloat] = [640, 400, 280, 200]
@MainActor
private let paneSize = NSSize(width: 520, height: 260)
@MainActor
private let partial: Double = 0.4
@MainActor
private let counts = [("xs 3", 3, Tone.neutral, Size.xs), ("xs 42", 42, Tone.neutral, Size.xs), ("xs 120", 120, Tone.neutral, Size.xs), ("sm 5", 5, Tone.neutral, Size.sm), ("danger", 12, Tone.danger, Size.xs), ("primary sm", 7, Tone.primary, Size.sm)]
@MainActor
private let lastOfFour = 3

@MainActor
private func slot(_ views: [NSView], height: CGFloat) -> NSView {
    let row = NSStackView(views: views)
    row.orientation = .horizontal
    row.alignment = .centerY
    row.spacing = Space.x2
    row.translatesAutoresizingMaskIntoConstraints = false
    row.heightAnchor.constraint(equalToConstant: height).isActive = true
    return row
}

@MainActor
private func chipState(_ change: (Chip) -> Void) -> Chip {
    let chip = Chip("hub.go:41-58", image: FileIcon.forFile(named: "hub.go").image(for: NSApp.effectiveAppearance))
    chip.onPress = {}
    chip.onRemove = {}
    change(chip)
    return chip
}

@MainActor
enum ChipRowSpecimens {
    static let width: CGFloat = 320
    static var opened: ChipRow?

    static func row(opened open: Bool) -> NSView {
        let names = ["hub.go:41-58", "client.go", "Terminal", "stats.go:6-16", "hub_test.go:26", "README.md"]
        let row = ChipRow(maximumLines: 2)
        row.chips = names.map { name in
            let chip = Chip(name, image: name == "Terminal" ? nil : FileIcon.forFile(named: name.split(separator: ":").first.map(String.init) ?? name)
                .image(for: NSApp.effectiveAppearance), symbol: name == "Terminal" ? "apple.terminal" : nil)
            chip.onRemove = {}
            chip.onPress = {}
            return chip
        }
        if open { opened = row }
        return Gallery.sized(row, width: width, height: Chip.height * 2 + ChipRow.gap)
    }

    static func open() {
        opened?.layoutSubtreeIfNeeded()
        opened?.showOverflow()
        opened = nil
    }
}

@MainActor
let badgesPage = GalleryPage(name: "badges", prepare: { ChipRowSpecimens.open() }) {
    Gallery.page([
        Gallery.section("Badge", onCard: true, [
            Gallery.row(Tone.allCases.map { tone in Gallery.specimen("\(tone)", Badge("Running", tone: tone)) }),
            Gallery.row(Tone.allCases.map { tone in Gallery.specimen("dot", Badge("Running", tone: tone, dot: true)) }),
            Gallery.row(Tone.allCases.map { tone in Gallery.specimen("xs rounded", Badge("beta", tone: tone, size: .xs, shape: .rounded)) }),
        ]),
        Gallery.section("Chip row", note: "Past two lines the rest collapse into +N, which opens them as a list; Return opens one, "
                        + "Delete removes it.", [
            Gallery.row([
                Gallery.specimen("six chips at 320 points", ChipRowSpecimens.row(opened: false)),
                Gallery.specimen("+N opened", ChipRowSpecimens.row(opened: true)),
            ], spacing: Space.x8, alignment: .top),
        ]),
        Gallery.section("Chip", onCard: true, [
            Gallery.row([
                Gallery.specimen("file, removable", slot([{
                    let chip = Chip("hub.go:41-58", image: FileIcon.forFile(named: "hub.go").image(for: NSApp.effectiveAppearance))
                    chip.onRemove = {}
                    return chip
                }()], height: Chip.height)),
                Gallery.specimen("detail", slot([Chip("big.go:1-5000", detail: "first 400 of 5,000 lines",
                                                      image: FileIcon.forFile(named: "big.go").image(for: NSApp.effectiveAppearance))],
                                                height: Chip.height)),
                Gallery.specimen("symbol, tone", slot([{
                    let chip = Chip("hub.go:41", symbol: "xmark.octagon")
                    chip.symbolTone = .danger
                    return chip
                }()], height: Chip.height)),
                Gallery.specimen("hover", slot([{
                    let chip = Chip("Terminal", detail: "12 lines", symbol: "apple.terminal")
                    chip.onPress = {}
                    chip.isHovered = true
                    return chip
                }()], height: Chip.height)),
            ]),
            Gallery.row([
                Gallery.specimen("pressed", slot([chipState { $0.isPressed = true }], height: Chip.height)),
                Gallery.specimen("pointer on remove", slot([chipState { $0.isHovered = true; $0.isCrossHovered = true }], height: Chip.height)),
                Gallery.specimen("remove pressed", slot([chipState {
                    $0.isHovered = true
                    $0.isCrossHovered = true
                    $0.isCrossPressed = true
                }], height: Chip.height)),
                Gallery.specimen("disabled", slot([chipState { $0.isEnabled = false }], height: Chip.height)),
                Gallery.specimen("label only", slot([Chip("+3")], height: Chip.height)),
            ]),
        ]),
        Gallery.section("Request label", note: "Waiting on the user is the only accent: a trailing word, not a second glyph.", [
            Gallery.row([
                Gallery.specimen("in a session row", Specimens.list(Specimens.sessionStates.filter { $0.badge != nil },
                                                                      height: Metric.rowCompact, width: Specimens.factWidths[1])),
            ]),
        ]),
        Gallery.section("Count", onCard: true, [
            Gallery.row(counts.map { caption, count, tone, size in
                Gallery.specimen(caption, slot([CountBadge(count, tone: tone, size: size)], height: Size.xs.height))
            }),
        ]),
        Gallery.section("Kbd", onCard: true, [
            Gallery.row([
                Gallery.specimen("xs", slot([Kbd("⇧⌘P")], height: Size.xs.height)),
                Gallery.specimen("sm", slot([Kbd("⌘K", size: .sm)], height: Size.xs.height)),
                Gallery.specimen("word", slot([Kbd(keys: ["Esc"])], height: Size.xs.height)),
                Gallery.specimen("return", slot([Kbd("↩")], height: Size.xs.height)),
                Gallery.specimen("plain", slot([Kbd("⌥⌘L", plain: true)], height: Size.xs.height)),
            ]),
        ]),
        Gallery.section("Avatar", onCard: true, [
            Gallery.row(["nyte", "nyte-ide", "Studio", "webKit", "pierre", "rex"].map { name in
                Gallery.specimen(name, slot([Size.xxs, .xs, .sm].map { Avatar(name, size: $0) }, height: Size.sm.height))
            }),
        ]),
        Gallery.section("On the chrome", [
            Gallery.row([
                Gallery.specimen("badge", Badge.needsInput()),
                Gallery.specimen("count", CountBadge(counts.count)),
                Gallery.specimen("kbd", Kbd("⌘P")),
                Gallery.specimen("avatar", Avatar("nyte-ide", size: .sm)),
            ]),
        ]),
    ])
}

@MainActor
let progressPage = GalleryPage(name: "progress", settle: 0.3) {
    Gallery.page([
        Gallery.section("Loader and Spinner", note: "Loader is any work; Spinner is the agent's work only.", onCard: true, [
            Gallery.row([
                Gallery.specimen("loader", Loader()),
                Gallery.specimen("loader tertiary", { let view = Loader(); view.ink = Palette.contentTertiary; return view }()),
                Gallery.specimen("spinner", Spinner()),
                Gallery.specimen("spinner primary", { let view = Spinner(); view.ink = Palette.accentInk; return view }()),
                Gallery.row((0..<Spinner.frames).map { phase in
                    let view = Spinner()
                    view.holdsPhase = true
                    view.phase = phase
                    return view
                }, spacing: Space.x1),
            ]),
        ]),
        Gallery.section("Meter", onCard: true, [
            Gallery.specimen("0.4", Gallery.sized(Meter(value: partial), width: meterWidth, height: Metric.meter)),
            Gallery.specimen("full, success", Gallery.sized(Meter(value: 1, tone: .success), width: meterWidth, height: Metric.meter)),
            Gallery.specimen("indeterminate", Gallery.sized(Meter(value: nil), width: meterWidth, height: Metric.meter)),
        ]),
        Gallery.section("Task marks", onCard: true, [
            Gallery.row([TaskMark.Status.working, .retrying, .waiting, .unread, .failed].map { status in
                Gallery.specimen("\(status)", TaskMark(status))
            }),
            Gallery.row([TaskMark.Status.working, .retrying, .waiting, .unread, .failed].map { status in
                Gallery.specimen("16", TaskMark(status, side: Glyph.md.rawValue))
            }),
        ]),
    ])
}

@MainActor
private enum Notices {
    static let actionsNarrow: CGFloat = 300

    static func changedOnDisk() -> Banner {
        Banner("hub.go changed on disk", detail: "It was rewritten by gofmt while you had unsaved edits.", tone: .warning,
               actions: [Banner.Action("Compare") {}, Banner.Action("Reload", primary: true) {}, Banner.Action("Keep Mine") {}],
               onDismiss: {})
    }

    static let narrow: CGFloat = 280
    static let hookOutput = (1...20).map { "lint: Sources/NyteUI/Lists/RowRenderer.swift:\($0 * 7): line is longer than 140 characters" }
        .joined(separator: "\n")
}

@MainActor
let noticesPage = GalleryPage(name: "notices") {
    Gallery.page([
        Gallery.section("Banner", onCard: true, [
            Gallery.wide(Banner("gopls is not installed", detail: "Go files open without completion or diagnostics.",
                                tone: .warning, action: ("Install", {}), onDismiss: {}), width: paneSize.width),
            Gallery.wide(Banner("Indexing paused while on battery", action: ("Resume", {}), onDismiss: {}), width: paneSize.width),
            Gallery.wide(Banner("The language server stopped", detail: "rust-analyzer exited with code 101.", tone: .danger,
                                action: ("Restart", {})), width: paneSize.width),
            Gallery.specimen("a long detail: two lines, then Show more", Gallery.wide(Banner(
                "The pre-commit hook failed", detail: Notices.hookOutput, tone: .danger, action: ("Retry", {})), width: paneSize.width)),
            Gallery.specimen("expanded: the whole text, selectable, with Copy", Gallery.wide({
                let banner = Banner("The pre-commit hook failed", detail: Notices.hookOutput, tone: .danger, action: ("Retry", {}))
                banner.setExpanded(true)
                return banner
            }(), width: paneSize.width)),
            Gallery.specimen("three actions, one primary, dismiss apart", Gallery.wide(Notices.changedOnDisk(), width: paneSize.width)),
            Gallery.specimen("300 points: the actions wrap under the text", Gallery.wide(Notices.changedOnDisk(), width: Notices.actionsNarrow)),
            Gallery.specimen("280 points, the detail wraps under the title", Gallery.wide(Banner(
                "This Nyte can't talk to the IDE", detail: "The host speaks protocol 14 (a1b2c3d), this IDE speaks 12 (9f8e7d6).",
                tone: .danger, action: ("Update", {})), width: Notices.narrow)),
        ]),
        Gallery.section("Empty state", onCard: true, [
            Gallery.sized(EmptyState(symbol: "doc.text", title: "No file open",
                                     description: "Open a file from the navigator, or find one by name.",
                                     actions: [("Open File…", {}), ("New File", {})],
                                     hints: [("Go to File", "⌘P"), ("Search Everywhere", "⇧⌘F")]),
                          width: paneSize.width, height: paneSize.height),
            Gallery.sized(EmptyState(loading: true, title: "Starting gopls"), width: paneSize.width, height: paneSize.height / 2),
            Gallery.sized(EmptyState(title: "This Nyte can't talk to the IDE",
                                     description: "Nyte 0.0.21 serves API revision 15. This IDE needs API revision 17 to 24.",
                                     command: "nyte update", actions: [("Try Again", {})]),
                          width: paneSize.width, height: paneSize.height / 2),
        ]),
    ])
}

@MainActor
private let path: [BreadcrumbBar.Crumb] = [
    .init("nyte", symbol: "folder"), .init("packages"), .init("ide"), .init("Sources"), .init("NyteUI"), .init("Controls"),
    .init("BreadcrumbBar.swift", image: FileIcon.forFile(named: "BreadcrumbBar.swift").image(dark: false)),
    .init("arrange()", mark: .code(letter: "m", semanticType: "method")),
]

@MainActor
let breadcrumbsPage = GalleryPage(name: "breadcrumbs") {
    Gallery.page([
        Gallery.section("Breadcrumbs", note: "Narrower bars fold the leading ancestors into one ellipsis; the file and the symbol go last. A symbol crumb carries the same kind mark as Structure and completion.", onCard: true,
                        breadcrumbWidths.map { width in
                            Gallery.specimen("\(Int(width))", Gallery.sized(BreadcrumbBar(path), width: width, height: Metric.paneFooter))
                        } + [
                            Gallery.specimen("hover third", Gallery.sized({
                                let bar = BreadcrumbBar(path)
                                bar.hoveredSlot = 2
                                return bar
                            }(), width: breadcrumbWidths[0], height: Metric.paneFooter)),
                            Gallery.specimen("hover last", Gallery.sized({
                                let bar = BreadcrumbBar(Array(path.prefix(lastOfFour + 1)))
                                bar.hoveredSlot = lastOfFour
                                return bar
                            }(), width: breadcrumbWidths[1], height: Metric.paneFooter)),
                        ]),
    ])
}
