import AppKit
import NyteUI

enum SessionState: Equatable {
    case none
    case unread
    case working
    case background(Int)
    case retrying(until: Date?)
    case waiting(AskKind?)
    case failed

    init(_ session: SessionSummary) {
        switch session.run {
        case .working: self = .working
        case let .retrying(_, until): self = .retrying(until: until)
        case .asking: self = .waiting(session.askKind)
        case .idle, .failed:
            if session.backgroundWaiting > 0 {
                self = .waiting(nil)
            } else if case .failed = session.run {
                self = .failed
            } else if session.backgroundWorking > 0 {
                self = .background(session.backgroundWorking)
            } else {
                self = session.unread ? .unread : .none
            }
        }
    }

    var mark: TaskMark.Status {
        switch self {
        case .none: .none
        case .unread: .unread
        case .working: .working
        case .background: .working
        case .retrying: .retrying
        case .waiting: .waiting
        case .failed: .failed
        }
    }

    var isWaiting: Bool {
        if case .waiting = self { true } else { false }
    }

    var request: TaskMark.Request? {
        guard case let .waiting(kind?) = self else { return nil }
        return switch kind {
        case .approval: .approval
        case .question: .question
        }
    }

    var badge: RowContent.Badge? {
        guard isWaiting else { return nil }
        return request.map(RowContent.Badge.request) ?? .needsInput
    }

    var waitingWord: String? {
        guard isWaiting else { return nil }
        return request?.word ?? Attention.needsInputText
    }

    func words(now: Date) -> String {
        switch self {
        case .none, .unread: ""
        case .working: "Working"
        case let .background(count): count == 1 ? "1 subagent working" : "\(count) subagents working"
        case let .retrying(until): Self.retryWords(until: until, now: now)
        case .waiting: waitingWord ?? ""
        case .failed: "Failed"
        }
    }

    static func retryWords(until: Date?, now: Date) -> String {
        guard let wait = remaining(until: until, now: now) else { return "Retrying" }
        return "Retrying in " + wait
    }

    static func remaining(until: Date?, now: Date) -> String? {
        guard let until else { return nil }
        let seconds = Int(until.timeIntervalSince(now).rounded(.up))
        guard seconds > 0 else { return nil }
        return Duration.seconds(seconds).formatted(.units(allowed: [.hours, .minutes, .seconds], width: .narrow, maximumUnitCount: 2))
    }

    var ticks: Bool {
        if case .retrying(.some) = self { true } else { false }
    }
}

@MainActor
final class SessionStateView: NSView {
    private let mark = TaskMark(.none, side: Glyph.md.rawValue)
    private let label = Label("", style: .sm, color: Palette.contentSecondary)
    private(set) var state = SessionState.none

    init() {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        label.translatesAutoresizingMaskIntoConstraints = false
        [mark, label].forEach(addSubview)
        setContentCompressionResistancePriority(.required, for: .horizontal)
        label.setContentCompressionResistancePriority(.required, for: .horizontal)
        setAccessibilityElement(true)
        setAccessibilityRole(.staticText)
        NSLayoutConstraint.activate([
            mark.leadingAnchor.constraint(equalTo: leadingAnchor),
            mark.centerYAnchor.constraint(equalTo: centerYAnchor),
            label.leadingAnchor.constraint(equalTo: mark.trailingAnchor, constant: Space.x1),
            label.trailingAnchor.constraint(equalTo: trailingAnchor),
            label.centerYAnchor.constraint(equalTo: centerYAnchor),
            topAnchor.constraint(lessThanOrEqualTo: label.topAnchor),
            bottomAnchor.constraint(greaterThanOrEqualTo: label.bottomAnchor),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    var text: String { label.stringValue }

    func show(_ state: SessionState, now: Date) {
        self.state = state
        mark.status = state.mark
        label.stringValue = state.words(now: now)
        setAccessibilityLabel(label.stringValue)
    }
}
