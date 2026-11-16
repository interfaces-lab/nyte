import AppKit
import NyteUI

enum PaneFit: Equatable {
    case agent, sidebar

    static let sidebarMinimum: CGFloat = 180

    static func collapses(width: CGFloat, isSidebarOpen: Bool, isAgentOpen: Bool) -> [PaneFit] {
        var sidebar = isSidebarOpen, agent = isAgentOpen
        var collapsed: [PaneFit] = []
        while needed(sidebar: sidebar, agent: agent) > width {
            if agent {
                agent = false
                collapsed.append(.agent)
            } else if sidebar {
                sidebar = false
                collapsed.append(.sidebar)
            } else {
                break
            }
        }
        return collapsed
    }

    static func needed(sidebar: Bool, agent: Bool) -> CGFloat {
        let edges = Metric.contentInset * 2 + Metric.hairline * 2
        return edges + Metric.editorMin + (sidebar ? sidebarMinimum : 0) + (agent ? Metric.agentMin : 0)
    }
}
