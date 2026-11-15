import AppKit
import NyteDesign
import NyteKit

/// What the window shows before a project is open: looking for the host, not finding one, or
/// the host's projects to choose from.
@MainActor
final class StatusViewController: NSViewController {
  private let model: StudioModel
  private let backdrop = NSVisualEffectView()
  private let column = NSStackView()
  private let heading = NSTextField.nyteLabel("", .xl, .semibold)
  private let detail = NSTextField.nyteWrapping("", .base, .contentTertiary)
  private let retry = NSButton(title: "Try Again", target: nil, action: nil)
  private let card = GlassSurface(radius: NyteRadius.panel)
  private let list = NSStackView()
  private var observer: Observer?

  init(model: StudioModel) {
    self.model = model
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  override func loadView() {
    view = NSView()
    backdrop.material = .underWindowBackground
    backdrop.blendingMode = .behindWindow
    backdrop.state = .followsWindowActiveState
    view.addSubview(backdrop)
    backdrop.pin(to: view)

    detail.alignment = .center
    detail.preferredMaxLayoutWidth = 380
    retry.bezelStyle = .push
    retry.controlSize = .large
    retry.keyEquivalent = "\r"
    retry.target = self
    retry.action = #selector(tryAgain(_:))

    list.orientation = .vertical
    list.alignment = .leading
    list.spacing = 2
    card.contentView.addSubview(list)
    list.pin(to: card.contentView, insets: NSEdgeInsets(top: 8, left: 8, bottom: 8, right: 8))
    card.widthAnchor.constraint(equalToConstant: 460).isActive = true

    column.orientation = .vertical
    column.spacing = 10
    column.translatesAutoresizingMaskIntoConstraints = false
    for subview in [MoonView(side: 44), heading, detail, card, retry] as [NSView] { column.addArrangedSubview(subview) }
    column.setCustomSpacing(16, after: column.arrangedSubviews[0])
    column.setCustomSpacing(18, after: detail)
    view.addSubview(column)
    NSLayoutConstraint.activate([
      column.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      column.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -20),
    ])
    observer = Observer { [weak self] in self?.refresh() }
  }

  func refresh() {
    guard isViewLoaded else { return }
    card.isHidden = true
    retry.isHidden = true
    switch model.phase {
    case .connecting, .ready:
      heading.stringValue = "Finding your Nyte host"
      detail.stringValue = ""
    case .unavailable(let message):
      heading.stringValue = "No Nyte host to attach to"
      detail.stringValue = message
      retry.isHidden = false
    case .choosing:
      heading.stringValue = "Open a project"
      detail.stringValue = "These are the projects on \(model.hostName), the same ones Nyte has."
      card.isHidden = false
      for view in list.arrangedSubviews { view.removeFromSuperview() }
      for workspace in model.workspaces {
        let row = ProjectRow(workspace) { [model] in Task { await model.open(workspace) } }
        list.addArrangedSubview(row)
        row.widthAnchor.constraint(equalTo: list.widthAnchor).isActive = true
      }
    }
    detail.isHidden = detail.stringValue.isEmpty
  }

  @objc private func tryAgain(_ sender: Any?) {
    model.start()
  }
}

/// One project in the picker: its name, and where it lives.
private final class ProjectRow: NSButton {
  private let choose: () -> Void
  private var hovered = false
  private var tracking: NSTrackingArea?

  init(_ workspace: WorkspaceInfo, choose: @escaping () -> Void) {
    self.choose = choose
    super.init(frame: .zero)
    isBordered = false
    title = ""
    translatesAutoresizingMaskIntoConstraints = false
    target = self
    action = #selector(pressed(_:))
    setAccessibilityLabel(workspace.name)

    let icon = NSImageView(image: NSImage(systemSymbolName: "folder", accessibilityDescription: nil) ?? NSImage())
    icon.contentTintColor = .nyte(.contentTertiary)
    let name = NSTextField.nyteLabel(workspace.name, .base, .medium)
    let path = NSTextField.nyteLabel(workspace.path ?? "", .sm, .regular, .contentTertiary)
    path.lineBreakMode = .byTruncatingHead
    path.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    name.setContentCompressionResistancePriority(.required, for: .horizontal)
    let stack = NSStackView(views: [icon, name, NSView(), path])
    stack.spacing = 8
    addSubview(stack)
    stack.pin(to: self, insets: NSEdgeInsets(top: 0, left: 10, bottom: 0, right: 10))
    heightAnchor.constraint(equalToConstant: 32).isActive = true
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  @objc private func pressed(_ sender: Any?) {
    choose()
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let tracking { removeTrackingArea(tracking) }
    let area = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
    addTrackingArea(area)
    tracking = area
  }

  override func mouseEntered(with event: NSEvent) {
    hovered = true
    needsDisplay = true
  }

  override func mouseExited(with event: NSEvent) {
    hovered = false
    needsDisplay = true
  }

  override func draw(_ dirtyRect: NSRect) {
    guard hovered || isHighlighted else { return }
    NSColor.nyte(isHighlighted ? .fillSecondary : .fillTertiary).setFill()
    NSBezierPath(roundedRect: bounds, xRadius: NyteRadius.md, yRadius: NyteRadius.md).fill()
  }
}
