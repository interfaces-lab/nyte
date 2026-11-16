import AppKit
import Lune
import NyteDesign
import QuartzCore

struct CanvasSelection: Hashable {
  var sheet: String
  var frame: Int
  var site: ElementRef
  var trail: [ElementRef] = []

  var occurrence: Occurrence { Occurrence(element: site, trail: trail) }
  var isFrame: Bool { trail.isEmpty && site.file == sheet && site.path.count == 1 }
  var isInComponent: Bool { !trail.isEmpty }
}

enum CanvasTool {
  case select
  case hand
}

final class CanvasView: NSView {
  var onSelect: ((CanvasSelection?) -> Void)?
  var onEditText: (() -> Void)?
  var onMoveFrame: ((_ selection: CanvasSelection, _ origin: CGPoint, _ commit: Bool) -> Void)?
  var onResize: ((_ selection: CanvasSelection, _ size: CGSize, _ origin: CGPoint?, _ commit: Bool) -> Void)?
  var onDelete: ((CanvasSelection) -> Void)?
  var onZoom: ((CGFloat) -> Void)?
  var onAsk: (() -> Void)?
  var onEscape: (() -> Void)?

  var tool: CanvasTool = .select { didSet { window?.invalidateCursorRects(for: self) } }
  var insets = NSEdgeInsetsZero

  private(set) var zoom: CGFloat = 1
  private(set) var pan = CGPoint.zero

  private var sheets: [SheetModel] = []
  private var selection: CanvasSelection?
  private var artboards: [String: Artboard] = [:]
  private var order: [String] = []
  private var sheetLabels: [String: CATextLayer] = [:]
  private var fitted = false

  private let grid = CAReplicatorLayer()
  private let gridRow = CAReplicatorLayer()
  private let dot = CALayer()
  private let lights = CALayer()
  private let boards = CALayer()
  private let overlay = CALayer()
  private let hoverOutline = CAShapeLayer()
  private let selectionOutline = CAShapeLayer()
  private var handles: [CALayer] = []
  private let badge = CALayer()
  private let badgeText = CATextLayer()

  private var hover: CanvasSelection?
  private var entered: [ElementRef] = []
  private var drag: Drag = .none
  private var spaceHeld = false
  private var settle: DispatchWorkItem?
  private var trim: DispatchWorkItem?
  var working: Set<String> = [] {
    didSet {
      guard working != oldValue else { return }
      for key in order where lit(key, by: oldValue) && !lit(key, by: working) { hold(key) }
      arrange()
    }
  }
  private var halos: [String: GlowLayer] = [:]
  private var held: [String: DispatchWorkItem] = [:]
  private var arranged: (zoom: CGFloat, pan: CGPoint) = (1, .zero)
  private var retired: [IOSurface] = []
  private var flight: Flight? { didSet { if flight == nil { shownTime = nil } } }
  private var shownTime: CFTimeInterval?
  private var link: CADisplayLink?
  private let renderQueue: OperationQueue = {
    let queue = OperationQueue()
    queue.maxConcurrentOperationCount = max(2, ProcessInfo.processInfo.activeProcessorCount / 2)
    queue.qualityOfService = .userInitiated
    return queue
  }()
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

    gridRow.addSublayer(dot)
    grid.addSublayer(gridRow)
    for layer in [grid, lights, boards, overlay] as [CALayer] { root.addSublayer(layer) }

    for outline in [hoverOutline, selectionOutline] {
      outline.fillColor = nil
      outline.isHidden = true
      overlay.addSublayer(outline)
    }
    hoverOutline.lineWidth = Overlay.hoverLine
    selectionOutline.lineWidth = Overlay.selectionLine

    for _ in 0..<4 {
      let handle = CALayer()
      handle.bounds = CGRect(x: 0, y: 0, width: Overlay.handle, height: Overlay.handle)
      handle.cornerRadius = Overlay.handle / 2
      handle.borderWidth = Overlay.selectionLine
      handle.isHidden = true
      overlay.addSublayer(handle)
      handles.append(handle)
    }

