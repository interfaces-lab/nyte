enum TerminalKey: Equatable {
    case show, hide

    static func decide(isDockOpen: Bool, selected: ToolWindowID?, isTerminalFocused: Bool) -> TerminalKey {
        isDockOpen && selected == .terminal && isTerminalFocused ? .hide : .show
    }
}
