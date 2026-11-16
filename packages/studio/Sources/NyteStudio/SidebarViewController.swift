import AppKit
import NyteDesign
import NyteKit

enum ChatState: Equatable {
  case idle
  case working
  case waiting
  case failed(String)

  init(_ execution: Execution) {
    switch execution {
    case .idle(let failed): self = failed.map(ChatState.failed) ?? .idle
    case .waiting: self = .waiting
    case .responding, .executing, .retrying: self = .working
    }
  }
}

private final class SidebarNode: NSObject {
  enum Kind: Equatable {
    case group(String)
    case file(path: String, frames: Int, broken: Bool)
    case newChat
    case chat(id: String, state: ChatState)
  }

  let kind: Kind
  let title: String
  var children: [SidebarNode] = []

  init(_ kind: Kind, title: String) {
    self.kind = kind
    self.title = title
  }
}

@MainActor
final class SidebarViewController: NSViewController, NSOutlineViewDataSource, NSOutlineViewDelegate {
  private let model: StudioModel
  private let outline = NSOutlineView()
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

    let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("main"))
    column.resizingMask = .autoresizingMask
    outline.columnAutoresizingStyle = .lastColumnOnlyAutoresizingStyle
    outline.addTableColumn(column)
    outline.outlineTableColumn = column
    outline.headerView = nil
    outline.style = .sourceList
    outline.rowSizeStyle = .default
    outline.indentationPerLevel = NyteSpace.s3.rawValue
    outline.floatsGroupRows = false
    outline.dataSource = self
    outline.delegate = self
    outline.target = self
    outline.action = #selector(rowClicked(_:))
    outline.setAccessibilityLabel("Designs and chats")

    let scroll = NSScrollView()
    scroll.documentView = outline
    scroll.drawsBackground = false
    scroll.hasVerticalScroller = true
    scroll.automaticallyAdjustsContentInsets = true

    view.addSubview(scroll)
    scroll.pin(to: view)

    observers = [
      Observer { [weak self] in self?.refreshRows() },
    ]
  }

  override func viewDidLayout() {
    super.viewDidLayout()
    outline.sizeLastColumnToFit()
  }

  // MARK: Following the model

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
    let kinds = ["Controls", "Blocks", "Screens"]
    var groups: [String: [String]] = [:]
    for path in files {
      let parts = path.lowercased().split(separator: "/").map { String($0.hasSuffix(".lune") ? $0.dropLast(5) : $0) }
      let kind = parts.reversed().lazy.compactMap { part in kinds.first { $0.lowercased() == part } }.first ?? "Other"
      groups[kind, default: []].append(path)
    }
    let names = files.map { URL(filePath: $0).deletingPathExtension().lastPathComponent }
    var roots: [SidebarNode] = []
    for kind in kinds + ["Other"] {
      guard let paths = groups[kind] else { continue }
      let group = SidebarNode(.group(kind), title: kind)
      for path in paths.sorted(by: { $0.localizedStandardCompare($1) == .orderedAscending }) {
        let url = URL(filePath: path)
        let name = url.deletingPathExtension().lastPathComponent
        let title = names.filter { $0 == name }.count > 1
          ? "\(name) · \(url.deletingLastPathComponent().lastPathComponent)" : name
        let sheet = sheets.first { $0.path == path }
        group.children.append(
          SidebarNode(.file(path: path, frames: sheet?.frames.count ?? 0, broken: sheet?.error != nil), title: title))
      }
      roots.append(group)
    }

    let chats = SidebarNode(.group("Chats"), title: "Chats")
    chats.children.append(SidebarNode(.newChat, title: "New Chat"))
    for session in sessions {
      chats.children.append(
        SidebarNode(.chat(id: session.id, state: ChatState(session.execution)), title: session.name ?? "New chat"))
    }
    return roots + [chats]
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
    case .group:
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
    textField = label
    label.lineBreakMode = .byTruncatingMiddle
    spinner.style = .spinning
    spinner.controlSize = .small
    warning.symbolConfiguration = .init(pointSize: NyteGlyph.sm.pointSize, weight: .medium)
    badge.setContentCompressionResistancePriority(.required, for: .horizontal)
    label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

    let stack = NSStackView.row(gap: .s1_5, [icon, label, .spacer(), badge, spinner, warning])
    stack.setHuggingPriority(.defaultLow, for: .horizontal)
    addSubview(stack)
    stack.pin(to: self, insets: NyteInsets(leading: .s0_5, trailing: .s1_5))
    icon.widthAnchor.constraint(equalToConstant: NyteGlyph.md.rawValue).isActive = true
    spinner.square(NyteGlyph.sm)
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  func show(_ title: String, kind: SidebarNode.Kind) {
    label.stringValue = title
    badge.isHidden = true
    warning.isHidden = true
    spinner.isHidden = true
    spinner.stopAnimation(nil)
    icon.isHidden = false
    let symbol: String?
    switch kind {
    case .group:
      symbol = nil
      icon.isHidden = true
    case .file(_, let frames, let broken):
      symbol = frames == 0 ? "paintpalette" : "rectangle.on.rectangle"
      badge.stringValue = "\(frames)"
      badge.isHidden = frames == 0 || broken
      if broken {
        mark("exclamationmark.triangle.fill", .orange, "This file has an error. The canvas shows its last good version.")
      }
    case .newChat:
      symbol = "plus"
    case .chat(_, let state):
      symbol = "bubble.left"
      switch state {
      case .idle: break
      case .working:
        spinner.isHidden = false
        spinner.startAnimation(nil)
      case .waiting: mark("questionmark.bubble.fill", .blue, "Waiting for your answer.")
      case .failed(let reason): mark("exclamationmark.triangle.fill", .orange, "Stopped: \(reason)")
      }
    }
    icon.image = symbol.flatMap { NSImage(systemSymbolName: $0, accessibilityDescription: nil) }
  }

  private func mark(_ symbol: String, _ hue: NyteHue, _ meaning: String) {
    warning.image = NSImage(systemSymbolName: symbol, accessibilityDescription: meaning)
    warning.contentTintColor = .nyte(.contentAccent, hue: hue)
    warning.toolTip = meaning
    warning.isHidden = false
  }
}
