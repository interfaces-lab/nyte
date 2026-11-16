import AppKit
import NyteDesign
import NyteKit

@MainActor
final class ComposerView: NSView, NSTextViewDelegate {
  var onCancel: (() -> Void)?
  var onSend: (() -> Void)?

  private let model: StudioModel
  private let text = ComposerTextView()
  private let chip = ChipButton()
  private let models = MenuButton(label: "Model")
  private let send = SendButton()
  private var textHeight: NSLayoutConstraint?
  private var observers: [Observer] = []

  init(model: StudioModel) {
    self.model = model
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false

    text.delegate = self
    text.font = .nyte(.base)
    text.textColor = .nyte(.contentPrimary)
    text.insertionPointColor = .nyte(.contentPrimary)
    text.drawsBackground = false
    text.isRichText = false
    text.allowsUndo = true
    text.textContainerInset = .zero
    text.textContainer?.lineFragmentPadding = 0
    text.isVerticallyResizable = true
    text.textContainer?.widthTracksTextView = true
    text.setAccessibilityLabel("Message to Nyte")

    let scroll = NSScrollView()
    scroll.documentView = text
    scroll.drawsBackground = false
    scroll.hasVerticalScroller = false
    scroll.translatesAutoresizingMaskIntoConstraints = false
    text.autoresizingMask = [.width]

    chip.target = self
    chip.action = #selector(dropSelection(_:))
    send.target = self
    send.action = #selector(sendDraft(_:))

    let content = NSStackView.column(gap: .s2, [chip, scroll])
    for subview in [content, models, send] as [NSView] { addSubview(subview) }
    content.pin(to: self, insets: NyteInsets(top: .s3, leading: .s3, trailing: .s3), edges: [.top, .leading, .trailing])
    send.pin(to: self, insets: NyteInsets(bottom: .s2, trailing: .s2), edges: [.bottom, .trailing])
    let height = scroll.heightAnchor.constraint(equalToConstant: NyteText.base.lineHeight)
    textHeight = height
    NSLayoutConstraint.activate([
      height,
      scroll.widthAnchor.constraint(equalTo: content.widthAnchor),
      send.topAnchor.below(content.bottomAnchor, .s2),
      models.leadingAnchor.after(leadingAnchor, .s1),
      models.centerYAnchor.constraint(equalTo: send.centerYAnchor),
      models.trailingAnchor.atLeastBefore(send.leadingAnchor, .s2),
    ])

    observers = [
      Observer { [weak self] in self?.refresh() },
      Observer { [weak self] in self?.adoptDraft() },
    ]
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  func focus() {
    window?.makeFirstResponder(text)
  }

  private func refresh() {
    let label = model.selectionLabel
    chip.isHidden = label == nil
    chip.title = label ?? ""
    text.placeholder = !model.online
      ? "Reconnecting to Nyte…"
      : model.selection == nil ? "Ask Nyte for a design, or select something first" : "Ask Nyte to change this"

    let menu = NSMenu()
    for choice in model.models {
      let item = NSMenuItem(title: choice.name, action: #selector(chooseModel(_:)), keyEquivalent: "")
      item.target = self
      item.state = choice.name == model.model?.name ? .on : .off
      menu.addItem(item)
    }
    models.menu = menu
    models.title = model.model?.name ?? ""
    models.isHidden = model.models.isEmpty
    models.isEnabled = model.transcript == nil && model.models.count > 1

    let ready = model.online && !model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    send.mode = ready ? .send : model.transcript?.execution.isBusy == true ? .stop : .idle
  }

  private func adoptDraft() {
    if text.string != model.draft {
      text.string = model.draft
      fit()
    }
  }

  func textDidChange(_ notification: Notification) {
    model.draft = text.string
    fit()
  }

  private func fit() {
    guard let container = text.textContainer, let manager = text.layoutManager else { return }
    manager.ensureLayout(for: container)
    let used = manager.usedRect(for: container).height
    let line = NyteText.base.lineHeight
    textHeight?.constant = min(max(used, line), line * 6)
    text.needsDisplay = true
  }

  func textView(_ textView: NSTextView, doCommandBy selector: Selector) -> Bool {
    switch selector {
    case #selector(NSResponder.insertNewline(_:)):
      if NSApp.currentEvent?.modifierFlags.contains(.shift) == true {
        textView.insertNewlineIgnoringFieldEditor(nil)
      } else {
        submit()
      }
      return true
    case #selector(NSResponder.cancelOperation(_:)):
      onCancel?()
      return true
    default:
      return false
    }
  }

  private func submit() {
    guard model.online, !model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
    model.send()
    text.string = ""
    fit()
    onSend?()
  }

  @objc private func sendDraft(_ sender: Any?) {
    if send.mode == .stop {
      model.stop()
    } else {
      submit()
    }
  }

  @objc private func dropSelection(_ sender: Any?) {
    model.selection = nil
  }

  @objc private func chooseModel(_ sender: NSMenuItem) {
    model.model = model.models.first { $0.name == sender.title }
  }
}

private final class ComposerTextView: NSTextView {
  var placeholder = "" { didSet { needsDisplay = true } }

  override func draw(_ dirtyRect: NSRect) {
    super.draw(dirtyRect)
    guard string.isEmpty else { return }
    (placeholder as NSString).draw(
      at: NSPoint(x: 0, y: 0),
      withAttributes: [.font: font ?? .nyte(.base), .foregroundColor: NSColor.nyte(.contentTertiary)])
  }

  override func becomeFirstResponder() -> Bool {
    needsDisplay = true
    return super.becomeFirstResponder()
  }
}

private final class ChipButton: NSButton {
  override var title: String { didSet { invalidateIntrinsicContentSize() } }

  private static let size = NyteControl.sm
  private static let pad = NyteSpace.s2.rawValue
  private static let scope = NyteGlyph.xs
  private static let close = NyteGlyph.xxs

  init() {
    super.init(frame: .zero)
    isBordered = false
    translatesAutoresizingMaskIntoConstraints = false
    toolTip = "Sent with your message. Click to send without it."
    setButtonType(.momentaryChange)
    setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  private var attributes: [NSAttributedString.Key: Any] {
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineBreakMode = .byTruncatingMiddle
    return [
      .font: NSFont.nyte(.sm, .medium), .foregroundColor: NSColor.nyte(.contentAccent, hue: .blue),
      .paragraphStyle: paragraph,
    ]
  }

  private var leadingWidth: CGFloat { ChipButton.pad + ChipButton.scope.rawValue + NyteSpace.s1.rawValue }
  private var trailingWidth: CGFloat { NyteSpace.s1_5.rawValue + ChipButton.close.rawValue + ChipButton.pad }

  override var intrinsicContentSize: NSSize {
    let width = ceil((title as NSString).size(withAttributes: attributes).width)
    return NSSize(width: leadingWidth + width + trailingWidth, height: ChipButton.size.rawValue)
  }

  override func draw(_ dirtyRect: NSRect) {
    NSColor.nyte(isHighlighted ? .fillSecondary : .fillTertiary, hue: .blue).setFill()
    NSBezierPath(roundedRect: bounds, xRadius: bounds.height / 2, yRadius: bounds.height / 2).fill()
    let tint = NSColor.nyte(.contentAccent, hue: .blue)
    func symbol(_ name: String, _ glyph: NyteGlyph, x: CGFloat) {
      guard
        let image = NSImage(systemSymbolName: name, accessibilityDescription: nil)?
          .withSymbolConfiguration(
            .init(pointSize: glyph.pointSize, weight: .semibold).applying(.init(paletteColors: [tint])))
      else { return }
      let box = NSRect(x: x, y: (bounds.height - glyph.rawValue) / 2, width: glyph.rawValue, height: glyph.rawValue)
      image.draw(
        in: NSRect(
          x: box.midX - image.size.width / 2, y: box.midY - image.size.height / 2, width: image.size.width,
          height: image.size.height),
        from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
    }
    symbol("scope", ChipButton.scope, x: ChipButton.pad)
    let height = ceil((title as NSString).size(withAttributes: attributes).height)
    (title as NSString).draw(
      with: NSRect(
        x: leadingWidth, y: ((bounds.height - height) / 2).rounded(),
        width: max(0, bounds.width - leadingWidth - trailingWidth), height: height),
      options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine], attributes: attributes)
    symbol("xmark", ChipButton.close, x: bounds.width - ChipButton.pad - ChipButton.close.rawValue)
  }
}

private final class SendButton: NSButton {
  enum Mode {
    case idle, send, stop
  }

  private static let size = NyteControl.md

  var mode = Mode.idle {
    didSet {
      guard mode != oldValue else { return }
      isEnabled = mode != .idle
      toolTip = mode == .stop ? "Stop" : "Send"
      setAccessibilityLabel(mode == .stop ? "Stop" : "Send")
      needsDisplay = true
    }
  }

  init() {
    super.init(frame: .zero)
    isBordered = false
    title = ""
    translatesAutoresizingMaskIntoConstraints = false
    setButtonType(.momentaryChange)
    toolTip = "Send"
    setAccessibilityLabel("Send")
    isEnabled = false
    square(SendButton.size)
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  override func draw(_ dirtyRect: NSRect) {
    let radius = SendButton.size.cornerRadius
    let shape = NSBezierPath(roundedRect: bounds, xRadius: radius, yRadius: radius)
    switch mode {
    case .send: NSColor.nyte(.bgInteractiveStrong, hue: .blue).setFill()
    case .stop: NSColor.nyte(.fillSecondary).setFill()
    case .idle: NSColor.nyte(.fillTertiary).setFill()
    }
    shape.fill()
    if isHighlighted {
      NSColor.black.withAlphaComponent(0.12).setFill()
      shape.fill()
    }
    let tint: NSColor
    switch mode {
    case .send: tint = .nyte(.contentOnInteractiveStrong, hue: .blue)
    case .stop: tint = .nyte(.contentPrimary)
    case .idle: tint = .nyte(.contentDisabled)
    }
    guard
      let image = NSImage(systemSymbolName: mode == .stop ? "stop.fill" : "arrow.up", accessibilityDescription: nil)?
        .withSymbolConfiguration(
          .init(pointSize: (mode == .stop ? NyteGlyph.xs : NyteGlyph.sm).pointSize, weight: .bold)
            .applying(.init(paletteColors: [tint])))
    else { return }
    image.draw(
      in: NSRect(
        x: (bounds.width - image.size.width) / 2, y: (bounds.height - image.size.height) / 2,
        width: image.size.width, height: image.size.height),
      from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
  }
}
