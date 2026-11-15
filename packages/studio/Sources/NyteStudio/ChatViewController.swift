import AppKit
import NyteDesign
import NyteKit

/// The chat on this project. It is a session of the host, so the same chat is in Nyte's sidebar.
@MainActor
final class ChatViewController: NSViewController {
  private let model: StudioModel
  private let scroll = NSScrollView()
  private let stack = NSStackView()
  private let placeholder = NSStackView()
  private var rows: [String: ChatRow] = [:]
  private var order: [String] = []
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
    stack.orientation = .vertical
    stack.alignment = .leading
    stack.spacing = 10
    stack.edgeInsets = NSEdgeInsets(top: 2, left: 14, bottom: 16, right: 14)
    stack.translatesAutoresizingMaskIntoConstraints = false
    let document = FlippedView()
    document.translatesAutoresizingMaskIntoConstraints = false
    document.addSubview(stack)
    stack.pin(to: document)
    scroll.documentView = document
    scroll.drawsBackground = false
    scroll.hasVerticalScroller = true
    view.addSubview(scroll)
    scroll.pin(to: view)
    document.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor).isActive = true

    placeholder.orientation = .vertical
    placeholder.spacing = 8
    placeholder.translatesAutoresizingMaskIntoConstraints = false
    placeholder.addArrangedSubview(MoonView(side: 28))
    placeholder.addArrangedSubview(NSTextField.nyteLabel("Ask from the canvas", .base, .medium, .contentSecondary))
    let line = NSTextField.nyteWrapping(
      "The chat is a Nyte session. Start it here and it is in Nyte too, with the same agent, model and history.",
      .sm, .contentTertiary)
    line.alignment = .center
    line.preferredMaxLayoutWidth = 220
    placeholder.addArrangedSubview(line)
    view.addSubview(placeholder)
    NSLayoutConstraint.activate([
      placeholder.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      placeholder.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -60),
    ])
    observer = Observer { [weak self] in self?.refresh() }
  }

  /// Keeps a row per message, updating in place so streamed text grows where it is.
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
    let pinned = clip.bounds.maxY >= (scroll.documentView?.frame.height ?? 0) - 24
    var items = transcript.items.filter { item in
      if case .thinking(let live) = item.body { return live }
      return true
    }
    if case .idle(let failed?) = transcript.execution {
      items.append(TranscriptItem(id: "failure", turn: "", body: .other(kind: failed)))
    }

    let ids = items.map(\.id)
    for (id, row) in rows where !ids.contains(id) {
      row.removeFromSuperview()
      rows[id] = nil
    }
    for item in items {
      let row = rows[item.id] ?? {
        let row = ChatRow()
        rows[item.id] = row
        return row
      }()
      row.show(item)
    }
    if ids != order {
      order = ids
      for view in stack.arrangedSubviews { stack.removeArrangedSubview(view) }
      for id in ids {
        guard let row = rows[id] else { continue }
        stack.addArrangedSubview(row)
        row.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -28).isActive = true
      }
    }

    if pinned {
      view.layoutSubtreeIfNeeded()
      let height = scroll.documentView?.frame.height ?? 0
      clip.scroll(to: NSPoint(x: 0, y: max(0, height - clip.bounds.height)))
      scroll.reflectScrolledClipView(clip)
    }
  }
}

/// One message: what a person sent, what the agent said, or a step it took.
private final class ChatRow: AppearanceView {
  private let text = NSTextField.nyteWrapping("", .base, .contentPrimary)
  private let chips = NSStackView()
  private let icon = NSImageView()
  private let counts = NSTextField.nyteLabel("", .xs, .medium, .contentTertiary)
  private let spinner = NSProgressIndicator()
  private let column = NSStackView()
  private let line = NSStackView()
  private var shown: TranscriptItem?
  private var filled = false

