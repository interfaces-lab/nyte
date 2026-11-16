import Foundation
@testable import NyteAgent

extension HostCheck {
    @MainActor enum StepCheck {
        struct Sample {
            let name: String
            let state: String
            let live: Bool
            let lead: String
            let subject: String
            let glyph: ToolGlyph
            let added: Int
        }

        static let samples: [Sample] = [
            Sample(name: "edit the user denied", state: #"{"call":"c","name":"edit","args":{},"class":{"kind":"edit","path":"hub/client.go"},"phase":"settled","outcome":{"kind":"rejected","reason":"denied"},"changes":{"added":3,"removed":1,"paths":[]}}"#,
                   live: false, lead: "Edit denied", subject: "client.go", glyph: .denied, added: 0),
            Sample(name: "edit that landed", state: #"{"call":"c","name":"edit","args":{},"class":{"kind":"edit","path":"hub/hub.go"},"phase":"settled","outcome":{"kind":"ok","content":[],"output":null,"parts":[]},"changes":{"added":42,"removed":7,"paths":[]}}"#,
                   live: false, lead: "Edited", subject: "hub.go", glyph: .edit, added: 42),
            Sample(name: "command that exited 1", state: #"{"call":"c","name":"bash","args":{},"class":{"kind":"shell","command":"go test ./..."},"phase":"settled","outcome":{"kind":"ok","content":[{"kind":"text","text":"FAIL\n[exit code 1]"}],"output":null,"parts":[]},"changes":null}"#,
                   live: false, lead: "Command failed", subject: "go test ./...", glyph: .shell, added: 0),
            Sample(name: "command that ran out of time", state: #"{"call":"c","name":"bash","args":{},"class":{"kind":"shell","command":"go test -race ./..."},"phase":"settled","outcome":{"kind":"ok","content":[{"kind":"text","text":"ok\n[stopped after 120 s; pass a larger timeout if it needs longer]"}],"output":null,"parts":[]},"changes":null}"#,
                   live: false, lead: "Command timed out", subject: "go test -race ./...", glyph: .shell, added: 0),
            Sample(name: "command that exited 0", state: #"{"call":"c","name":"bash","args":{},"class":{"kind":"shell","command":"go vet ./..."},"phase":"settled","outcome":{"kind":"ok","content":[{"kind":"text","text":"[exit code 0]"}],"output":null,"parts":[]},"changes":null}"#,
                   live: false, lead: "Ran", subject: "go vet ./...", glyph: .shell, added: 0),
            Sample(name: "command the user stopped", state: #"{"call":"c","name":"bash","args":{},"class":{"kind":"shell","command":"make"},"phase":"settled","outcome":{"kind":"stopped"},"changes":null}"#,
                   live: false, lead: "Command stopped", subject: "make", glyph: .shell, added: 0),
            Sample(name: "command still running", state: #"{"call":"c","name":"bash","args":{},"class":{"kind":"shell","command":"make"},"phase":"running","progress":null}"#,
                   live: true, lead: "Running", subject: "make", glyph: .shell, added: 0),
            Sample(name: "read that failed", state: #"{"call":"c","name":"read","args":{},"class":{"kind":"read","path":"/tmp/missing.go"},"phase":"settled","outcome":{"kind":"failed","message":"ENOENT"},"changes":null}"#,
                   live: false, lead: "Read failed", subject: "missing.go", glyph: .read, added: 0),
            Sample(name: "read cut off", state: #"{"call":"c","name":"read","args":{},"class":{"kind":"read","path":"a.go"},"phase":"settled","outcome":{"kind":"interrupted"},"changes":null}"#,
                   live: false, lead: "Read interrupted", subject: "a.go", glyph: .read, added: 0),
            Sample(name: "run ended before the call settled", state: #"{"call":"c","name":"edit","args":{},"class":{"kind":"edit","path":"a.go"},"phase":"calling"}"#,
                   live: false, lead: "Edit stopped", subject: "a.go", glyph: .edit, added: 0),
            Sample(name: "question", state: #"{"call":"c","name":"question","args":{},"class":{"kind":"custom","label":"question"},"phase":"settled","outcome":{"kind":"ok","content":[],"output":null,"parts":[]},"changes":null}"#,
                   live: false, lead: "Asked a question", subject: "", glyph: .other, added: 0),
        ]

        static func run(check: HostCheck) {
            var broken: [String] = []
            for kind in StepKind.allCases {
                let titles = StepOutcome.allCases.map { StepWords.title(kind, $0) }
                if Set(titles).count != titles.count { broken.append("\(kind): two outcomes share a title") }
                for outcome in StepOutcome.allCases {
                    let title = StepWords.title(kind, outcome)
                    if outcome != .done, title == StepWords.title(kind, .done) { broken.append("\(kind) \(outcome) claims success") }
                    if (StepWords.glyph(kind, outcome) == .denied) != (outcome == .denied) { broken.append("\(kind) \(outcome) glyph") }
                    if StepWords.showsChanges(kind, outcome), outcome != .done { broken.append("\(kind) \(outcome) shows changes") }
                }
            }
            check.expect(broken.isEmpty, "wording table: \(StepKind.allCases.count) kinds by \(StepOutcome.allCases.count) outcomes, "
                + (broken.isEmpty ? "every title names its outcome and only a finished step uses the past tense" : "\(broken)"))
            for sample in samples {
                let spec: RowSpec
                do {
                    let state = try JSONDecoder().decode(Wire.ToolState.self, from: Data(sample.state.utf8))
                    spec = state.spec(id: "p", part: "p", version: 1, live: sample.live, failed: false)
                } catch {
                    check.expect(false, "\(sample.name): \(Wire.describe(error))")
                    continue
                }
                let shown = [spec.lead, spec.text].filter { !$0.isEmpty }.joined(separator: " ")
                check.expect(spec.lead == sample.lead && spec.text == sample.subject && spec.glyph == sample.glyph && spec.added == sample.added,
                             "\(sample.name): \u{201C}\(shown)\u{201D}" + (spec.added > 0 ? " +\(spec.added) \u{2212}\(spec.removed)" : ""))
            }
        }
    }
}
