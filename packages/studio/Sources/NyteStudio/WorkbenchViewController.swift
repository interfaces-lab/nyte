import AppKit
import Lune
import NyteDesign
import NyteKit

/// The canvas and the little that floats on it: the composer, what the agent is doing, and a
/// notice now and then. In zen mode the composer stays away until it is asked for.
@MainActor
final class WorkbenchViewController: NSViewController {
  private let model: StudioModel
  private let canvas = CanvasView(frame: .zero)
  private let composer: ComposerView
  /// Holds the composer over one of two backdrops.
  private let dock = NSView()
  /// The composer's everyday backdrop: plain, steady, used all day.
  private let plain = FloatingSurface(radius: 14)
  /// Its backdrop when it is summoned in zen mode: a moment, so it gets glass.
  private let glass = GlassSurface(radius: 14)
  private let activity = Pill()
  private let notice = Pill()
  private let hint = GlassPill()
  private let empty = NSStackView()
  private var observers: [Observer] = []
  private var revision = -1
  private var marks: Set<UUID> = []
  private var shownSelection: CanvasSelection?
  private var focusCount = 0
  private var wasBusy = false
  private var noticeTimer: Timer?
  private var whisperShown = false

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
    canvas.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(canvas)
    canvas.pin(to: view)

    empty.orientation = .vertical
    empty.spacing = 8
    empty.translatesAutoresizingMaskIntoConstraints = false
    empty.addArrangedSubview(MoonView(side: 36))
    empty.addArrangedSubview(NSTextField.nyteLabel("No designs here yet", .lg, .medium))
    let line = NSTextField.nyteWrapping(
      "Ask for a screen below. Nyte writes it as a .lune file in this project, and it appears here.",
      .base, .contentTertiary)
    line.alignment = .center
    line.preferredMaxLayoutWidth = 320
    empty.addArrangedSubview(line)
    empty.isHidden = true

    hint.label.stringValue = "Zen  ·  / to ask  ·  ⌘. to leave"
    hint.alphaValue = 0
    glass.isHidden = true
    activity.isHidden = true
    notice.isHidden = true

    dock.translatesAutoresizingMaskIntoConstraints = false
    for (name, tagged) in [("canvas", canvas), ("composer", dock), ("activity", activity), ("notice", notice), ("zen-hint", hint)]
      as [(String, NSView)]
    {
      tagged.identifier = NSUserInterfaceItemIdentifier(name)
    }
    dock.wantsLayer = true
    for subview in [empty, dock, activity, notice, hint] as [NSView] { view.addSubview(subview) }
    for backdrop in [plain, glass] as [NSView] {
      dock.addSubview(backdrop)
      backdrop.pin(to: dock)
    }
    dock.addSubview(composer)
    composer.pin(to: dock)

