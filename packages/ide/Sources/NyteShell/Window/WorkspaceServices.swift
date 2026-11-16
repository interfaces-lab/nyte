import Foundation
import NyteCore
import NyteDebug
import NyteLanguage

@MainActor
final class WorkspaceServices {
    let toolchain: Toolchain
    let language: LanguageService
    let debugger: Debugger
    private var isShutDown = false

    init(workspace: Workspace, settings: LanguageSettings) {
        toolchain = Toolchain(workspace: workspace.root)
        language = LanguageService(workspace: workspace, toolchain: toolchain, settings: settings)
        debugger = Debugger(workspace: workspace, toolchain: toolchain)
    }

    func shutdown() async {
        guard !isShutDown else { return }
        isShutDown = true
        await debugger.stop()
        await language.shutdown()
    }
}
