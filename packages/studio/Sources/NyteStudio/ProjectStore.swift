import CoreGraphics
import Foundation
import ImageIO
import Lune
import NyteKit
import Observation

/// One design file placed on the canvas: its frames, laid out, and where the file sits.
struct SheetModel: Identifiable {
  let path: String
  let sheet: Sheet
  let frames: [FrameLayout]
  /// Where the file's own (0, 0) sits on the canvas.
  var origin: CGPoint
  /// Counts the times this file's rendering changed, so the canvas knows what to redraw.
  let revision: Int
  /// The parse error of a file that is broken right now. Its last good frames stay up.
  let error: Diagnostic?

  var id: String { path }
  var name: String { URL(filePath: path).lastPathComponent }

  /// The frames' union in the file's own coordinates.
  var extent: CGRect {
    frames.reduce(CGRect.null) { $0.union($1.rect) }
  }

  func worldRect(of frame: Int) -> CGRect {
    frames[frame].rect.offsetBy(dx: origin.x, dy: origin.y)
  }
}

/// A place on the canvas an agent or another person just changed.
struct ChangeMark: Identifiable {
  let id = UUID()
  let sheet: String
  let frame: Int
  /// In the frame's coordinates.
  let rect: CGRect
}

/// The design files of one workspace, read and written through the host, never the disk:
/// the same code works when the host runs on another machine.
@MainActor
@Observable
final class ProjectStore {
  let workspace: WorkspaceInfo
  private(set) var sheets: [SheetModel] = []
  private(set) var files: [String] = []
  private(set) var loaded = false
  /// Bumped on every change to `sheets`.
  private(set) var revision = 0
  /// The newest outside changes, for the canvas to light up.
  private(set) var marks: [ChangeMark] = []
  var mode: ThemeMode = .light { didSet { if mode != oldValue { relayout(marking: []) } } }
  var notice: String?
  weak var undoManager: UndoManager?

  private let client: HostClient
  private var project = Project()
  private var versions: [String: String] = [:]
  /// The files with an unsaved preview, each with the source it had before the preview began.
  private var staged: [String: String] = [:]
  private var unsaved: [String: String] = [:]
  private var saving: Set<String> = []
  private var revisions: [String: Int] = [:]
  private var signatures: [String: [[BoxSignature]]] = [:]
  private let images = ImageStore()
  private var watcher: Task<Void, Never>?

  init(workspace: WorkspaceInfo, client: HostClient) {
    self.workspace = workspace
    self.client = client
  }

  /// Where the renderer finds the images designs reference.
  var environment: LayoutEnvironment {
    LayoutEnvironment(image: { [images] path in images.image(path) })
  }

  func tree(_ path: String) -> SyntaxTree? { project.files[path]?.tree }
  func source(_ path: String) -> String? { project.files[path]?.source }
  func scope(_ path: String) -> Scope { project.scope(of: path) }

  /// Reads every `.lune` file in the workspace, then follows changes until `close`.
  func open() async {
    do {
      let entries = try await client.scan(workspace: workspace.id)
      let paths = entries.filter { !$0.isDirectory && $0.path.hasSuffix(".lune") }.map(\.path).sorted()
      for path in paths { await read(path) }
      files = paths
    } catch {
      notice = "Couldn't read the project: \(error.localizedDescription)"
    }
    relayout(marking: [])
    loaded = true
    follow()
  }

  func close() {
    watcher?.cancel()
  }

  private func follow() {
    watcher?.cancel()
    watcher = Task { [weak self] in
      while !Task.isCancelled {
        guard let self else { return }
        do {
          for try await changes in self.client.watch(workspace: self.workspace.id) {
            await self.absorb(changes)
          }
        } catch {}
        try? await Task.sleep(for: .seconds(1))
      }
    }
  }

  /// Takes file changes from the host. A change whose version this client wrote itself is its
  /// own echo; anything else came from an agent or another person.
  private func absorb(_ changes: [FileChange]) async {
    var outside: Set<String> = []
    for change in changes {
      if change.path.hasSuffix(".lune") {
        if change.kind == .removed {
          project.remove(change.path)
          versions[change.path] = nil
          files.removeAll { $0 == change.path }
          outside.insert(change.path)
          continue
        }
        if change.version != nil, change.version == versions[change.path] { continue }
        if staged[change.path] != nil || saving.contains(change.path) { continue }
        await read(change.path)
        if !files.contains(change.path) { files = (files + [change.path]).sorted() }
        outside.insert(change.path)
      } else if images.holds(change.path) {
        images.forget(change.path)
        outside.insert(change.path)
      }
    }
    if !outside.isEmpty { relayout(marking: outside) }
  }

