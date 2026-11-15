// TEMPORARY development probe. Not part of the product; delete before finishing.
import AppKit

@MainActor
enum Probe {
  static let directory = ProcessInfo.processInfo.environment["NYTE_STUDIO_PROBE_DIR"] ?? "/tmp/nyte-studio-scratch"
  static var recorder: FrameRecorder?
  static var tracer: Tracer?

  static func start(_ model: StudioModel) {
    guard let path = ProcessInfo.processInfo.environment["NYTE_STUDIO_PROBE"],
      let script = try? String(contentsOfFile: path, encoding: .utf8)
    else { return }
    Task { @MainActor in
      for raw in script.split(separator: "\n") {
        let line = raw.trimmingCharacters(in: .whitespaces)
        if line.isEmpty || line.hasPrefix("#") { continue }
        let parts = line.split(separator: " ", maxSplits: 1).map(String.init)
        let args = parts.count > 1 ? parts[1].split(separator: " ").map(String.init) : []
        let rest = parts.count > 1 ? parts[1] : ""
        func n(_ i: Int) -> CGFloat { CGFloat(Double(args[i]) ?? 0) }
        switch parts[0] {
        case "wait": try? await Task.sleep(for: .seconds(Double(rest) ?? 1))
        case "click":
          mouse(.leftMouseDown, n(0), n(1)); mouse(.leftMouseUp, n(0), n(1))
        case "move": mouse(.mouseMoved, n(0), n(1))
        case "drag":
          mouse(.leftMouseDown, n(0), n(1))
          for step in 1...10 {
            let t = CGFloat(step) / 10
            mouse(.leftMouseDragged, n(0) + (n(2) - n(0)) * t, n(1) + (n(3) - n(1)) * t)
            try? await Task.sleep(for: .milliseconds(30))
          }
          mouse(.leftMouseUp, n(2), n(3))
        case "key": key(UInt16(args[0]) ?? 0, cmd: args.contains("cmd"), shift: args.contains("shift"))
        case "zoom": canvas?.setZoom(n(0), animated: args.contains("animated"))
        case "type": model.draft = rest
        case "send": model.send()
        case "ask": model.focusComposer()
        case "zen": model.zen = rest == "on"
        case "panel": model.panel = rest == "chat" ? .chat : .design
        case "mode": model.project?.mode = rest == "dark" ? .dark : .light
        case "fit": model.cameraRequest = .fitAll
        case "sheet": model.cameraRequest = .sheet(rest)
        case "set": model.set([args[0]: args.count > 1 ? args[1...].joined(separator: " ") : nil])
        case "undo": NSApp.windows.first?.undoManager?.undo()
        case "redo": NSApp.windows.first?.undoManager?.redo()
        case "choose": model.chooseWorkspace()
        case "appearance": NSApp.appearance = NSAppearance(named: rest == "light" ? .aqua : .darkAqua)
        case "resize":
          if let window = NSApp.windows.first(where: { $0.isVisible && $0.frame.width > 300 }) {
            var frame = window.frame
            frame.origin.y += frame.height - n(1)
            frame.size = NSSize(width: n(0), height: n(1))
            window.setFrame(frame, display: true)
          }
        case "sidebar", "inspector":
          // sidebar|inspector [on|off]: show or hide a side, or toggle it with no argument
          @MainActor func split(_ controller: NSViewController?) -> NSSplitViewController? {
            if let found = controller as? NSSplitViewController { return found }
            for child in controller?.children ?? [] { if let found = split(child) { return found } }
            return nil
          }
          let window = NSApp.windows.first(where: { $0.isVisible && $0.frame.width > 300 })
          if let items = split(window?.contentViewController)?.splitViewItems, items.count == 3 {
            let item = parts[0] == "sidebar" ? items[0] : items[2]
            item.isCollapsed = rest == "on" ? false : rest == "off" ? true : !item.isCollapsed
          }
        case "dump": dump(rest)
        case "trace":
          // trace start <name>: sample every animated thing on each display refresh, until
          // trace stop. The commands in between are what gets traced.
          if args.first == "start", args.count > 1, let window = NSApp.windows.first(where: { $0.isVisible && $0.frame.width > 300 }) {
            let tracer = Tracer(window: window, path: "\(directory)/\(args[1]).json")
            Probe.tracer = tracer
            tracer.start()
          } else {
            Probe.tracer?.stop()
            Probe.tracer = nil
          }
        case "mem":
          // mem <name>: this process's physical footprint, the number Activity Monitor shows
          var info = task_vm_info_data_t()
          var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
          let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
              task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
            }
          }
          if result == KERN_SUCCESS {
            let line = "{\"physFootprintBytes\": \(info.phys_footprint), \"uptimeSeconds\": \(ProcessInfo.processInfo.systemUptime)}\n"
            try? line.write(toFile: "\(directory)/\(rest).json", atomically: true, encoding: .utf8)
          }
        case "frames":
          // frames <name> <zoom>: fly the camera to a zoom and record every display refresh on the way
          let recorder = FrameRecorder()
          Probe.recorder = recorder
          if let canvas { recorder.start(on: canvas) }
          model.cameraRequest = .zoom(n(1))
          try? await Task.sleep(for: .seconds(1.2))
          recorder.stop(writingTo: "\(directory)/\(args[0]).json")
        case "shot":
          let request = "\(directory)/shot-request"
          try? rest.write(toFile: request, atomically: true, encoding: .utf8)
          while FileManager.default.fileExists(atPath: request) { try? await Task.sleep(for: .milliseconds(40)) }
        default: FileHandle.standardError.write(Data("probe: unknown \(line)\n".utf8))
        }
        try? await Task.sleep(for: .milliseconds(60))
      }
    }
  }

  /// Writes every view's frame, in points from the window's top-left corner, with what it says.
  static func dump(_ name: String) {
    guard let window = NSApp.windows.first(where: { $0.isVisible && $0.frame.width > 300 }),
      let root = window.contentView?.superview
    else { return }
    var rows: [[String: Any]] = []
    func walk(_ view: NSView, _ depth: Int) {
      let inWindow = view.convert(view.bounds, to: nil)
      var row: [String: Any] = [
        "class": String(describing: type(of: view)), "depth": depth,
        "x": inWindow.minX, "y": window.frame.height - inWindow.maxY, "w": inWindow.width, "h": inWindow.height,
        "hidden": view.isHiddenOrHasHiddenAncestor, "alpha": view.alphaValue,
      ]
      if let id = view.identifier?.rawValue { row["id"] = id }
      if let role = view.accessibilityRole()?.rawValue { row["axRole"] = role }
      if let label = view.accessibilityLabel(), !label.isEmpty { row["axLabel"] = label }
      if let tip = view.toolTip { row["toolTip"] = tip }
      if let control = view as? NSControl {
        row["controlSize"] = control.controlSize.rawValue
        row["enabled"] = control.isEnabled
        if let font = control.font { row["font"] = "\(font.fontName) \(font.pointSize)" }
        row["canBecomeKey"] = control.canBecomeKeyView
      }
      if let field = view as? NSTextField {
        row["text"] = field.stringValue
        row["placeholder"] = field.placeholderString ?? ""
        row["editable"] = field.isEditable
      }
      if let button = view as? NSButton { row["title"] = button.title }
      if let text = view as? NSTextView { row["text"] = text.string }
      rows.append(row)
      for sub in view.subviews { walk(sub, depth + 1) }
    }
    walk(root, 0)
    let out: [String: Any] = [
      "window": ["w": window.frame.width, "h": window.frame.height, "scale": window.backingScaleFactor],
      "views": rows,
    ]
    if let data = try? JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys]) {
      try? data.write(to: URL(filePath: "\(directory)/\(name).json"))
    }
  }

  static var canvas: CanvasView? {
    func find(_ view: NSView) -> CanvasView? {
      if let canvas = view as? CanvasView { return canvas }
      for sub in view.subviews { if let found = find(sub) { return found } }
      return nil
    }
    return NSApp.windows.compactMap { $0.contentView.flatMap(find) }.first
  }

  /// x, y in canvas coordinates: points from the canvas view's top-left corner.
  static func mouse(_ type: NSEvent.EventType, _ x: CGFloat, _ y: CGFloat) {
    guard let canvas, let window = canvas.window else { return }
    let inWindow = canvas.convert(NSPoint(x: x, y: canvas.bounds.height - y), to: nil)
    guard let event = NSEvent.mouseEvent(
      with: type, location: inWindow, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
      windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)
    else { return }
    switch type {
    case .leftMouseDown: canvas.mouseDown(with: event)
    case .leftMouseDragged: canvas.mouseDragged(with: event)
    case .leftMouseUp: canvas.mouseUp(with: event)
    case .mouseMoved: canvas.mouseMoved(with: event)
    default: break
    }
  }

  static func key(_ code: UInt16, cmd: Bool, shift: Bool) {
    guard let canvas, let window = canvas.window else { return }
    var flags: NSEvent.ModifierFlags = []
    if cmd { flags.insert(.command) }
    if shift { flags.insert(.shift) }
    guard let event = NSEvent.keyEvent(
      with: .keyDown, location: .zero, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
      windowNumber: window.windowNumber, context: nil, characters: "", charactersIgnoringModifiers: "",
      isARepeat: false, keyCode: code)
    else { return }
    canvas.keyDown(with: event)
  }
}

