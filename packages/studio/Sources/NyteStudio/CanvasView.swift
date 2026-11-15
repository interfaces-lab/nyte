import AppKit
import Lune
import NyteDesign
import QuartzCore

/// What is selected on the canvas: an element of a file, seen in one of that file's frames.
struct CanvasSelection: Hashable {
  var sheet: String
  var frame: Int
  var site: ElementRef

  var isFrame: Bool { site.file == sheet && site.path.count == 1 }
}

enum CanvasTool {
  case select
  case hand
}

/// The infinite canvas. Core Animation composites it on the GPU; each frame is rasterized off
/// the main thread by the same Core Graphics renderer the `lune` command uses, at exactly the
/// pixel scale it is shown at, and re-rasterized once a zoom settles.
final class CanvasView: NSView {
  var onSelect: ((CanvasSelection?) -> Void)?
  /// A frame dragged to a new place in its file. `commit` is false while the drag continues.
  var onMoveFrame: ((_ selection: CanvasSelection, _ origin: CGPoint, _ commit: Bool) -> Void)?
  /// A selection resized. `origin` is set when a frame's top or left edge moved.
  var onResize: ((_ selection: CanvasSelection, _ size: CGSize, _ origin: CGPoint?, _ commit: Bool) -> Void)?
  var onDelete: ((CanvasSelection) -> Void)?
  var onZoom: ((CGFloat) -> Void)?
  /// The person wants to talk about what is selected: `/`, or Ask Nyte in the context menu.
  var onAsk: (() -> Void)?
  /// Escape with nothing left to step out of.
  var onEscape: (() -> Void)?

  var tool: CanvasTool = .select { didSet { window?.invalidateCursorRects(for: self) } }
  /// The parts of the view that chrome covers. Fitting keeps frames clear of them.
  var insets = NSEdgeInsets(top: 64, left: 32, bottom: 150, right: 32)

  private(set) var zoom: CGFloat = 1
  private(set) var pan = CGPoint.zero

  private var sheets: [SheetModel] = []
  private var selection: CanvasSelection?
  private var artboards: [String: Artboard] = [:]
  private var order: [String] = []
  private var sheetLabels: [String: CATextLayer] = [:]
  private var glows: [Glow] = []
  private var fitted = false

  private let grid = CAReplicatorLayer()
  private let gridRow = CAReplicatorLayer()
  private let dot = CALayer()
  private let boards = CALayer()
  private let effects = CALayer()
  private let overlay = CALayer()
  private let hoverOutline = CAShapeLayer()
  private let selectionOutline = CAShapeLayer()
  private var handles: [CALayer] = []
  private let badge = CALayer()
  private let badgeText = CATextLayer()

  private var hover: (sheet: String, frame: Int, site: ElementRef)?
  private var drag: Drag = .none
  private var spaceHeld = false
  private var settle: DispatchWorkItem?
  private var flight: Flight?
  private var link: CADisplayLink?
  private var tracking: NSTrackingArea?
  private var leftEdge: CGFloat?

  private var isDark: Bool {
    effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
  }

  private var backing: CGFloat { window?.backingScaleFactor ?? 2 }

  override init(frame: NSRect) {
    super.init(frame: frame)
    let root = CALayer()
    layer = root
    wantsLayer = true
    root.masksToBounds = true

    dot.cornerRadius = 1
    gridRow.addSublayer(dot)
    grid.addSublayer(gridRow)
    for layer in [grid, boards, effects, overlay] as [CALayer] { root.addSublayer(layer) }

    for outline in [hoverOutline, selectionOutline] {
      outline.fillColor = nil
      outline.isHidden = true
      overlay.addSublayer(outline)
    }
    hoverOutline.lineWidth = 1
    selectionOutline.lineWidth = 1.5

    for _ in 0..<4 {
      let handle = CALayer()
      handle.bounds = CGRect(x: 0, y: 0, width: 8, height: 8)
      handle.cornerRadius = 4
      handle.borderWidth = 1.5
      handle.isHidden = true
      overlay.addSublayer(handle)
      handles.append(handle)
    }

    badge.cornerRadius = 6
    badge.cornerCurve = .continuous
    badge.isHidden = true
    badgeText.font = NSFont.nyte(.xs, .medium)
    badgeText.fontSize = 11
    badgeText.alignmentMode = .center
    badge.addSublayer(badgeText)
    overlay.addSublayer(badge)
    refreshColors()
  }

  required init?(coder: NSCoder) {
    fatalError("CanvasView is made in code.")
  }

  override var acceptsFirstResponder: Bool { true }
  override var isOpaque: Bool { true }

  /// A click on the canvas of a window in the background selects, as it does in Nyte.
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  // MARK: Scene

