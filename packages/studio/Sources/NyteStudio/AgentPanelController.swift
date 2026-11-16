import AppKit
import NyteDesign
import NyteKit

@MainActor
final class AgentPanelController: NSViewController {
  private let model: StudioModel
  private let column = NSStackView.column(gap: .s3)
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
    view.addSubview(column)
    column.pin(to: view, insets: .all(.s4))
    column.width(.agentPanel)
    observer = Observer { [weak self] in self?.refresh() }
  }

  private func refresh() {
    for row in column.arrangedSubviews { row.removeFromSuperview() }

    add(
      AgentRow(
        mark: MoonView.image(.lg), title: "Nyte",
        status: model.online
          ? ("Connected · \(model.hostName)", .green)
          : (model.offlineReason.map { "Reconnecting. \($0)" } ?? "Reconnecting…", .orange),
        action: (model.transcript == nil ? "Open Nyte" : "Continue in Nyte", #selector(openNyte(_:))), target: self))

    section("Providers")
    let providers = Dictionary(grouping: model.models, by: \.provider)
    if providers.isEmpty {
      add(
        AgentRow(
          symbol: "person.crop.circle.badge.questionmark", title: "No provider yet",
          status: ("Sign in to one in Nyte, and its models are here too.", nil), action: nil, target: nil))
    }
    for (provider, models) in providers.sorted(by: { $0.key < $1.key }) {
      let names = models.map(\.name).sorted()
      let row = AgentRow(
        symbol: "cpu", title: AgentPanelController.name(of: provider),
        status: (names.count == 1 ? names[0] : "\(names.count) models", nil), action: nil, target: nil)
      row.toolTip = names.joined(separator: "\n")
      add(row)
    }

    section("This Project")
    switch model.skill {
    case .current:
      add(skill(("In this project. Any agent here can read and write designs.", .green), action: nil))
    case .outdated:
      add(skill(("An older version is in this project.", .orange), action: "Update"))
    case .missing:
      add(skill(("Not in this project. Chats started in Studio learn it anyway.", nil), action: "Add"))
    case .unknown:
      add(skill(("Checking…", nil), action: nil))
    }
  }

  private func skill(_ status: (String, NyteHue?), action: String?) -> AgentRow {
    AgentRow(
      symbol: "doc.text", title: "Lune Skill", status: status,
      action: action.map { ($0, #selector(installSkill(_:))) }, target: self)
  }

  private func add(_ row: NSView) {
    column.add(row)
    row.matchWidth(of: column)
  }

  private func section(_ title: String) {
    column.gapAfterLast(.s4)
    column.add(NSTextField.nyteLabel(title, .sm, .semibold, .contentSecondary))
  }

  private static func name(of provider: String) -> String {
    let known = [
      "anthropic": "Anthropic", "openai": "OpenAI", "openai-codex": "OpenAI Codex", "google": "Google",
      "xai": "xAI", "openrouter": "OpenRouter", "github-copilot": "GitHub Copilot", "ollama": "Ollama",
    ]
    return known[provider] ?? provider.split(separator: "-").map(\.capitalized).joined(separator: " ")
  }

  @objc private func openNyte(_ sender: Any?) {
    model.openInNyte()
  }

  @objc private func installSkill(_ sender: Any?) {
    model.installSkill()
  }
}

private final class AgentRow: NSView {
  init(
    mark: NSImage? = nil, symbol: String? = nil, title: String, status: (text: String, hue: NyteHue?),
    action: (title: String, selector: Selector)?, target: AnyObject?
  ) {
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false

    let icon = NSImageView()
    icon.image = mark ?? symbol.flatMap { NSImage(systemSymbolName: $0, accessibilityDescription: nil) }
    icon.symbolConfiguration = .init(pointSize: NyteGlyph.md.pointSize, weight: .regular)
    icon.contentTintColor = .nyte(.contentSecondary)
    icon.square(NyteGlyph.lg)

    let name = NSTextField.nyteLabel(title, .base, .medium)
    let state = NSTextField.nyteWrapping(status.text, .sm, .contentSecondary)
    if let hue = status.hue { state.textColor = .nyte(.contentAccent, hue: hue) }
    let words = NSStackView.column(gap: .s0_5, [name, state])
    words.setContentHuggingPriority(.defaultLow, for: .horizontal)
    state.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

    var views: [NSView] = [icon, words, .spacer()]
    if let action {
      let button = NSButton(title: action.title, target: target, action: action.selector)
      button.bezelStyle = .push
      button.controlSize = NyteControl.sm.system
      button.setContentCompressionResistancePriority(.required, for: .horizontal)
      button.setContentHuggingPriority(.required, for: .horizontal)
      views.append(button)
    }
    let row = NSStackView.row(gap: .s3, align: .top, views)
    addSubview(row)
    row.pin(to: self)
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }
}
