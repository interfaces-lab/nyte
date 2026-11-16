import os
import CoreGraphics
import Foundation
import ImageIO
import Lune
import NyteKit
import Observation

struct SheetModel: Identifiable {
  let path: String
  let sheet: Sheet
  let frames: [FrameLayout]
  var origin: CGPoint
  let revision: Int
  let error: Diagnostic?

  var id: String { path }
  var name: String { URL(filePath: path).lastPathComponent }

  var extent: CGRect {
    frames.reduce(CGRect.null) { $0.union($1.rect) }
  }

  func worldRect(of frame: Int) -> CGRect {
    frames[frame].rect.offsetBy(dx: origin.x, dy: origin.y)
  }
}

struct ChangeMark: Identifiable {
  let id = UUID()
  let sheet: String
  let frame: Int
}

@MainActor
@Observable
final class ProjectStore {
  private static let log = Logger(subsystem: Bundle.main.bundleIdentifier ?? "sh.nyte.studio", category: "ProjectStore")

  let workspace: WorkspaceInfo
  private(set) var sheets: [SheetModel] = []
  private(set) var files: [String] = []
  private(set) var loaded = false
  private(set) var revision = 0
  private(set) var marks: [ChangeMark] = []
  var mode: ThemeMode = .light { didSet { if mode != oldValue { relayout(marking: []) } } }
  var notice: String?
  weak var undoManager: UndoManager?

  private let client: HostClient
  private var project = Project()
  private var versions: [String: String] = [:]
  private var undoKeys: [String: UndoKey] = [:]
  private var staged: [String: String] = [:]
  private var unsaved: [String: String] = [:]
  private var saving: Set<String> = []
  private var revisions: [String: Int] = [:]
  private var places: [String: CGPoint] = [:]
  private var shelf: Shelf?

  private struct Shelf {
    var x: CGFloat
    var y: CGFloat
    var height: CGFloat
  }
  private var signatures: [String: [[BoxSignature]]] = [:]
  private let images = ImageStore()
  private var watcher: Task<Void, Never>?

  init(workspace: WorkspaceInfo, client: HostClient) {
    self.workspace = workspace
    self.client = client
  }

  var environment: LayoutEnvironment {
    LayoutEnvironment(image: { [images] path in images.image(path) })
  }

