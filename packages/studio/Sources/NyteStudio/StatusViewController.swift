import AppKit
import NyteDesign
import NyteKit

@MainActor
final class StatusViewController: NSViewController {
  private let model: StudioModel
  private let backdrop = NSVisualEffectView()
  private let column = NSStackView.column(gap: .s3, align: .centerX)
  private let heading = NSTextField.nyteLabel("", .xl, .semibold)
  private let detail = NSTextField.nyteWrapping("", .base, .contentSecondary)
  private let retry = NSButton(title: "Try Again", target: nil, action: nil)
  private let card = GlassSurface(.radius(.surface))
  private let list = NSStackView.column(gap: .s0_5)
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
    detail.preferredMaxLayoutWidth = NyteMetric.picker.rawValue
    retry.bezelStyle = .push
    retry.controlSize = NyteControl.md.system
    retry.keyEquivalent = "\r"
    retry.target = self
    retry.action = #selector(tryAgain(_:))

    card.contentView.addSubview(list)
    list.pin(to: card.contentView, insets: .all(.s2))
    card.width(.picker)

    let mark = MoonView(NyteMetric.hero)
    for subview in [mark, heading, detail, card, retry] as [NSView] { column.addArrangedSubview(subview) }
    column.setCustomSpacing(NyteSpace.s4.rawValue, after: mark)
    column.setCustomSpacing(NyteSpace.s5.rawValue, after: detail)
    view.addSubview(column)
    NSLayoutConstraint.activate([
      column.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      column.centerYAnchor.above(view.centerYAnchor, .s5),
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
    let path = NSTextField.nyteLabel(workspace.path ?? "", .sm, .regular, .contentSecondary)
    path.toolTip = workspace.path
    path.lineBreakMode = .byTruncatingHead
    path.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    name.setContentCompressionResistancePriority(.required, for: .horizontal)
    icon.widthAnchor.constraint(equalToConstant: NyteGlyph.md.rawValue).isActive = true
    let stack = NSStackView.row(gap: .s2, [icon, name, .spacer(), path])
    addSubview(stack)
    stack.pin(to: self, insets: NyteInsets(horizontal: .s3))
    height(.lg)
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
    NSBezierPath(roundedRect: bounds, xRadius: NyteRadius.control.rawValue, yRadius: NyteRadius.control.rawValue).fill()
  }
}
