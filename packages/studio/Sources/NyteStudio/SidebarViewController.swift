import AppKit
import NyteDesign
import NyteKit

/// One row of the sidebar outline.
private final class SidebarNode: NSObject {
  enum Kind: Equatable {
    case group(String)
    case folder(String)
    case file(path: String, frames: Int, broken: Bool)
    case newChat
    case chat(id: String, busy: Bool)
  }

  let kind: Kind
  let title: String
  var children: [SidebarNode] = []

  init(_ kind: Kind, title: String) {
    self.kind = kind
    self.title = title
  }
}

/// The project's design files and chats, in a native source list. A file is a place on the
/// canvas: choosing one moves the camera there, it doesn't swap a document.
@MainActor
final class SidebarViewController: NSViewController, NSOutlineViewDataSource, NSOutlineViewDelegate {
  private let model: StudioModel
  private let outline = NSOutlineView()
  private let project = NSPopUpButton(frame: .zero, pullsDown: true)
  private let statusDot = NSView()
  private let statusLabel = NSTextField.nyteLabel("", .sm, .regular, .contentTertiary)
  private var roots: [SidebarNode] = []
  private var signature = ""
  private var observers: [Observer] = []

  init(model: StudioModel) {
    self.model = model
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  override func loadView() {
    view = NSView()

    project.isBordered = false
    project.font = .nyte(.base, .semibold)
    project.translatesAutoresizingMaskIntoConstraints = false
    project.toolTip = "Open another project"
    (project.cell as? NSPopUpButtonCell)?.arrowPosition = .arrowAtBottom

    let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("main"))
    column.resizingMask = .autoresizingMask
    outline.columnAutoresizingStyle = .lastColumnOnlyAutoresizingStyle
    outline.addTableColumn(column)
    outline.outlineTableColumn = column
    outline.headerView = nil
    outline.style = .sourceList
    outline.rowSizeStyle = .default
    outline.indentationPerLevel = 12
    outline.floatsGroupRows = false
    outline.dataSource = self
    outline.delegate = self
    outline.target = self
    outline.action = #selector(rowClicked(_:))

    let scroll = NSScrollView()
    scroll.documentView = outline
    scroll.drawsBackground = false
    scroll.hasVerticalScroller = true
    scroll.automaticallyAdjustsContentInsets = true
    scroll.translatesAutoresizingMaskIntoConstraints = false

    statusDot.wantsLayer = true
    statusDot.layer?.cornerRadius = 3.5
    statusDot.translatesAutoresizingMaskIntoConstraints = false
    let footer = NSStackView(views: [statusDot, statusLabel])
    footer.spacing = 7
    footer.edgeInsets = NSEdgeInsets(top: 0, left: 16, bottom: 0, right: 12)
    footer.translatesAutoresizingMaskIntoConstraints = false

    for subview in [project, scroll, footer] as [NSView] { view.addSubview(subview) }
    let safe = view.safeAreaLayoutGuide
    NSLayoutConstraint.activate([
      project.topAnchor.constraint(equalTo: safe.topAnchor, constant: 2),
      project.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 10),
      project.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -10),
      scroll.topAnchor.constraint(equalTo: project.bottomAnchor, constant: 4),
      scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      scroll.bottomAnchor.constraint(equalTo: footer.topAnchor),
      footer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      footer.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      footer.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      footer.heightAnchor.constraint(equalToConstant: 32),
      statusDot.widthAnchor.constraint(equalToConstant: 7),
      statusDot.heightAnchor.constraint(equalToConstant: 7),
    ])

    observers = [
      Observer { [weak self] in self?.refreshProject() },
      Observer { [weak self] in self?.refreshRows() },
      Observer { [weak self] in self?.refreshStatus() },
    ]
  }

  override func viewDidLayout() {
    super.viewDidLayout()
    outline.sizeLastColumnToFit()
  }

  // MARK: Following the model

  private func refreshProject() {
    let menu = NSMenu()
    let title = NSMenuItem(title: model.workspace?.name ?? "Project", action: nil, keyEquivalent: "")
    title.image = MoonView.image(side: 16)
    menu.addItem(title)
    for workspace in model.workspaces {
      let item = NSMenuItem(title: workspace.name, action: #selector(chooseProject(_:)), keyEquivalent: "")
      item.target = self
      item.representedObject = workspace.id
      item.toolTip = workspace.path
      item.state = workspace.id == model.workspace?.id ? .on : .off
      menu.addItem(item)
    }
    project.menu = menu
  }

  private func refreshStatus() {
    statusDot.layer?.backgroundColor = (model.online
      ? NyteRole.contentQuaternary.color(hue: .green) : NyteRole.contentQuaternary.color()).cgColor
    statusLabel.stringValue = model.online ? model.hostName : "Reconnecting"
    statusLabel.toolTip = model.online
      ? "Attached to the Nyte host on \(model.hostName). Chats, models and files all come from it."
      : "The host went away. Studio keeps trying."
  }

  /// Rebuilds the outline when what it lists changed, and follows the selection either way.
  private func refreshRows() {
    let files = model.project?.files ?? []
    let sheets = model.project?.sheets ?? []
    let sessions = model.sessions
    let next = buildRoots(files: files, sheets: sheets, sessions: sessions)
    let nextSignature = describe(next)
    if nextSignature != signature {
      signature = nextSignature
      roots = next
      outline.reloadData()
      outline.expandItem(nil, expandChildren: true)
    }
    select()
  }

  private func buildRoots(files: [String], sheets: [SheetModel], sessions: [SessionInfo]) -> [SidebarNode] {
    let designs = SidebarNode(.group("Designs"), title: "Designs")
    var folders: [String: SidebarNode] = [:]
    for path in files {
      let parts = path.split(separator: "/").map(String.init)
      var parent = designs
      var prefix = ""
      for folder in parts.dropLast() {
        prefix += folder + "/"
        if let known = folders[prefix] {
          parent = known
          continue
        }
        let node = SidebarNode(.folder(prefix), title: folder)
        folders[prefix] = node
        parent.children.append(node)
        parent = node
      }
      let sheet = sheets.first { $0.path == path }
      parent.children.append(
        SidebarNode(
          .file(path: path, frames: sheet?.frames.count ?? 0, broken: sheet?.error != nil),
          title: String(parts.last?.dropLast(5) ?? "")))
    }

    let chats = SidebarNode(.group("Chats"), title: "Chats")
    chats.children.append(SidebarNode(.newChat, title: "New Chat"))
    for session in sessions {
      chats.children.append(
        SidebarNode(.chat(id: session.id, busy: session.execution.isBusy), title: session.name ?? "New chat"))
    }
    return [designs, chats]
  }

  private func describe(_ nodes: [SidebarNode]) -> String {
    nodes.map { "\($0.kind)|\($0.title)[\(describe($0.children))]" }.joined(separator: ",")
  }

  private func select() {
    var wanted: SidebarNode?
    func find(_ nodes: [SidebarNode]) {
      for node in nodes {
        switch node.kind {
        case .chat(let id, _) where model.panel == .chat && id == model.transcript?.session: wanted = node
        case .file(let path, _, _) where wanted == nil && path == model.selection?.sheet: wanted = node
        default: break
        }
        find(node.children)
      }
    }
    find(roots)
    let row = wanted.map { outline.row(forItem: $0) } ?? -1
    if row >= 0 {
      if outline.selectedRow != row { outline.selectRowIndexes([row], byExtendingSelection: false) }
    } else if outline.selectedRow >= 0 {
      outline.deselectAll(nil)
    }
  }

  // MARK: Actions

  @objc private func chooseProject(_ sender: NSMenuItem) {
    guard let id = sender.representedObject as? String, let workspace = model.workspaces.first(where: { $0.id == id })
    else { return }
    Task { await model.open(workspace) }
  }

  @objc private func rowClicked(_ sender: Any?) {
    guard let node = outline.item(atRow: outline.clickedRow) as? SidebarNode else { return }
    switch node.kind {
    case .file(let path, let frames, _):
      guard frames > 0 else { return }
      model.selection = nil
      model.cameraRequest = .sheet(path)
    case .chat(let id, _):
      model.openSession(id)
    case .newChat:
      model.newChat()
      model.focusComposer()
    case .group, .folder:
      break
    }
  }

  // MARK: Outline

  func outlineView(_ outlineView: NSOutlineView, numberOfChildrenOfItem item: Any?) -> Int {
    (item as? SidebarNode)?.children.count ?? roots.count
  }

  func outlineView(_ outlineView: NSOutlineView, child index: Int, ofItem item: Any?) -> Any {
    (item as? SidebarNode)?.children[index] ?? roots[index]
  }

  func outlineView(_ outlineView: NSOutlineView, isItemExpandable item: Any) -> Bool {
    !((item as? SidebarNode)?.children.isEmpty ?? true)
  }

  func outlineView(_ outlineView: NSOutlineView, isGroupItem item: Any) -> Bool {
    if case .group = (item as? SidebarNode)?.kind { return true }
    return false
  }

  func outlineView(_ outlineView: NSOutlineView, shouldSelectItem item: Any) -> Bool {
    switch (item as? SidebarNode)?.kind {
    case .file, .chat: return true
    default: return false
    }
  }

  func outlineView(_ outlineView: NSOutlineView, viewFor tableColumn: NSTableColumn?, item: Any) -> NSView? {
    guard let node = item as? SidebarNode else { return nil }
    let identifier = NSUserInterfaceItemIdentifier("row")
    let cell = (outlineView.makeView(withIdentifier: identifier, owner: self) as? SidebarCell) ?? SidebarCell(identifier)
    cell.show(node.title, kind: node.kind)
    return cell
  }
}

