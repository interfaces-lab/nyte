import AppKit
import NyteUI

enum ToolWindowID: String, CaseIterable, Sendable {
    case terminal, folderTerminal, run, problems, search, find, debug
}

struct ToolWindow {
    let id: ToolWindowID
    var title: String
    var count: Int?
    var toolTip = ""
    let isClosable: Bool
    let controller: NSViewController
}

@MainActor
final class DockController: NSViewController {
    private(set) var windows: [ToolWindow] = []
    private(set) var selected: ToolWindowID?
    var onSelect: ((ToolWindowID) -> Void)?
    var onHide: ((_ sender: Any?) -> Void)?
    var onClose: ((ToolWindowID) -> Void)?

    private let tabs = TabBar(style: .plain, label: "Tool windows")
    private let content = NSView()
    private lazy var hide = Button.header(symbol: "chevron.down", label: "Hide Bottom Panel") { [weak self] in self?.onHide?(nil) }

    override func loadView() {
        let root = FlippedView()
        let header = NSView()
        for view in [header, content] {
            view.translatesAutoresizingMaskIntoConstraints = false
            root.addSubview(view)
        }
        for view in [tabs, hide] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            header.addSubview(view)
        }
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: root.topAnchor),
            header.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            header.heightAnchor.constraint(equalToConstant: Metric.paneHeader),
            tabs.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: PaneHeader.actionInset),
            tabs.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            tabs.trailingAnchor.constraint(lessThanOrEqualTo: hide.leadingAnchor, constant: -PaneHeader.middleGap),
            hide.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -PaneHeader.actionInset),
            hide.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            content.topAnchor.constraint(equalTo: header.bottomAnchor),
            content.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            content.bottomAnchor.constraint(equalTo: root.bottomAnchor),
        ])
        let tabsWidth = tabs.widthAnchor.constraint(equalTo: header.widthAnchor)
        tabsWidth.priority = .defaultLow
        tabsWidth.isActive = true
        tabs.onSelect = { [weak self] index in
            guard let self, windows.indices.contains(index) else { return }
            show(windows[index].id)
        }
        tabs.onClose = { [weak self] index in
            guard let self, windows.indices.contains(index), windows[index].isClosable else { return }
            close(windows[index].id)
        }
        view = root
    }

    func contains(_ id: ToolWindowID) -> Bool { windows.contains { $0.id == id } }

    func controller(_ id: ToolWindowID) -> NSViewController? { windows.first { $0.id == id }?.controller }

    func add(_ window: ToolWindow) {
        if let index = windows.firstIndex(where: { $0.id == window.id }) {
            windows[index] = window
            return refreshTabs()
        }
        let order = ToolWindowID.allCases
        let slot = windows.firstIndex { order.firstIndex(of: $0.id) ?? 0 > order.firstIndex(of: window.id) ?? 0 } ?? windows.count
        windows.insert(window, at: slot)
        addChild(window.controller)
        let view = window.controller.view
        view.translatesAutoresizingMaskIntoConstraints = false
        view.isHidden = true
        content.addSubview(view)
        NSLayoutConstraint.activate([
            view.topAnchor.constraint(equalTo: content.topAnchor),
            view.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            view.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            view.bottomAnchor.constraint(equalTo: content.bottomAnchor),
        ])
        if selected == nil { show(window.id) } else { refreshTabs() }
    }

    func update(_ id: ToolWindowID, title: String? = nil, count: Int?? = nil, toolTip: String? = nil) {
        guard let index = windows.firstIndex(where: { $0.id == id }) else { return }
        if let title { windows[index].title = title }
        if let count { windows[index].count = count }
        if let toolTip { windows[index].toolTip = toolTip }
        refreshTabs()
    }

    func show(_ id: ToolWindowID) {
        guard contains(id) else { return }
        selected = id
        for window in windows { window.controller.view.isHidden = window.id != id }
        refreshTabs()
        onSelect?(id)
    }

    func close(_ id: ToolWindowID) {
        guard let index = windows.firstIndex(where: { $0.id == id }) else { return }
        let window = windows.remove(at: index)
        window.controller.view.removeFromSuperview()
        window.controller.removeFromParent()
        if selected == id {
            selected = nil
            if let next = windows[safe: min(index, windows.count - 1)] ?? windows.first { show(next.id) }
        }
        refreshTabs()
        onClose?(id)
    }

    private func refreshTabs() {
        tabs.items = windows.map {
            TabBar.Item($0.title, count: $0.count.flatMap { $0 > 0 ? $0 : nil }, toolTip: $0.toolTip, isClosable: $0.isClosable)
        }
        tabs.selectedIndex = windows.firstIndex { $0.id == selected }
    }

}

final class FlippedView: NSView {
    override var isFlipped: Bool { true }
}

extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
