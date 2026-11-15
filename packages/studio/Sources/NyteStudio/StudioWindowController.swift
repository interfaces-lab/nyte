import AppKit
import NyteDesign
import NyteKit

private extension NSToolbarItem.Identifier {
  static let night = NSToolbarItem.Identifier("studio.night")
  static let zoom = NSToolbarItem.Identifier("studio.zoom")
  static let zen = NSToolbarItem.Identifier("studio.zen")
  static let handOff = NSToolbarItem.Identifier("studio.handOff")
}

/// The window: a native split of sidebar, canvas and inspector under a unified toolbar, and
/// zen mode, which puts all of that away.
@MainActor
final class StudioWindowController: NSWindowController, NSToolbarDelegate, NSWindowDelegate, NSMenuItemValidation {
  private let model: StudioModel
  private let root = NSViewController()
  private let split = NSSplitViewController()
  private let status: StatusViewController
  private let workbench: WorkbenchViewController
  private let sidebarItem: NSSplitViewItem
  private let panelItem: NSSplitViewItem
  private let toolbar = NSToolbar(identifier: "studio")
  private let zoomItem = NSMenuToolbarItem(itemIdentifier: .zoom)
  private let nightItem = NSToolbarItem(itemIdentifier: .night)
  private let handOffItem = NSToolbarItem(itemIdentifier: .handOff)
  private var observers: [Observer] = []
  /// Whether the sidebar and inspector were collapsed before zen mode put them away.
  private var beforeZen: (sidebar: Bool, panel: Bool)?
  private var lightsTracking: NSTrackingArea?

  init(model: StudioModel) {
    self.model = model
    status = StatusViewController(model: model)
    workbench = WorkbenchViewController(model: model)
    sidebarItem = NSSplitViewItem(sidebarWithViewController: SidebarViewController(model: model))
    panelItem = NSSplitViewItem(inspectorWithViewController: PanelViewController(model: model))

    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered,
      defer: false)
    super.init(window: window)

    window.title = "Nyte Studio"
    window.titleVisibility = .hidden
    window.titlebarAppearsTransparent = true
    window.toolbarStyle = .unified
    window.titlebarSeparatorStyle = .none
    window.minSize = NSSize(width: 900, height: 560)
    window.tabbingMode = .disallowed
    window.delegate = self
    window.center()
    window.setFrameAutosaveName("studio")

    sidebarItem.viewController.view.identifier = NSUserInterfaceItemIdentifier("sidebar")
    panelItem.viewController.view.identifier = NSUserInterfaceItemIdentifier("inspector")
    sidebarItem.minimumThickness = 208
    sidebarItem.maximumThickness = 340
    sidebarItem.canCollapse = true
    panelItem.minimumThickness = 264
    panelItem.maximumThickness = 400
    panelItem.canCollapse = true
    let canvasItem = NSSplitViewItem(viewController: workbench)
    canvasItem.minimumThickness = 420
    split.splitViewItems = [sidebarItem, canvasItem, panelItem]
    split.splitView.autosaveName = "studio.split"

    root.view = NSView()
    window.contentViewController = root
    window.setContentSize(NSSize(width: 1440, height: 900))

    toolbar.delegate = self
    toolbar.displayMode = .iconOnly
    window.toolbar = toolbar
    model.undoManager = window.undoManager

    observers = [
      Observer { [weak self] in self?.showPhase() },
      Observer { [weak self] in self?.refreshToolbar() },
      Observer { [weak self] in self?.applyZen() },
    ]
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  // MARK: Phases

  /// Shows the split once a project is open, and a quiet status screen until then.
  private func showPhase() {
    let ready = model.phase == .ready
    let wanted: NSViewController = ready ? split : status
    if root.children.first !== wanted {
      for child in root.children {
        child.view.removeFromSuperview()
        child.removeFromParent()
      }
      root.addChild(wanted)
      root.view.addSubview(wanted.view)
      wanted.view.pin(to: root.view)
    }
    toolbar.isVisible = ready && !model.zen
    status.refresh()
  }

  // MARK: Toolbar

