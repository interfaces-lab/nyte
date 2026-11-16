import AppKit
import NyteUI

@MainActor
final class ActivityLine: NSView {
    private let spinner = Spinner()
    private let loader = Loader(side: TaskMark.waitSide)
    private let label = Label("", style: .base, color: Palette.contentSecondary)
    private var activity: Activity?
    private var timer: Timer?
    private lazy var fixedHeight = heightAnchor.constraint(equalToConstant: Self.height)

    static var height: CGFloat { Size.sm.height }
    static let slot = Glyph.sm.rawValue
    static let tick: TimeInterval = 1
    static let tolerance: TimeInterval = 0.25
    static let secondsPerMinute = 60
    static let secondsPerHour = 3_600

    init() {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        label.font = TextStyle.base.tabularFont()
        [spinner, loader, label].forEach(addSubview)
        spinner.ink = TaskMark.ink(.working)
        loader.ink = TaskMark.ink(.retrying)
        loader.isHidden = true
        NSLayoutConstraint.activate([
            loader.centerXAnchor.constraint(equalTo: spinner.centerXAnchor),
            loader.centerYAnchor.constraint(equalTo: spinner.centerYAnchor),
            fixedHeight,
            spinner.centerXAnchor.constraint(equalTo: leadingAnchor, constant: Rows.inset - Space.x3 + Self.slot / 2),
            spinner.centerYAnchor.constraint(equalTo: centerYAnchor),
            label.leadingAnchor.constraint(equalTo: leadingAnchor, constant: StepCell.textX - Space.x3),
            label.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor),
            label.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
        setAccessibilityElement(true)
        setAccessibilityRole(.staticText)
        Density.observe(self) { [weak self] in self?.fixedHeight.constant = Self.height }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func show(_ activity: Activity?) {
        guard activity != self.activity else { return }
        self.activity = activity
        isHidden = activity == nil
        let retrying = activity?.kind == .retrying
        spinner.isHidden = retrying
        loader.isHidden = !retrying
        update()
        updateTimer()
    }

    private func updateTimer() {
        timer?.invalidate()
        timer = nil
        let ticking = activity?.kind == .working || (activity?.kind == .retrying && activity?.until != nil)
        guard ticking, window != nil else { return }
        let timer = Timer(timeInterval: Self.tick, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.update() }
        }
        timer.tolerance = Self.tolerance
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    private func update() {
        guard let activity else { return }
        let words = switch activity.kind {
        case .working: "Working for " + Self.elapsed(since: activity.since, now: .now)
        case .retrying:
            [SessionState.retryWords(until: activity.until, now: .now), activity.reason].filter { !$0.isEmpty }.joined(separator: " \u{00B7} ")
        case .stopping: "Stopping"
        }
        label.stringValue = words
        setAccessibilityLabel(words)
    }

    static func elapsed(since: Date, now: Date) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(since)))
        if seconds < secondsPerMinute { return "\(seconds)s" }
        if seconds < secondsPerHour { return "\(seconds / secondsPerMinute)m \(seconds % secondsPerMinute)s" }
        return "\(seconds / secondsPerHour)h \(seconds % secondsPerHour / secondsPerMinute)m"
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        update()
        updateTimer()
    }
}
