import AppKit
import Lune
import NyteDesign
import NyteKit

@MainActor
final class WorkbenchViewController: NSViewController {
  private let model: StudioModel
  private let canvas = CanvasView(frame: .zero)
  private let dock: DockView
  private let hint = GlassPill()
  private var canvasFocusCount = 0
  private let editing = ComponentBanner()
  private let empty = NSStackView()
  private var observers: [Observer] = []
  private var revision = -1
  private var marks: Set<UUID> = []
  private var shownSelection: CanvasSelection?
  private var focusCount = 0
  private var wasBusy = false
  private var said: (session: String, tail: DockTail)?
  private var notice: String?
  private var noticeTimer: Timer?
  private var hintTimer: DispatchWorkItem?
  private var whisperShown = false

  init(model: StudioModel) {
    self.model = model
    dock = DockView(composer: ComposerView(model: model))
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
    empty.spacing = NyteSpace.s2.rawValue
    empty.translatesAutoresizingMaskIntoConstraints = false
    empty.addArrangedSubview(MoonView(.xl))
    empty.addArrangedSubview(NSTextField.nyteLabel("No designs here yet", .lg, .medium))
    let line = NSTextField.nyteWrapping(
      "Ask for a screen below. Nyte writes it as a .lune file in this project, and it appears here.",
      .base, .contentTertiary)
    line.alignment = .center
    line.preferredMaxLayoutWidth = NyteMetric.emptyLine.rawValue
    empty.addArrangedSubview(line)
    empty.isHidden = true

    hint.label.stringValue = "Zen  ·  / to ask  ·  ⌘. to leave"
    hint.isHidden = true
    editing.isHidden = true

    for (name, tagged) in [("canvas", canvas), ("composer", dock), ("zen-hint", hint)] as [(String, NSView)] {
      tagged.identifier = NSUserInterfaceItemIdentifier(name)
    }
    for subview in [empty, dock, hint, editing] as [NSView] { view.addSubview(subview) }
    dock.fitWidth(in: view, margin: .s6)
    NSLayoutConstraint.activate([
      empty.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      empty.centerYAnchor.above(view.centerYAnchor, .s8),
      dock.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      dock.bottomAnchor.above(view.bottomAnchor, .s4),
      editing.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      editing.topAnchor.below(view.safeAreaLayoutGuide.topAnchor, .s1),
      hint.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      hint.bottomAnchor.above(view.bottomAnchor, .s6),
    ])

    wire()
    observers = [
      Observer { [weak self] in self?.syncCanvas() },
      Observer { [weak self] in self?.syncChrome() },
      Observer { [weak self] in self?.syncFocus() },
      Observer { [weak self] in self?.syncCanvasFocus() },
    ]
  }

  override func viewDidLayout() {
    super.viewDidLayout()
    updateInsets()
  }

  private func updateInsets() {
    let margin = NyteSpace.s8.rawValue
    let top = model.zen ? 0 : view.safeAreaInsets.top
    let bottom = model.zen || dock.isHidden ? 0 : dock.frame.height + NyteSpace.s4.rawValue
    canvas.insets = NSEdgeInsets(top: top + margin, left: margin, bottom: bottom + margin, right: margin)
  }

