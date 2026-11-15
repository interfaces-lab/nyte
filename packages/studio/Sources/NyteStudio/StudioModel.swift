import AppKit
import Foundation
import Lune
import NyteDesign
import NyteKit
import Observation

/// Everything the window shows: the host it is attached to, the project on the canvas, the
/// selection and the chat.
@MainActor
@Observable
final class StudioModel {
  enum Phase: Equatable {
    case connecting
    case unavailable(String)
    case choosing
    case ready
  }

  enum Panel {
    case design
    case chat
  }

  private(set) var phase: Phase = .connecting
  private(set) var hostName = ""
  private(set) var online = false
  private(set) var workspaces: [WorkspaceInfo] = []
  private(set) var workspace: WorkspaceInfo?
  private(set) var project: ProjectStore?
  private(set) var transcript: Transcript?
  private(set) var models: [ModelChoice] = []
  private(set) var others: [ConnectedClient] = []
  let directory = SessionDirectory()

  var model: ModelChoice?
  var selection: CanvasSelection?
  var panel: Panel = .design
  var draft = ""
  var zoom: CGFloat = 1
  /// Only the canvas: no sidebar, inspector, toolbar or composer until one is asked for.
  var zen = false
  /// Set by a view that wants the canvas to move; the canvas clears it.
  var cameraRequest: CameraRequest?
  /// Counts requests to put the caret in the composer.
  private(set) var composerFocus = 0
  /// Edits register with this, so Undo and Redo in the Edit menu reach the canvas.
  weak var undoManager: UndoManager? { didSet { project?.undoManager = undoManager } }

  private var client: HostClient?
  private var socket: HostSocket?
  private var starting = false
  private var dragTree: (path: String, tree: SyntaxTree)?

  enum CameraRequest: Equatable {
    case fitAll
    case sheet(String)
    case selection
    case zoom(CGFloat)
  }

  /// The sessions of the open workspace, newest first.
  var sessions: [SessionInfo] {
    guard let workspace else { return [] }
    return directory.sessions.filter { $0.workspace == workspace.id }
  }

  /// The Nyte desktop app, when it is attached to the same host.
  var nyte: ConnectedClient? {
    others.first { $0.kind == "app" && $0.name == "Nyte" }
  }

  // MARK: Connecting

  /// Attaches to the host. Asking again while attached, or while trying, changes nothing.
  func start() {
    guard socket == nil, !starting else { return }
    starting = true
    Task {
      await connect()
      starting = false
    }
  }

  private func connect() async {
    phase = .connecting
    do {
      let endpoint = try HostEndpoint.discover()
      let client = HostClient(endpoint: endpoint)
      self.client = client
      hostName = (try? await client.describe()) ?? endpoint.url.host() ?? "host"

      let socket = HostSocket(
        endpoint: endpoint, name: "Nyte Studio", version: Self.version,
        actions: [
          ClientAction(
            name: "reveal", summary: "Shows a design file, and optionally one of its frames, on the canvas.",
            input: [
              "type": "object",
              "properties": ["path": ["type": "string"], "frame": ["type": "string"]],
              "required": ["path"],
            ]),
          ClientAction(
            name: "snapshot", summary: "Renders one frame of a design file and answers it as a PNG.",
            input: [
              "type": "object",
              "properties": [
                "path": ["type": "string"], "frame": ["type": "string"], "scale": ["type": "number"],
              ],
              "required": ["path"],
            ]),
        ])
      self.socket = socket
      socket.onState = { [weak self] state in self?.socketChanged(state) }
      socket.onClients = { [weak self] clients in self?.clientsChanged(clients) }
      socket.onEvent = { [weak self] event in
        self?.directory.apply(event)
        self?.transcript?.apply(event)
      }
      socket.onText = { [weak self] frame in self?.transcript?.applyText(frame) }
      socket.onPerform = { [weak self] action, input in
        guard let self else { throw HostError(code: "unavailable", message: "Nyte Studio is closing.") }
        return try await self.perform(action, input)
      }
      socket.connect()

      workspaces = try await client.workspaces().filter { $0.available && $0.path != nil && !$0.isWorktree }
      let listed = try await client.models()
      models = listed.choices
      model = listed.preferred ?? listed.choices.first

      let wanted = ProcessInfo.processInfo.environment["NYTE_STUDIO_WORKSPACE"]
        ?? UserDefaults.standard.string(forKey: "workspace")
      if let match = workspaces.first(where: { $0.path == wanted || $0.id == wanted }) {
        await open(match)
      } else if workspaces.count == 1, let only = workspaces.first {
        await open(only)
      } else {
        phase = .choosing
      }
    } catch {
      socket?.close()
      socket = nil
      phase = .unavailable(error.localizedDescription)
    }
  }