  private func read(_ path: String) async {
    guard let file = try? await client.read(workspace: workspace.id, path: path) else { return }
    project.set(path, source: file.contents)
    versions[path] = file.version
  }

  // MARK: Editing

  /// Shows an edit on the canvas without saving it, for a drag in progress. `from` is the tree
  /// the drag started with, so repeated previews never compound.
  func stage(_ path: String, from tree: SyntaxTree, _ edits: [TextEdit]) {
    if staged[path] == nil { staged[path] = tree.source }
    project.set(path, source: tree.applying(edits))
    relayout(marking: [])
  }

  /// Saves what `stage` showed, as one step to undo.
  func commitStaged(_ path: String, named name: String) {
    guard let before = staged.removeValue(forKey: path), let source = project.files[path]?.source else { return }
    guard source != before else { return }
    registerUndo(path, restoring: before, named: name)
    save(path, source)
  }

  /// Applies edits to a file and saves it.
  func edit(_ path: String, _ edits: [TextEdit], named name: String) {
    guard let file = project.files[path], let tree = file.tree, !edits.isEmpty else { return }
    let source = tree.applying(edits)
    guard source != file.source else { return }
    registerUndo(path, restoring: file.source, named: name)
    project.set(path, source: source)
    relayout(marking: [])
    save(path, source)
  }

  /// Undo puts a file's whole text back. That is safe against an agent's edit in between: the
  /// write still names the version it expects, so it comes back stale instead of erasing it.
  private func registerUndo(_ path: String, restoring source: String, named name: String) {
    guard let undoManager else { return }
    undoManager.registerUndo(withTarget: self) { store in
      MainActor.assumeIsolated { store.restore(path, source, named: name) }
    }
    undoManager.setActionName(name)
  }

  private func restore(_ path: String, _ source: String, named name: String) {
    guard let current = project.files[path]?.source else { return }
    registerUndo(path, restoring: current, named: name)
    project.set(path, source: source)
    relayout(marking: [])
    save(path, source)
  }

  /// Saves one file at a time, newest contents last. Each write expects the version this client
  /// last saw, so it can't land on top of a change from an agent: that write comes back stale,
  /// and the file on the host wins.
  private func save(_ path: String, _ source: String) {
    unsaved[path] = source
    guard saving.insert(path).inserted else { return }
    Task {
      defer { saving.remove(path) }
      while let next = unsaved.removeValue(forKey: path) {
        do {
          switch try await client.write(
            workspace: workspace.id, path: path, contents: next, expect: versions[path])
          {
          case .saved(let version):
            versions[path] = version
          case .stale:
            unsaved[path] = nil
            await read(path)
            relayout(marking: [path])
            notice = "\(URL(filePath: path).lastPathComponent) changed underneath you, so your edit was dropped."
          }
        } catch {
          notice = "Couldn't save \(URL(filePath: path).lastPathComponent): \(error.localizedDescription)"
        }
      }
      // Changes that arrived while this file was saving were skipped, so look once more.
      guard staged[path] == nil else { return }
      let known = versions[path]
      await read(path)
      if versions[path] != known { relayout(marking: [path]) }
    }
  }

  // MARK: Layout

  /// Lays out every file again and places the files on the canvas. `marking` names the files
  /// that changed from outside.
  private func relayout(marking outside: Set<String>) {
    let previous = Dictionary(uniqueKeysWithValues: sheets.map { ($0.path, $0) })
    let environment = environment
    var next: [SheetModel] = []
    var nextMarks: [ChangeMark] = []

    for path in files {
      let sheet = project.sheet(path)
      let old = previous[path]
      if sheet.error != nil, let old {
        next.append(
          SheetModel(
            path: path, sheet: old.sheet, frames: old.frames, origin: .zero,
            revision: old.revision, error: sheet.error))
        continue
      }
      guard !sheet.frames.isEmpty else {
        signatures[path] = nil
        continue
      }

      let frames = project.layout(sheet, mode: mode, environment: environment)
      let signed = frames.map { frame in frame.placed().map(BoxSignature.init) }
      let before = signatures[path]
      let changed = before != signed
      if changed { revisions[path, default: 0] += 1 }
      signatures[path] = signed

      let touched = outside.contains(path) || !outside.isDisjoint(with: project.dependencies(of: path))
      if changed, touched, let before {
        nextMarks += marks(path: path, before: before, after: signed)
      }
      next.append(
        SheetModel(
          path: path, sheet: sheet, frames: frames, origin: .zero,
          revision: revisions[path, default: 0], error: nil))
    }

    place(&next)
    sheets = next
    revision += 1
    if !nextMarks.isEmpty { marks = nextMarks }
    fetchMissingImages()
  }

