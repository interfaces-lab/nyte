import AppKit
import NyteDesign

@MainActor
final class StudioToolbar: NSObject, NSToolbarDelegate {
  let toolbar = NSToolbar(identifier: "studio")
  private let model: StudioModel
  private let split: NSSplitView
  private let project = NSMenuToolbarItem(itemIdentifier: Item.project)
  private let zoom = NSMenuToolbarItem(itemIdentifier: Item.zoom)
  private let night = NSToolbarItem(itemIdentifier: Item.night)
  private let zen = NSToolbarItem(itemIdentifier: Item.zen)
  private lazy var panel = NSToolbarItemGroup(
    itemIdentifier: Item.panel, titles: ["Design", "Chat"], selectionMode: .selectOne,
    labels: ["Design", "Chat"], target: self, action: #selector(choosePanel(_:)))
  private var observers: [Observer] = []

  private enum Item {
    static let project = NSToolbarItem.Identifier("project")
    static let sidebarEdge = NSToolbarItem.Identifier("sidebarEdge")
    static let night = NSToolbarItem.Identifier("night")
    static let zoom = NSToolbarItem.Identifier("zoom")
    static let zen = NSToolbarItem.Identifier("zen")
    static let inspectorEdge = NSToolbarItem.Identifier("inspectorEdge")
    static let panel = NSToolbarItem.Identifier("panel")
  }

  init(model: StudioModel, split: NSSplitView) {
    self.model = model
    self.split = split
    super.init()
    toolbar.delegate = self
    toolbar.displayMode = .iconOnly
    toolbar.allowsUserCustomization = false

    project.image = MoonView.image(.md)
    project.showsIndicator = true
    project.label = "Project"
    project.toolTip = "Open another project"

    zoom.showsIndicator = true
    zoom.label = "Zoom"
    zoom.toolTip = "Zoom"

    night.label = "Day or Night"
    night.target = self
    night.action = #selector(toggleNight(_:))

    zen.label = "Zen"
    zen.toolTip = "Zen: only the canvas (⌘.)"
    zen.image = NSImage(systemSymbolName: "viewfinder", accessibilityDescription: "Zen")
    zen.target = self
    zen.action = #selector(toggleZen(_:))

    observers = [Observer { [weak self] in self?.refresh() }]
  }

  // MARK: Following the model

  private func refresh() {
    let menu = NSMenu()
    for workspace in model.workspaces {
      let item = NSMenuItem(title: workspace.name, action: #selector(chooseProject(_:)), keyEquivalent: "")
      item.target = self
      item.representedObject = workspace.id
      item.toolTip = workspace.path
      item.state = workspace.id == model.workspace?.id ? .on : .off
      menu.addItem(item)
    }
    menu.addItem(.separator())
    menu.addItem(withTitle: "Open Project…", action: #selector(StudioWindowController.openProject(_:)), keyEquivalent: "")
    project.menu = menu
    project.title = model.workspace?.name ?? "Project"

    zoom.title = "\(Int((model.zoom * 100).rounded()))%"
    zoom.menu = zoomMenu()

    let dark = model.project?.mode == .dark
    night.image = NSImage(systemSymbolName: dark ? "moon" : "sun.max", accessibilityDescription: nil)
    night.toolTip = dark ? "Show designs by day (⇧⌘D)" : "Show designs by night (⇧⌘D)"

    panel.selectedIndex = model.panel == .design ? 0 : 1
    panel.badge = model.chatUnseen ? .count(1) : nil
  }

  private func zoomMenu() -> NSMenu {
    let menu = NSMenu()
    menu.addItem(withTitle: "Zoom to Fit", action: #selector(CanvasView.zoomToFit(_:)), keyEquivalent: "")
    menu.addItem(withTitle: "Zoom to Selection", action: #selector(CanvasView.zoomToSelection(_:)), keyEquivalent: "")
    menu.addItem(.separator())
    for percent in [50, 100, 200, 400] {
      let item = NSMenuItem(title: "\(percent)%", action: #selector(zoomTo(_:)), keyEquivalent: "")
      item.target = self
      item.tag = percent
      menu.addItem(item)
    }
    return menu
  }

  // MARK: Actions

  @objc private func choosePanel(_ sender: NSToolbarItemGroup) {
    model.panel = sender.selectedIndex == 0 ? .design : .chat
    if !model.inspectorShown {
      NSApp.sendAction(#selector(NSSplitViewController.toggleInspector(_:)), to: nil, from: self)
    }
  }

  @objc private func chooseProject(_ sender: NSMenuItem) {
    guard let id = sender.representedObject as? String, let workspace = model.workspaces.first(where: { $0.id == id })
    else { return }
    Task { await model.open(workspace) }
  }

  @objc private func toggleNight(_ sender: Any?) {
    guard let project = model.project else { return }
    project.mode = project.mode == .dark ? .light : .dark
  }

  @objc private func toggleZen(_ sender: Any?) {
    model.zen.toggle()
  }

  @objc private func zoomTo(_ sender: NSMenuItem) {
    model.cameraRequest = .zoom(CGFloat(sender.tag) / 100)
  }

  // MARK: NSToolbarDelegate

  func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
    [
      .toggleSidebar, Item.sidebarEdge, Item.project, .flexibleSpace, Item.night, Item.zoom, .space, Item.zen,
      Item.inspectorEdge, Item.panel, .flexibleSpace, .toggleInspector,
    ]
  }

  func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
    toolbarDefaultItemIdentifiers(toolbar)
  }

  func toolbar(
    _ toolbar: NSToolbar, itemForItemIdentifier identifier: NSToolbarItem.Identifier, willBeInsertedIntoToolbar flag: Bool
  ) -> NSToolbarItem? {
    switch identifier {
    case Item.project: return project
    case Item.zoom: return zoom
    case Item.night: return night
    case Item.zen: return zen
    case Item.panel: return panel
    case Item.sidebarEdge: return NSTrackingSeparatorToolbarItem(identifier: identifier, splitView: split, dividerIndex: 0)
    case Item.inspectorEdge: return NSTrackingSeparatorToolbarItem(identifier: identifier, splitView: split, dividerIndex: 1)
    default: return nil
    }
  }
}
