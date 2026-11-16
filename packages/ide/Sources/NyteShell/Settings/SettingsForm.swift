import AppKit
import NyteUI

@MainActor
final class SettingsForm {
    private struct Pending {
        var title: String
        var description: String
        var control: NSView?
    }

    private struct Section {
        var heading: String
        var rows: [Pending] = []
    }

    private var sections: [Section] = []
    private(set) var entries: [(label: String, group: String?)] = []

    static let inset = Space.x6
    static let groupGap = Space.x5

    func heading(_ title: String) {
        sections.append(Section(heading: title))
        entries.append((title, nil))
    }

    func row(_ title: String, _ controls: [NSView]) {
        if sections.isEmpty { sections.append(Section(heading: "")) }
        let heading = sections[sections.count - 1].heading
        let switches = controls.compactMap { $0 as? Switch }
        if !switches.isEmpty, switches.count == controls.count {
            for toggle in switches {
                let label = toggle.accessibilityLabel() ?? ""
                sections[sections.count - 1].rows.append(Pending(title: label, description: "", control: toggle))
                entries.append((label, heading.isEmpty ? nil : heading))
            }
            return
        }
        let control: NSView? = switch controls.count {
        case 0: nil
        case 1: controls[0]
        default: Self.stack(controls)
        }
        sections[sections.count - 1].rows.append(Pending(title: title, description: "", control: control))
        if !title.isEmpty { entries.append((title, heading.isEmpty ? nil : heading)) }
    }

    func note(_ text: String) {
        guard !sections.isEmpty else { return }
        let last = sections.count - 1
        guard !sections[last].rows.isEmpty else { return sections[last].rows.append(Pending(title: "", description: text, control: nil)) }
        let row = sections[last].rows.count - 1
        sections[last].rows[row].description = text
    }

    func footnote(_ text: String) {
        if sections.isEmpty { sections.append(Section(heading: "")) }
        sections[sections.count - 1].rows.append(Pending(title: "", description: text, control: nil))
    }

    func view() -> NSView {
        let groups = sections.filter { !$0.rows.isEmpty }.map { section in
            SettingsGroup(heading: section.heading, rows: section.rows.map { SettingsRow($0.title, description: $0.description, control: $0.control) })
        }
        let stack = NSStackView(views: groups)
        stack.orientation = .vertical
        stack.alignment = .width
        stack.spacing = Self.groupGap
        let root = FlippedView()
        stack.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: root.topAnchor, constant: Space.x2),
            stack.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: Self.inset),
            stack.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -Self.inset),
            stack.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -Self.inset),
        ])
        groups.forEach { $0.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true }
        return root
    }

    private static func stack(_ controls: [NSView]) -> NSView {
        let stack = NSStackView(views: controls)
        stack.orientation = .horizontal
        stack.alignment = .centerY
        stack.spacing = Space.x2
        return stack
    }

    static func checkbox(_ title: String, _ isOn: Bool, _ change: @escaping (Bool) -> Void) -> Switch {
        Switch(label: title, isOn: isOn, onChange: change)
    }

    static func picker<Value: Equatable>(_ label: String, _ choices: [(title: String, value: Value)], selected: Value,
                                         _ choose: @escaping (Value) -> Void) -> Button {
        let button = Button(choices.first { $0.value == selected }?.title ?? "", label: label, variant: .outline, size: .sm)
        button.trailingSymbol = "chevron.up.chevron.down"
        var current = selected
        button.menuProvider = { [weak button] in
            Menu.make(choices.map { choice in
                MenuItem(choice.title, checked: choice.value == current) {
                    current = choice.value
                    button?.title = choice.title
                    choose(choice.value)
                }
            })
        }
        return button
    }
}
