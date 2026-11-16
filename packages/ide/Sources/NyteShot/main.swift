import AppKit
import NyteCore
@testable import NyteAgent
import NyteReplay
import NyteUI
@testable import NyteChanges
@testable import NyteSearch
@testable import NyteShell

let usage = """
usage: NyteShot <out.png> <folder> [light|dark] [key=value ...]
  size=WxH  wait=seconds  tabs=a.go,b.go  caret=line:column
  density=compact|standard  dock=terminal|problems|find|debug  navigator=files|structure|changes
  collapse=sidebar,agent,dock  palette=all|files|symbols|commands|text  query=text  command=findUsages,...  rename=NewName  check=keys|preferences  settings=general|editor|terminal|tools|keys  server=panel
  diff=path/in/repo  comment=words  agent=transcript|approval|question|failed|running  review=open
  switcher=sessions  side=split  layout=focus  folder=path  run=terminal  review=open|all  search=text  replace=text  chips=all  preview=path  banner=disk  welcome=folder,folder  check=all  measure=app|servers

"""
let arguments = Array(CommandLine.arguments.dropFirst())
guard arguments.count >= 2 else {
    FileHandle.standardError.write(Data(usage.utf8))
    exit(2)
}
let output = URL(fileURLWithPath: arguments[0])
try? FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
let workspace = Workspace(root: URL(fileURLWithPath: arguments[1]))
var options: [String: String] = [:]
var size = WorkspaceWindowController.defaultSize
let defaultSettle = 2.5
var settle = defaultSettle
for argument in arguments.dropFirst(2) {
    let parts = argument.split(separator: "=", maxSplits: 1).map(String.init)
    switch (parts[0], parts.count > 1 ? parts[1] : "") {
    case ("light", _): NSApplication.shared.appearance = NSAppearance(named: .aqua)
    case ("dark", _): NSApplication.shared.appearance = NSAppearance(named: .darkAqua)
    case ("size", let value):
        let sides = value.split(separator: "x").compactMap { Double($0) }
        if sides.count == 2 { size = NSSize(width: sides[0], height: sides[1]) }
    case ("wait", let value): settle = Double(value) ?? settle
    case let (key, value): options[key] = value
    }
}

final class ShotWindow: NSWindow {
    nonisolated(unsafe) static var claimsKey = true
    override var isKeyWindow: Bool { Self.claimsKey }
    override var isMainWindow: Bool { true }
    override var occlusionState: NSWindow.OcclusionState { .visible }
}

@MainActor func views<T: NSView>(of type: T.Type, in root: NSView) -> [T] {
    ((root as? T).map { [$0] } ?? []) + root.subviews.flatMap { views(of: type, in: $0) }
}

@MainActor func render(_ view: NSView) -> NSBitmapImageRep? {
    view.layoutSubtreeIfNeeded()
    guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return nil }
    view.cacheDisplay(in: view.bounds, to: bitmap)
    return bitmap
}

@MainActor func composite(_ panels: [NSWindow], over window: NSWindow, into base: NSBitmapImageRep) {
    guard !panels.isEmpty, let context = NSGraphicsContext(bitmapImageRep: base) else { return }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    for panel in panels where panel.isVisible {
        guard let content = panel.contentView, let overlay = render(content) else { continue }
        let origin = NSPoint(x: panel.frame.minX - window.frame.minX, y: panel.frame.minY - window.frame.minY)
        overlay.draw(in: NSRect(origin: origin, size: panel.frame.size), from: .zero, operation: .sourceOver, fraction: 1,
                     respectFlipped: false, hints: nil)
    }
    NSGraphicsContext.restoreGraphicsState()
}

let application = NSApplication.shared
application.setActivationPolicy(.accessory)
AppDelegate.installRenderers()
let preferences = PreferencesCenter(Preferences())
AppDelegate.wire(preferences)
if arguments.contains("light") { preferences.update { $0.general.appearance = .light } }
if arguments.contains("dark") { preferences.update { $0.general.appearance = .dark } }
if let density = arguments.first(where: { $0.hasPrefix("density=") }).flatMap({ Preferences.Density(rawValue: String($0.dropFirst("density=".count))) }) {
    preferences.update { $0.general.density = density }
}

