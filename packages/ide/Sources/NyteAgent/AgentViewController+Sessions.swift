import AppKit
import NyteCore
import NyteUI

public struct AgentWaitingSession: Sendable, Equatable {
    public enum Request: Sendable, Equatable { case approval, question, other }

    public let id: String
    public let title: String
    public let request: Request
    public let asked: String
    public let since: Date
}

extension AgentViewController {
    enum FirstChoice: Equatable { case waiting, opened, made }

    func setUpTitle() {
        titleButton.toolTip = "Sessions (\u{2303}\u{2318}S)"
        titleButton.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        titleButton.onPress = { [weak self] in self?.showSessionSwitcher() }
        titleBar.orientation = .horizontal
        titleBar.spacing = Space.x1
        titleBar.detachesHiddenViews = true
        titleBar.edgeInsets = NSEdgeInsets(top: 0, left: -PaneHeader.middleGap, bottom: 0, right: 0)
        titleBar.addArrangedSubview(titleButton)
        titleBar.addArrangedSubview(stateView)
        header.middle = titleBar
        wire(switcher.sessions)
        switcher.sessions.onOpenInWindow = onOpenSessionInNewWindow
    }

    func show(title: String?) {
        titleButton.title = title ?? Self.untitled
        titleButton.setAccessibilityValue(titleButton.title)
        titleButton.toolTip = (title ?? Self.untitled) + "\nSessions (\u{2303}\u{2318}S)"
    }

    public func showSessionSwitcher() {
        guard view.window != nil, !header.isHiddenOrHasHiddenAncestor else { return }
        if switcher.isShown { return switcher.dismiss() }
        switcher.show(under: header)
    }

    func announceWaiting(_ list: [SessionSummary]) {
        let waiting = list.compactMap { summary -> AgentWaitingSession? in
            let state = SessionState(summary)
            guard state.isWaiting else { return nil }
            let request: AgentWaitingSession.Request = switch state.request {
            case .approval?: .approval
            case .question?: .question
            case nil: .other
            }
            return AgentWaitingSession(id: summary.id, title: SessionLines.title(summary, shown: nil, opening: nil).title,
                                       request: request, asked: summary.asked ?? "", since: summary.lastActivity)
        }
        if waiting.count != waitingCount {
            waitingCount = waiting.count
            onWaitingCountChange?(waiting.count)
        }
        guard waiting != waitingSessions else { return }
        waitingSessions = waiting
        onWaitingChange?(waiting)
    }

    func chooseFirst() {
        guard firstChoice == .opened, connection == .ready else { return }
        firstChoice = .made
        guard shown == nil, composer.draft.isEmpty, draftContext.isEmpty else { return }
        let newest = sessions.max { $0.lastActivity < $1.lastActivity }
        guard let newest, SessionState(newest) != .none else { return }
        open(newest.id)
    }

    func confirmArchive(_ id: String) {
        switcher.dismiss()
        guard let window = view.window, let session = sessions.first(where: { $0.id == id }) else { return }
        let title = SessionLines.title(session, shown: nil, opening: nil).title
        let alert = NSAlert()
        alert.messageText = "Archive \u{201C}\(title)\u{201D}?"
        alert.informativeText = SessionState(session) == .none
            ? "It leaves the session list. Nyte keeps it."
            : "It leaves the session list while it still has work going. Nyte keeps it."
        alert.addButton(withTitle: "Archive")
        alert.addButton(withTitle: "Cancel")
        alert.buttons.first?.hasDestructiveAction = true
        alert.beginSheetModal(for: window) { [weak self] response in
            guard response == .alertFirstButtonReturn else { return }
            MainActor.assumeIsolated { self?.archive(id) }
        }
    }

    private func archive(_ id: String) {
        let engine = engine
        Task {
            if let problem = await engine.archive(id) {
                return showSendProblem(problem, title: "Couldn't archive the session")
            }
            if id == shown { newSession() }
        }
    }
}