  init() {
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false
    layer?.cornerRadius = NyteRadius.lg
    layer?.cornerCurve = .continuous
    text.isSelectable = true
    text.allowsEditingTextAttributes = true
    chips.spacing = 4
    spinner.style = .spinning
    spinner.controlSize = .small
    spinner.isDisplayedWhenStopped = false
    icon.symbolConfiguration = .init(pointSize: 10, weight: .medium)
    counts.setContentCompressionResistancePriority(.required, for: .horizontal)

    line.spacing = 6
    for view in [icon, text, counts, spinner] as [NSView] { line.addArrangedSubview(view) }
    column.orientation = .vertical
    column.alignment = .leading
    column.spacing = 6
    column.addArrangedSubview(chips)
    column.addArrangedSubview(line)
    addSubview(column)
    column.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      column.leadingAnchor.constraint(equalTo: leadingAnchor), column.trailingAnchor.constraint(equalTo: trailingAnchor),
      column.topAnchor.constraint(equalTo: topAnchor), column.bottomAnchor.constraint(equalTo: bottomAnchor),
      icon.widthAnchor.constraint(equalToConstant: 14), line.widthAnchor.constraint(equalTo: column.widthAnchor, constant: 0),
    ])
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  func show(_ item: TranscriptItem) {
    guard item != shown else { return }
    shown = item
    filled = false
    icon.isHidden = true
    counts.isHidden = true
    chips.isHidden = true
    spinner.stopAnimation(nil)
    column.edgeInsets = NSEdgeInsetsZero
    text.textColor = .nyte(.contentPrimary)
    text.font = .nyte(.base)
    text.maximumNumberOfLines = 0

    switch item.body {
    case .user(let words, let attachments):
      filled = true
      column.edgeInsets = NSEdgeInsets(top: 8, left: 10, bottom: 8, right: 10)
      text.stringValue = words
      chips.isHidden = attachments.isEmpty
      for view in chips.arrangedSubviews { view.removeFromSuperview() }
      for name in attachments { chips.addArrangedSubview(AttachmentChip(name)) }

    case .answer(let markdown, _):
      text.attributedStringValue = Markdown.render(markdown)

    case .thinking:
      text.stringValue = "Thinking"
      text.textColor = .nyte(.contentTertiary)
      text.font = .nyte(.sm)

    case .tool(let step):
      icon.isHidden = false
      icon.image = NSImage(systemSymbolName: symbol(step), accessibilityDescription: nil)
      icon.contentTintColor = step.failed ? .nyte(.contentAccent, hue: .red) : .nyte(.contentQuaternary)
      text.stringValue = title(step)
      text.textColor = .nyte(.contentTertiary)
      text.font = .nyte(.sm)
      text.maximumNumberOfLines = 1
      if step.running {
        spinner.startAnimation(nil)
      } else if let added = step.added, let removed = step.removed {
        counts.isHidden = false
        counts.stringValue = "+\(added)  −\(removed)"
      }

    case .other(let kind):
      text.stringValue = kind
      text.textColor = .nyte(.contentTertiary)
      text.font = .nyte(.sm)
    }
    applyColors()
  }

  override func applyColors() {
    layer?.backgroundColor = filled ? NyteRole.fillTertiary.cgColor(dark: isDark) : nil
  }

  private func symbol(_ step: ToolStep) -> String {
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

  private func title(_ step: ToolStep) -> String {
    let file = step.path.map { URL(filePath: $0).lastPathComponent }
    switch step.kind {
    case "edit": return "Edited \(file ?? "a file")"
    case "read": return "Read \(file ?? "a file")"
    case "list": return "Looked in \(file ?? "a folder")"
    case "shell": return step.label ?? "Ran a command"
    default: return step.label ?? step.name
    }
  }
}

/// The name of a file or excerpt that rode along with a message.
private final class AttachmentChip: NSView {
  init(_ name: String) {
    super.init(frame: .zero)
    wantsLayer = true
    layer?.cornerRadius = 10
    let label = NSTextField.nyteLabel(name, .sm, .medium, .contentAccent)
    label.textColor = .nyte(.contentAccent, hue: .blue)
    addSubview(label)
    label.pin(to: self, insets: NSEdgeInsets(top: 2, left: 8, bottom: 2, right: 8))
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  override func updateLayer() {
    layer?.backgroundColor = NSColor.nyte(.fillTertiary, hue: .blue).cgColor
  }

  override var wantsUpdateLayer: Bool { true }
}

/// Turns the agent's Markdown into attributed text with Foundation's own parser.
enum Markdown {
  static func render(_ source: String) -> NSAttributedString {
    let options = AttributedString.MarkdownParsingOptions(
      allowsExtendedAttributes: true, interpretedSyntax: .full, failurePolicy: .returnPartiallyParsedIfPossible)
    guard let parsed = try? AttributedString(markdown: source, options: options) else {
      return NSAttributedString(string: source, attributes: base(.nyte(.base)))
    }

    let out = NSMutableAttributedString()
    var block: Int?
    for run in parsed.runs {
      let intent = run.presentationIntent
      let identity = intent?.components.first?.identity
      var prefix = ""
      if identity != block {
        if out.length > 0 { out.append(NSAttributedString(string: "\n")) }
        block = identity
        for component in intent?.components ?? [] {
          if case .listItem(let ordinal) = component.kind {
            let ordered = intent?.components.contains { $0.kind == .orderedList } ?? false
            prefix = ordered ? "\(ordinal). " : "•  "
          }
        }
      }

      var font = NSFont.nyte(.base)
      var extra: [NSAttributedString.Key: Any] = [:]
      for component in intent?.components ?? [] {
        switch component.kind {
        case .header(let level):
          font = .nyte(level <= 1 ? .lg : .base, .semibold)
        case .codeBlock:
          font = .nyteMono(11.5)
        default:
          break
        }
      }
      if let inline = run.inlinePresentationIntent {
        if inline.contains(.code) {
          font = .nyteMono(11.5)
          extra[.backgroundColor] = NSColor.nyte(.fillTertiary)
        }
        if inline.contains(.stronglyEmphasized) { font = NSFontManager.shared.convert(font, toHaveTrait: .boldFontMask) }
        if inline.contains(.emphasized) { font = NSFontManager.shared.convert(font, toHaveTrait: .italicFontMask) }
      }
      if let link = run.link { extra[.link] = link }

      let text = prefix + String(parsed[run.range].characters)
      out.append(NSAttributedString(string: text, attributes: base(font).merging(extra) { _, new in new }))
    }
    return out
  }

  private static func base(_ font: NSFont) -> [NSAttributedString.Key: Any] {
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineSpacing = 3
    paragraph.paragraphSpacing = 6
    return [.font: font, .foregroundColor: NSColor.nyte(.contentPrimary), .paragraphStyle: paragraph]
  }
}