  private func socketChanged(_ state: HostSocket.State) {
    switch state {
    case .connected:
      online = true
      guard let socket else { return }
      Task {
        await directory.read(from: socket)
        await transcript?.read(from: socket)
      }
    case .connecting, .waiting:
      online = false
    }
  }

  private func clientsChanged(_ clients: [ConnectedClient]) {
    others = clients.filter { $0.id != socket?.clientID }
  }

  func open(_ workspace: WorkspaceInfo) async {
    guard let client else { return }
    project?.close()
    self.workspace = workspace
    selection = nil
    transcript = nil
    UserDefaults.standard.set(workspace.path, forKey: "workspace")
    let store = ProjectStore(workspace: workspace, client: client)
    store.undoManager = undoManager
    project = store
    phase = .ready
    await store.open()
  }

  func chooseWorkspace() {
    phase = .choosing
  }

  func focusComposer() {
    composerFocus += 1
  }

  // MARK: Chat

  func openSession(_ id: String) {
    guard transcript?.session != id, let socket else { return }
    if let current = transcript { Task { await socket.unsubscribe("session/\(current.session)") } }
    let next = Transcript(session: id)
    transcript = next
    panel = .chat
    Task { await next.read(from: socket) }
  }

  func newChat() {
    if let current = transcript, let socket {
      Task { await socket.unsubscribe("session/\(current.session)") }
    }
    transcript = nil
  }

  /// Sends the draft, with the selection as context. The first message of a chat starts the
  /// session and teaches the agent the design language in a prompt layer.
  func send() {
    let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, let client, let workspace, let socket else { return }
    draft = ""
    var parts: [MessagePart] = []
    if let excerpt = selectionExcerpt() { parts.append(excerpt) }
    parts.append(.text(text))

    Task {
      do {
        if let transcript {
          _ = try await client.send(session: transcript.session, content: parts)
        } else {
          let sent = try await client.startSession(
            workspace: workspace.id, content: parts, model: model, prompt: Self.guide)
          let next = Transcript(session: sent.session)
          transcript = next
          await next.read(from: socket)
        }
      } catch {
        draft = text
        project?.notice = "Couldn't send: \(error.localizedDescription)"
      }
    }
  }

  func stop() {
    guard let transcript, let client else { return }
    Task { await client.stop(session: transcript.session) }
  }

  /// The selected element as the agent can find it: its file, its lines, and its markup. It is
  /// the excerpt Nyte sends for a selection in a diff, so Nyte draws it as the same chip.
  private func selectionExcerpt() -> MessagePart? {
    guard let selection, let project, let tree = project.tree(selection.site.file),
      let line = tree.line(at: selection.site.path), let markup = tree.markup(at: selection.site.path)
    else { return nil }
    let lines = markup.split(separator: "\n", omittingEmptySubsequences: false).count
    return .excerpt(path: selection.site.file, start: line, end: line + lines - 1, text: markup)
  }

  /// What the selection reads as in the composer.
  var selectionLabel: String? {
    guard let selection, let node = selectedNode else { return nil }
    let file = URL(filePath: selection.site.file).lastPathComponent
    return "\(node.name)  ·  \(file)"
  }

  // MARK: Hand-off