  func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
    [
      .toggleSidebar, .sidebarTrackingSeparator, .flexibleSpace, .handOff, .night, .zoom, .zen,
      .inspectorTrackingSeparator, .flexibleSpace, .toggleInspector,
    ]
  }

  func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
    toolbarDefaultItemIdentifiers(toolbar)
  }

  func toolbar(
    _ toolbar: NSToolbar, itemForItemIdentifier identifier: NSToolbarItem.Identifier,
    willBeInsertedIntoToolbar flag: Bool
  ) -> NSToolbarItem? {
    switch identifier {
    case .night:
      configure(nightItem, "Night", symbol: "sun.max", #selector(toggleNight(_:)))
      return nightItem
    case .zoom:
      zoomItem.label = "Zoom"
      zoomItem.toolTip = "Zoom"
      zoomItem.showsIndicator = true
      zoomItem.menu = zoomMenu()
      return zoomItem
    case .zen:
      let item = NSToolbarItem(itemIdentifier: identifier)
      configure(item, "Zen", symbol: "viewfinder", #selector(toggleZen(_:)))
      item.toolTip = "Only the canvas (⌘.)"
      return item
    case .handOff:
      handOffItem.label = "Continue in Nyte"
      handOffItem.toolTip = "Nyte is attached to the same host. Open this chat there."
      handOffItem.image = MoonView.image(side: 16)
      handOffItem.target = self
      handOffItem.action = #selector(continueInNyte(_:))
      handOffItem.isBordered = true
      return handOffItem
    default:
      return nil
    }
  }

  private func configure(_ item: NSToolbarItem, _ label: String, symbol: String, _ action: Selector) {
    item.label = label
    item.toolTip = label
    item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)
    item.target = self
    item.action = action
    item.isBordered = true
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

  private func refreshToolbar() {
    zoomItem.title = "\(Int((model.zoom * 100).rounded()))%"
    let night = model.project?.mode == .dark
    nightItem.image = NSImage(systemSymbolName: night ? "moon.fill" : "sun.max", accessibilityDescription: nil)
    nightItem.toolTip = night ? "Show designs by day" : "Show designs by night"
    handOffItem.isHidden = model.nyte == nil
  }

  // MARK: Zen

  /// Puts the chrome away or brings it back as it was. The split view and the toolbar do their
  /// own native animation; the traffic lights fade and come back under the pointer.
  private func applyZen() {
    let zen = model.zen && model.phase == .ready
    guard let window, zen != (beforeZen != nil) else { return }
    let lights = window.standardWindowButton(.closeButton)?.superview

    if zen {
      beforeZen = (sidebarItem.isCollapsed, panelItem.isCollapsed)
      NyteMotion.animate(0.28) {
        sidebarItem.animator().isCollapsed = true
        panelItem.animator().isCollapsed = true
        lights?.animator().alphaValue = 0
      }
      toolbar.isVisible = false
      trackLights(true)
    } else if let before = beforeZen {
      beforeZen = nil
      toolbar.isVisible = true
      trackLights(false)
      NyteMotion.animate(0.28) {
        sidebarItem.animator().isCollapsed = before.sidebar
        panelItem.animator().isCollapsed = before.panel
        lights?.animator().alphaValue = 1
      }
    }
    workbench.zenChanged()
  }

  /// In zen mode the close, minimise and zoom buttons show only while the pointer is near them.
  private func trackLights(_ on: Bool) {
    guard let view = window?.contentView else { return }
    if let lightsTracking { view.removeTrackingArea(lightsTracking) }
    lightsTracking = nil
    guard on else { return }
    let area = NSTrackingArea(
      rect: NSRect(x: 0, y: view.bounds.height - 44, width: 96, height: 44),
      options: [.mouseEnteredAndExited, .activeAlways], owner: self)
    view.addTrackingArea(area)
    lightsTracking = area
  }

  override func mouseEntered(with event: NSEvent) {
    fadeLights(to: 1)
  }

  override func mouseExited(with event: NSEvent) {
    if model.zen { fadeLights(to: 0) }
  }

  private func fadeLights(to alpha: CGFloat) {
    let lights = window?.standardWindowButton(.closeButton)?.superview
    NyteMotion.animate(0.12) { lights?.animator().alphaValue = alpha }
  }

  func windowDidResize(_ notification: Notification) {
    if model.zen { trackLights(true) }
  }

  // MARK: Actions

  @objc func toggleZen(_ sender: Any?) {
    model.zen.toggle()
  }

  @objc func toggleNight(_ sender: Any?) {
    guard let project = model.project else { return }
    project.mode = project.mode == .dark ? .light : .dark
  }

  @objc private func zoomTo(_ sender: NSMenuItem) {
    model.cameraRequest = .zoom(CGFloat(sender.tag) / 100)
  }

  @objc func newChat(_ sender: Any?) {
    model.newChat()
    model.focusComposer()
  }

  @objc func openProject(_ sender: Any?) {
    model.zen = false
    model.chooseWorkspace()
  }

  @objc func installSkill(_ sender: Any?) {
    model.installSkill()
  }

  @objc func focusComposer(_ sender: Any?) {
    model.focusComposer()
  }

  @objc func stopChat(_ sender: Any?) {
    model.stop()
  }

  @objc func continueInNyte(_ sender: Any?) {
    model.openInNyte()
  }

  func validateMenuItem(_ item: NSMenuItem) -> Bool {
    let ready = model.phase == .ready
    switch item.action {
    case #selector(toggleZen(_:)):
      item.title = model.zen ? "Leave Zen Mode" : "Enter Zen Mode"
      return ready
    case #selector(toggleNight(_:)):
      item.title = model.project?.mode == .dark ? "Show Designs by Day" : "Show Designs by Night"
      return ready
    case #selector(stopChat(_:)):
      return model.transcript?.execution.isBusy ?? false
    case #selector(continueInNyte(_:)):
      return model.nyte != nil
    case #selector(newChat(_:)), #selector(focusComposer(_:)), #selector(installSkill(_:)), #selector(zoomTo(_:)):
      return ready
    default:
      return true
    }
  }
}