  /// Shelves the files left to right in path order, starting a new shelf when one is as wide as
  /// a canvas of about three by two would be. Neighbours in a folder stay neighbours, and a
  /// file moves only when a file before it grows.
  private func place(_ sheets: inout [SheetModel]) {
    let gap = CGSize(width: 240, height: 300)
    let sizes = sheets.map { sheet in
      CGSize(width: max(sheet.extent.maxX, 320), height: max(sheet.extent.maxY, 320))
    }
    let area = sizes.reduce(0) { $0 + ($1.width + gap.width) * ($1.height + gap.height) }
    let shelf = max(sizes.map(\.width).max() ?? 0, (area * 1.5).squareRoot())

    var x: CGFloat = 0
    var y: CGFloat = 0
    var height: CGFloat = 0
    for index in sheets.indices {
      if x > 0, x + sizes[index].width > shelf {
        x = 0
        y += height + gap.height
        height = 0
      }
      sheets[index].origin = CGPoint(x: x, y: y)
      x += sizes[index].width + gap.width
      height = max(height, sizes[index].height)
    }
  }

  private func marks(path: String, before: [[BoxSignature]], after: [[BoxSignature]]) -> [ChangeMark] {
    var out: [ChangeMark] = []
    for (index, boxes) in after.enumerated() {
      guard index < before.count else {
        if let root = boxes.first { out.append(ChangeMark(sheet: path, frame: index, rect: root.rect)) }
        continue
      }
      let known = Set(before[index])
      let changed = boxes.dropFirst().filter { !known.contains($0) }
      // A change that touches most of a frame reads better as one glow around the frame.
      if changed.isEmpty { continue }
      if changed.count > 8 || changed.count * 2 > boxes.count {
        if let root = boxes.first { out.append(ChangeMark(sheet: path, frame: index, rect: root.rect)) }
        continue
      }
      let rects = changed.map(\.rect)
      for rect in rects where !rects.contains(where: { $0 != rect && $0.contains(rect) }) {
        out.append(ChangeMark(sheet: path, frame: index, rect: rect))
      }
    }
    return out
  }

  private func fetchMissingImages() {
    let missing = images.takeRequests()
    guard !missing.isEmpty else { return }
    Task {
      for path in missing {
        let data = try? await client.fileBytes(workspace: workspace.id, path: path)
        images.store(path, data: data)
      }
      relayout(marking: [])
    }
  }
}

/// What makes a box look the way it does. Two layouts with the same signatures draw the same.
private struct BoxSignature: Hashable {
  let site: ElementRef
  let rect: CGRect
  let attributes: [String: String]
  let text: String?
  let mode: ThemeMode
  let resolved: Int

  init(_ placed: PlacedBox) {
    site = placed.box.node.site
    rect = placed.rect
    attributes = placed.box.node.attributes
    text = placed.box.node.text
    mode = placed.box.mode
    var hasher = Hasher()
    hasher.combine(placed.box.style.fill.map { "\($0)" })
    hasher.combine(placed.box.style.stroke?.hex)
    hasher.combine(placed.box.style.color.hex)
    hasher.combine(placed.box.style.radii.topLeft)
    hasher.combine(placed.box.style.fontSize)
    hasher.combine(placed.box.style.fontWeight)
    resolved = hasher.finalize()
  }
}

/// The images designs reference, fetched from the host once and kept decoded.
final class ImageStore: @unchecked Sendable {
  private let lock = NSLock()
  private var images: [String: CGImage?] = [:]
  private var requests: Set<String> = []

  func image(_ path: String) -> CGImage? {
    lock.lock()
    defer { lock.unlock() }
    if let known = images[path] { return known }
    requests.insert(path)
    return nil
  }

  func holds(_ path: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return images[path] != nil
  }

  func forget(_ path: String) {
    lock.lock()
    images[path] = nil
    lock.unlock()
  }

  func takeRequests() -> [String] {
    lock.lock()
    defer { lock.unlock() }
    let out = Array(requests)
    requests = []
    return out
  }

  func store(_ path: String, data: Data?) {
    let image = data.flatMap { CGImageSourceCreateWithData($0 as CFData, nil) }
      .flatMap { CGImageSourceCreateImageAtIndex($0, 0, nil) }
    lock.lock()
    images[path] = .some(image)
    lock.unlock()
  }
}
