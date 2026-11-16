import AppKit
import NyteDesign

enum DockTail: Equatable {
  case working(String)
  case waiting
  case answer(String)
  case failed(String)
  case notice(String)
}

@MainActor
final class DockView: NSView {
  let composer: ComposerView
  var onStop: (() -> Void)?
  var onDismiss: (() -> Void)?
  var onOpenChat: (() -> Void)?
  var onOpenNyte: (() -> Void)?

  private let surface = FloatingSurface(.radius(.surface))
  private let status = StatusRow()
  private let note = NoteRow()
  private let rule = Hairline()
  private let column = NSStackView.column(gap: .none)
  private var fixedWidth: NSLayoutConstraint?
  private var widths: [(row: NSView, constraint: NSLayoutConstraint)] = []

  var tail: DockTail? {
    didSet {
      guard tail != oldValue else { return }
      let row = fill()
      arrange()
      if let row, row !== shown { NyteMotion.fade(row, to: 1, .slow, from: 0) }
      shown = row
    }
  }

  var showsInput = true {
    didSet { if showsInput != oldValue { arrange() } }
  }

  private weak var shown: NSView?

  init(composer: ComposerView) {
    self.composer = composer
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false
    wantsLayer = true
    addSubview(surface)
    surface.pin(to: self)
    for row in [status, note, rule, composer] as [NSView] {
      column.addArrangedSubview(row)
      widths.append((row, row.widthAnchor.constraint(equalTo: column.widthAnchor)))
    }
    surface.contentView.addSubview(column)
    column.pin(to: surface.contentView)

    status.stop.target = self
    status.stop.action = #selector(stop(_:))
    status.open.target = self
    status.open.action = #selector(openNyte(_:))
    note.chat.target = self
    note.chat.action = #selector(openChat(_:))
    note.close.target = self
    note.close.action = #selector(dismiss(_:))

    let fixed = widthAnchor.constraint(equalToConstant: NyteMetric.composer.rawValue)
    fixed.priority = .defaultHigh
    fixedWidth = fixed
    let narrow = widthAnchor.constraint(equalToConstant: NyteSpace.none.rawValue)
    narrow.priority = .fittingSizeCompression
    NSLayoutConstraint.activate([
      narrow, widthAnchor.constraint(lessThanOrEqualToConstant: NyteMetric.composer.rawValue),
    ])
    arrange()
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  var isEmpty: Bool { tail == nil && !showsInput }

  private func fill() -> NSView? {
    switch tail {
    case .working(let doing):
      status.show(doing, state: .working)
      return status
    case .waiting:
      status.show("Nyte has a question for you", state: .waiting)
      return status
    case .answer(let markdown):
      note.show(Markdown.render(markdown), mark: nil, chat: true)
      return note
    case .failed(let reason):
      note.show(NSAttributedString(string: reason, attributes: Markdown.body), mark: .failed, chat: true)
      return note
    case .notice(let text):
      note.show(NSAttributedString(string: text, attributes: Markdown.body), mark: .notice, chat: false)
      return note
    case nil:
      return nil
    }
  }

  private func arrange() {
    let row = row
    status.isHidden = row !== status
    note.isHidden = row !== note
    rule.isHidden = row == nil || !showsInput
    composer.isHidden = !showsInput
    fixedWidth?.isActive = showsInput
    for width in widths { width.constraint.isActive = !width.row.isHidden }
  }

  private var row: NSView? {
    switch tail {
    case .working, .waiting: return status
    case .answer, .failed, .notice: return note
    case nil: return nil
    }
  }

  @objc private func stop(_ sender: Any?) { onStop?() }
  @objc private func openNyte(_ sender: Any?) { onOpenNyte?() }
  @objc private func openChat(_ sender: Any?) { onOpenChat?() }
  @objc private func dismiss(_ sender: Any?) { onDismiss?() }
}

private final class StatusRow: NSView {
  enum State {
    case working
    case waiting
  }

  let stop = GhostButton(symbol: "stop.fill", label: "Stop", size: .xs, target: nil, action: nil)
  let open = NSButton(title: "Answer in Nyte", target: nil, action: nil)
  private let label = NSTextField.nyteLabel("", .sm, .regular, .contentSecondary)
  private let spinner = NSProgressIndicator()
  private let mark = NSImageView()