  /// Shows a new set of sheets. A frame is redrawn only when its sheet's revision moved.
  func update(sheets next: [SheetModel], selection nextSelection: CanvasSelection?) {
    sheets = next
    selection = nextSelection
    var seen: Set<String> = []
    var nextOrder: [String] = []

    for sheet in next {
      for (index, layout) in sheet.frames.enumerated() {
        let key = "\(sheet.path)#\(index)"
        seen.insert(key)
        nextOrder.append(key)
        let world = sheet.worldRect(of: index)
        if let artboard = artboards[key] {
          let redraw = artboard.revision != sheet.revision
          artboard.layout = layout
          artboard.world = world
          if redraw {
            artboard.revision = sheet.revision
            artboard.baseScale = 0
            artboard.detailRegion = nil
          }
        } else {
          let artboard = Artboard(sheet: sheet.path, index: index, layout: layout, world: world, revision: sheet.revision)
          artboard.label.font = NSFont.nyte(.sm, .medium)
          artboard.label.fontSize = 12
          artboard.label.truncationMode = .end
          boards.addSublayer(artboard.shadow)
          boards.addSublayer(artboard.base)
          boards.addSublayer(artboard.detail)
          overlay.insertSublayer(artboard.label, at: 0)
          artboards[key] = artboard
        }
      }

      let label = sheetLabels[sheet.path] ?? {
        let label = CATextLayer()
        label.font = NSFont.nyte(.sm, .regular)
        label.fontSize = 12
        label.truncationMode = .middle
        overlay.insertSublayer(label, at: 0)
        sheetLabels[sheet.path] = label
        return label
      }()
      label.string = sheet.error.map { "\(sheet.path)  ·  line \($0.line): \($0.message)" } ?? sheet.path
    }

    for (key, artboard) in artboards where !seen.contains(key) {
      for layer in [artboard.shadow, artboard.base, artboard.detail, artboard.label] as [CALayer] {
        layer.removeFromSuperlayer()
      }
      artboards[key] = nil
    }
    for (path, label) in sheetLabels where !next.contains(where: { $0.path == path }) {
      label.removeFromSuperlayer()
      sheetLabels[path] = nil
    }
    order = nextOrder
    refreshColors()

    if !fitted, !next.isEmpty, bounds.width > 0 {
      fitted = true
      apply(fitCamera(to: contentBounds()))
    }
    arrange()
    rasterize()
  }

  func select(_ next: CanvasSelection?) {
    selection = next
    arrangeOverlay()
  }

  /// Lights up places an agent just changed, then lets them fade.
  func flash(_ marks: [ChangeMark]) {
    for mark in marks {
      guard let sheet = sheets.first(where: { $0.path == mark.sheet }), sheet.frames.indices.contains(mark.frame)
      else { continue }
      let frame = sheet.worldRect(of: mark.frame)
      let glow = Glow(world: mark.rect.offsetBy(dx: frame.minX, dy: frame.minY))
      let tint = CGColor(srgbRed: 0.48, green: 0.58, blue: 0.84, alpha: 1)
      glow.layer.strokeColor = tint
      glow.layer.fillColor = tint.copy(alpha: 0.1)
      glow.layer.lineWidth = 2
      glow.layer.shadowColor = tint
      glow.layer.shadowOpacity = 1
      glow.layer.shadowRadius = 12
      glow.layer.shadowOffset = .zero
      glow.layer.opacity = 0
      effects.addSublayer(glow.layer)
      glows.append(glow)

      let fade = CAKeyframeAnimation(keyPath: "opacity")
      fade.values = [0, 1, 1, 0]
      fade.keyTimes = [0, 0.12, 0.45, 1]
      fade.duration = 1.8
      fade.timingFunction = CAMediaTimingFunction(name: .easeOut)
      CATransaction.begin()
      CATransaction.setCompletionBlock { [weak self, weak glow] in
        guard let glow else { return }
        glow.layer.removeFromSuperlayer()
        self?.glows.removeAll { $0 === glow }
      }
      glow.layer.add(fade, forKey: "fade")
      CATransaction.commit()
    }
    arrange()
  }

  // MARK: Camera

  private func toScreen(_ point: CGPoint) -> CGPoint {
    CGPoint(x: point.x * zoom + pan.x, y: point.y * zoom + pan.y)
  }

  private func toScreen(_ rect: CGRect) -> CGRect {
    CGRect(
      x: rect.minX * zoom + pan.x, y: rect.minY * zoom + pan.y, width: rect.width * zoom,
      height: rect.height * zoom)
  }

  private func toWorld(_ point: CGPoint) -> CGPoint {
    CGPoint(x: (point.x - pan.x) / zoom, y: (point.y - pan.y) / zoom)
  }

  /// Converts a rectangle measured from the view's top-left corner into the layer tree's
  /// coordinates, which count up from the bottom.
  private func layerRect(_ rect: CGRect) -> CGRect {
    CGRect(x: rect.minX, y: bounds.height - rect.maxY, width: rect.width, height: rect.height)
  }

  private func snap(_ value: CGFloat) -> CGFloat {
    (value * backing).rounded() / backing
  }

  private func location(_ event: NSEvent) -> CGPoint {
    let point = convert(event.locationInWindow, from: nil)
    return CGPoint(x: point.x, y: bounds.height - point.y)
  }

  private func contentBounds() -> CGRect {
    artboards.values.reduce(CGRect.null) { $0.union($1.world) }
  }

