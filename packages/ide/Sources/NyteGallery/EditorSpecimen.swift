import AppKit
import NyteCore
import NyteLanguage
import NyteUI
@testable import NyteEditor

@MainActor
final class EditorSpecimen {
    static let fixtures = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("Fixtures", isDirectory: true)
    static let size = NSSize(width: 860, height: 520)
    private static var kept: [EditorSpecimen] = []

    let workspace: Workspace
    let service: LanguageService
    let editor: EditorViewController
    let card = PaneCard()

    init(fixture: String) {
        workspace = Workspace(root: Self.fixtures.appendingPathComponent(fixture, isDirectory: true))
        service = LanguageService(workspace: workspace, toolchain: Toolchain(workspace: workspace.root))
        editor = EditorViewController(workspace: workspace)
        editor.intelligence = service
        service.onEvent = { [weak editor] in editor?.handle($0) }
        service.applyEdit = { [weak editor] in await editor?.apply($0) ?? false }
        card.embed(editor.view)
        card.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            card.widthAnchor.constraint(equalToConstant: Self.size.width),
            card.heightAnchor.constraint(equalToConstant: Self.size.height),
        ])
        Self.kept.append(self)
    }

    func url(_ path: String) -> URL { workspace.root.appendingPathComponent(path) }

    func open(_ path: String, at line: Int = 0, column: Int = 0) {
        let position = TextPosition(line: line, column: column)
        editor.reveal(FileLocation(url: url(path), range: TextSpan(at: position)), asJump: false)
    }

    func waitForDiagnostics(in path: String, timeout: Duration = .seconds(30)) async {
        let file = url(path)
        _ = await Wait.until(timeout) { !service.diagnostics(for: file).isEmpty }
    }

    func shutdown() async {
        await service.shutdown()
    }
}
