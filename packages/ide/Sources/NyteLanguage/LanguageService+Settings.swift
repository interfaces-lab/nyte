import Foundation
import NyteCore

extension LanguageService {
    enum SettingsChange: Equatable {
        case unchanged
        case reconfigure
        case restart
    }

    static func change(for spec: ServerSpec, from old: LanguageSettings, to new: LanguageSettings, in workspace: URL) -> SettingsChange {
        if ServerTable.needsRestart(spec, from: old, to: new, in: workspace) { return .restart }
        let hints = spec.name == ServerTable.gopls.name
            ? old.go.inlayHints != new.go.inlayHints : old.typeScript.inlayHints != new.typeScript.inlayHints
        return hints ? .reconfigure : .unchanged
    }

    func apply(_ new: LanguageSettings, replacing old: LanguageSettings) {
        for index in servers.indices {
            let spec = ServerTable.all[servers[index].spec]
            if ServerTable.countsUsages(spec, old) != ServerTable.countsUsages(spec, new) || ServerTable.memoryCeiling(of: spec, old)
                != ServerTable.memoryCeiling(of: spec, new) {
                for document in documents where document.server == index { counted[document.url] = nil }
                onEvent?(.status(status(of: index)))
            }
            switch Self.change(for: spec, from: old, to: new, in: workspace.root) {
            case .unchanged:
                continue
            case .restart:
                Task { await self.restart(index) }
            case .reconfigure:
                guard let plan = servers[index].plan else { continue }
                let fresh = ServerTable.settings(for: plan, new)
                servers[index].plan?.options = fresh.options
                servers[index].plan?.settings = fresh.settings
                servers[index].connection?.enqueue(.notify(ClientFeature.didChangeConfiguration.method, ["settings": fresh.settings]))
            }
        }
    }

    public func useTSServer(_ on: Bool) {
        settings = settings.choosingTSServer(on, in: workspace.root)
    }

    public func environmentReading() async -> EnvironmentReading {
        await toolchain.reading()
    }

    public func reloadEnvironment() async -> EnvironmentReading {
        let reading = await toolchain.reload()
        toldEnvironmentProblem = false
        for index in servers.indices {
            let spec = ServerTable.all[servers[index].spec]
            let request = PlanRequest(root: servers[index].root, workspace: workspace.root, toolchain: toolchain, settings: settings)
            let fresh = try? await spec.plan(request).get()
            let changed = fresh?.executable != servers[index].plan?.executable || fresh?.source != servers[index].plan?.source
                || (servers[index].environment.map { $0 != reading.values } ?? true)
            if changed { await restart(index) }
        }
        return reading
    }
}