  private func fitCamera(to rect: CGRect, maxZoom: CGFloat = 1) -> (zoom: CGFloat, pan: CGPoint) {
    guard !rect.isNull, rect.width > 0, rect.height > 0 else { return (zoom, pan) }
    let area = CGRect(
      x: insets.left, y: insets.top, width: max(120, bounds.width - insets.left - insets.right),
      height: max(120, bounds.height - insets.top - insets.bottom))
    let scale = min(maxZoom, min(area.width / rect.width, area.height / rect.height))
    return (
      scale,
      CGPoint(x: area.midX - rect.midX * scale, y: area.midY - rect.midY * scale)
    )
  }

  private func apply(_ camera: (zoom: CGFloat, pan: CGPoint)) {
    zoom = camera.zoom
    pan = camera.pan
    onZoom?(zoom)
  }

  /// Flies the camera on a critically damped spring: it leaves at once and lands without
  /// overshoot. Under Reduce Motion it cuts.
  private func fly(to camera: (zoom: CGFloat, pan: CGPoint)) {
    guard !NyteMotion.reduced, window != nil else {
      flight = nil
      apply(camera)
      arrange()
      rasterize()
      return
    }
    let center = CGPoint(x: bounds.midX, y: bounds.midY)
    flight = Flight(
      start: CACurrentMediaTime(), fromZoom: zoom, toZoom: camera.zoom, fromCenter: toWorld(center),
      toCenter: CGPoint(x: (center.x - camera.pan.x) / camera.zoom, y: (center.y - camera.pan.y) / camera.zoom))
    if link == nil {
      link = displayLink(target: self, selector: #selector(step(_:)))
      link?.add(to: .main, forMode: .common)
    }
  }

  @objc private func step(_ link: CADisplayLink) {
    guard let flight else {
      link.invalidate()
      self.link = nil
      return
    }
    let elapsed = CACurrentMediaTime() - flight.start
    let done = elapsed >= NyteSpring.travel.settling
    let progress = done ? 1 : NyteSpring.travel.progress(at: elapsed)
    zoom = flight.fromZoom * pow(flight.toZoom / flight.fromZoom, progress)
    let center = CGPoint(
      x: flight.fromCenter.x + (flight.toCenter.x - flight.fromCenter.x) * progress,
      y: flight.fromCenter.y + (flight.toCenter.y - flight.fromCenter.y) * progress)
    pan = CGPoint(x: bounds.midX - center.x * zoom, y: bounds.midY - center.y * zoom)
    onZoom?(zoom)
    arrange()
    if done {
      self.flight = nil
      link.invalidate()
      self.link = nil
      rasterize()
    }
  }

  func fitAll(animated: Bool = true) {
    let camera = fitCamera(to: contentBounds())
    if animated { fly(to: camera) } else { apply(camera); arrange(); rasterize() }
  }

  func reveal(sheet path: String) {
    guard let sheet = sheets.first(where: { $0.path == path }), !sheet.frames.isEmpty else { return }
    let rect = sheet.extent.offsetBy(dx: sheet.origin.x, dy: sheet.origin.y)
    fly(to: fitCamera(to: rect.insetBy(dx: -40, dy: -60)))
  }

  func reveal(_ selection: CanvasSelection) {
    guard let rect = worldRect(of: selection) else { return }
    let padded = rect.insetBy(dx: -max(80, rect.width * 0.2), dy: -max(80, rect.height * 0.2))
    fly(to: fitCamera(to: padded, maxZoom: 2))
  }

  func setZoom(_ next: CGFloat, animated: Bool = true) {
    let center = CGPoint(x: bounds.midX, y: bounds.midY)
    let world = toWorld(center)
    let camera = (zoom: next, pan: CGPoint(x: center.x - world.x * next, y: center.y - world.y * next))
    if animated { fly(to: camera) } else { apply(camera); arrange(); rasterize() }
  }

  // The View menu reaches these through the responder chain.

  @objc func zoomToFit(_ sender: Any?) { fitAll() }
  @objc func zoomToSelection(_ sender: Any?) { if let selection { reveal(selection) } }
  @objc func zoomToActualSize(_ sender: Any?) { setZoom(1) }
  @objc func zoomIn(_ sender: Any?) { setZoom(min(64, zoom * 1.5)) }
  @objc func zoomOut(_ sender: Any?) { setZoom(max(0.02, zoom / 1.5)) }

  private func zoom(by factor: CGFloat, at point: CGPoint) {
    flight = nil
    let world = toWorld(point)
    zoom = min(64, max(0.02, zoom * factor))
    pan = CGPoint(x: point.x - world.x * zoom, y: point.y - world.y * zoom)
    onZoom?(zoom)
    arrange()
    rasterizeSoon()
  }

  // MARK: Arranging layers

  private func arrange() {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    arrangeGrid()

    for key in order {
      guard let artboard = artboards[key] else { continue }
      var rect = toScreen(artboard.world)
      rect.origin = CGPoint(x: snap(rect.minX), y: snap(rect.minY))
      let frame = layerRect(rect)
      artboard.base.frame = frame
      artboard.shadow.frame = frame
      let radius = min(artboard.layout.root.style.radii.topLeft * zoom, min(rect.width, rect.height) / 2)
      artboard.shadow.shadowPath = CGPath(
        roundedRect: CGRect(origin: .zero, size: rect.size), cornerWidth: radius, cornerHeight: radius,
        transform: nil)
      if let region = artboard.detailRegion {
        var detail = toScreen(region.offsetBy(dx: artboard.world.minX, dy: artboard.world.minY))
        detail.origin = CGPoint(x: snap(detail.minX), y: snap(detail.minY))
        artboard.detail.frame = layerRect(detail)
        artboard.detail.isHidden = false
      } else {
        artboard.detail.isHidden = true
      }

      let selected = selection.map { $0.sheet == artboard.sheet && $0.frame == artboard.index && $0.isFrame } ?? false
      artboard.label.string = artboard.layout.root.node.name
      artboard.label.foregroundColor = selected
        ? NyteRole.strokeAccent.cgColor(dark: isDark, hue: .blue) : NyteRole.contentTertiary.cgColor(dark: isDark)
      artboard.label.isHidden = rect.width < 56
      artboard.label.contentsScale = backing
      artboard.label.frame = layerRect(CGRect(x: rect.minX + 1, y: rect.minY - 22, width: max(40, rect.width), height: 16))
    }

    for sheet in sheets {
      guard let label = sheetLabels[sheet.path], !sheet.frames.isEmpty else { continue }
      let extent = toScreen(sheet.extent.offsetBy(dx: sheet.origin.x, dy: sheet.origin.y))
      label.contentsScale = backing
      label.foregroundColor = sheet.error == nil
        ? NyteRole.contentQuaternary.cgColor(dark: isDark)
        : NyteRole.contentAccent.cgColor(dark: isDark, hue: .red)
      label.frame = layerRect(CGRect(x: snap(extent.minX) + 1, y: snap(extent.minY) - 46, width: max(240, extent.width), height: 16))
    }

    for glow in glows {
      let rect = toScreen(glow.world).insetBy(dx: -3, dy: -3)
      glow.layer.frame = layerRect(rect)
      let path = CGPath(
        roundedRect: CGRect(origin: .zero, size: rect.size), cornerWidth: min(8, rect.width / 2),
        cornerHeight: min(8, rect.height / 2), transform: nil)
      glow.layer.path = path
      glow.layer.shadowPath = path.copy(strokingWithWidth: 2, lineCap: .round, lineJoin: .round, miterLimit: 1)
    }
    CATransaction.commit()
    arrangeOverlay()
  }

  /// Keeps the dots between 14 and 28 points apart on screen, doubling their spacing in the
  /// design as the camera pulls back.
  private func arrangeGrid() {
    var spacing = 16 * zoom
    while spacing < 14 { spacing *= 2 }
    while spacing >= 28 { spacing /= 2 }
    let columns = Int(bounds.width / spacing) + 2
    let rows = Int(bounds.height / spacing) + 2
    let offsetX = pan.x.truncatingRemainder(dividingBy: spacing)
    let offsetY = pan.y.truncatingRemainder(dividingBy: spacing)
    let size = max(1, (1.5 * backing).rounded() / backing)
    dot.frame = CGRect(x: 0, y: 0, width: size, height: size)
    dot.cornerRadius = size / 2
    gridRow.instanceCount = columns
    gridRow.instanceTransform = CATransform3DMakeTranslation(spacing, 0, 0)
    grid.instanceCount = rows
    grid.instanceTransform = CATransform3DMakeTranslation(0, -spacing, 0)
    grid.frame = bounds
    gridRow.frame = CGRect(
      x: snap(offsetX - spacing), y: snap(bounds.height - offsetY - size / 2), width: bounds.width,
      height: size)
  }

  private func worldRect(of selection: CanvasSelection) -> CGRect? {
    guard let sheet = sheets.first(where: { $0.path == selection.sheet }),
      sheet.frames.indices.contains(selection.frame),
      let rect = sheet.frames[selection.frame].rect(of: selection.site)
    else { return nil }
    let frame = sheet.worldRect(of: selection.frame)
    return rect.offsetBy(dx: frame.minX, dy: frame.minY)
  }

  private func arrangeOverlay() {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    defer { CATransaction.commit() }
    let accent = NyteRole.strokeAccent.cgColor(dark: isDark, hue: .blue)

    if let hover, hover.site != selection?.site || hover.frame != selection?.frame,
      let rect = worldRect(of: CanvasSelection(sheet: hover.sheet, frame: hover.frame, site: hover.site))
    {
      let screen = toScreen(rect)
      hoverOutline.frame = layerRect(screen)
      hoverOutline.path = CGPath(rect: CGRect(origin: .zero, size: screen.size), transform: nil)
      hoverOutline.strokeColor = accent.copy(alpha: 0.7)
      hoverOutline.isHidden = false
    } else {
      hoverOutline.isHidden = true
    }

    guard let selection, let rect = worldRect(of: selection) else {
      selectionOutline.isHidden = true
      badge.isHidden = true
      for handle in handles { handle.isHidden = true }
      return
    }

    var screen = toScreen(rect)
    screen.origin = CGPoint(x: snap(screen.minX), y: snap(screen.minY))
    selectionOutline.frame = layerRect(screen)
    selectionOutline.path = CGPath(rect: CGRect(origin: .zero, size: screen.size), transform: nil)
    selectionOutline.strokeColor = accent
    selectionOutline.isHidden = false

    let corners = [
      CGPoint(x: screen.minX, y: screen.minY), CGPoint(x: screen.maxX, y: screen.minY),
      CGPoint(x: screen.maxX, y: screen.maxY), CGPoint(x: screen.minX, y: screen.maxY),
    ]
    for (handle, corner) in zip(handles, corners) {
      handle.position = CGPoint(x: corner.x, y: bounds.height - corner.y)
      handle.backgroundColor = CGColor(gray: 1, alpha: 1)
      handle.borderColor = accent
      handle.isHidden = screen.width < 24 || screen.height < 24
    }

    let text = "\(formatNumber(rect.width)) × \(formatNumber(rect.height))"
    let font = NSFont.nyte(.xs, .medium)
    let width = ceil((text as NSString).size(withAttributes: [.font: font]).width) + 14
    badge.frame = layerRect(CGRect(x: snap(screen.midX - width / 2), y: snap(screen.maxY + 8), width: width, height: 20))
    badge.backgroundColor = accent
    badgeText.string = text
    badgeText.foregroundColor = CGColor(gray: 1, alpha: 1)
    badgeText.contentsScale = backing
    badgeText.frame = CGRect(x: 0, y: 2.5, width: width, height: 14)
    badge.isHidden = false
  }

  private func refreshColors() {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    // The desk sits one step under the surfaces that float on it, in either appearance.
    layer?.backgroundColor = (isDark ? NyteRole.bgChrome : NyteRole.bgMuted).cgColor(dark: isDark)
    dot.backgroundColor = NyteRole.contentQuaternary.cgColor(dark: isDark).copy(alpha: isDark ? 0.34 : 0.3)
    for artboard in artboards.values {
      artboard.shadow.shadowColor = CGColor(gray: 0, alpha: 1)
      artboard.shadow.shadowOpacity = isDark ? 0.5 : 0.1
      artboard.shadow.shadowRadius = 14
      artboard.shadow.shadowOffset = CGSize(width: 0, height: -5)
    }
    CATransaction.commit()
  }

  // MARK: Rasterizing

  private func rasterizeSoon() {
    settle?.cancel()
    let work = DispatchWorkItem { [weak self] in self?.rasterize() }
    settle = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.12, execute: work)
  }