  private func wire() {
    let model = model
    canvas.onSelect = { [weak self] selection in
      model.selection = selection
      if selection != nil, model.panel == .chat, model.transcript == nil { model.panel = .design }
      if model.zen { self?.putAway() }
    }
    canvas.onMoveFrame = { selection, origin, commit in model.moveFrame(selection, to: origin, commit: commit) }
    canvas.onResize = { selection, size, origin, commit in
      model.resize(selection, to: size, origin: origin, commit: commit)
    }
    canvas.onDelete = { model.delete($0) }
    canvas.onZoom = { zoom in
      DispatchQueue.main.async {
        if (model.zoom * 100).rounded() != (zoom * 100).rounded() { model.zoom = zoom }
      }
    }
    canvas.onAsk = { model.focusComposer() }
    canvas.onEditText = { DispatchQueue.main.async { model.editText() } }
    canvas.onEscape = { if model.zen { model.zen = false } }
    canvas.markupForSelection = { model.selectedMarkup }
    dock.composer.onCancel = { [weak self] in self?.leaveComposer() }
    dock.composer.onSend = { [weak self] in
      guard let self else { return }
      self.putAway()
      if self.model.zen { self.leaveComposer() }
    }
    dock.onStop = { model.stop() }
    dock.onOpenNyte = { model.openInNyte() }
    dock.onDismiss = { [weak self] in self?.putAway() }
    dock.onOpenChat = { [weak self] in
      self?.putAway()
      model.showChat()
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

    if let component = model.editedComponent {
      editing.show(component.name, instances: component.instances)
      NyteMotion.show(editing, true, enter: .fast)
    } else {
      NyteMotion.show(editing, false, exit: .fast)
    }
  }

  private func syncChrome() {
    let transcript = model.transcript
    let busy = transcript?.execution.isBusy ?? false
    canvas.working = busy ? workingFiles(transcript) : []

    if let transcript, wasBusy, !busy, let word = lastWord(transcript) { said = (transcript.session, word) }
    if busy || said?.session != transcript?.session || model.chatShown { said = nil }
    wasBusy = busy

    if let text = model.project?.notice {
      model.project?.notice = nil
      notice = text
      noticeTimer?.invalidate()
      noticeTimer = Timer.scheduledTimer(withTimeInterval: Dwell.notice, repeats: false) { [weak self] _ in
        MainActor.assumeIsolated {
          self?.notice = nil
          self?.settleDock(fade: true)
        }
      }
    }
    settleDock(fade: true)
  }

  private var tail: DockTail? {
    if let notice { return .notice(notice) }
    guard let transcript = model.transcript, transcript.execution.isBusy else { return said?.tail }
    return transcript.execution == .waiting ? .waiting : .working(activityLine(transcript))
  }

  private func lastWord(_ transcript: Transcript) -> DockTail? {
    if case .idle(let failed?) = transcript.execution { return .failed(failed) }
    guard let turn = transcript.items.last?.turn else { return nil }
    for item in transcript.items.reversed() where item.turn == turn {
      if case .answer(let markdown, _) = item.body, !markdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return .answer(markdown)
      }
    }
    return nil
  }

  private func putAway() {
    guard said != nil || notice != nil else { return }
    said = nil
    notice = nil
    noticeTimer?.invalidate()
    settleDock(fade: true)
  }

  private func settleDock(fade: Bool) {
    let floating = model.zen || !model.inspectorShown
    let input = floating && (!model.zen || whisperShown)
    let tail = floating ? tail : notice.map { DockTail.notice($0) }
    let shown = input || tail != nil
    if shown {
      dock.showsInput = input
      dock.tail = tail
    }
    if fade {
      NyteMotion.show(dock, shown, enter: .slow, exit: .normal)
    } else {
      dock.layer?.removeAnimation(forKey: "nyte.fade")
      dock.alphaValue = shown ? 1 : 0
      dock.isHidden = !shown
    }
  }

  private func workingFiles(_ transcript: Transcript?) -> Set<String> {
    guard let transcript, let files = model.project?.files, let turn = transcript.items.last?.turn else { return [] }
    var out: Set<String> = []
    if let asked = model.askedAbout { out.insert(asked) }
    for item in transcript.items where item.turn == turn {
      guard case .tool(let step) = item.body, step.kind == "edit", let path = step.path else { continue }
      for file in files where path == file || path.hasSuffix("/" + file) { out.insert(file) }
    }
    return out
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
    if case .answer(let markdown, true) = transcript.items.last?.body {
      let line = markdown.split(whereSeparator: \.isWhitespace).joined(separator: " ")
      if !line.isEmpty { return line }
    }
    if case .retrying(let reason) = transcript.execution { return "Retrying: \(reason)" }
    return transcript.activity ?? "Thinking"
  }