    let width = dock.widthAnchor.constraint(equalToConstant: 560)
    width.priority = .defaultHigh
    NSLayoutConstraint.activate([
      empty.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      empty.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -40),
      dock.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      dock.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -NyteSpace.s4),
      dock.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, constant: -NyteSpace.s6 * 2),
      width,
      activity.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      activity.bottomAnchor.constraint(equalTo: dock.topAnchor, constant: -NyteSpace.s2),
      notice.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      notice.bottomAnchor.constraint(equalTo: activity.topAnchor, constant: -NyteSpace.s2),
      notice.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, constant: -NyteSpace.s6 * 2),
      hint.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      hint.topAnchor.constraint(equalTo: view.topAnchor, constant: NyteSpace.s4),
    ])

    wire()
    observers = [
      Observer { [weak self] in self?.syncCanvas() },
      Observer { [weak self] in self?.syncChrome() },
      Observer { [weak self] in self?.syncFocus() },
    ]
  }

  override func viewDidLayout() {
    super.viewDidLayout()
    updateInsets()
  }

  /// Keeps "zoom to fit" clear of the toolbar above and the composer below.
  private func updateInsets() {
    let top = model.zen ? 28 : view.safeAreaInsets.top + 36
    let bottom = model.zen ? 36 : dock.frame.height + 56
    canvas.insets = NSEdgeInsets(top: top, left: 36, bottom: bottom, right: 36)
  }

  private func wire() {
    let model = model
    canvas.onSelect = { selection in
      model.selection = selection
      if selection != nil, model.panel == .chat, model.transcript == nil { model.panel = .design }
    }
    canvas.onMoveFrame = { selection, origin, commit in model.moveFrame(selection, to: origin, commit: commit) }
    canvas.onResize = { selection, size, origin, commit in
      model.resize(selection, to: size, origin: origin, commit: commit)
    }
    canvas.onDelete = { model.delete($0) }
    canvas.onZoom = { zoom in
      DispatchQueue.main.async { if abs(model.zoom - zoom) > 0.0005 { model.zoom = zoom } }
    }
    canvas.onAsk = { model.focusComposer() }
    canvas.onEscape = { if model.zen { model.zen = false } }
    canvas.markupForSelection = { model.selectedMarkup }
    composer.onCancel = { [weak self] in self?.leaveComposer() }
    composer.onSend = { [weak self] in
      guard let self, self.model.zen else { return }
      self.leaveComposer()
    }
  }

  // MARK: Following the model

  private func syncCanvas() {
    let project = model.project
    let next = project?.revision ?? 0
    if let project { canvas.imageEnvironment = project.environment }

    if revision != next {
      revision = next
      shownSelection = model.selection
      canvas.update(sheets: project?.sheets ?? [], selection: model.selection)
    } else if shownSelection != model.selection {
      shownSelection = model.selection
      canvas.select(model.selection)
    }

    let latest = project?.marks ?? []
    let ids = Set(latest.map(\.id))
    if ids != marks {
      marks = ids
      canvas.flash(latest)
    }

    if let request = model.cameraRequest {
      switch request {
      case .fitAll: canvas.fitAll()
      case .sheet(let path): canvas.reveal(sheet: path)
      case .selection: if let selection = model.selection { canvas.reveal(selection) }
      case .zoom(let value): canvas.setZoom(value)
      }
      let model = model
      DispatchQueue.main.async { model.cameraRequest = nil }
    }
    empty.isHidden = !(project?.loaded == true && project?.sheets.isEmpty == true)
  }

  private func syncChrome() {
    let transcript = model.transcript
    let busy = transcript?.execution.isBusy ?? false
    activity.isHidden = !busy
    activity.spins = busy
    if let transcript, busy { activity.label.stringValue = activityLine(transcript) }

    // In zen mode the chat is put away, so the agent's last word shows here for a moment.
    if wasBusy, !busy, model.zen, let answer = transcript?.items.last(where: { item in
      if case .answer = item.body { return true }
      return false
    }), case .answer(let markdown, _) = answer.body {
      show(notice: String(markdown.prefix(160)))
    }
    wasBusy = busy

    if let text = model.project?.notice {
      show(notice: text)
      model.project?.notice = nil
    }
  }

  private func show(notice text: String) {
    notice.label.stringValue = text
    notice.isHidden = false
    notice.alphaValue = 0
    NyteMotion.animate(0.2) { notice.animator().alphaValue = 1 }
    noticeTimer?.invalidate()
    noticeTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: false) { [weak self] _ in
      MainActor.assumeIsolated {
        guard let self else { return }
        NyteMotion.animate(0.2, { self.notice.animator().alphaValue = 0 }) { self.notice.isHidden = true }
      }
    }
  }

  private func activityLine(_ transcript: Transcript) -> String {
    for item in transcript.items.reversed() {
      if case .tool(let step) = item.body, step.running {
        let verb: String
        switch step.kind {
        case "edit": verb = "Editing"
        case "read": verb = "Reading"
        case "list": verb = "Looking in"
        case "shell": verb = "Running a command"
        default: verb = step.name
        }
        return [verb, step.kind == "shell" ? nil : step.path].compactMap { $0 }.joined(separator: " ")
      }
    }
    switch transcript.execution {
    case .waiting: return "Waiting for you in the chat"
    case .retrying(let reason): return "Retrying: \(reason)"
    default: return transcript.activity ?? "Thinking"
    }
  }

  private func syncFocus() {
    let count = model.composerFocus
    guard count != focusCount else { return }
    focusCount = count
    showWhisper(true)
    composer.focus()
  }

  private func leaveComposer() {
    showWhisper(false)
    view.window?.makeFirstResponder(canvas)
  }

  // MARK: Zen

  /// Called by the window when zen mode turns on or off.
  func zenChanged() {
    let zen = model.zen
    whisperShown = false
    dock.layer?.removeAllAnimations()
    plain.isHidden = zen
    glass.isHidden = !zen
    dock.isHidden = false
    NyteMotion.animate(0.24, { dock.animator().alphaValue = zen ? 0 : 1 }) { [weak self] in
      guard let self else { return }
      self.dock.isHidden = self.model.zen && !self.whisperShown
    }
    updateInsets()
    if zen {
      view.window?.makeFirstResponder(canvas)
      hint.alphaValue = 0
      NyteMotion.animate(0.3) { hint.animator().alphaValue = 1 }
      DispatchQueue.main.asyncAfter(deadline: .now() + 2.6) { [weak self] in
        guard let self else { return }
        NyteMotion.animate(0.4) { self.hint.animator().alphaValue = 0 }
      }
    } else {
      hint.alphaValue = 0
    }
  }

  /// Brings the composer up on glass, or puts it away. It rises a few points on a spring.
  private func showWhisper(_ show: Bool) {
    guard model.zen, show != whisperShown else { return }
    whisperShown = show
    if show {
      dock.isHidden = false
      if !NyteMotion.reduced, let layer = dock.layer {
        let rise = CASpringAnimation(keyPath: "transform.translation.y")
        rise.fromValue = -12
        rise.toValue = 0
        rise.mass = 1
        rise.stiffness = CGFloat(NyteSpring.travel.stiffness)
        rise.damping = CGFloat(NyteSpring.travel.damping)
        rise.duration = rise.settlingDuration
        layer.add(rise, forKey: "rise")
      }
      NyteMotion.animate(0.16) { dock.animator().alphaValue = 1 }
    } else {
      NyteMotion.animate(0.14, { dock.animator().alphaValue = 0 }) { [weak self] in
        guard let self, !self.whisperShown, self.model.zen else { return }
        self.dock.isHidden = true
      }
    }
  }
}