  /// Brings every frame's bitmap to the scale it is shown at. A frame larger than the pixel
  /// budget gets a sharp tile over just the part in view.
  private func rasterize() {
    settle?.cancel()
    guard bounds.width > 0 else { return }
    let exact = zoom * backing
    let viewport = CGRect(origin: .zero, size: bounds.size)
    let budget: CGFloat = 12_000_000

    for artboard in artboards.values {
      let size = artboard.layout.size
      guard size.width > 0, size.height > 0 else { continue }
      let screen = toScreen(artboard.world)
      let visible = screen.intersects(viewport.insetBy(dx: -200, dy: -200))
      let cap = sqrt(budget / (size.width * size.height))
      let target = visible ? min(exact, cap) : min(exact, cap, backing)

      if artboard.baseScale == 0 || abs(artboard.baseScale - target) / target > 0.01 {
        artboard.baseScale = target
        artboard.baseGeneration += 1
        render(artboard, scale: target, region: nil, generation: artboard.baseGeneration)
      }

      guard visible, exact > cap * 1.02 else {
        if artboard.detailRegion != nil {
          artboard.detailRegion = nil
          artboard.detail.contents = nil
          artboard.detail.isHidden = true
        }
        continue
      }
      let seen = screen.intersection(viewport.insetBy(dx: -120, dy: -120))
      let region = CGRect(
        x: (seen.minX - screen.minX) / zoom, y: (seen.minY - screen.minY) / zoom,
        width: seen.width / zoom, height: seen.height / zoom
      ).integral.intersection(CGRect(origin: .zero, size: size))
      artboard.detailGeneration += 1
      render(artboard, scale: exact, region: region, generation: artboard.detailGeneration)
    }
  }