private final class SidebarCell: NSTableCellView {
  private let icon = NSImageView()
  private let label = NSTextField(labelWithString: "")
  private let badge = NSTextField.nyteLabel("", .sm, .regular, .contentTertiary)
  private let spinner = NSProgressIndicator()
  private let warning = NSImageView()

  init(_ identifier: NSUserInterfaceItemIdentifier) {
    super.init(frame: .zero)
    self.identifier = identifier
    imageView = icon
    textField = label
    label.lineBreakMode = .byTruncatingMiddle
    spinner.style = .spinning
    spinner.controlSize = .small
    spinner.isDisplayedWhenStopped = false
    warning.image = NSImage(systemSymbolName: "exclamationmark.triangle.fill", accessibilityDescription: "Has an error")
    warning.contentTintColor = .systemOrange
    warning.toolTip = "This file has an error. The canvas shows its last good version."
    badge.setContentCompressionResistancePriority(.required, for: .horizontal)
    label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

    let stack = NSStackView(views: [icon, label, NSView(), badge, spinner, warning])
    stack.spacing = 6
    stack.setHuggingPriority(.defaultLow, for: .horizontal)
    addSubview(stack)
    stack.pin(to: self, insets: NSEdgeInsets(top: 0, left: 2, bottom: 0, right: 6))
    NSLayoutConstraint.activate([
      icon.widthAnchor.constraint(equalToConstant: 16),
      spinner.widthAnchor.constraint(equalToConstant: 14),
      spinner.heightAnchor.constraint(equalToConstant: 14),
    ])
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  func show(_ title: String, kind: SidebarNode.Kind) {
    label.stringValue = title
    badge.isHidden = true
    warning.isHidden = true
    spinner.stopAnimation(nil)
    icon.isHidden = false
    let symbol: String?
    switch kind {
    case .group:
      symbol = nil
      icon.isHidden = true
    case .folder:
      symbol = "folder"
    case .file(_, let frames, let broken):
      symbol = frames == 0 ? "paintpalette" : "rectangle.on.rectangle"
      badge.stringValue = "\(frames)"
      badge.isHidden = frames == 0 || broken
      warning.isHidden = !broken
    case .newChat:
      symbol = "plus"
    case .chat(_, let busy):
      symbol = "bubble.left"
      if busy { spinner.startAnimation(nil) }
    }
    icon.image = symbol.flatMap { NSImage(systemSymbolName: $0, accessibilityDescription: nil) }
  }
}
