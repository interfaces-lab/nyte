import AppKit
import NyteDesign
import NyteKit

/// Where you ask Nyte for a design. What is selected on the canvas rides along as context.
@MainActor
final class ComposerView: NSView, NSTextViewDelegate {
  /// Escape was pressed in the text.
  var onCancel: (() -> Void)?
  /// A message went out.
  var onSend: (() -> Void)?

  private let model: StudioModel
  private let text = ComposerTextView()
  private let chip = ChipButton()
  private let models = NSPopUpButton(frame: .zero, pullsDown: false)
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

    models.isBordered = false
    models.controlSize = .small
    models.font = .nyte(.sm)
    models.target = self
    models.action = #selector(chooseModel(_:))
    models.translatesAutoresizingMaskIntoConstraints = false

    send.target = self
    send.action = #selector(sendOrStop(_:))

    let bottom = NSStackView(views: [models, NSView(), send])
    bottom.spacing = 8
    let stack = NSStackView(views: [chip, scroll, bottom])
    stack.orientation = .vertical
    stack.alignment = .leading
    stack.spacing = 8
    addSubview(stack)
    stack.pin(to: self, insets: NSEdgeInsets(top: 12, left: 14, bottom: 10, right: 12))
    let height = scroll.heightAnchor.constraint(equalToConstant: 18)
    textHeight = height
    NSLayoutConstraint.activate([
      height, scroll.widthAnchor.constraint(equalTo: stack.widthAnchor),
      bottom.widthAnchor.constraint(equalTo: stack.widthAnchor),
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

  var isFocused: Bool { window?.firstResponder === text }

  private func refresh() {
    let label = model.selectionLabel
    chip.isHidden = label == nil
    chip.title = label ?? ""
    text.placeholder = model.selection == nil
      ? "Ask Nyte for a design, or select something first" : "Ask Nyte to change this"

    let chosen = model.model
    if models.itemTitles != model.models.map(\.name) {
      models.removeAllItems()
      models.addItems(withTitles: model.models.map(\.name))
    }
    if let chosen { models.selectItem(withTitle: chosen.name) }
    models.isHidden = model.models.isEmpty
    models.isEnabled = model.transcript == nil && model.models.count > 1

    let busy = model.transcript?.execution.isBusy ?? false
    let ready = !model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    send.mode = ready ? .send : busy ? .stop : .idle
  }

  /// Takes the model's draft when something else changed it: a failed send putting it back.
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

  /// Grows the text from one line to six, then scrolls.
  private func fit() {
    guard let container = text.textContainer, let manager = text.layoutManager else { return }
    manager.ensureLayout(for: container)
    let used = manager.usedRect(for: container).height
    textHeight?.constant = min(max(used, 18), 108)
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
    guard !model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
    model.send()
    text.string = ""
    fit()
    onSend?()
  }

  @objc private func sendOrStop(_ sender: Any?) {
    if send.mode == .stop { model.stop() } else { submit() }
  }

  @objc private func dropSelection(_ sender: Any?) {
    model.selection = nil
  }

  @objc private func chooseModel(_ sender: Any?) {
    model.model = model.models.first { $0.name == models.titleOfSelectedItem }
  }
}

/// A text view that shows a placeholder while it is empty.
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

/// The selection as a chip: its name, and a way to send without it.
private final class ChipButton: NSButton {
  override var title: String { didSet { invalidateIntrinsicContentSize() } }

  init() {
    super.init(frame: .zero)
    isBordered = false
    translatesAutoresizingMaskIntoConstraints = false
    toolTip = "Sent with your message. Click to send without it."
    setButtonType(.momentaryChange)
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  private var attributes: [NSAttributedString.Key: Any] {
    [.font: NSFont.nyte(.sm, .medium), .foregroundColor: NSColor.nyte(.contentAccent, hue: .blue)]
  }

  override var intrinsicContentSize: NSSize {
    let width = (title as NSString).size(withAttributes: attributes).width
    return NSSize(width: ceil(width) + 44, height: 22)
  }

  override func draw(_ dirtyRect: NSRect) {
    NSColor.nyte(.fillTertiary, hue: .blue).setFill()
    NSBezierPath(roundedRect: bounds, xRadius: 11, yRadius: 11).fill()
    let tint = NSColor.nyte(.contentAccent, hue: .blue)
    func symbol(_ name: String, size: CGFloat, x: CGFloat) {
      guard
        let image = NSImage(systemSymbolName: name, accessibilityDescription: nil)?
          .withSymbolConfiguration(.init(pointSize: size, weight: .semibold).applying(.init(paletteColors: [tint])))
      else { return }
      image.draw(in: NSRect(x: x, y: (bounds.height - image.size.height) / 2, width: image.size.width, height: image.size.height))
    }
    symbol("scope", size: 10, x: 8)
    let size = (title as NSString).size(withAttributes: attributes)
    (title as NSString).draw(at: NSPoint(x: 24, y: (bounds.height - size.height) / 2), withAttributes: attributes)
    symbol("xmark", size: 8, x: bounds.width - 18)
  }
}

/// The round button at the composer's corner: send, or stop while the agent works.
private final class SendButton: NSButton {
  enum Mode {
    case idle, send, stop
  }

  var mode: Mode = .idle {
    didSet {
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
    NSLayoutConstraint.activate([widthAnchor.constraint(equalToConstant: 26), heightAnchor.constraint(equalToConstant: 26)])
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  override func draw(_ dirtyRect: NSRect) {
    let active = mode != .idle
    (active ? NSColor.nyte(.bgInteractiveStrong, hue: .blue) : NSColor.nyte(.fillTertiary)).setFill()
    NSBezierPath(ovalIn: bounds).fill()
    if isHighlighted {
      NSColor.black.withAlphaComponent(0.12).setFill()
      NSBezierPath(ovalIn: bounds).fill()
    }
    let tint: NSColor = active ? .white : .nyte(.contentDisabled)
    guard
      let image = NSImage(systemSymbolName: mode == .stop ? "stop.fill" : "arrow.up", accessibilityDescription: nil)?
        .withSymbolConfiguration(.init(pointSize: 11, weight: .bold).applying(.init(paletteColors: [tint])))
    else { return }
    image.draw(
      in: NSRect(
        x: (bounds.width - image.size.width) / 2, y: (bounds.height - image.size.height) / 2,
        width: image.size.width, height: image.size.height))
  }
}
