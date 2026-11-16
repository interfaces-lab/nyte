import Foundation
import NyteCore
@testable import NyteAgent

extension HostCheck {
    @MainActor enum ContextCheck {
        static let root = URL(fileURLWithPath: "/work/hub")

        static func file(_ path: String) -> URL { root.appending(path: path) }

        static let samples: [(name: String, context: [AgentContext], expected: [String])] = [
            ("a file", [.file(file("hub/hub.go"))], ["reference hub/hub.go"]),
            ("lines of a file", [.lines(AgentContext.Lines(file: file("hub/hub.go"), range: .init(first: 41, last: 43),
                                                         text: "select {\ncase <-ctx.Done():\n}"))],
             ["```hub/hub.go:41-43\nselect {\ncase <-ctx.Done():\n}\n```"]),
            ("lines holding a fence", [.lines(AgentContext.Lines(file: file("README.md"), range: .init(first: 3, last: 3), text: "```go"))],
             ["````README.md:3\n```go\n````"]),
            ("a diagnostic", [.diagnostic(AgentContext.Diagnostic(file: file("hub/hub.go"), start: .init(line: 41, column: 5),
                                                                   end: .init(line: 41, column: 8), severity: .error,
                                                                   message: "undefined: ctx\nsee the docs", source: "gopls", code: "UndeclaredName"))],
             ["diagnostic hub/hub.go:41:5-41:8 error gopls(UndeclaredName): undefined: ctx see the docs"]),
            ("review comments, grouped by file in order", [
                .review(AgentContext.Review(file: file("hub/z.go"), side: .new, range: .init(first: 9, last: 9), lines: "x := 1",
                                            comment: "Name this.")),
                .review(AgentContext.Review(file: file("hub/a.go"), side: .new, range: .init(first: 20, last: 21), lines: "a\nb",
                                            comment: "Why two?")),
                .review(AgentContext.Review(file: file("hub/a.go"), side: .old, range: .init(first: 4, last: 4), lines: "c",
                                            comment: "Keep this.")),
            ], ["excerpt diff hub/a.go old 4-4\nc", "review hub/a.go:4 old: Keep this.",
                "excerpt diff hub/a.go new 20-21\na\nb", "review hub/a.go:20-21 new: Why two?",
                "excerpt diff hub/z.go new 9-9\nx := 1", "review hub/z.go:9 new: Name this."]),
            ("terminal output", [.terminal(AgentContext.Terminal(text: "FAIL\nexit status 1", directory: root))],
             ["terminal in /work/hub", "excerpt terminal\nFAIL\nexit status 1"]),
            ("a debugger stop", [.stop(AgentContext.Stop(file: file("hub/hub.go"), line: 41, function: "(*Hub).Run", locals: [
                .init(name: "ctx", type: "context.Context", value: "context.Background.WithCancel"),
                .init(name: "n", type: "", value: "3"),
            ]))], ["```stopped hub/hub.go:41 in (*Hub).Run\nctx context.Context = context.Background.WithCancel\nn = 3\n```"]),
        ]

        static func run(check: HostCheck) {
            let all = ContextFormat.content(prompt: "Fix it.", context: samples.flatMap(\.context), root: root)
            if let data = try? JSONEncoder().encode(Wire.Content(items: all)) {
                try? data.write(to: FileManager.default.temporaryDirectory.appending(path: "nyte-host-check/context.json"))
            }
            for sample in samples {
                let items = ContextFormat.content(prompt: "Fix it.", context: sample.context.map(ContextFormat.capped), root: root)
                let shown = items.dropFirst().map(render)
                check.expect(items.first == .text("Fix it.") && shown == sample.expected,
                             "\(sample.name):\n" + shown.map { "         " + $0.replacingOccurrences(of: "\n", with: "\n         ") }.joined(separator: "\n"))
                let sent = roundTrip(items)
                let composed = sample.context.map { ContextFormat.chip($0, root: root).label }
                let parsed = Set(sent.chips.map(\.label))
                check.expect(sent.prompt == "Fix it." && parsed == Set(composed),
                             "\(sample.name) reads back as the same chips: \(sent.chips.map(\.label).joined(separator: ", "))")
            }
            let long = (1 ... 5_000).map { "line \($0)" }.joined(separator: "\n")
            let capped = ContextFormat.capped(.lines(AgentContext.Lines(file: file("big.go"), range: .init(first: 1, last: 5_000), text: long)))
            let chip = ContextFormat.chip(capped, root: root)
            let items = ContextFormat.content(prompt: "Read this.", context: [capped], root: root)
            let header = items.dropFirst().first.map(render)?.split(separator: "\n").first.map(String.init) ?? ""
            check.expect(chip.detail == "first 400 of 5,000 lines" && header == "```big.go:1-400 first 400 of 5,000 lines",
                         "5,000 lines: chip \u{201C}\(chip.label) \(chip.detail)\u{201D}, block opens \u{201C}\(header)\u{201D}")
        }

        static func render(_ item: Wire.Outgoing) -> String {
            switch item {
            case let .text(text): text
            case let .reference(path): "reference " + path
            case let .excerpt(.diff(path, side, start, end), text): "excerpt diff \(path) \(side) \(start)-\(end)\n" + text
            case let .excerpt(.terminal, text): "excerpt terminal\n" + text
            case let .excerpt(.other(kind), text): "excerpt \(kind)\n" + text
            }
        }

        static func roundTrip(_ items: [Wire.Outgoing]) -> (prompt: String, chips: [ContextFormat.Chip]) {
            guard let data = try? JSONEncoder().encode(Wire.Content(items: items)),
                  let prompt = try? JSONDecoder().decode(Wire.Prompt.self, from: data) else { return ("", []) }
            return ContextFormat.sent(prompt.items)
        }
    }
}
