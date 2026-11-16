import AppKit
import NyteChanges

extension ShellViewController {
    var isReviewShown: Bool {
        guard let id = editorPane.shownDocument, let document = editorPane.documents.first(where: { $0.id == id }) else { return false }
        return document.controller is DiffViewController || document.controller is ReviewViewController
    }

    var dockFacts: DockIdle.Facts {
        DockIdle.Facts(shown: dock.selected, hasForegroundJob: ForegroundJobs.anyRunning(), problemCount: problems.count,
                       isDebugging: isSessionActive)
    }

    func shownDocumentDidChange() {
        markOpenDiff()
        switch (isReviewShown, reviewLayout) {
        case (true, .normal):
            reviewLayout = ReviewLayout.entering(isDockOpen: !dockItem.isCollapsed, dockIdle: DockIdle.isIdle(dockFacts))
            if reviewLayout == .collapsedDock { arrange { setDock(open: false, from: nil) } }
        case (false, .collapsedDock):
            reviewLayout = .normal
            arrange { setDock(open: true, from: nil) }
        case let (false, .focused(sidebar, dock)):
            leaveFocus(sidebar: sidebar, dock: dock)
        case (true, _), (false, .normal):
            break
        }
    }

    private func markOpenDiff() {
        let shown = editorPane.shownDocument.flatMap { id in editorPane.documents.first { $0.id == id } }
        guard let diff = shown?.controller as? DiffViewController, case let .repository(_, path, comparison) = diff.source else {
            return changes?.showOpenDiff(path: nil, comparison: .worktree) ?? ()
        }
        changes?.showOpenDiff(path: path, comparison: comparison)
    }

    func toggleFocusReview() {
        if case let .focused(sidebar, dock) = reviewLayout { return leaveFocus(sidebar: sidebar, dock: dock) }
        let collapsesDock = !dockItem.isCollapsed && DockIdle.isIdle(dockFacts)
        let wasCollapsedByReview = reviewLayout == .collapsedDock
        reviewLayout = .focused(restoresSidebar: !sidebarItem.isCollapsed, restoresDock: collapsesDock || wasCollapsedByReview)
        arrange {
            setSidebar(open: false, from: nil)
            if collapsesDock { setDock(open: false, from: nil) }
        }
    }

    private func leaveFocus(sidebar: Bool, dock: Bool) {
        reviewLayout = .normal
        arrange {
            if sidebar { setSidebar(open: true, from: nil) }
            if dock { setDock(open: true, from: nil) }
        }
        if isReviewShown { shownDocumentDidChange() }
    }

    func arrange(_ change: () -> Void) {
        isArrangingReview = true
        change()
        isArrangingReview = false
    }

    func userMovedPanes() {
        guard !isArrangingReview, reviewLayout != .normal else { return }
        reviewLayout = .normal
    }
}