  func tree(_ path: String) -> SyntaxTree? { project.files[path]?.tree }
  func source(_ path: String) -> String? { project.files[path]?.source }
  func scope(_ path: String) -> Scope { project.scope(of: path) }

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
        } catch {
          Self.log.error("watching the project stopped: \(String(describing: error), privacy: .public)")
        }
        try? await Task.sleep(for: .seconds(1))
      }
    }
  }

  private func absorb(_ changes: [FileChange]) async {
    var outside: Set<String> = []
    var everything = false
    for change in changes {
      if change.path.hasSuffix(".lune") {
        if change.kind == .removed {
          everything = true
          project.remove(change.path)
          versions[change.path] = nil
          files.removeAll { $0 == change.path }
          outside.insert(change.path)
          continue
        }
        if change.version != nil, change.version == versions[change.path] { continue }
        if staged[change.path] != nil || saving.contains(change.path) { continue }
        let before = project.files[change.path]?.source
        await read(change.path)
        if project.files[change.path]?.source != before { forgetUndo(change.path) }
        if !files.contains(change.path) { files = (files + [change.path]).sorted() }
        outside.insert(change.path)
      } else if images.holds(change.path) {
        everything = true
        images.forget(change.path)
        outside.insert(change.path)
      }
    }
    if !outside.isEmpty { relayout(marking: outside, only: everything ? nil : outside) }
  }

  private func read(_ path: String) async {
    do {
      guard let file = try await client.read(workspace: workspace.id, path: path) else { return }
      project.set(path, source: file.contents)
      versions[path] = file.version
    } catch {
      notice = "Couldn't read \(URL(filePath: path).lastPathComponent): \(error.localizedDescription)"
    }
  }

  // MARK: Editing

  func stage(_ path: String, from tree: SyntaxTree, _ edits: [TextEdit]) {
    if staged[path] == nil { staged[path] = tree.source }
    project.set(path, source: tree.applying(edits))
    relayout(marking: [], only: [path])
  }

  func commitStaged(_ path: String, named name: String) {
    guard let before = staged.removeValue(forKey: path), let source = project.files[path]?.source else { return }
    guard source != before else { return }
    registerUndo(path, restoring: before, over: source, named: name)
    save(path, source)
  }

  func edit(_ path: String, _ edits: [TextEdit], named name: String) {
    guard let file = project.files[path], let tree = file.tree, !edits.isEmpty else { return }
    let source = tree.applying(edits)
    guard source != file.source else { return }
    registerUndo(path, restoring: file.source, over: source, named: name)
    project.set(path, source: source)
    relayout(marking: [], only: [path])
    save(path, source)
  }

  private func registerUndo(_ path: String, restoring source: String, over expected: String, named name: String) {
    guard let undoManager else { return }
    let key = undoKeys[path] ?? UndoKey()
    undoKeys[path] = key
    undoManager.registerUndo(withTarget: key) { [weak self] _ in
      MainActor.assumeIsolated { self?.restore(path, source, over: expected, named: name) }
    }
    undoManager.setActionName(name)
  }

  private func restore(_ path: String, _ source: String, over expected: String, named name: String) {
    guard let current = project.files[path]?.source else { return }
    guard current == expected else {
      notice = "\(URL(filePath: path).lastPathComponent) changed since that edit, so it can't be undone."
      return
    }
    registerUndo(path, restoring: current, over: source, named: name)
    project.set(path, source: source)
    relayout(marking: [], only: [path])
    save(path, source)
  }

  private func forgetUndo(_ path: String) {
    guard let key = undoKeys[path] else { return }
    undoManager?.removeAllActions(withTarget: key)
  }

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
            forgetUndo(path)
            await read(path)
            relayout(marking: [path], only: [path])
            notice = "\(URL(filePath: path).lastPathComponent) changed underneath you, so your edit was dropped."
          }
        } catch {
          notice = "Couldn't save \(URL(filePath: path).lastPathComponent): \(error.localizedDescription)"
        }
      }
      guard staged[path] == nil else { return }
      let known = versions[path]
      let before = project.files[path]?.source
      await read(path)
      if project.files[path]?.source != before { forgetUndo(path) }
      if versions[path] != known { relayout(marking: [path], only: [path]) }
    }
  }

  // MARK: Layout

  private func relayout(marking outside: Set<String>, only changed: Set<String>? = nil) {
    let previous = Dictionary(uniqueKeysWithValues: sheets.map { ($0.path, $0) })
    let environment = environment
    var next: [SheetModel] = []
    var nextMarks: [ChangeMark] = []

    for path in files {
      if let changed, let kept = previous[path], kept.error == nil, !changed.contains(path),
        changed.isDisjoint(with: project.dependencies(of: path))
      {
        next.append(kept)
        continue
      }
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
      if changed, touched { nextMarks += marks(path: path, before: before ?? [], after: signed) }
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

  private func place(_ sheets: inout [SheetModel]) {
    let gap = CGSize(width: 240, height: 300)
    let shelfWidth: CGFloat = 3200
    if places.isEmpty { places = savedPlaces() }
    let fresh = sheets.indices.filter { places[sheets[$0].path] == nil && !sheets[$0].frames.isEmpty }
    if !fresh.isEmpty {
      if shelf == nil {
        let bottom = sheets.compactMap { sheet -> CGFloat? in
          places[sheet.path].map { $0.y + max(sheet.extent.maxY, 320) }
        }.max()
        shelf = Shelf(x: 0, y: bottom.map { $0 + gap.height } ?? 0, height: 0)
      }
      for index in fresh {
        guard var cursor = shelf else { break }
        let size = CGSize(width: max(sheets[index].extent.maxX, 320), height: max(sheets[index].extent.maxY, 320))
        if cursor.x > 0, cursor.x + size.width > shelfWidth {
          cursor = Shelf(x: 0, y: cursor.y + cursor.height + gap.height, height: 0)
        }
        places[sheets[index].path] = CGPoint(x: cursor.x, y: cursor.y)
        cursor.x += size.width + gap.width
        cursor.height = max(cursor.height, size.height)
        shelf = cursor
      }
      UserDefaults.standard.set(
        places.mapValues { [Double($0.x), Double($0.y)] }, forKey: "studio.places.\(workspace.id)")
    }
    for index in sheets.indices { sheets[index].origin = places[sheets[index].path] ?? .zero }
  }

  private func savedPlaces() -> [String: CGPoint] {
    let saved = UserDefaults.standard.dictionary(forKey: "studio.places.\(workspace.id)") ?? [:]
    return saved.compactMapValues { value in
      guard let pair = value as? [Double], pair.count == 2 else { return nil }
      return CGPoint(x: pair[0], y: pair[1])
    }
  }

  private func marks(path: String, before: [[BoxSignature]], after: [[BoxSignature]]) -> [ChangeMark] {
    after.indices.filter { $0 >= before.count || before[$0] != after[$0] }.map { ChangeMark(sheet: path, frame: $0) }
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

private final class UndoKey: NSObject {}
