import AppKit
import NyteDesign
import NyteKit

@MainActor
final class StudioWindowController: NSWindowController, NSWindowDelegate, NSMenuItemValidation {
  private let model: StudioModel
  private let root = NSViewController()
  private let split = SidesViewController()
  private let status: StatusViewController
  private let workbench: WorkbenchViewController
  private let sidebarItem: NSSplitViewItem
  private let panelItem: NSSplitViewItem
  private var bar: StudioToolbar?
  private var observers: [Observer] = []
  private var beforeZen: (sidebar: Bool, panel: Bool)?
  private var lightsTracking: NSTrackingArea?
  private var panelWatch: NSKeyValueObservation?
  private var chatRequests = 0
  private static let splitAutosave = "studio.split"

  init(model: StudioModel) {
    self.model = model
    status = StatusViewController(model: model)
    workbench = WorkbenchViewController(model: model)
    sidebarItem = NSSplitViewItem(sidebarWithViewController: SidebarViewController(model: model))
    panelItem = NSSplitViewItem(inspectorWithViewController: PanelViewController(model: model))

    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: NyteMetric.windowWidth.rawValue, height: NyteMetric.windowHeight.rawValue),
      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered,
      defer: false)
    super.init(window: window)

    window.title = "Nyte Studio"
    window.titleVisibility = .hidden
    window.toolbarStyle = .unified
    window.titlebarAppearsTransparent = true
    window.titlebarSeparatorStyle = .none
    window.backgroundColor = CanvasView.desk
    window.minSize = NSSize(width: NyteMetric.windowMinWidth.rawValue, height: NyteMetric.windowMinHeight.rawValue)
    window.tabbingMode = .disallowed
    window.delegate = self
    window.center()
    window.setFrameAutosaveName("studio")

    sidebarItem.viewController.view.identifier = NSUserInterfaceItemIdentifier("sidebar")
    panelItem.viewController.view.identifier = NSUserInterfaceItemIdentifier("inspector")
    sidebarItem.minimumThickness = NyteMetric.sidebarMin.rawValue
    sidebarItem.maximumThickness = NyteMetric.sidebarMax.rawValue
    sidebarItem.canCollapse = true
    panelItem.minimumThickness = NyteMetric.inspectorMin.rawValue
    panelItem.maximumThickness = NyteMetric.inspectorMax.rawValue
    panelItem.canCollapse = true
    let canvasItem = NSSplitViewItem(viewController: workbench)
    canvasItem.minimumThickness = NyteMetric.canvasMin.rawValue
    split.splitViewItems = [sidebarItem, canvasItem, panelItem]
    split.splitView.autosaveName = StudioWindowController.splitAutosave

    let bar = StudioToolbar(model: model, split: split.splitView)
    window.toolbar = bar.toolbar
    self.bar = bar

    root.view = NSView()
    window.contentViewController = root
    window.setContentSize(NSSize(width: NyteMetric.windowWidth.rawValue, height: NyteMetric.windowHeight.rawValue))

    model.undoManager = window.undoManager

    panelWatch = panelItem.observe(\.isCollapsed, options: [.initial, .new]) { _, change in
      let shown = change.newValue == false
      MainActor.assumeIsolated { model.inspectorShown = shown }
    }
    observers = [
      Observer { [weak self] in self?.showPhase() },
      Observer { [weak self] in self?.applyZen() },
      Observer { [weak self] in self?.showToolbar() },
      Observer { [weak self] in self?.showChat() },
    ]
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  // MARK: Phases

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
    status.refresh()
  }

  // MARK: Zen

  private func showToolbar() {
    let shown = model.phase == .ready && !model.zen
    if window?.toolbar?.isVisible != shown { window?.toolbar?.isVisible = shown }
  }

  private func applyZen() {
    let zen = model.zen && model.phase == .ready
    guard let window, zen != (beforeZen != nil) else { return }
    let lights = window.standardWindowButton(.closeButton)?.superview

    if zen {
      beforeZen = (sidebarItem.isCollapsed, panelItem.isCollapsed)
      split.splitView.autosaveName = nil
      sidebarItem.isCollapsed = true
      panelItem.isCollapsed = true
      if let lights { NyteMotion.fade(lights, to: 0, .normal) }
      trackLights(true)
    } else if let before = beforeZen {
      beforeZen = nil
      trackLights(false)
      sidebarItem.isCollapsed = before.sidebar
      panelItem.isCollapsed = before.panel
      split.splitView.autosaveName = StudioWindowController.splitAutosave
      if let lights { NyteMotion.fade(lights, to: 1, .slow) }
    }
    workbench.zenChanged()
  }

  private func showChat() {
    let requests = model.chatRequests
    guard requests != chatRequests else { return }
    chatRequests = requests
    if panelItem.isCollapsed { panelItem.isCollapsed = false }
  }

  private func trackLights(_ on: Bool) {
    guard let view = window?.contentView else { return }
    if let lightsTracking { view.removeTrackingArea(lightsTracking) }
    lightsTracking = nil
    guard on else { return }
    let zone = NSSize(width: NyteMetric.lightsZoneWidth.rawValue, height: NyteMetric.lightsZoneHeight.rawValue)
    let area = NSTrackingArea(
      rect: NSRect(x: 0, y: view.bounds.height - zone.height, width: zone.width, height: zone.height),
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
    guard let lights = window?.standardWindowButton(.closeButton)?.superview else { return }
    NyteMotion.fade(lights, to: alpha, .fast)
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
    case #selector(newChat(_:)), #selector(focusComposer(_:)), #selector(installSkill(_:)):
      return ready
    default:
      return true
    }
  }
}

private final class SidesViewController: NSSplitViewController {
  override func toggleSidebar(_ sender: Any?) {
    guard cuts, let side = splitViewItems.first(where: { $0.behavior == .sidebar }) else {
      super.toggleSidebar(sender)
      return
    }
    side.isCollapsed.toggle()
  }

  override func toggleInspector(_ sender: Any?) {
    guard cuts, let side = splitViewItems.first(where: { $0.behavior == .inspector }) else {
      super.toggleInspector(sender)
      return
    }
    side.isCollapsed.toggle()
  }

  private var cuts: Bool { NSApp.currentEvent?.type == .keyDown || NyteMotion.reduced }
}