/// Records when the display asks for each frame while something animates.
@MainActor
final class FrameRecorder: NSObject {
  private var link: CADisplayLink?
  private var stamps: [Double] = []
  private var budgets: [Double] = []

  func start(on view: NSView) {
    link = view.displayLink(target: self, selector: #selector(tick(_:)))
    link?.add(to: .main, forMode: .common)
  }

  @objc private func tick(_ link: CADisplayLink) {
    stamps.append(CACurrentMediaTime())
    budgets.append(link.targetTimestamp - link.timestamp)
  }

  func stop(writingTo path: String) {
    link?.invalidate()
    let intervals = zip(stamps.dropFirst(), stamps).map { ($0 - $1) * 1000 }
    let out: [String: Any] = [
      "refreshIntervalMs": (budgets.first ?? 0) * 1000, "callbacks": stamps.count, "intervalsMs": intervals,
    ]
    if let data = try? JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted]) {
      try? data.write(to: URL(filePath: path))
    }
  }
}

/// Samples, on every display refresh, the camera and each tagged view as it is drawn right now:
/// the presentation layer's opacity and vertical offset, and the view's frame in the window.
@MainActor
final class Tracer: NSObject {
  private let window: NSWindow
  private let path: String
  private var link: CADisplayLink?
  private var origin = 0.0
  private var samples: [[String: Any]] = []
  private var tagged: [(String, NSView)] = []
  private weak var canvas: CanvasView?