  /// Draws off the main thread and shows the bitmap if nothing newer was asked for meanwhile.
  private func render(_ artboard: Artboard, scale: CGFloat, region: CGRect?, generation: Int) {
    let layout = artboard.layout
    let environment = imageEnvironment
    DispatchQueue.global(qos: .userInitiated).async { [weak self, weak artboard] in
      let image = layout.image(scale: scale, region: region, environment: environment)
      DispatchQueue.main.async {
        guard let self, let artboard else { return }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        if let region {
          if artboard.detailGeneration == generation {
            artboard.detail.contents = image
            artboard.detailRegion = region
            self.arrange()
          }
        } else if artboard.baseGeneration == generation {
          artboard.base.contents = image
        }
        CATransaction.commit()
      }
    }
  }

  /// Where the renderer finds the images designs reference.
  var imageEnvironment = LayoutEnvironment()

  // MARK: View events

  override func layout() {
    super.layout()
    // When the sidebar opens or closes, the view's edge moves under the design. Shift the
    // camera by the same amount, so the design stays where it was on screen.
    if window != nil {
      let left = convert(NSPoint.zero, to: nil).x
      if let known = leftEdge, fitted { pan.x += known - left }
      leftEdge = left
    }
    if !fitted, !artboards.isEmpty, bounds.width > 0 {
      fitted = true
      apply(fitCamera(to: contentBounds()))
    }
    arrange()
    rasterizeSoon()
  }

