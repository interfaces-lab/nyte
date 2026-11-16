import Foundation

extension AgentEngine {
    static let permissionSetting = "permissions"

    func readWorkspaces() async {
        do throws(LinkError) {
            let rows = try await link.call(Wire.ListWorkspaces()).items
            worktrees = Dictionary(rows.compactMap { $0.isolation == nil ? nil : ($0.id, $0) }) { _, last in last }
        } catch {
            return
        }
    }

    func noticeWorkspace(_ id: String) {
        guard !unknownWorkspaces.contains(id) else { return }
        unknownWorkspaces.insert(id)
        Task {
            await readWorkspaces()
            guard worktrees[id] != nil else { return }
            await rereadSessions()
        }
    }

    private func rereadSessions() async {
        do throws(LinkError) {
            try await readSessions()
        } catch {
            return
        }
    }

    func emitPlace() {
        let workspace = shown.flatMap { summaries[$0.id] }?.worktree
        let path = worktrees.values.first { $0.isolation?.branch == workspace && workspace != nil }?.target.path
        emit(.place(worktree: workspace, path: path))
    }

    func readCatalog() async {
        guard let id = rows?.catalog, id != catalogRead else { return }
        catalogRead = id
        do throws(LinkError) {
            let read = try await link.call(Wire.ReadCatalog(id: id))
            permission = read.settings.first { $0.id == Self.permissionSetting }
        } catch {
            catalogRead = nil
            return
        }
        emit(.permission(permission))
    }

    func emitPermission() {
        emit(.permission(permission))
    }

    func choosePermission(_ value: String) async {
        guard let current = permission, current.value != value else { return }
        do throws(LinkError) {
            switch try await link.call(Wire.ApplySetting(id: Self.permissionSetting, value: value)) {
            case .applied:
                permission = Wire.Setting(copying: current, value: value)
                emit(.permission(permission))
            case .invalid, .unknown:
                emit(.permissionRefused("Nyte didn't accept that permission mode."))
            }
        } catch {
            emit(.permissionRefused(error.message))
        }
    }

    func needChanges(sessions ids: [String]) {
        loadRuns(ids.compactMap { summaries[$0]?.lastRun })
    }

    func loadRuns(_ wanted: [String]) {
        let fresh = Array(Set(wanted.filter { runs[$0] == nil }))
        guard !fresh.isEmpty else { return }
        guard case let .registered(workspace) = place else {
            for run in fresh { runs[run] = .unavailable }
            return
        }
        for run in fresh { runs[run] = .loading }
        Task { await readRuns(fresh, workspace: workspace) }
    }

    private func readRuns(_ wanted: [String], workspace: String) async {
        for run in wanted {
            do throws(LinkError) {
                let set = try await link.call(Wire.RunChanges(workspace: workspace, source: .init(run: run)))
                runs[run] = .host(set.files)
            } catch {
                switch error {
                case .lost, .notConnected: runs.removeValue(forKey: run)
                case .host, .undecodable: runs[run] = .unavailable
                }
            }
        }
        var touched = false
        for (id, summary) in summaries {
            guard let run = summary.lastRun, wanted.contains(run), case let .host(files)? = runs[run] else { continue }
            summaries[id]?.changes = ChangeTotals(files)
            touched = true
        }
        if touched { emit(.sessions(summaries.values.sorted { $0.lastActivity > $1.lastActivity })) }
        if let rows, !Set(rows.endedRuns).isDisjoint(with: wanted) { emitSnapshot() }
    }
}
