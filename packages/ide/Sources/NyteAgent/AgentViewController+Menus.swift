import AppKit
import NyteCore
import NyteUI

extension AgentViewController {
    func showHeaderState() {
        let state = sessions.first { $0.id == shown }.map(SessionState.init) ?? .none
        let now = Date.now
        stateView.show(state, now: now)
        stateView.isHidden = state.words(now: now).isEmpty
        guard state.ticks else {
            stateClock?.invalidate()
            stateClock = nil
            return
        }
        guard stateClock == nil else { return }
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.showHeaderState() }
        }
        RunLoop.main.add(timer, forMode: .common)
        stateClock = timer
    }

    func showPlace(worktree: String?, path: String?) {
        guard let worktree else {
            composer.show(place: workspace.name, detail: "Works in " + workspace.root.path)
            return
        }
        composer.show(place: worktree, detail: "Works in the worktree " + worktree + (path.map { " at " + $0 } ?? ""))
    }

    func permissionMenu() -> NSMenu {
        guard let permission, !permission.choices.isEmpty else {
            return Menu.make([MenuItem("This Nyte offers no permission modes", enabled: false)])
        }
        var items = [MenuItem.header(permission.scope == .host ? "Permissions for every session on this Nyte" : permission.label)]
        items += permission.choices.map { choice in
            var item = MenuItem(choice.label, checked: choice.value == permission.value) { [weak self] in self?.choosePermission(choice.value) }
            item.subtitle = choice.badge ?? ""
            return item
        }
        return Menu.make(items)
    }

    func choosePermission(_ value: String) {
        let engine = engine
        Task { await engine.choosePermission(value) }
    }

    func modelMenu() -> NSMenu {
        if let modelProblem { return Menu.make([MenuItem("Couldn't read the models: " + modelProblem, enabled: false)]) }
        guard !models.isEmpty else { return Menu.make([MenuItem("No models are signed in", enabled: false)]) }
        var items: [MenuItem] = []
        var provider: String?
        for choice in models {
            if choice.provider != provider {
                provider = choice.provider
                items.append(.header(choice.provider))
            }
            items.append(MenuItem(choice.name, checked: choice.ref == currentModel) { [weak self] in self?.pick(choice) })
        }
        return Menu.make(items)
    }

    func pick(_ choice: ModelChoice) {
        currentModel = choice.ref
        composer.modelTitle = choice.name
        Task { await engine.choose(choice.ref) }
    }

    func moreMenu() -> NSMenu {
        Menu.make([MenuItem("Review All Changes", enabled: shown != nil && connection == .ready) { [weak self] in self?.reviewAllChanges() }])
    }
}
