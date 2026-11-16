import AppKit
@testable import NyteUI

@MainActor
private let barWidth: CGFloat = 760
@MainActor
private let narrowWidth: CGFloat = 420
@MainActor
private let dragOffset: CGFloat = 40
@MainActor
private let problems = 5
@MainActor
private let third = 2
@MainActor
private let fifth = 4
@MainActor
private let ports = 3
@MainActor
private let chromeWidth: CGFloat = 580
@MainActor
private let lastTab = 5

@MainActor
private func fileItems() -> [TabBar.Item] {
    [
        ("Package.swift", false, false), ("TabBar.swift", true, false), ("Metrics.swift", false, false),
        ("README.md", false, true), ("check-design.mjs", true, false), ("AGENTS.md", false, false),
    ].map { name, dirty, preview in
        TabBar.Item(name, icon: FileIcon.forFile(named: name).image(dark: false), toolTip: "packages/ide/\(name)",
                    isDirty: dirty, isPreview: preview)
    }
}

@MainActor
private func fileBar(width: CGFloat = barWidth, selected: Int = 1, hovered: Int? = nil, overClose: Bool = false,
                     pressClose: Int? = nil, drag: Int? = nil, hoverList: Bool = false) -> NSView {
    let bar = TabBar(style: .file, label: "Open files")
    bar.items = fileItems()
    bar.selectedIndex = selected
    bar.onMove = { _, _ in }
    let view = Gallery.sized(bar, width: width, height: Metric.paneHeader)
    view.layoutSubtreeIfNeeded()
    bar.layout()
    bar.hovered = hovered
    bar.hoveringClose = overClose
    bar.pressingClose = pressClose
    if let drag {
        bar.drag = (drag, bar.offsets[drag] + dragOffset, drag)
    }
    bar.listButton.isHovered = hoverList
    return view
}

@MainActor
private func toolBar(hovered: Int? = nil, overClose: Bool = false) -> NSView {
    let bar = TabBar(style: .plain, label: "Tool windows")
    bar.items = [
        TabBar.Item("Problems", count: problems, isClosable: false), TabBar.Item("Output", isClosable: false),
        TabBar.Item("Debug Console"), TabBar.Item("Ports", count: 2),
    ]
    bar.selectedIndex = 0
    let view = Gallery.sized(bar, width: narrowWidth, height: Metric.paneHeader)
    view.layoutSubtreeIfNeeded()
    bar.layout()
    bar.hovered = hovered
    bar.hoveringClose = overClose
    return view
}

@MainActor
let tabsPage = GalleryPage(name: "tabs") {
    Gallery.page([
        Gallery.section("File tabs", note: "Second tab selected and dirty; fourth is a preview; fifth dirty.", onCard: true, [
            Gallery.specimen("rest", fileBar()),
            Gallery.specimen("hover first", fileBar(hovered: 0)),
            Gallery.specimen("hover the dirty fifth", fileBar(hovered: fifth)),
            Gallery.specimen("pointer over the close glyph of the third", fileBar(hovered: third, overClose: true)),
            Gallery.specimen("pressing close", fileBar(hovered: third, overClose: true, pressClose: third)),
            Gallery.specimen("dragging the third", fileBar(drag: third)),
            Gallery.specimen("overflowing: titles that do not fit end in an ellipsis; a list button opens every tab", fileBar(width: narrowWidth)),
            Gallery.specimen("overflowing, the last tab chosen from the list and scrolled into view",
                             fileBar(width: narrowWidth, selected: lastTab)),
            Gallery.specimen("overflowing, list button hovered", fileBar(width: narrowWidth, hoverList: true)),
        ]),
        Gallery.section("Tool window tabs", onCard: true, [
            Gallery.specimen("rest", toolBar()),
            Gallery.specimen("hover output", toolBar(hovered: 1)),
            Gallery.specimen("hover ports, closable", toolBar(hovered: ports)),
            Gallery.specimen("over close", toolBar(hovered: ports, overClose: true)),
        ]),
        Gallery.section("On the chrome", [Gallery.specimen("file tabs", fileBar(width: chromeWidth))]),
    ])
}
