import AppKit
import NyteDesign
import NyteKit

@MainActor
final class ChatViewController: NSViewController {
  private let model: StudioModel
  private let scroll = NSScrollView()
  private let stack = NSStackView()
  private let placeholder = NSStackView()
  private let chats = MenuButton(label: "Chats", size: .md, text: .base, weight: .medium, role: .contentPrimary)
  private lazy var add = GhostButton(symbol: "plus", label: "New Chat", size: .sm, target: self, action: #selector(newChat(_:)))
  private lazy var agent = GhostButton(
    symbol: "cable.connector", label: "Agent", size: .sm, target: self, action: #selector(showAgent(_:)))
  private let popover = NSPopover()
  private let composer: ComposerView
  private let box = ComposerBox()
  private var rows: [String: NSView] = [:]
  private var order: [String] = []
  private var focusCount = 0
  private var observers: [Observer] = []

  init(model: StudioModel) {
    self.model = model
    composer = ComposerView(model: model)
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  override func loadView() {
    view = NSView()
    let inset = PanelViewController.inset
    stack.orientation = .vertical
    stack.alignment = .leading
    stack.spacing = NyteSpace.s3.rawValue
    stack.pad(NyteInsets(top: .s1, leading: inset, bottom: .s4, trailing: inset))
    let document = FlippedView()
    document.translatesAutoresizingMaskIntoConstraints = false
    document.addSubview(stack)
    stack.pin(to: document)
    scroll.documentView = document
    scroll.drawsBackground = false
    scroll.hasVerticalScroller = true
    let actions = NSStackView.row(gap: .s0_5, [add, agent])
    box.hold(composer)
    composer.onCancel = { [model] in model.focusCanvas() }
    for subview in [chats, actions, scroll, box] as [NSView] { view.addSubview(subview) }
    scroll.pin(to: view, edges: [.leading, .trailing])
    box.pin(to: view, insets: NyteInsets(leading: .s3, bottom: .s3, trailing: .s3), edges: [.leading, .trailing, .bottom])
    NSLayoutConstraint.activate([
      scroll.bottomAnchor.above(box.topAnchor, .s2),
      chats.topAnchor.constraint(equalTo: view.topAnchor),
      chats.leadingAnchor.after(view.leadingAnchor, .s2),
      chats.trailingAnchor.atLeastBefore(actions.leadingAnchor, .s2),
      actions.centerYAnchor.constraint(equalTo: chats.centerYAnchor),
      actions.trailingAnchor.before(view.trailingAnchor, .s3),
      scroll.topAnchor.below(chats.bottomAnchor, .s2),
    ])
    document.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor).isActive = true
    popover.behavior = .transient
    popover.contentViewController = AgentPanelController(model: model)

    placeholder.orientation = .vertical
    placeholder.spacing = NyteSpace.s2.rawValue
    placeholder.translatesAutoresizingMaskIntoConstraints = false
    placeholder.addArrangedSubview(MoonView(.md))
    placeholder.addArrangedSubview(NSTextField.nyteLabel("Ask Nyte", .base, .medium, .contentPrimary))
    let line = NSTextField.nyteWrapping(
      "Select something on the canvas and say what to change. The chat is a Nyte session, so it is in Nyte too.",
      .sm, .contentSecondary)
    line.alignment = .center
    placeholder.addArrangedSubview(line)
    view.addSubview(placeholder)
    placeholder.pin(to: view, insets: NyteInsets(horizontal: .s6), edges: .horizontal)
    placeholder.centerYAnchor.above(view.centerYAnchor, .s8).isActive = true
    observers = [
      Observer { [weak self] in self?.refresh() },
      Observer { [weak self] in self?.refreshChats() },
      Observer { [weak self] in self?.syncFocus() },
    ]
  }

  @objc private func newChat(_ sender: Any?) {
    model.newChat()
    model.focusComposer()
  }

  @objc private func openChat(_ sender: NSMenuItem) {
    guard let id = sender.representedObject as? String else { return }
    model.openSession(id)
  }

  @objc private func showAgent(_ sender: Any?) {
    popover.animates = !NyteMotion.reduced
    popover.show(relativeTo: agent.bounds, of: agent, preferredEdge: .maxY)
  }

  private func refreshChats() {
    let menu = NSMenu()
    let fresh = NSMenuItem(title: "New Chat", action: #selector(newChat(_:)), keyEquivalent: "")
    fresh.target = self
    fresh.state = model.transcript == nil ? .on : .off
    menu.addItem(fresh)
    if !model.sessions.isEmpty { menu.addItem(.separator()) }
    for session in model.sessions {
      let item = NSMenuItem(title: session.name ?? "New chat", action: #selector(openChat(_:)), keyEquivalent: "")
      item.target = self
      item.representedObject = session.id
      item.state = session.id == model.transcript?.session ? .on : .off
      switch ChatState(session.execution) {
      case .idle: break
      case .working: item.badge = NSMenuItemBadge(string: "Working")
      case .waiting: item.badge = NSMenuItemBadge(string: "Waiting for you")
      case .failed: item.badge = NSMenuItemBadge(string: "Stopped")
      }
      menu.addItem(item)
    }
    chats.menu = menu
    let current = model.sessions.first { $0.id == model.transcript?.session }
    chats.title = model.transcript == nil ? "New Chat" : current?.name ?? "New chat"
  }

  private func syncFocus() {
    let count = model.composerFocus
    guard count != focusCount else { return }
    focusCount = count
    if model.chatShown { composer.focus() }
  }

  private func refresh() {
    guard let transcript = model.transcript else {
      scroll.isHidden = true
      placeholder.isHidden = false
      for row in rows.values { row.removeFromSuperview() }
      rows = [:]
      order = []
      return
    }
    scroll.isHidden = false
    placeholder.isHidden = true

    let clip = scroll.contentView
    let pinned = clip.bounds.maxY >= (scroll.documentView?.frame.height ?? 0) - NyteSpace.s6.rawValue
    let entries = ChatEntry.list(transcript)
    let ids = entries.map(\.id)
    for (id, row) in rows where !ids.contains(id) {
      row.removeFromSuperview()
      rows[id] = nil
    }
    for entry in entries {
      switch entry.body {
      case .user(let words, let attachments):
        row(entry.id, UserRow.init).show(words, attachments)
      case .answer(let markdown):
        row(entry.id, MessageBody.init).show(Markdown.blocks(markdown))
      case .steps(let steps):
        row(entry.id, StepsRow.init).show(steps)
      case .working(let line):
        row(entry.id, StatusRow.init).show(line, failed: false)
      case .failed(let reason):
        row(entry.id, StatusRow.init).show(reason, failed: true)
      }
    }
    if ids != order {
      order = ids
      for view in stack.arrangedSubviews { stack.removeArrangedSubview(view) }
      for id in ids {
        guard let row = rows[id] else { continue }
        stack.addArrangedSubview(row)
        row.matchWidth(of: stack, inset: PanelViewController.inset)
      }
    }

    if pinned {
      view.layoutSubtreeIfNeeded()
      let height = scroll.documentView?.frame.height ?? 0
      clip.scroll(to: NSPoint(x: 0, y: max(0, height - clip.bounds.height)))
      scroll.reflectScrolledClipView(clip)
    }
  }

  private func row<Row: NSView>(_ id: String, _ make: () -> Row) -> Row {
    if let row = rows[id] as? Row { return row }
    rows[id]?.removeFromSuperview()
    order = []
    let row = make()
    rows[id] = row
    return row
  }
}

private struct ChatEntry {
  enum Body {
    case user(String, [String])
    case answer(String)
    case steps([ToolStep])
    case working(String)
    case failed(String)
  }

  let id: String
  let body: Body

  @MainActor
  static func list(_ transcript: Transcript) -> [ChatEntry] {
    var out: [ChatEntry] = []
    for item in transcript.items {
      switch item.body {
      case .user(let words, let attachments):
        out.append(ChatEntry(id: item.id, body: .user(words, attachments)))
      case .answer(let markdown, _):
        if !markdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          out.append(ChatEntry(id: item.id, body: .answer(markdown)))
        }
      case .tool(let step):
        if let last = out.last, case .steps(let steps) = last.body {
          out[out.count - 1] = ChatEntry(id: last.id, body: .steps(steps + [step]))
        } else {
          out.append(ChatEntry(id: item.id, body: .steps([step])))
        }
      case .other(let kind):
        out.append(ChatEntry(id: item.id, body: .failed(kind)))
      case .thinking:
        break
      }
    }
    switch transcript.execution {
    case .idle(let failed?): out.append(ChatEntry(id: "failed", body: .failed(failed)))
    case .idle: break
    case .waiting: out.append(ChatEntry(id: "working", body: .working("Waiting for your answer in Nyte")))
    case .retrying(let reason): out.append(ChatEntry(id: "working", body: .working("Retrying: \(reason)")))
    case .responding, .executing:
      out.append(ChatEntry(id: "working", body: .working(transcript.activity ?? "Thinking")))
    }
    return out
  }
}

private final class UserRow: NSView {
  private let bubble = Bubble()
  private let body = MessageBody()
  private let chips = NSStackView.row(gap: .s1, [])
  private let more = NSButton(title: "Show more", target: nil, action: nil)
  private var natural: NSLayoutConstraint?
  private var clamp: NSLayoutConstraint?
  private var expanded = false

  init() {
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false
    more.isBordered = false
    more.font = .nyte(.sm, .medium)
    more.contentTintColor = .nyte(.contentSecondary)
    more.target = self
    more.action = #selector(toggle(_:))
    let column = NSStackView.column(gap: .s1_5, [chips, body, more])
    bubble.addSubview(column)
    column.pin(to: bubble, insets: NyteInsets(horizontal: .s3, vertical: .s2))
    body.matchWidth(of: column)
    addSubview(bubble)
    bubble.pin(to: self, edges: [.top, .bottom, .trailing])
    let width = bubble.widthAnchor.constraint(equalToConstant: .zero)
    width.priority = .defaultHigh
    natural = width
    let limit = body.heightAnchor.constraint(lessThanOrEqualToConstant: NyteText.base.lineHeight * UserRow.lines)
    clamp = limit
    NSLayoutConstraint.activate([width, bubble.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: NyteSpace.s8.rawValue)])
    body.clipsToBounds = true
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  private static let lines: CGFloat = 8

  func show(_ words: String, _ attachments: [String]) {
    chips.isHidden = attachments.isEmpty
    if chips.arrangedSubviews.count != attachments.count {
      for view in chips.arrangedSubviews { view.removeFromSuperview() }
      for name in attachments { chips.addArrangedSubview(AttachmentChip(name)) }
    }
    body.show(Markdown.blocks(words))
    let text = body.onlyProse?.naturalWidth ?? .greatestFiniteMagnitude
    let chipsWidth = attachments.isEmpty ? 0 : chips.fittingSize.width
    natural?.constant = min(10_000, max(text, chipsWidth)) + NyteSpace.s3.rawValue * 2
    let long = words.count > 600 || words.split(separator: "\n", omittingEmptySubsequences: false).count > Int(UserRow.lines)
    more.isHidden = !long
    clamp?.isActive = long && !expanded
  }

  @objc private func toggle(_ sender: Any?) {
    expanded.toggle()
    more.title = expanded ? "Show less" : "Show more"
    clamp?.isActive = !expanded
  }
}

private final class Bubble: AppearanceView {
  override init(frame: NSRect) {
    super.init(frame: frame)
    translatesAutoresizingMaskIntoConstraints = false
    layer?.cornerRadius = NyteRadius.card.rawValue
    layer?.cornerCurve = .continuous
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  override func applyColors() {
    layer?.backgroundColor = NyteRole.fillTertiary.cgColor(dark: isDark)
  }
}

private final class StepsRow: NSView {
  private let icon = NSImageView()
  private let spinner = NSProgressIndicator()
  private let title = NSTextField.nyteLabel("", .sm, .regular, .contentSecondary)
  private let counts = NSTextField.nyteLabel("", .xs, .medium, .contentTertiary)
  private let chevron = NSImageView()
  private let details = NSStackView.column(gap: .s1_5)
  private var steps: [ToolStep] = []
  private var expanded = false

  init() {
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false
    spinner.style = .spinning
    spinner.controlSize = .small
    spinner.isDisplayedWhenStopped = false
    spinner.square(NyteGlyph.sm)
    icon.symbolConfiguration = .init(pointSize: NyteGlyph.xs.pointSize, weight: .medium)
    icon.square(NyteGlyph.sm)
    chevron.symbolConfiguration = .init(pointSize: NyteGlyph.xxs.pointSize, weight: .semibold)
    chevron.contentTintColor = .nyte(.contentTertiary)
    title.lineBreakMode = .byTruncatingTail
    title.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    counts.setContentCompressionResistancePriority(.required, for: .horizontal)
    let head = NSStackView.row(gap: .s1_5, [icon, spinner, title, NSView.spacer(), counts, chevron])
    head.addGestureRecognizer(NSClickGestureRecognizer(target: self, action: #selector(toggle(_:))))
    head.setAccessibilityElement(true)
    head.setAccessibilityRole(.disclosureTriangle)
    details.pad(NyteInsets(leading: .s5))
    let column = NSStackView.column(gap: .s1_5, [head, details])
    addSubview(column)
    column.pin(to: self)
    head.matchWidth(of: column)
    details.matchWidth(of: column)
    details.isHidden = true
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  func show(_ next: [ToolStep]) {
    guard next != steps else { return }
    steps = next
    let running = next.last { $0.running }
    let failed = next.filter(\.failed).count
    spinner.isHidden = running == nil
    if running != nil {
      icon.isHidden = true
      spinner.startAnimation(nil)
    } else {
      spinner.stopAnimation(nil)
      icon.isHidden = false
      icon.image = NSImage(systemSymbolName: StepsRow.symbol(next[0]), accessibilityDescription: nil)
      icon.contentTintColor = .nyte(.contentTertiary)
    }
    title.stringValue = running.map { StepsRow.title($0) } ?? StepsRow.summary(next)
    let added = next.compactMap(\.added).reduce(0, +)
    let removed = next.compactMap(\.removed).reduce(0, +)
    if failed > 0 {
      counts.stringValue = "\(failed) failed"
      counts.textColor = .nyte(.contentAccent, hue: .red)
    } else {
      counts.stringValue = added + removed > 0 ? "+\(added)  −\(removed)" : ""
      counts.textColor = .nyte(.contentTertiary)
    }
    chevron.isHidden = next.count < 2
    arrange()
  }

  @objc private func toggle(_ sender: Any?) {
    guard steps.count > 1 else { return }
    expanded.toggle()
    arrange()
  }

  private func arrange() {
    chevron.image = NSImage(systemSymbolName: expanded ? "chevron.down" : "chevron.right", accessibilityDescription: nil)
    details.isHidden = !expanded || steps.count < 2
    for view in details.arrangedSubviews { view.removeFromSuperview() }
    guard !details.isHidden else { return }
    for step in steps {
      let mark = NSImageView()
      mark.image = NSImage(systemSymbolName: StepsRow.symbol(step), accessibilityDescription: nil)
      mark.symbolConfiguration = .init(pointSize: NyteGlyph.xs.pointSize, weight: .medium)
      mark.contentTintColor = step.failed ? .nyte(.contentAccent, hue: .red) : .nyte(.contentTertiary)
      mark.square(NyteGlyph.sm)
      let line = NSTextField.nyteLabel(StepsRow.title(step), .sm, .regular, .contentSecondary)
      line.lineBreakMode = .byTruncatingMiddle
      line.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
      details.add(NSStackView.row(gap: .s1_5, [mark, line]))
    }
  }

  private static func symbol(_ step: ToolStep) -> String {
    if step.failed { return "exclamationmark.circle" }
    switch step.kind {
    case "edit": return "pencil"
    case "read": return "doc.text"
    case "list": return "folder"
    case "shell": return "terminal"
    case "delegate": return "person.2"
    default: return "wrench.adjustable"
    }
  }

  private static func title(_ step: ToolStep) -> String {
    let file = step.path.map { URL(filePath: $0).lastPathComponent }
    switch step.kind {
    case "edit": return "\(step.running ? "Editing" : "Edited") \(file ?? "a file")"
    case "read": return "\(step.running ? "Reading" : "Read") \(file ?? "a file")"
    case "list": return "\(step.running ? "Looking" : "Looked") in \(file ?? "a folder")"
    case "shell": return step.label ?? (step.running ? "Running a command" : "Ran a command")
    default: return step.label ?? step.name
    }
  }

  private static func summary(_ steps: [ToolStep]) -> String {
    guard steps.count > 1 else { return steps.first.map(title) ?? "" }
    func part(_ kind: String, _ one: String, _ many: String) -> String? {
      let matching = steps.filter { $0.kind == kind }
      if matching.isEmpty { return nil }
      return matching.count == 1 ? one : "\(many) \(matching.count) \(kind == "shell" ? "commands" : kind == "list" ? "folders" : "files")"
    }
    let known = ["edit", "read", "list", "shell"]
    let rest = steps.filter { !known.contains($0.kind) }.count
    var parts = [
      part("edit", title(steps.first { $0.kind == "edit" } ?? steps[0]), "Edited"),
      part("read", title(steps.first { $0.kind == "read" } ?? steps[0]), "Read"),
      part("list", "Looked in a folder", "Looked in"), part("shell", "Ran a command", "Ran"),
    ].compactMap { $0 }
    if rest > 0 { parts.append(rest == 1 ? "1 other step" : "\(rest) other steps") }
    return parts.enumerated().map { $0.offset == 0 ? $0.element : $0.element.prefix(1).lowercased() + $0.element.dropFirst() }
      .joined(separator: ", ")
  }
}

private final class StatusRow: NSView {
  private let pill = AppearanceTint()
  private let spinner = NSProgressIndicator()
  private let icon = NSImageView()
  private let text = NSTextField.nyteLabel("", .sm, .medium)

  init() {
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false
    spinner.style = .spinning
    spinner.controlSize = .small
    spinner.isDisplayedWhenStopped = false
    spinner.square(NyteGlyph.sm)
    icon.image = NSImage(systemSymbolName: "exclamationmark.circle", accessibilityDescription: nil)
    icon.symbolConfiguration = .init(pointSize: NyteGlyph.xs.pointSize, weight: .medium)
    icon.square(NyteGlyph.sm)
    text.lineBreakMode = .byTruncatingTail
    text.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    let row = NSStackView.row(gap: .s1_5, [spinner, icon, text])
    pill.addSubview(row)
    row.pin(to: pill, insets: NyteInsets(horizontal: .s2_5), edges: .horizontal)
    row.centerYAnchor.constraint(equalTo: pill.centerYAnchor).isActive = true
    pill.height(.md)
    addSubview(pill)
    pill.pin(to: self, edges: [.top, .bottom, .leading])
    pill.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor).isActive = true
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  func show(_ line: String, failed: Bool) {
    let words = line.split(whereSeparator: \.isNewline).first.map(String.init) ?? line
    text.stringValue = failed ? words : words + "…"
    text.toolTip = line
    let hue: NyteHue = failed ? .red : .blue
    text.textColor = .nyte(.contentAccent, hue: hue)
    icon.contentTintColor = .nyte(.contentAccent, hue: hue)
    icon.isHidden = !failed
    spinner.isHidden = failed
    pill.hue = hue
    if failed { spinner.stopAnimation(nil) } else { spinner.startAnimation(nil) }
  }
}

private final class AppearanceTint: AppearanceView {
  var hue: NyteHue = .blue { didSet { applyColors() } }

  override init(frame: NSRect) {
    super.init(frame: frame)
    translatesAutoresizingMaskIntoConstraints = false
    layer?.cornerRadius = NyteRadius.control.rawValue
    layer?.cornerCurve = .continuous
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  override func applyColors() {
    layer?.backgroundColor = NyteRole.fillTertiary.cgColor(dark: isDark, hue: hue)
  }
}

private final class ComposerBox: AppearanceView {
  override init(frame: NSRect) {
    super.init(frame: frame)
    translatesAutoresizingMaskIntoConstraints = false
    layer?.cornerRadius = NyteRadius.card.rawValue
    layer?.cornerCurve = .continuous
    layer?.borderWidth = NyteSpace.px.rawValue
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  func hold(_ composer: NSView) {
    addSubview(composer)
    composer.pin(to: self)
  }

  override func applyColors() {
    layer?.backgroundColor = NyteRole.bgMutedTranslucent.cgColor(dark: isDark)
    layer?.borderColor = NyteRole.strokeTertiary.cgColor(dark: isDark)
  }
}

private final class AttachmentChip: NSView {
  init(_ name: String) {
    super.init(frame: .zero)
    wantsLayer = true
    layer?.cornerRadius = NyteControl.xs.rawValue / 2
    let label = NSTextField.nyteLabel(name, .sm, .medium, .contentAccent)
    label.textColor = .nyte(.contentAccent, hue: .blue)
    label.lineBreakMode = .byTruncatingMiddle
    label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    addSubview(label)
    label.pin(to: self, insets: NyteInsets(horizontal: .s2), edges: .horizontal)
    label.centerYAnchor.constraint(equalTo: centerYAnchor).isActive = true
    height(.xs)
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  override func updateLayer() {
    layer?.backgroundColor = NSColor.nyte(.fillTertiary, hue: .blue).cgColor
  }

  override var wantsUpdateLayer: Bool { true }
}