  override func viewDidChangeBackingProperties() {
    super.viewDidChangeBackingProperties()
    for artboard in artboards.values { artboard.baseScale = 0 }
    arrange()
    rasterize()
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    refreshColors()
    arrange()
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let tracking { removeTrackingArea(tracking) }
    let area = NSTrackingArea(
      rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect],
      owner: self, userInfo: nil)
    addTrackingArea(area)
    tracking = area
  }

  override func resetCursorRects() {
    addCursorRect(bounds, cursor: tool == .hand || spaceHeld ? .openHand : .arrow)
  }

  override func scrollWheel(with event: NSEvent) {
    let point = location(event)
    if event.modifierFlags.contains(.command) || event.modifierFlags.contains(.control) {
      let delta = event.hasPreciseScrollingDeltas ? event.scrollingDeltaY * 0.01 : event.scrollingDeltaY * 0.08
      zoom(by: exp(delta), at: point)
      return
    }
    flight = nil
    let scale: CGFloat = event.hasPreciseScrollingDeltas ? 1 : 12
    pan.x += event.scrollingDeltaX * scale
    pan.y += event.scrollingDeltaY * scale
    arrange()
    rasterizeSoon()
  }

  override func magnify(with event: NSEvent) {
    zoom(by: 1 + event.magnification, at: location(event))
  }

  override func smartMagnify(with event: NSEvent) {
    let point = location(event)
    if let (artboard, _) = artboard(at: toWorld(point)), zoom < 0.95 {
      fly(to: fitCamera(to: artboard.world.insetBy(dx: -40, dy: -60)))
    } else {
      fitAll()
    }
  }

  override func mouseMoved(with event: NSEvent) {
    guard tool == .select, !spaceHeld else { return }
    let world = toWorld(location(event))
    let next = hit(world).map { (sheet: $0.selection.sheet, frame: $0.selection.frame, site: $0.selection.site) }
    if next?.site != hover?.site || next?.frame != hover?.frame || next?.sheet != hover?.sheet {
      hover = next
      arrangeOverlay()
    }
  }

  override func mouseExited(with event: NSEvent) {
    hover = nil
    arrangeOverlay()
  }

  override func mouseDown(with event: NSEvent) {
    window?.makeFirstResponder(self)
    let point = location(event)
    let world = toWorld(point)

    if tool == .hand || spaceHeld {
      drag = .pan(last: point, hand: true)
      NSCursor.closedHand.push()
      return
    }

    if let selection, let corner = handle(at: point), let rect = worldRect(of: selection) {
      drag = .resize(
        selection: selection, corner: corner, start: world, rect: rect, origin: frameOrigin(selection))
      return
    }

    if let labelled = label(at: point) {
      selection = labelled
      onSelect?(labelled)
      drag = .press(selection: labelled, start: world, origin: frameOrigin(labelled), drill: nil)
      arrangeOverlay()
      return
    }

    guard let found = hit(world) else {
      selection = nil
      onSelect?(nil)
      drag = .pan(last: point, hand: false)
      arrangeOverlay()
      return
    }

    // A press on the selected frame may become a drag of it; released in place, it selects
    // what is under the pointer instead.
    let frame = CanvasSelection(sheet: found.selection.sheet, frame: found.selection.frame, site: found.root)
    if selection == frame {
      drag = .press(selection: frame, start: world, origin: frameOrigin(frame), drill: found.selection)
      return
    }
    drag = .none
    selection = found.selection
    onSelect?(found.selection)
    arrangeOverlay()
  }

  override func mouseDragged(with event: NSEvent) {
    let point = location(event)
    let world = toWorld(point)
    switch drag {
    case .pan(let last, let hand):
      flight = nil
      pan.x += point.x - last.x
      pan.y += point.y - last.y
      drag = .pan(last: point, hand: hand)
      arrange()
      rasterizeSoon()

    case .press(let selection, let start, let origin, _):
      guard hypot(world.x - start.x, world.y - start.y) * zoom > 3 else { return }
      drag = .move(selection: selection, start: start, origin: origin)
      onMoveFrame?(selection, moved(origin, from: start, to: world), false)

    case .move(let selection, let start, let origin):
      onMoveFrame?(selection, moved(origin, from: start, to: world), false)

    case .resize(let selection, let corner, let start, let rect, let origin):
      report(selection, corner, start, rect, origin, world, event, commit: false)

    case .none:
      break
    }
  }

  override func mouseUp(with event: NSEvent) {
    let world = toWorld(location(event))
    switch drag {
    case .pan(_, let hand):
      if hand { NSCursor.pop() }
    case .press(_, _, _, let drill):
      if let drill {
        selection = drill
        onSelect?(drill)
        arrangeOverlay()
      }
    case .move(let selection, let start, let origin):
      onMoveFrame?(selection, moved(origin, from: start, to: world), true)
    case .resize(let selection, let corner, let start, let rect, let origin):
      report(selection, corner, start, rect, origin, world, event, commit: true)
    case .none:
      break
    }
    drag = .none
  }

  private func moved(_ origin: CGPoint, from start: CGPoint, to world: CGPoint) -> CGPoint {
    CGPoint(x: (origin.x + world.x - start.x).rounded(), y: (origin.y + world.y - start.y).rounded())
  }

  private func report(
    _ selection: CanvasSelection, _ corner: Int, _ start: CGPoint, _ rect: CGRect, _ origin: CGPoint,
    _ world: CGPoint, _ event: NSEvent, commit: Bool
  ) {
    let resized = resize(
      rect, corner: corner, by: CGSize(width: world.x - start.x, height: world.y - start.y),
      keepRatio: event.modifierFlags.contains(.shift))
    // Only a frame has a place of its own; anything inside one is placed by its parent.
    let place = selection.isFrame
      ? CGPoint(
        x: (origin.x + resized.minX - rect.minX).rounded(), y: (origin.y + resized.minY - rect.minY).rounded())
      : nil
    onResize?(selection, resized.size, place, commit)
  }

  override func keyDown(with event: NSEvent) {
    let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
    switch event.keyCode {
    case 49:
      if !event.isARepeat {
        spaceHeld = true
        window?.invalidateCursorRects(for: self)
      }
    case 53:
      guard let selection else {
        onEscape?()
        return
      }
      let parent = parent(of: selection)
      self.selection = parent
      onSelect?(parent)
      arrangeOverlay()
    case 44 where flags.subtracting(.shift).isEmpty:
      onAsk?()
    case 9 where flags.isEmpty:
      tool = .select
    case 4 where flags.isEmpty:
      tool = .hand
    case 51, 117:
      if let selection, !selection.isFrame { onDelete?(selection) }
    case 18 where flags == .shift:
      fitAll()
    case 19 where flags == .shift:
      if let selection { reveal(selection) }
    case 123, 124, 125, 126:
      guard let selection, selection.isFrame else { return }
      let step: CGFloat = flags.contains(.shift) ? 10 : 1
      var origin = frameOrigin(selection)
      switch event.keyCode {
      case 123: origin.x -= step
      case 124: origin.x += step
      case 125: origin.y += step
      default: origin.y -= step
      }
      onMoveFrame?(selection, origin, true)
    default:
      super.keyDown(with: event)
    }
  }

  override func keyUp(with event: NSEvent) {
    if event.keyCode == 49 {
      spaceHeld = false
      window?.invalidateCursorRects(for: self)
      return
    }
    super.keyUp(with: event)
  }

  // MARK: Context menu

  override func menu(for event: NSEvent) -> NSMenu? {
    let world = toWorld(location(event))
    guard let found = hit(world) else { return nil }
    if selection != found.selection {
      selection = found.selection
      onSelect?(found.selection)
      arrangeOverlay()
    }
    let menu = NSMenu()
    menu.addItem(withTitle: "Ask Nyte About This", action: #selector(askFromMenu(_:)), keyEquivalent: "/").target = self
    menu.items.last?.keyEquivalentModifierMask = []
    menu.addItem(.separator())
    menu.addItem(withTitle: "Zoom to Selection", action: #selector(zoomToSelection(_:)), keyEquivalent: "").target = self
    menu.addItem(withTitle: "Select Parent", action: #selector(selectParentFromMenu(_:)), keyEquivalent: "").target = self
    menu.addItem(withTitle: "Copy Markup", action: #selector(copyMarkupFromMenu(_:)), keyEquivalent: "").target = self
    if !found.selection.isFrame {
      menu.addItem(.separator())
      menu.addItem(withTitle: "Delete", action: #selector(deleteFromMenu(_:)), keyEquivalent: "").target = self
    }
    return menu
  }

  /// Asked for the selected element's markup, when Copy Markup is chosen.
  var markupForSelection: (() -> String?)?

  @objc private func askFromMenu(_ sender: Any?) { onAsk?() }

  @objc private func selectParentFromMenu(_ sender: Any?) {
    guard let selection, let parent = parent(of: selection) else { return }
    self.selection = parent
    onSelect?(parent)
    arrangeOverlay()
  }

  @objc private func copyMarkupFromMenu(_ sender: Any?) {
    guard let markup = markupForSelection?() else { return }
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(markup, forType: .string)
  }

  @objc private func deleteFromMenu(_ sender: Any?) {
    if let selection { onDelete?(selection) }
  }

  // MARK: Hit testing

  private struct Hit {
    let selection: CanvasSelection
    let root: ElementRef
  }

  private func artboard(at world: CGPoint) -> (Artboard, CGPoint)? {
    for key in order.reversed() {
      guard let artboard = artboards[key], artboard.world.contains(world) else { continue }
      return (artboard, CGPoint(x: world.x - artboard.world.minX, y: world.y - artboard.world.minY))
    }
    return nil
  }

  private func hit(_ world: CGPoint) -> Hit? {
    guard let (artboard, local) = artboard(at: world) else { return nil }
    let boxes = artboard.layout.hit(local)
    guard let deepest = boxes.last else { return nil }
    return Hit(
      selection: CanvasSelection(sheet: artboard.sheet, frame: artboard.index, site: deepest.box.node.site),
      root: artboard.layout.root.node.site)
  }

  private func label(at point: CGPoint) -> CanvasSelection? {
    for key in order.reversed() {
      guard let artboard = artboards[key], !artboard.label.isHidden else { continue }
      let screen = toScreen(artboard.world)
      let width = min(max(40, screen.width), 220)
      if CGRect(x: screen.minX, y: screen.minY - 24, width: width, height: 22).contains(point) {
        return CanvasSelection(sheet: artboard.sheet, frame: artboard.index, site: artboard.layout.root.node.site)
      }
    }
    return nil
  }

  private func handle(at point: CGPoint) -> Int? {
    for (index, handle) in handles.enumerated() where !handle.isHidden {
      let center = CGPoint(x: handle.position.x, y: bounds.height - handle.position.y)
      if abs(center.x - point.x) <= 7, abs(center.y - point.y) <= 7 { return index }
    }
    return nil
  }

  private func frameOrigin(_ selection: CanvasSelection) -> CGPoint {
    sheets.first { $0.path == selection.sheet }?.frames[selection.frame].origin ?? .zero
  }

  /// The selection one step out: the nearest ancestor box that a different element put there.
  private func parent(of selection: CanvasSelection) -> CanvasSelection? {
    guard let sheet = sheets.first(where: { $0.path == selection.sheet }),
      sheet.frames.indices.contains(selection.frame)
    else { return nil }
    let placed = sheet.frames[selection.frame].placed()
    guard let index = placed.firstIndex(where: { $0.box.node.site == selection.site }) else { return nil }
    let depth = placed[index].depth
    for candidate in placed[..<index].reversed() where candidate.depth < depth && candidate.box.node.site != selection.site {
      return CanvasSelection(sheet: selection.sheet, frame: selection.frame, site: candidate.box.node.site)
    }
    return nil
  }

  private func resize(_ rect: CGRect, corner: Int, by delta: CGSize, keepRatio: Bool) -> CGRect {
    var left = rect.minX
    var top = rect.minY
    var right = rect.maxX
    var bottom = rect.maxY
    if corner == 0 || corner == 3 { left = min(right - 1, left + delta.width) } else { right = max(left + 1, right + delta.width) }
    if corner == 0 || corner == 1 { top = min(bottom - 1, top + delta.height) } else { bottom = max(top + 1, bottom + delta.height) }
    var width = (right - left).rounded()
    var height = (bottom - top).rounded()
    if keepRatio, rect.height > 0 {
      let ratio = rect.width / rect.height
      if abs(delta.width) > abs(delta.height) { height = (width / ratio).rounded() } else { width = (height * ratio).rounded() }
    }
    let x = corner == 0 || corner == 3 ? right - width : left
    let y = corner == 0 || corner == 1 ? bottom - height : top
    return CGRect(x: x, y: y, width: width, height: height)
  }
}

private final class Artboard {
  let sheet: String
  let index: Int
  var layout: FrameLayout
  var world: CGRect
  var revision: Int
  var baseScale: CGFloat = 0
  var detailRegion: CGRect?
  var baseGeneration = 0
  var detailGeneration = 0
  let shadow = CALayer()
  let base = CALayer()
  let detail = CALayer()
  let label = CATextLayer()

  init(sheet: String, index: Int, layout: FrameLayout, world: CGRect, revision: Int) {
    self.sheet = sheet
    self.index = index
    self.layout = layout
    self.world = world
    self.revision = revision
    for layer in [base, detail] {
      layer.contentsGravity = .resize
      layer.minificationFilter = .trilinear
      layer.magnificationFilter = .linear
    }
  }
}

private final class Glow {
  let world: CGRect
  let layer = CAShapeLayer()

  init(world: CGRect) {
    self.world = world
  }
}

private struct Flight {
  let start: CFTimeInterval
  let fromZoom: CGFloat
  let toZoom: CGFloat
  let fromCenter: CGPoint
  let toCenter: CGPoint
}

private enum Drag {
  case none
  case pan(last: CGPoint, hand: Bool)
  /// The button is down on a frame and hasn't moved far enough to be a drag yet.
  case press(selection: CanvasSelection, start: CGPoint, origin: CGPoint, drill: CanvasSelection?)
  case move(selection: CanvasSelection, start: CGPoint, origin: CGPoint)
  case resize(selection: CanvasSelection, corner: Int, start: CGPoint, rect: CGRect, origin: CGPoint)
}