  private func syncFocus() {
    let count = model.composerFocus
    guard count != focusCount else { return }
    focusCount = count
    guard !model.chatShown else { return }
    showWhisper(true)
    dock.composer.focus()
  }

  private func syncCanvasFocus() {
    let count = model.canvasFocus
    guard count != canvasFocusCount else { return }
    canvasFocusCount = count
    view.window?.makeFirstResponder(canvas)
  }

  private func leaveComposer() {
    showWhisper(false)
    view.window?.makeFirstResponder(canvas)
  }

  // MARK: Zen

  func zenChanged() {
    whisperShown = false
    hintTimer?.cancel()
    if model.zen {
      view.window?.makeFirstResponder(canvas)
      NyteMotion.show(hint, true)
      let work = DispatchWorkItem { [weak self] in
        guard let self else { return }
        NyteMotion.show(self.hint, false)
      }
      hintTimer = work
      DispatchQueue.main.asyncAfter(deadline: .now() + Dwell.hint, execute: work)
    } else {
      NyteMotion.show(hint, false, exit: .fast)
    }
    settleDock(fade: true)
    updateInsets()
  }

  private func showWhisper(_ show: Bool) {
    guard model.zen, show != whisperShown else { return }
    whisperShown = show
    settleDock(fade: false)
  }
}

private enum Dwell {
  static let notice: TimeInterval = 5
  static let hint: TimeInterval = 2.5
}

private final class GlassPill: NSView {
  let label = NSTextField.nyteLabel("", .sm, .medium, .contentSecondary)

  init() {
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false
    wantsLayer = true
    let glass = GlassSurface(.pill(.md))
    addSubview(glass)
    glass.pin(to: self)
    glass.contentView.addSubview(label)
    label.pin(to: glass.contentView, insets: NyteInsets(horizontal: .s3), edges: .horizontal)
    label.centerYAnchor.constraint(equalTo: glass.contentView.centerYAnchor).isActive = true
    height(.md)
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }
}

private final class ComponentBanner: NSView {
  private let name = NSTextField.nyteLabel("", .sm, .medium)
  private let count = NSTextField.nyteLabel("", .sm, .regular)
  private let mark = NSImageView()

  init() {
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false
    wantsLayer = true
    let surface = FloatingSurface(.pill(.md))
    addSubview(surface)
    surface.pin(to: self)
    mark.image = NSImage(systemSymbolName: "diamond.fill", accessibilityDescription: nil)
    mark.symbolConfiguration = .init(pointSize: NyteGlyph.xs.pointSize, weight: .medium)
    mark.square(NyteGlyph.sm)
    for view in [mark, name, count] as [NSView] {
      view.setContentCompressionResistancePriority(.required, for: .horizontal)
    }
    mark.contentTintColor = .nyte(.contentAccent, hue: .purple)
    name.textColor = .nyte(.contentAccent, hue: .purple)
    count.textColor = .nyte(.contentSecondary)
    let row = NSStackView.row(gap: .s1_5, [mark, name, count])
    row.setCustomSpacing(NyteSpace.s2.rawValue, after: name)
    surface.contentView.addSubview(row)
    row.pin(to: surface.contentView, insets: NyteInsets(horizontal: .s3), edges: .horizontal)
    row.centerYAnchor.constraint(equalTo: surface.contentView.centerYAnchor).isActive = true
    height(.md)
    setAccessibilityElement(true)
    setAccessibilityRole(.staticText)
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  func show(_ component: String, instances: Int) {
    name.stringValue = "Editing \(component)"
    count.stringValue = instances == 1 ? "1 instance" : "\(instances) instances"
    setAccessibilityLabel("Editing the component \(component), used \(instances) times")
  }
}