/// A small capsule on the floating surface: a spinner and a line of text.
private final class Pill: NSView {
  let label = NSTextField.nyteLabel("", .sm, .regular, .contentSecondary)
  private let spinner = NSProgressIndicator()
  var spins = false {
    didSet {
      spinner.isHidden = !spins
      spins ? spinner.startAnimation(nil) : spinner.stopAnimation(nil)
    }
  }

  init() {
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false
    let surface = FloatingSurface(radius: 14)
    addSubview(surface)
    surface.pin(to: self)
    spinner.style = .spinning
    spinner.controlSize = .small
    spinner.isHidden = true
    spinner.translatesAutoresizingMaskIntoConstraints = false
    label.lineBreakMode = .byTruncatingMiddle
    let stack = NSStackView(views: [spinner, label])
    stack.spacing = 7
    surface.contentView.addSubview(stack)
    stack.pin(to: surface.contentView, insets: NSEdgeInsets(top: 0, left: 11, bottom: 0, right: 12))
    NSLayoutConstraint.activate([
      heightAnchor.constraint(equalToConstant: 28), spinner.widthAnchor.constraint(equalToConstant: 14),
      spinner.heightAnchor.constraint(equalToConstant: 14),
    ])
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }
}

/// A capsule of glass with one line in it, for a hint that comes and goes.
private final class GlassPill: NSView {
  let label = NSTextField.nyteLabel("", .sm, .medium, .contentSecondary)

  init() {
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false
    let glass = GlassSurface(radius: 15)
    addSubview(glass)
    glass.pin(to: self)
    glass.contentView.addSubview(label)
    label.pin(to: glass.contentView, insets: NSEdgeInsets(top: 7, left: 14, bottom: 7, right: 14))
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }
}