  init() {
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false
    wantsLayer = true
    spinner.style = .spinning
    spinner.controlSize = .small
    spinner.square(NyteGlyph.sm)
    mark.image = NSImage(systemSymbolName: "questionmark.bubble.fill", accessibilityDescription: nil)
    mark.symbolConfiguration = .init(pointSize: NyteGlyph.sm.pointSize, weight: .medium)
    mark.contentTintColor = .nyte(.contentAccent, hue: .blue)
    mark.square(NyteGlyph.sm)
    open.bezelStyle = .push
    open.controlSize = NyteControl.xs.system
    label.lineBreakMode = .byTruncatingTail
    label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    for control in [stop, open] as [NSView] { control.setContentCompressionResistancePriority(.required, for: .horizontal) }

    label.setContentHuggingPriority(.init(1), for: .horizontal)
    let row = NSStackView.row(gap: .s2, [spinner, mark, label, stop, open])
    row.distribution = .fill
    row.setCustomSpacing(NyteSpace.s3.rawValue, after: label)
    addSubview(row)
    row.pin(to: self, insets: NyteInsets(leading: .s3, trailing: .s1_5), edges: .horizontal)
    row.centerYAnchor.constraint(equalTo: centerYAnchor).isActive = true
    height(.lg)
    setAccessibilityElement(true)
    setAccessibilityRole(.group)
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  func show(_ text: String, state: State) {
    label.stringValue = text
    label.toolTip = text
    let working = state == .working
    spinner.isHidden = !working
    working ? spinner.startAnimation(nil) : spinner.stopAnimation(nil)
    mark.isHidden = working
    stop.isHidden = !working
    open.isHidden = working
    setAccessibilityLabel(text)
  }

  override var isHidden: Bool {
    didSet { if isHidden { spinner.stopAnimation(nil) } }
  }
}

private final class NoteRow: NSView {
  enum Mark {
    case failed
    case notice
  }

  let chat = GhostButton(symbol: "bubble.left", label: "Show the Chat", size: .xs, target: nil, action: nil)
  let close = GhostButton(symbol: "xmark", label: "Dismiss", size: .xs, target: nil, action: nil)
  private let text = NSTextField.nyteWrapping("", .base, .contentPrimary)
  private let mark = NSImageView()
  private var textLeading: NSLayoutConstraint?
  private var markedLeading: NSLayoutConstraint?

  private static let lines = 4

  init() {
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false
    wantsLayer = true
    text.isSelectable = true
    text.allowsEditingTextAttributes = true
    text.maximumNumberOfLines = NoteRow.lines
    text.cell?.truncatesLastVisibleLine = true
    text.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    mark.symbolConfiguration = .init(pointSize: NyteGlyph.sm.pointSize, weight: .medium)
    mark.square(NyteGlyph.sm)

    let actions = NSStackView.row(gap: .s0_5, [chat, close])
    for subview in [mark, text, actions] as [NSView] { addSubview(subview) }
    let firstLine = NyteText.base.lineHeight / 2
    let plain = text.leadingAnchor.after(leadingAnchor, .s3)
    let marked = text.leadingAnchor.after(mark.trailingAnchor, .s2)
    textLeading = plain
    markedLeading = marked
    NSLayoutConstraint.activate([
      plain,
      mark.leadingAnchor.after(leadingAnchor, .s3),
      mark.centerYAnchor.constraint(equalTo: text.topAnchor, constant: firstLine),
      text.topAnchor.below(topAnchor, .s2_5),
      text.bottomAnchor.above(bottomAnchor, .s2_5),
      text.trailingAnchor.atLeastBefore(actions.leadingAnchor, .s2),
      actions.trailingAnchor.before(trailingAnchor, .s1_5),
      actions.centerYAnchor.constraint(equalTo: text.topAnchor, constant: firstLine),
    ])
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  func show(_ words: NSAttributedString, mark kind: Mark?, chat showsChat: Bool) {
    text.attributedStringValue = words
    chat.isHidden = !showsChat
    mark.isHidden = kind == nil
    textLeading?.isActive = kind == nil
    markedLeading?.isActive = kind != nil
    switch kind {
    case .failed:
      mark.image = NSImage(systemSymbolName: "exclamationmark.triangle.fill", accessibilityDescription: "Stopped")
      mark.contentTintColor = .nyte(.contentAccent, hue: .red)
    case .notice:
      mark.image = NSImage(systemSymbolName: "info.circle.fill", accessibilityDescription: "Notice")
      mark.contentTintColor = .nyte(.contentSecondary)
    case nil:
      mark.image = nil
    }
  }
}