  /// Brings Nyte forward on the same chat. Until Nyte declares an action for it, this opens the
  /// app, where the chat is already in the sidebar: both apps read the same host.
  func openInNyte() {
    Task {
      if let nyte, nyte.actions.contains("open"), let socket, let transcript {
        _ = try? await socket.perform("open", on: nyte.id, input: ["session": .string(transcript.session)])
      }
      if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "ai.nyte.desktop") {
        _ = try? await NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
      }
    }
  }

  /// Answers another client of the host: Nyte, a script, or a tool the agent calls.
  private func perform(_ action: String, _ input: JSON) async throws -> JSON {
    guard let project, let path = input["path"].string,
      let sheet = project.sheets.first(where: { $0.path == path })
    else { throw HostError(code: "unknown", message: "That design file isn't open on the canvas.") }
    let index = input["frame"].string.flatMap { name in
      sheet.frames.firstIndex { $0.root.node.name == name }
    }

    switch action {
    case "reveal":
      if let index {
        selection = CanvasSelection(sheet: path, frame: index, site: sheet.frames[index].root.node.site)
        cameraRequest = .selection
      } else {
        cameraRequest = .sheet(path)
      }
      NSApp.activate()
      return ["revealed": true]

    case "snapshot":
      guard let frame = sheet.frames[safe: index ?? 0],
        let image = frame.image(scale: CGFloat(input["scale"].double ?? 2)),
        let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
      else { throw HostError(code: "unavailable", message: "That frame couldn't be rendered.") }
      return ["png": .string(data.base64EncodedString()), "frame": .string(frame.root.node.name)]

    default:
      throw HostError(code: "not_supported", message: "Nyte Studio doesn't perform \(action).")
    }
  }

  // MARK: Editing

  var selectedNode: Node? {
    guard let selection, let sheet = project?.sheets.first(where: { $0.path == selection.sheet }),
      sheet.frames.indices.contains(selection.frame)
    else { return nil }
    return sheet.frames[selection.frame].placed().first { $0.box.node.site == selection.site }?.box.node
  }

  var selectedBox: PlacedBox? {
    guard let selection, let sheet = project?.sheets.first(where: { $0.path == selection.sheet }),
      sheet.frames.indices.contains(selection.frame)
    else { return nil }
    return sheet.frames[selection.frame].placed().first { $0.box.node.site == selection.site }
  }

  /// Sets or removes attributes of the selected element. With `commit` false the change shows
  /// on the canvas only, for a drag in flight; the commit that ends it saves and is one undo.
  func set(_ attributes: [String: String?], commit: Bool = true, named name: String = "Change") {
    guard let selection, let project else { return }
    let path = selection.site.file
    if dragTree?.path != path { dragTree = nil }
    guard let tree = dragTree?.tree ?? project.tree(path) else { return }
    let edits = attributes.compactMap { tree.setAttribute($0.key, to: $0.value, at: selection.site.path) }
    guard !edits.isEmpty else { return }
    if commit, dragTree == nil {
      project.edit(path, edits, named: name)
      return
    }
    if dragTree == nil { dragTree = (path, tree) }
    project.stage(path, from: tree, edits)
    if commit {
      project.commitStaged(path, named: name)
      dragTree = nil
    }
  }

  func setText(_ text: String) {
    guard let selection, let project, let tree = project.tree(selection.site.file),
      let edit = tree.setText(text, at: selection.site.path)
    else { return }
    project.edit(selection.site.file, [edit], named: "Edit Text")
  }

  func moveFrame(_ target: CanvasSelection, to origin: CGPoint, commit: Bool) {
    selection = target
    set(["x": formatNumber(origin.x), "y": formatNumber(origin.y)], commit: commit, named: "Move Frame")
  }

  func resize(_ target: CanvasSelection, to size: CGSize, origin: CGPoint?, commit: Bool) {
    selection = target
    var attributes: [String: String?] = ["w": formatNumber(size.width), "h": formatNumber(size.height)]
    if let origin {
      attributes["x"] = formatNumber(origin.x)
      attributes["y"] = formatNumber(origin.y)
    }
    set(attributes, commit: commit, named: "Resize")
  }

  func delete(_ target: CanvasSelection) {
    guard let project, let tree = project.tree(target.site.file), let edit = tree.remove(at: target.site.path)
    else { return }
    selection = nil
    project.edit(target.site.file, [edit], named: "Delete")
  }

  /// The markup of the selected element, as written.
  var selectedMarkup: String? {
    guard let selection else { return nil }
    return project?.tree(selection.site.file)?.markup(at: selection.site.path)
  }

  static let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"

  /// The Lune skill as shipped: the language reference, with the `lune` command's real path.
  static let skill: String = {
    let cli = Bundle.main.executableURL?.deletingLastPathComponent().appending(path: "lune").path ?? "lune"
    let text = NyteResources.url("lune-skill.md").flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""
    return text.replacingOccurrences(of: "/Applications/Nyte Studio.app/Contents/MacOS/lune", with: cli)
  }()

  /// The prompt layer a chat started in Studio carries: who the agent is working with, then the
  /// skill's body, so the first message needs no file read to speak the language.
  static let guide: String = {
    let body = skill.components(separatedBy: "\n---\n").dropFirst().joined(separator: "\n---\n")
    return """
      You are working with a designer in Nyte Studio, a design canvas. The designer is watching \
      the canvas, not the chat: keep answers short and let the designs speak.

      \(body)
      """
  }()

  /// Writes the Lune skill into the project, so a chat started anywhere on this host (Nyte, the
  /// terminal, a phone) knows the language too.
  func installSkill() {
    guard let client, let workspace else { return }
    Task {
      let path = ".agents/skills/lune/SKILL.md"
      do {
        let current = try await client.read(workspace: workspace.id, path: path)
        if current?.contents == Self.skill {
          project?.notice = "This project's agents already know Lune."
          return
        }
        _ = try await client.write(
          workspace: workspace.id, path: path, contents: Self.skill, expect: current?.version)
        project?.notice = "Added the Lune skill. Agents in this project now read and write designs."
      } catch {
        project?.notice = "Couldn't add the skill: \(error.localizedDescription)"
      }
    }
  }
}

extension HostClient {
  /// The machine name a host reports about itself, without a credential.
  func describe() async throws -> String? {
    var request = URLRequest(url: endpoint.url.appending(path: ".nyte/describe"))
    request.timeoutInterval = 5
    let (data, _) = try await URLSession.shared.data(for: request)
    return try JSON.parse(data)["name"].string
  }
}

extension Array {
  subscript(safe index: Int) -> Element? {
    indices.contains(index) ? self[index] : nil
  }
}
