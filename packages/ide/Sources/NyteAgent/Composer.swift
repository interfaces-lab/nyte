import AppKit
import NyteUI

@MainActor
final class ComposerView: SurfaceView {
    var onSend: ((String) -> Void)?
    var onStop: (() -> Void)?
    var onReturnEmpty: (() -> Bool)?
    var onEscape: (() -> Bool)?
    var onMove: ((Int) -> Bool)?
    var onRemoveLastContext: (() -> Bool)?

    let area = TextArea(textStyle: .prose, chrome: .borderless, minimumLines: 1, maximumLines: 8)
    let model = Button("", label: "Model", size: .sm)
    let permission = Button("", label: "Permissions", size: .sm)
    let send = Button(symbol: "arrow.up", label: "Send", variant: .solid, tone: .primary, size: .sm)
    let chips = ChipFlow(maximumLines: ComposerView.chipLines)
    static let chipLines = 2
    private let place = Label("", style: .sm, color: Palette.contentTertiary)
    private lazy var textTop = area.topAnchor.constraint(equalTo: chips.bottomAnchor, constant: Space.x1)

    private(set) var live = false
    private(set) var deciding = false
    private(set) var canSend = false

    init() {
        super.init(fill: Palette.bgElevated, ring: Palette.strokeQuaternary, radius: Radius.composer)
        area.textView.setAccessibilityLabel("Message")
        area.onFocusChange = { [weak self] focused in
            self?.ring = focused ? Palette.strokeTertiary : Palette.strokeQuaternary
        }
        area.onChange = { [weak self] _ in self?.refresh() }
        area.onSubmit = { [weak self] _ in self?.submit() }
        area.onCommand = { [weak self] selector in self?.command(selector) ?? false }

        model.trailingSymbol = "chevron.down"
        model.toolTip = "Model"
        model.isHidden = true
        permission.trailingSymbol = "chevron.down"
        permission.isHidden = true
        place.setContentCompressionResistancePriority(.init(1), for: .horizontal)
        place.setContentHuggingPriority(.init(1), for: .horizontal)
        place.setAccessibilityElement(true)
        let footer = NSStackView(views: [model, permission, place])
        footer.orientation = .horizontal
        footer.spacing = Space.x05
        footer.setCustomSpacing(Space.x15, after: permission)
        footer.detachesHiddenViews = true
        footer.translatesAutoresizingMaskIntoConstraints = false
        send.isPill = true
        send.onPress = { [weak self] in self?.sendOrStop() }
        chips.onLeave = { [weak self] in
            guard let self else { return }
            window?.makeFirstResponder(area.textView)
        }
        [chips, area, footer, send].forEach(addSubview)
        NSLayoutConstraint.activate([
            chips.topAnchor.constraint(equalTo: topAnchor, constant: Space.x15),
            chips.leadingAnchor.constraint(equalTo: leadingAnchor, constant: Space.x2),
            chips.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -Space.x2),
            textTop,
            area.leadingAnchor.constraint(equalTo: leadingAnchor, constant: Space.x3),
            area.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -Space.x3),
            send.topAnchor.constraint(equalTo: area.bottomAnchor, constant: Space.x15),
            send.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -Space.x2),
            send.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -Space.x2),
            footer.leadingAnchor.constraint(equalTo: leadingAnchor, constant: Space.x1),
            footer.trailingAnchor.constraint(lessThanOrEqualTo: send.leadingAnchor, constant: -Space.x2),
            footer.centerYAnchor.constraint(equalTo: send.centerYAnchor),
        ])
        model.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        refresh()
    }

    var text: NSTextView { area.textView }

    func show(context: [ContextFormat.Chip]) {
        chips.show(context, removable: true)
        textTop.constant = context.isEmpty ? Space.x1 : Space.x15
    }

    var placeholder: String {
        get { area.placeholder }
        set { area.placeholder = newValue }
    }

    var modelTitle: String {
        get { model.title }
        set {
            model.title = newValue
            model.setAccessibilityValue(newValue)
            model.isHidden = newValue.isEmpty
        }
    }

    func show(permission label: String?, detail: String?) {
        permission.title = label ?? ""
        permission.isHidden = label == nil
        permission.setAccessibilityValue(label)
        permission.toolTip = detail.map { "Permissions: " + $0 }
    }

    func show(place text: String, detail: String) {
        place.stringValue = text
        place.toolTip = detail
        place.setAccessibilityLabel(detail)
    }

    var placeText: String { place.stringValue }

    var draft: String {
        get { area.string }
        set {
            area.string = newValue
            refresh()
        }
    }

    func set(live: Bool, deciding: Bool, canSend: Bool) {
        self.live = live
        self.deciding = deciding
        self.canSend = canSend
        refresh()
    }

    private var hasText: Bool { !area.string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    var stopping: Bool { live && !deciding && !hasText }

    private func refresh() {
        let stopping = stopping
        send.symbol = stopping ? "stop.fill" : "arrow.up"
        send.tone = stopping ? .neutral : .primary
        let label = stopping ? "Stop" : "Send"
        send.setAccessibilityLabel(label)
        send.toolTip = label
        send.isEnabled = stopping ? canSend : canSend && hasText
    }

    private func command(_ selector: Selector) -> Bool {
        switch selector {
        case #selector(NSResponder.insertNewline(_:)):
            let flags = NSApp.currentEvent?.modifierFlags ?? []
            guard flags.isDisjoint(with: [.shift, .option]) else { return false }
            guard hasText else {
                _ = onReturnEmpty?()
                return true
            }
            submit()
            return true
        case #selector(NSResponder.deleteBackward(_:)):
            guard area.textView.selectedRange() == NSRange(location: 0, length: 0) else { return false }
            return onRemoveLastContext?() ?? false
        case #selector(NSResponder.insertBacktab(_:)):
            return chips.focusLast()
        case #selector(NSResponder.cancelOperation(_:)):
            return onEscape?() ?? false
        case #selector(NSResponder.moveUp(_:)):
            return !hasText && (onMove?(-1) ?? false)
        case #selector(NSResponder.moveDown(_:)):
            return !hasText && (onMove?(1) ?? false)
        default:
            return false
        }
    }

    private func submit() {
        guard canSend, hasText else { return }
        let message = area.string.trimmingCharacters(in: .whitespacesAndNewlines)
        draft = ""
        onSend?(message)
    }

    private func sendOrStop() {
        if stopping {
            onStop?()
            return
        }
        submit()
    }
}