  init(window: NSWindow, path: String) {
    self.window = window
    self.path = path
  }

  func start() {
    guard let root = window.contentView?.superview else { return }
    func walk(_ view: NSView) {
      if let id = view.identifier?.rawValue, ["canvas", "composer", "activity", "notice", "zen-hint", "sidebar", "inspector"].contains(id) {
        tagged.append((id, view))
      }
      if let found = view as? CanvasView { canvas = found }
      for sub in view.subviews { walk(sub) }
    }
    walk(root)
    if let lights = window.standardWindowButton(.closeButton)?.superview { tagged.append(("traffic-lights", lights)) }
    origin = CACurrentMediaTime()
    link = root.displayLink(target: self, selector: #selector(tick(_:)))
    link?.add(to: .main, forMode: .common)
  }

  @objc private func tick(_ link: CADisplayLink) {
    var sample: [String: Any] = ["t": (CACurrentMediaTime() - origin) * 1000]
    if let canvas {
      sample["camera"] = ["zoom": canvas.zoom, "panX": canvas.pan.x, "panY": canvas.pan.y]
    }
    for (name, view) in tagged {
      let frame = view.convert(view.bounds, to: nil)
      let shown = view.layer?.presentation() ?? view.layer
      sample[name] = [
        "opacity": shown?.opacity ?? Float(view.alphaValue), "ty": shown?.transform.m42 ?? 0,
        "x": frame.minX, "y": window.frame.height - frame.maxY, "w": frame.width, "h": frame.height,
        "hidden": view.isHidden,
      ]
    }
    samples.append(sample)
  }

  func stop() {
    link?.invalidate()
    if let data = try? JSONSerialization.data(withJSONObject: ["samples": samples], options: [.sortedKeys]) {
      try? data.write(to: URL(filePath: path))
    }
  }
}