let tabs = options["tabs"]?.split(separator: ",").map(String.init) ?? []
var state = WorkspaceState()
state.openTabs = tabs
state.selectedTab = tabs.isEmpty ? nil : 0
state.navigator = options["navigator"]
state.dockWindow = options["dock"]
state.save(workspace)

let replayScripts = ["transcript": ReplayScript.transcript, "approval": ReplayScript.approval,
                     "question": ReplayScript.question, "failed": ReplayScript.failed, "running": ReplayScript.running,
                     "retrying": ReplayScript.retrying, "unread": ReplayScript.unread]
let replayHome = FileManager.default.temporaryDirectory.appendingPathComponent("nyteshot-replay-\(getpid())")
let replay: ReplayHost? = options["agent"] == nil ? nil : try? ReplayHost.start(home: replayHome)
if replay != nil { setenv("NYTE_HOME", replayHome.path, 1) }

let controller = WorkspaceWindowController(workspace: workspace, preferences: preferences)
guard let window = controller.window, let shell = controller.shell else { exit(1) }
object_setClass(window, ShotWindow.self)
controller.services.debugger.removeAllBreakpoints()
shell.fitPanes(toWindowWidth: size.width)
window.setContentSize(size)
window.alphaValue = 0
window.ignoresMouseEvents = true
window.orderBack(nil)
window.layoutIfNeeded()
window.displayIfNeeded()
let firstFrame = Measure.secondsSinceLaunch()
nonisolated(unsafe) var editableAt: Double?
Task { @MainActor in
    guard !tabs.isEmpty, await Wait.until(.seconds(30), { shell.editor.selectionContext() != nil }) else { return }
    editableAt = Measure.secondsSinceLaunch()
}

for pane in (options["collapse"] ?? "").split(separator: ",") {
    switch pane {
    case "sidebar": shell.setSidebar(open: false, from: nil)
    case "agent": shell.setAgent(open: false, from: nil)
    case "dock": shell.setDock(open: false, from: nil)
    default: break
    }
}

func finish(_ code: Int32) {
    Task { @MainActor in
        replay?.stop()
        if replay != nil { try? FileManager.default.removeItem(at: replayHome) }
        await controller.services.shutdown()
        exit(code)
    }
}

