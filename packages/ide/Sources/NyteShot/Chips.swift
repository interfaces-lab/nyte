import Foundation
import NyteCore

enum Chips {
    static func all(in root: URL) -> [AgentContext] {
        let hub = root.appendingPathComponent("hub/hub.go")
        let stop = AgentContext.Stop(file: hub, line: 41, function: "hub.(*Hub).Send", locals: [
            AgentContext.Stop.Local(name: "message", type: "hub.Message", value: "{Channel: \"mail\", Subject: \"Welcome\"}"),
        ])
        return [
            .file(root.appendingPathComponent("main.go")),
            .lines(AgentContext.Lines(file: hub, range: AgentContext.LineRange(first: 12, last: 16), text: "type Message struct {\n}")),
            .diagnostic(AgentContext.Diagnostic(file: hub, start: AgentContext.Position(line: 25, column: 5),
                                                end: AgentContext.Position(line: 25, column: 23), severity: .error,
                                                message: "undefined: ErrClosed", source: "compiler", code: "UndeclaredName")),
            .review(AgentContext.Review(file: hub, side: .new, range: AgentContext.LineRange(first: 30, last: 34), lines: "func (h *Hub) Send(",
                                        comment: "Retry once before giving up?")),
            .terminal(AgentContext.Terminal(text: "--- FAIL: TestSend (0.01s)\n    hub_test.go:22: got 0 deliveries", directory: root)),
            .stop(stop),
        ]
    }
}