    badge.cornerRadius = Overlay.badge.cornerRadius
    badge.cornerCurve = .continuous
    badge.isHidden = true
    badgeText.font = NSFont.nyte(.xs, .medium)
    badgeText.fontSize = NyteText.xs.size
    badgeText.alignmentMode = .center
    badge.addSublayer(badgeText)
    overlay.addSublayer(badge)
    refreshColors()
  }

  required init?(coder: NSCoder) {
    fatalError("CanvasView is made in code.")
  }

  static func desk(dark: Bool) -> CGColor {
    (dark ? NyteRole.bgChrome : NyteRole.bgMuted).cgColor(dark: dark)
  }

  static let desk = NSColor(name: "nyte.desk") { appearance in
    NSColor(cgColor: desk(dark: appearance.isDark)) ?? .windowBackgroundColor
  }

  override var acceptsFirstResponder: Bool { true }
  override var isOpaque: Bool { true }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  // MARK: Scene

  func update(sheets next: [SheetModel], selection nextSelection: CanvasSelection?) {
    sheets = next
    selection = nextSelection
    if let nextSelection { entered = nextSelection.trail }
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
            artboard.invalidate()
          }
        } else {
          let artboard = Artboard(sheet: sheet.path, index: index, layout: layout, world: world, revision: sheet.revision)
          if fitted { for layer in [artboard.base, artboard.shadow] { layer.fade(from: 0, to: 1) } }
          artboard.label.font = NSFont.nyte(.sm, .medium)
          artboard.label.fontSize = NyteText.sm.size
          artboard.label.truncationMode = .end
          boards.addSublayer(artboard.shadow)
          boards.addSublayer(artboard.base)
          overlay.insertSublayer(artboard.label, at: 0)
          artboards[key] = artboard
        }
      }

      let label = sheetLabels[sheet.path] ?? {
        let label = CATextLayer()
        label.font = NSFont.nyte(.sm, .regular)
        label.fontSize = NyteText.sm.size
        label.truncationMode = .middle
        overlay.insertSublayer(label, at: 0)
        sheetLabels[sheet.path] = label
        return label
      }()
      let name = URL(filePath: sheet.path).deletingPathExtension().lastPathComponent
      let missing = sheet.sheet.warnings.filter { $0.missingImport != nil }.count
      label.string = sheet.error.map { "\(name)  ·  line \($0.line): \($0.message)" }
        ?? (missing == 0 ? name : "\(name)  ·  missing \(missing) file\(missing == 1 ? "" : "s")")
    }

    for (key, artboard) in artboards where !seen.contains(key) {
      artboard.baseWork?.cancel()
      artboard.detailWork?.cancel()
      retire(artboard.baseSurface)
      retire(artboard.detailSurface)
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
    entered = next?.trail ?? []
    arrangeOverlay()
  }

  func flash(_ marks: [ChangeMark]) {
    for mark in marks { hold("\(mark.sheet)#\(mark.frame)") }
    arrange()
  }

  private func lit(_ key: String, by working: Set<String>) -> Bool {
    guard let artboard = artboards[key] else { return false }
    return working.contains(artboard.sheet) || working.contains(key)
  }

  private func hold(_ key: String) {
    held[key]?.cancel()
    let work = DispatchWorkItem { [weak self] in
      self?.held[key] = nil
      self?.arrange()
    }
    held[key] = work
    DispatchQueue.main.asyncAfter(deadline: .now() + GlowLayer.linger, execute: work)
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
    let top = insets.top + Overlay.labelBand
    let area = CGRect(
      x: insets.left, y: top, width: max(120, bounds.width - insets.left - insets.right),
      height: max(120, bounds.height - top - insets.bottom))
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

  private var cameraState: [Double] {
    let middle = toWorld(CGPoint(x: bounds.midX, y: bounds.midY))
    return [log(Double(zoom)), Double(middle.x), Double(middle.y)]
  }

  private func cut(to camera: (zoom: CGFloat, pan: CGPoint)) {
    flight = nil
    apply(camera)
    arrange()
    rasterize()
  }

  private func fly(to camera: (zoom: CGFloat, pan: CGPoint)) {
    guard !NyteMotion.reduced, window != nil, camera.zoom > 0 else {
      cut(to: camera)
      return
    }
    let middle = CGPoint(x: bounds.midX, y: bounds.midY)
    let target = [
      log(Double(camera.zoom)), Double((middle.x - camera.pan.x) / camera.zoom),
      Double((middle.y - camera.pan.y) / camera.zoom),
    ]
    let now = shownTime ?? CACurrentMediaTime()
    let moving = flight?.state(at: now)
    let from = moving?.value ?? cameraState
    flight = Flight(
      start: now, target: target, offset: zip(from, target).map { $0 - $1 },
      velocity: moving?.velocity ?? [0, 0, 0])
    shownTime = now
    rasterize(ahead: camera)
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
    let time = max(link.targetTimestamp, flight.start)
    shownTime = time
    let state = flight.state(at: time)
    let scale = exp(state.value[0])
    let apart = zip(state.value, flight.target).map { $0 - $1 }
    let landed =
      abs(apart[0]) < 0.0005 && hypot(apart[1], apart[2]) * scale < 0.25 && abs(state.velocity[0]) < 0.01
      && hypot(state.velocity[1], state.velocity[2]) * scale < 4
    let value = landed || time - flight.start > 2 ? flight.target : state.value
    zoom = CGFloat(exp(value[0]))
    pan = CGPoint(x: bounds.midX - CGFloat(value[1]) * zoom, y: bounds.midY - CGFloat(value[2]) * zoom)
    follow()
    if value == flight.target {
      self.flight = nil
      link.invalidate()
      self.link = nil
      onZoom?(zoom)
      rasterize()
    }
  }

  func fitAll(animated: Bool = true) {
    let camera = fitCamera(to: contentBounds())
    if animated { fly(to: camera) } else { cut(to: camera) }
  }

  func reveal(sheet path: String) {
    guard let sheet = sheets.first(where: { $0.path == path }), !sheet.frames.isEmpty else { return }
    let rect = sheet.extent.offsetBy(dx: sheet.origin.x, dy: sheet.origin.y)
    fly(to: fitCamera(to: rect.insetBy(dx: -40, dy: -60)))
  }

  func reveal(_ selection: CanvasSelection, animated: Bool = true) {
    guard let rect = worldRect(of: selection) else { return }
    let padded = rect.insetBy(dx: -max(80, rect.width * 0.2), dy: -max(80, rect.height * 0.2))
    let camera = fitCamera(to: padded, maxZoom: 2)
    if animated { fly(to: camera) } else { cut(to: camera) }
  }

  func setZoom(_ next: CGFloat, animated: Bool = false) {
    let center = CGPoint(x: bounds.midX, y: bounds.midY)
    let world = toWorld(center)
    let camera = (zoom: next, pan: CGPoint(x: center.x - world.x * next, y: center.y - world.y * next))
    if animated { fly(to: camera) } else { cut(to: camera) }
  }

  private var keyed: Bool { NSApp.currentEvent?.type == .keyDown }

  @objc func zoomToFit(_ sender: Any?) { fitAll(animated: !keyed) }
  @objc func zoomToSelection(_ sender: Any?) { if let selection { reveal(selection, animated: !keyed) } }
  @objc func zoomToActualSize(_ sender: Any?) { setZoom(1) }
  @objc func zoomIn(_ sender: Any?) { setZoom(min(64, zoom * 1.5)) }
  @objc func zoomOut(_ sender: Any?) { setZoom(max(0.02, zoom / 1.5)) }

  private func zoom(by factor: CGFloat, at point: CGPoint) {
    flight = nil
    let world = toWorld(point)
    zoom = min(64, max(0.02, zoom * factor))
    pan = CGPoint(x: point.x - world.x * zoom, y: point.y - world.y * zoom)
    onZoom?(zoom)
    follow()
    rasterizeSoon()
  }

  // MARK: Arranging layers

  private func arrange() {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    arranged = (zoom, pan)
    boards.setAffineTransform(.identity)
    lights.setAffineTransform(.identity)
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
      }

      let selected = selection.map { $0.sheet == artboard.sheet && $0.frame == artboard.index && $0.isFrame } ?? false
      let name = artboard.layout.root.node.name
      if artboard.label.string as? String != name { artboard.label.string = name }
      artboard.label.foregroundColor = selected
        ? NyteRole.contentAccent.cgColor(dark: isDark, hue: .blue) : NyteRole.contentTertiary.cgColor(dark: isDark)
      artboard.label.contentsScale = backing
    }

    for sheet in sheets {
      guard let label = sheetLabels[sheet.path], !sheet.frames.isEmpty else { continue }
      label.contentsScale = backing
      label.foregroundColor = sheet.error == nil
        ? NyteRole.contentTertiary.cgColor(dark: isDark)
        : NyteRole.contentAccent.cgColor(dark: isDark, hue: .red)
    }

    arrangeHalos()
    arrangeLabels()
    CATransaction.commit()
    arrangeOverlay()
  }

  private func arrangeHalos() {
    var wanted: Set<String> = []
    for key in order {
      guard let artboard = artboards[key], lit(key, by: working) || held[key] != nil else { continue }
      wanted.insert(key)
      let halo = halos[key] ?? {
        let halo = GlowLayer()
        halo.opacity = 0
        halo.tone(dark: isDark)
        halos[key] = halo
        lights.addSublayer(halo)
        halo.turn(true)
        halo.rise()
        artboard.shadow.fade(to: 0)
        return halo
      }()
      var rect = toScreen(artboard.world)
      rect.origin = CGPoint(x: snap(rect.minX), y: snap(rect.minY))
      halo.surround(layerRect(rect), radius: artboard.layout.root.style.radii.topLeft * zoom)
    }
    for (key, halo) in halos where !wanted.contains(key) {
      halos[key] = nil
      artboards[key]?.shadow.fade(to: 1)
      halo.fall { [weak halo] in halo?.removeFromSuperlayer() }
    }
  }

  private func follow() {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    let scale = zoom / arranged.zoom
    let move = CGAffineTransform(
      a: scale, b: 0, c: 0, d: scale, tx: pan.x - scale * arranged.pan.x,
      ty: bounds.height * (1 - scale) - pan.y + scale * arranged.pan.y)
    boards.setAffineTransform(move)
    lights.setAffineTransform(move)
    arrangeGrid()
    arrangeLabels()
    CATransaction.commit()
    arrangeOverlay()
  }

  private func arrangeLabels() {
    for key in order {
      guard let artboard = artboards[key] else { continue }
      let rect = toScreen(artboard.world)
      artboard.label.isHidden = rect.width < Overlay.shortestLabelled
      artboard.label.frame = layerRect(
        CGRect(
          x: snap(rect.minX), y: snap(rect.minY) - Overlay.frameLabelGap - Overlay.labelHeight,
          width: max(Overlay.shortestLabelled, rect.width), height: Overlay.labelHeight))
    }
    for sheet in sheets {
      guard let label = sheetLabels[sheet.path], !sheet.frames.isEmpty else { continue }
      let extent = toScreen(sheet.extent.offsetBy(dx: sheet.origin.x, dy: sheet.origin.y))
      label.frame = layerRect(
        CGRect(
          x: snap(extent.minX), y: snap(extent.minY) - Overlay.labelBand,
          width: max(Overlay.sheetLabelWidth, extent.width), height: Overlay.labelHeight))
    }
  }

  private func arrangeGrid() {
    var pitch = Overlay.gridPitch * zoom
    while pitch < Overlay.gridClosest { pitch *= 2 }
    while pitch >= Overlay.gridClosest * 2 { pitch /= 2 }
    let columns = Int(bounds.width / pitch) + 2
    let rows = Int(bounds.height / pitch) + 2
    let offsetX = pan.x.truncatingRemainder(dividingBy: pitch)
    let offsetY = pan.y.truncatingRemainder(dividingBy: pitch)
    let size = max(1, (1.5 * backing).rounded() / backing)
    dot.frame = CGRect(x: 0, y: 0, width: size, height: size)
    dot.cornerRadius = size / 2
    gridRow.instanceCount = columns
    gridRow.instanceTransform = CATransform3DMakeTranslation(pitch, 0, 0)
    grid.instanceCount = rows
    grid.instanceTransform = CATransform3DMakeTranslation(0, -pitch, 0)
    grid.frame = bounds
    gridRow.frame = CGRect(
      x: snap(offsetX - pitch), y: snap(bounds.height - offsetY - size / 2), width: bounds.width,
      height: size)
  }

  private func worldRect(of selection: CanvasSelection) -> CGRect? {
    guard let sheet = sheets.first(where: { $0.path == selection.sheet }),
      sheet.frames.indices.contains(selection.frame),
      let rect = sheet.frames[selection.frame].box(at: selection.occurrence)?.rect
    else { return nil }
    let frame = sheet.worldRect(of: selection.frame)
    return rect.offsetBy(dx: frame.minX, dy: frame.minY)
  }

  private func hue(of selection: CanvasSelection) -> NyteHue {
    if selection.isInComponent { return .purple }
    guard let sheet = sheets.first(where: { $0.path == selection.sheet }),
      sheet.frames.indices.contains(selection.frame),
      let box = sheet.frames[selection.frame].box(at: selection.occurrence)
    else { return .blue }
    return box.box.node.component == nil ? .blue : .purple
  }

  private func arrangeOverlay() {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    defer { CATransaction.commit() }
    if let hover, hover != selection, let rect = worldRect(of: hover) {
      let screen = toScreen(rect)
      hoverOutline.frame = layerRect(screen)
      hoverOutline.path = CGPath(rect: CGRect(origin: .zero, size: screen.size), transform: nil)
      hoverOutline.strokeColor = NyteRole.strokeAccent.cgColor(dark: isDark, hue: hue(of: hover)).copy(alpha: 0.7)
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

    let accent = NyteRole.strokeAccent.cgColor(dark: isDark, hue: hue(of: selection))
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
      handle.isHidden = screen.width < Overlay.smallestHandled || screen.height < Overlay.smallestHandled
    }

    let text = "\(formatNumber(rect.width)) × \(formatNumber(rect.height))"
    let font = NSFont.nyte(.xs, .medium)
    let height = Overlay.badge.rawValue
    let width = ceil((text as NSString).size(withAttributes: [.font: font]).width) + Overlay.badgePad * 2
    badge.frame = layerRect(
      CGRect(x: snap(screen.midX - width / 2), y: snap(screen.maxY + Overlay.badgeGap), width: width, height: height))
    badge.backgroundColor = NyteRole.contentPrimary.cgColor(dark: isDark)
    badgeText.string = text
    badgeText.foregroundColor = NyteRole.bgBase.cgColor(dark: isDark)
    badgeText.contentsScale = backing
    let line = NyteText.xs.lineHeight
    badgeText.frame = CGRect(x: 0, y: snap((height - line) / 2), width: width, height: line)
    badge.isHidden = false
  }

  private func refreshColors() {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    layer?.backgroundColor = CanvasView.desk(dark: isDark)
    dot.backgroundColor = NyteRole.contentQuaternary.cgColor(dark: isDark).copy(alpha: isDark ? 0.34 : 0.3)
    for artboard in artboards.values {
      artboard.shadow.shadowColor = CGColor(gray: 0, alpha: 1)
      artboard.shadow.shadowOpacity = isDark ? 0.5 : 0.1
      artboard.shadow.shadowRadius = 14
      artboard.shadow.shadowOffset = CGSize(width: 0, height: -5)
    }
    for halo in halos.values { halo.tone(dark: isDark) }
    CATransaction.commit()
  }

  // MARK: Rasterizing

  private func rasterizeSoon() {
    settle?.cancel()
    let work = DispatchWorkItem { [weak self] in self?.rasterize() }
    settle = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.12, execute: work)
  }

  private func rasterize(ahead camera: (zoom: CGFloat, pan: CGPoint)? = nil) {
    guard bounds.width > 0 else { return }
    if camera == nil {
      settle?.cancel()
      if arranged.zoom != zoom || arranged.pan != pan { arrange() }
    }
    let zoom = camera?.zoom ?? self.zoom
    let pan = camera?.pan ?? self.pan
    let exact = zoom * backing
    let viewport = CGRect(origin: .zero, size: bounds.size).insetBy(dx: -Raster.margin, dy: -Raster.margin)

    for artboard in artboards.values {
      let size = artboard.layout.size
      guard size.width > 0, size.height > 0 else { continue }
      let screen = CGRect(
        x: artboard.world.minX * zoom + pan.x, y: artboard.world.minY * zoom + pan.y,
        width: artboard.world.width * zoom, height: artboard.world.height * zoom)
      let visible = screen.intersects(viewport)
      let budget = visible ? Raster.base : Raster.thumbnail
      let target = min(exact, (budget / (size.width * size.height)).squareRoot())
      let wanted = artboard.basePending ?? artboard.baseScale
      let coarser = target < wanted
      if wanted == 0 || (abs(wanted - target) / target > 0.01 && !(camera != nil && coarser)) {
        render(artboard, scale: target, region: nil)
      }

      guard visible, exact > target * 1.02 else {
        if camera == nil { retire(artboard.dropDetail()) }
        continue
      }
      let seen = screen.intersection(viewport)
      let region = CGRect(
        x: (seen.minX - screen.minX) / zoom, y: (seen.minY - screen.minY) / zoom,
        width: seen.width / zoom, height: seen.height / zoom
      ).integral.intersection(CGRect(origin: .zero, size: size))
      let tile = Tile(region: region, scale: exact)
      if artboard.detailPending != tile, artboard.detailTile != tile {
        render(artboard, scale: exact, region: region)
      }
    }
  }

  private func render(_ artboard: Artboard, scale: CGFloat, region: CGRect?) {
    let layout = artboard.layout
    let environment = imageEnvironment
    let work = BlockOperation()
    let show: @MainActor @Sendable (IOSurface?) -> Void = { [weak self, weak artboard, weak work] image in
      guard let self, let artboard, work?.isCancelled == false else { return }
      CATransaction.begin()
      CATransaction.setDisableActions(true)
      if let region {
        if artboard.detail.superlayer == nil { self.boards.insertSublayer(artboard.detail, above: artboard.base) }
        self.retire(artboard.detailSurface)
        artboard.detailSurface = image
        artboard.detail.contents = image
        artboard.detailRegion = region
        artboard.detailTile = Tile(region: region, scale: scale)
        artboard.detailPending = nil
        self.arrange()
      } else {
        self.retire(artboard.baseSurface)
        artboard.baseSurface = image
        artboard.base.contents = image
        artboard.baseScale = scale
        artboard.basePending = nil
      }
      CATransaction.commit()
    }
    work.addExecutionBlock {
      let image = layout.surface(scale: scale, region: region, environment: environment)
      DispatchQueue.main.async { MainActor.assumeIsolated { show(image) } }
    }
    if let region {
      artboard.detailWork?.cancel()
      artboard.detailWork = work
      artboard.detailPending = Tile(region: region, scale: scale)
    } else {
      artboard.baseWork?.cancel()
      artboard.baseWork = work
      artboard.basePending = scale
    }
    renderQueue.addOperation(work)
  }

  private func retire(_ surface: IOSurface?) {
    guard let surface else { return }
    retired.append(surface)
    trimSoon()
  }

  private func trimSoon() {
    trim?.cancel()
    let work = DispatchWorkItem { [weak self] in
      guard let self else { return }
      for surface in self.retired { surface.setPurgeable(.purgeableVolatile, oldState: nil) }
      self.retired = []
    }
    trim = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: work)
  }

  var imageEnvironment = LayoutEnvironment()

  // MARK: View events

  override func layout() {
    super.layout()
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
    for artboard in artboards.values { artboard.invalidate() }
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
      rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeAlways, .inVisibleRect],
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
    follow()
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
    let point = location(event)
    let next = hit(toWorld(point))?.selection
    if next != hover {
      hover = next
      arrangeOverlay()
    }
    cursor(at: point).set()
  }

  private func cursor(at point: CGPoint) -> NSCursor {
    if tool == .hand || spaceHeld { return .openHand }
    if selection != nil, let corner = handle(at: point) {
      let position: NSCursor.FrameResizePosition = [.topLeft, .topRight, .bottomRight, .bottomLeft][corner]
      return .frameResize(position: position, directions: .all)
    }
    return label(at: point) == nil ? .arrow : .openHand
  }

  override func mouseExited(with event: NSEvent) {
    guard case .none = drag else { return }
    hover = nil
    arrangeOverlay()
  }

  // MARK: Losing the keyboard

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    NotificationCenter.default.removeObserver(self, name: NSWindow.didResignKeyNotification, object: nil)
    guard let window else { return }
    NotificationCenter.default.addObserver(
      self, selector: #selector(releaseKeys(_:)), name: NSWindow.didResignKeyNotification, object: window)
  }

  override func resignFirstResponder() -> Bool {
    releaseKeys(nil)
    return super.resignFirstResponder()
  }

  @objc private func releaseKeys(_ sender: Any?) {
    guard spaceHeld else { return }
    spaceHeld = false
    window?.invalidateCursorRects(for: self)
  }

  // MARK: The middle button

  override func otherMouseDown(with event: NSEvent) {
    guard event.buttonNumber == 2 else { return super.otherMouseDown(with: event) }
    drag = .pan(last: location(event), hand: true)
    NSCursor.closedHand.set()
  }

  override func otherMouseDragged(with event: NSEvent) {
    guard event.buttonNumber == 2 else { return super.otherMouseDragged(with: event) }
    mouseDragged(with: event)
  }

  override func otherMouseUp(with event: NSEvent) {
    guard event.buttonNumber == 2 else { return super.otherMouseUp(with: event) }
    mouseUp(with: event)
  }

  override func mouseDown(with event: NSEvent) {
    window?.makeFirstResponder(self)
    let point = location(event)
    let world = toWorld(point)

    if tool == .hand || spaceHeld {
      drag = .pan(last: point, hand: true)
      NSCursor.closedHand.set()
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

    let found: Hit?
    if event.clickCount == 2 {
      found = enter(at: world) ?? hit(world)
      if let found, isText(found.selection) { onEditText?() }
    } else {
      found = hit(world, deep: event.modifierFlags.contains(.command))
    }
    guard let found else {
      selection = nil
      entered = []
      onSelect?(nil)
      drag = .pan(last: point, hand: false)
      arrangeOverlay()
      return
    }
    entered = found.selection.trail

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
      follow()
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
      if hand { cursor(at: location(event)).set() }
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
    let place = selection.isFrame
      ? CGPoint(
        x: (origin.x + resized.minX - rect.minX).rounded(), y: (origin.y + resized.minY - rect.minY).rounded())
      : nil
    onResize?(selection, resized.size, place, commit)
  }

  override func keyDown(with event: NSEvent) {
    let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
      .subtracting([.capsLock, .numericPad, .function])

    if flags.subtracting(.shift).isEmpty, let typed = event.charactersIgnoringModifiers?.lowercased() {
      switch typed {
      case "/", "?":
        onAsk?()
        return
      case "v" where flags.isEmpty:
        tool = .select
        return
      case "h" where flags.isEmpty:
        tool = .hand
        return
      default:
        break
      }
    }

    switch Key(rawValue: event.keyCode) {
    case .space:
      if !event.isARepeat {
        spaceHeld = true
        window?.invalidateCursorRects(for: self)
      }
    case .escape:
      guard let selection else {
        onEscape?()
        return
      }
      let parent = parent(of: selection)
      self.selection = parent
      entered = parent?.trail ?? []
      onSelect?(parent)
      arrangeOverlay()
    case .delete, .forwardDelete:
      if let selection, !selection.isFrame { onDelete?(selection) }
    case .left, .right, .down, .up:
      guard let selection, selection.isFrame, let key = Key(rawValue: event.keyCode) else { return }
      let step: CGFloat = flags.contains(.shift) ? 10 : 1
      var origin = frameOrigin(selection)
      switch key {
      case .left: origin.x -= step
      case .right: origin.x += step
      case .down: origin.y += step
      default: origin.y -= step
      }
      onMoveFrame?(selection, origin, true)
    case nil:
      super.keyDown(with: event)
    }
  }

  override func keyUp(with event: NSEvent) {
    if Key(rawValue: event.keyCode) == .space {
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

  var markupForSelection: (() -> String?)?

  @objc private func askFromMenu(_ sender: Any?) { onAsk?() }

  @objc private func selectParentFromMenu(_ sender: Any?) {
    guard let selection, let parent = parent(of: selection) else { return }
    self.selection = parent
    entered = parent.trail
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

  private func hit(_ world: CGPoint, deep: Bool = false) -> Hit? {
    guard let (artboard, local) = artboard(at: world) else { return nil }
    let boxes = artboard.layout.hit(local)
    guard let found = deep ? boxes.last : boxes.last(where: { entered.starts(with: $0.box.node.trail) })
    else { return nil }
    return Hit(selection: selection(found.box.node.occurrence, on: artboard), root: artboard.layout.root.node.site)
  }

  private func enter(at world: CGPoint) -> Hit? {
    guard let (artboard, local) = artboard(at: world) else { return nil }
    let boxes = artboard.layout.hit(local)
    guard let instance = boxes.last(where: { entered.starts(with: $0.box.node.trail) })?.box.node,
      let root = instance.componentRoot
    else { return nil }
    let inside = boxes.last { $0.box.node.trail == root.trail }?.box.node.occurrence ?? root
    return Hit(selection: selection(inside, on: artboard), root: artboard.layout.root.node.site)
  }

  private func isText(_ selection: CanvasSelection) -> Bool {
    guard let sheet = sheets.first(where: { $0.path == selection.sheet }),
      sheet.frames.indices.contains(selection.frame)
    else { return false }
    return sheet.frames[selection.frame].box(at: selection.occurrence)?.box.node.kind == .text
  }

  private func selection(_ occurrence: Occurrence, on artboard: Artboard) -> CanvasSelection {
    CanvasSelection(sheet: artboard.sheet, frame: artboard.index, site: occurrence.element, trail: occurrence.trail)
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
      if abs(center.x - point.x) <= Overlay.handleReach, abs(center.y - point.y) <= Overlay.handleReach {
        return index
      }
    }
    return nil
  }

  private func frameOrigin(_ selection: CanvasSelection) -> CGPoint {
    sheets.first { $0.path == selection.sheet }?.frames[selection.frame].origin ?? .zero
  }

  private func parent(of selection: CanvasSelection) -> CanvasSelection? {
    guard let sheet = sheets.first(where: { $0.path == selection.sheet }),
      sheet.frames.indices.contains(selection.frame)
    else { return nil }
    let placed = sheet.frames[selection.frame].placed()
    guard let index = placed.firstIndex(where: { $0.box.node.isAt(selection.occurrence) }) else { return nil }
    let node = placed[index].box.node
    func step(_ occurrence: Occurrence) -> CanvasSelection {
      CanvasSelection(sheet: selection.sheet, frame: selection.frame, site: occurrence.element, trail: occurrence.trail)
    }
    if node.componentRoot == selection.occurrence { return step(node.occurrence) }
    let depth = placed[index].depth
    guard let outer = placed[..<index].last(where: { $0.depth < depth })?.box.node else { return nil }
    if let root = outer.componentRoot, root.trail == selection.trail { return step(root) }
    return step(outer.occurrence)
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

private enum Overlay {
  static let labelHeight = NyteText.sm.lineHeight
  static let frameLabelGap = NyteSpace.s1_5.rawValue
  static let sheetLabelGap = NyteSpace.s2.rawValue
  static let labelBand = labelHeight * 2 + frameLabelGap + sheetLabelGap
  static let shortestLabelled: CGFloat = 56
  static let sheetLabelWidth: CGFloat = 240
  static let handle = NyteSpace.s2.rawValue
  static let handleReach = NyteControl.sm.rawValue / 2
  static let smallestHandled = NyteControl.sm.rawValue
  static let hoverLine = NyteSpace.px.rawValue
  static let selectionLine: CGFloat = 1.5
  static let badge = NyteControl.xs
  static let badgePad = NyteSpace.s2.rawValue
  static let badgeGap = NyteSpace.s2.rawValue
  static let gridPitch = NyteSpace.s4.rawValue
  static let gridClosest = NyteSpace.s3.rawValue
}

private enum Raster {
  static let thumbnail: CGFloat = 16_384
  static let base: CGFloat = 1_048_576
  static let margin: CGFloat = 64
}

private struct Tile: Equatable {
  let region: CGRect
  let scale: CGFloat
}

private final class Artboard {
  let sheet: String
  let index: Int
  var layout: FrameLayout
  var world: CGRect
  var revision: Int
  var baseScale: CGFloat = 0
  var basePending: CGFloat?
  var baseWork: Operation?
  var detailRegion: CGRect?
  var detailTile: Tile?
  var detailPending: Tile?
  var detailWork: Operation?
  var baseSurface: IOSurface?
  var detailSurface: IOSurface?
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

  func invalidate() {
    baseWork?.cancel()
    detailWork?.cancel()
    baseScale = 0
    basePending = nil
    detailTile = nil
    detailPending = nil
  }

  func dropDetail() -> IOSurface? {
    detailWork?.cancel()
    detailPending = nil
    guard detailRegion != nil || detail.contents != nil else { return nil }
    detailRegion = nil
    detailTile = nil
    detail.contents = nil
    detail.removeFromSuperlayer()
    defer { detailSurface = nil }
    return detailSurface
  }
}

private struct Flight {
  let start: CFTimeInterval
  let target: [Double]
  let offset: [Double]
  let velocity: [Double]

  func state(at time: CFTimeInterval) -> (value: [Double], velocity: [Double]) {
    let elapsed = max(0, time - start)
    let parts = (0..<target.count).map {
      NyteSpring.travel.state(offset: offset[$0], velocity: velocity[$0], after: elapsed)
    }
    return (zip(target, parts).map { $0 + $1.offset }, parts.map(\.velocity))
  }
}

private enum Drag {
  case none
  case pan(last: CGPoint, hand: Bool)
  case press(selection: CanvasSelection, start: CGPoint, origin: CGPoint, drill: CanvasSelection?)
  case move(selection: CanvasSelection, start: CGPoint, origin: CGPoint)
  case resize(selection: CanvasSelection, corner: Int, start: CGPoint, rect: CGRect, origin: CGPoint)
}

private enum Key: UInt16 {
  case space = 49
  case delete = 51
  case escape = 53
  case forwardDelete = 117
  case left = 123
  case right = 124
  case down = 125
  case up = 126
}

// MARK: Menu validation

extension CanvasView: NSMenuItemValidation {
  func validateMenuItem(_ item: NSMenuItem) -> Bool {
    switch item.action {
    case #selector(zoomToSelection(_:)): return selection != nil
    default: return true
    }
  }
}