Task { @MainActor in
    guard await Wait.pause(.seconds(settle)) else { return finish(1) }
    if let caret = options["caret"]?.split(separator: ":").compactMap({ Int($0) }), caret.count == 2, let url = shell.editor.selectedURL {
        let place = TextPosition(line: caret[0] - 1, column: caret[1] - 1)
        shell.editor.reveal(FileLocation(url: url, range: TextSpan(at: place)), asJump: false)
        guard await Wait.pause(.seconds(1)) else { return finish(1) }
    }
    if let name = options["rename"], let caret = options["caret"]?.split(separator: ":").compactMap({ Int($0) }), caret.count == 2,
       let url = shell.editor.selectedURL {
        let place = TextPosition(line: caret[0] - 1, column: caret[1] - 1)
        if case let .success(edit) = await shell.services.language.rename(at: place, in: url, to: name) {
            shell.editor.onPreviewEdit?(edit, "Rename to \(name)")
        }
        guard await Wait.pause(.seconds(settle)) else { return finish(1) }
    }
    for id in (options["command"] ?? "").split(separator: ",").compactMap({ CommandID(rawValue: String($0)) }) {
        shell.run(id, from: nil)
        guard await Wait.pause(.seconds(settle)) else { return finish(1) }
    }
    if options["check"] == "preferences" {
        let failures = PreferencesCheck.run(preferences, shell: shell)
        failures.forEach { print("FAIL", $0) }
        print(failures.isEmpty ? "preferences: every applied setting reached its owner" : "preferences: \(failures.count) failures")
        return finish(failures.isEmpty ? 0 : 1)
    }
    if let folders = options["welcome"] {
        let store = UserDefaults(suiteName: "sh.nyte.shot.welcome") ?? .standard
        var remembered = AppState()
        for folder in folders.split(separator: ",").reversed() { remembered = remembered.opening(String(folder)) }
        remembered.save(to: store)
        let app = AppDelegate(preferences: preferences, store: store)
        guard let panel = app.welcome.window else { return finish(1) }
        object_setClass(panel, ShotWindow.self)
        panel.alphaValue = 0
        panel.ignoresMouseEvents = true
        app.welcome.reload()
        panel.orderBack(nil)
        guard await Wait.pause(.seconds(1)) else { return finish(1) }
        store.removePersistentDomain(forName: "sh.nyte.shot.welcome")
        guard let frame = panel.contentView?.superview else { return finish(1) }
        views(of: NSView.self, in: frame).forEach { $0.needsDisplay = true }
        panel.displayIfNeeded()
        guard let image = render(frame) else { return finish(1) }
        try? image.representation(using: .png, properties: [:])?.write(to: output)
        print(output.path, "\(image.pixelsWide)x\(image.pixelsHigh)")
        return finish(0)
    }
    if let pane = options["settings"].flatMap(SettingsPane.init(rawValue:)) {
        let settings = SettingsWindowController(center: preferences) { workspace.root }
        guard let panel = settings.window else { return finish(1) }
        object_setClass(panel, ShotWindow.self)
        panel.alphaValue = 0
        panel.ignoresMouseEvents = true
        settings.show(pane)
        panel.orderBack(nil)
        guard await Wait.pause(.seconds(settle)) else { return finish(1) }
        if [.languages, .debugger, .tools].contains(pane) { settings.show(pane) }
        guard let frame = panel.contentView?.superview else { return finish(1) }
        views(of: NSView.self, in: frame).forEach { $0.needsDisplay = true }
        panel.displayIfNeeded()
        guard let image = render(frame) else { return finish(1) }
        try? image.representation(using: .png, properties: [:])?.write(to: output)
        print(output.path, "\(image.pixelsWide)x\(image.pixelsHigh)", "sidebar \(SettingsSidebar.width) pt")
        return finish(0)
    }
    if let script = options["agent"].flatMap({ replayScripts[$0] }) {
        shell.setAgent(open: true, from: nil)
        shell.agent.openSession(script)
        guard await Wait.pause(.seconds(settle)) else { return finish(1) }
        if let review = options["review"] {
            if review == "all" {
                shell.agent.reviewAllChanges()
            } else {
                views(of: Button.self, in: shell.agent.view).first { $0.title == "Review Changes" }?.press()
            }
            guard await Wait.pause(.seconds(settle)) else { return finish(1) }
            if options["layout"] == "focus" { shell.toggleFocusReview() }
        }
    }
    if options["switcher"] == "sessions" {
        shell.setAgent(open: true, from: nil)
        shell.agent.showSessionSwitcher()
        guard await Wait.pause(.seconds(1)) else { return finish(1) }
    }
    if let path = options["diff"], case let .repository(git) = await GitRepository.locate(workspace.root) {
        let diff = DiffViewController(source: .repository(git, path: path, comparison: .worktree))
        shell.openDiff(diff)
        guard await Wait.pause(.seconds(settle)) else { return finish(1) }
        if options["side"] == "split" { diff.isSideBySide = true }
        if options["layout"] == "focus" { shell.toggleFocusReview() }
        guard await Wait.pause(.seconds(1)) else { return finish(1) }
    }
    if let words = options["comment"], let diff = shell.openDiffs.last {
        let canvas = diff.pane.canvas
        canvas.move(to: Int(canvas.rows.headers.first ?? 0) + 1, extending: false)
        canvas.openComposer()
        canvas.composer?.field.string = words
        canvas.commitComposer()
        guard await Wait.pause(.seconds(1)) else { return finish(1) }
    }
    if let path = options["preview"] {
        shell.editor.open(workspace.root.appendingPathComponent(path), preview: true)
        guard await Wait.pause(.seconds(1)) else { return finish(1) }
    }
    if options["banner"] == "disk", let url = shell.editor.selectedURL {
        let end = TextPosition(line: 0, column: 0)
        _ = await shell.editor.apply(WorkspaceEdit(files: [.init(url: url, edits: [TextEdit(range: TextSpan(at: end), text: "// draft\n")])]))
        guard await Wait.pause(.seconds(1)) else { return finish(1) }
        shell.editor.filesDidChange([url])
        guard await Wait.pause(.seconds(1)) else { return finish(1) }
    }
    if options["chips"] == "all" {
        shell.ask(Chips.all(in: workspace.root))
        guard await Wait.pause(.seconds(1)) else { return finish(1) }
    }
    if let folder = options["folder"] {
        shell.navigator.onFindInFolder?(workspace.root.appendingPathComponent(folder))
        guard await Wait.pause(.milliseconds(500)) else { return finish(1) }
    }
    if options["run"] == "terminal" {
        _ = await Wait.until(.seconds(10)) { shell.runTarget != nil }
        shell.run(.runInTerminal, from: nil)
        guard await Wait.pause(.seconds(settle * 2)) else { return finish(1) }
    }
    if let query = options["search"] {
        if options["folder"] == nil { shell.findInFiles() }
        shell.search.find(query)
        if let replacement = options["replace"] {
            shell.search.bar.setDisclosed(true)
            shell.search.bar.replace.stringValue = replacement
            shell.search.replaceChanged()
        }
        guard await Wait.pause(.seconds(settle)) else { return finish(1) }
        shell.search.enterResults()
        guard await Wait.pause(.seconds(1)) else { return finish(1) }
    }
    if options["server"] == "panel" {
        shell.showServerPanel(from: shell.editorPane.foot.serverItem)
        guard await Wait.pause(.seconds(settle)) else { return finish(1) }
    }
    if let mode = options["measure"] {
        await MeasureRun.run(mode, shell: shell, window: window, launch: (firstFrame, editableAt))
        return finish(0)
    }
    if options["check"] == "all" {
        let sections = await AllCheck.run(shell, preferences: preferences)
        for section in sections {
            section.failures.forEach { print("FAIL", section.name + ":", $0) }
            print("\(section.name): \(section.checks - min(section.failures.count, section.checks)) of \(section.checks) passed")
        }
        let failed = sections.reduce(0) { $0 + $1.failures.count }
        print(failed == 0 ? "all: every check passed" : "all: \(failed) failures")
        return finish(failed == 0 ? 0 : 1)
    }
    if options["check"] == "keys" {
        let failures = KeyCheck.run(shell)
        failures.forEach { print("FAIL", $0) }
        print(failures.isEmpty ? "keys: every terminal chord reaches the terminal" : "keys: \(failures.count) failures")
        return finish(failures.isEmpty ? 0 : 1)
    }
    if let dock = options["dock"].flatMap(ToolWindowID.init(rawValue:)), shell.dock.selected != dock { shell.showToolWindow(dock) }
    if let palette = options["palette"] {
        let scope = Palettes.Scope.allCases.first { $0.title.lowercased() == palette } ?? .files
        ShotWindow.claimsKey = false
        shell.run(.commandPalette, from: nil)
        shell.palettes.search.view.scope = scope.rawValue
        if let query = options["query"] { shell.palettes.search.view.setQuery(query) }
        guard await Wait.pause(.seconds(2)) else { return finish(1) }
    }
    window.toolbar?.validateVisibleItems()
    guard let frame = window.contentView?.superview else { return finish(1) }
    views(of: NSView.self, in: frame).forEach { $0.needsDisplay = true }
    window.displayIfNeeded()
    guard let base = render(frame) else { return finish(1) }
    composite(window.childWindows ?? [], over: window, into: base)
    try? base.representation(using: .png, properties: [:])?.write(to: output)
    print(output.path, "\(base.pixelsWide)x\(base.pixelsHigh)")
    print("navigator \(shell.sidebarItem.isCollapsed ? 0 : shell.sidebar.view.frame.width) pt, surface \(shell.surface.surface.frame.width)x\(shell.surface.surface.frame.height) pt")
    var usage = rusage()
    getrusage(RUSAGE_SELF, &usage)
    print(String(format: "peak resident %.1f MB", Double(usage.ru_maxrss) / 1_048_576))
    finish(0)
}
application.run()
