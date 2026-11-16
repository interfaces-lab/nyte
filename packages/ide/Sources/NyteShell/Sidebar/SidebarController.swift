import AppKit
import NyteUI

struct Navigator {
    let id: String
    let title: String
    let symbol: String
    let controller: NSViewController
}

@MainActor
final class SidebarController: NSViewController {
    let navigators: [Navigator]
    private(set) var selected: Int
    var onSelect: ((Navigator) -> Void)?
    private let content = NSView()
    private let footer = NSView()
    private lazy var settings = Button.header(symbol: "gearshape", label: "Settings") {
        NSApp.sendAction(#selector(AppDelegate.showSettings(_:)), to: nil, from: nil)
    }
    private lazy var switcher = NavigatorBar(navigators.map { NavigatorBar.Item(symbol: $0.symbol, label: $0.title) },
                                             selectedIndex: selected, label: "Navigator") { [weak self] in self?.select($0) }
    private lazy var heading = Label(navigators.first?.title ?? "", style: PaneHeader.titleStyle, color: Palette.contentSecondary,
                                   weight: .medium)

    static let leading = Space.x2
    static let titleLeading = Space.x4

    init(navigators: [Navigator], selectedID: String?) {
        self.navigators = navigators
        selected = navigators.firstIndex { $0.id == selectedID } ?? 0
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func loadView() {
        let root = FlippedView()
        let header: NSView = navigators.count > 1 ? switcher : heading
        for view in [header, content, footer] {
            view.translatesAutoresizingMaskIntoConstraints = false
            root.addSubview(view)
        }
        settings.translatesAutoresizingMaskIntoConstraints = false
        settings.toolTip = "Settings (\u{2318},)"
        footer.addSubview(settings)
        NSLayoutConstraint.activate([
            header.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: navigators.count > 1 ? Self.leading : Self.titleLeading),
            header.centerYAnchor.constraint(equalTo: root.topAnchor, constant: Metric.paneHeader / 2),
            header.trailingAnchor.constraint(lessThanOrEqualTo: root.trailingAnchor, constant: -Self.leading),
            content.topAnchor.constraint(equalTo: root.topAnchor, constant: Metric.paneHeader),
            content.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            content.bottomAnchor.constraint(equalTo: footer.topAnchor),
            footer.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            footer.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            footer.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            footer.heightAnchor.constraint(equalToConstant: Metric.paneHeader),
            settings.leadingAnchor.constraint(equalTo: footer.leadingAnchor, constant: Self.leading),
            settings.centerYAnchor.constraint(equalTo: footer.centerYAnchor),
        ])
        for navigator in navigators {
            addChild(navigator.controller)
            let view = navigator.controller.view
            view.translatesAutoresizingMaskIntoConstraints = false
            content.addSubview(view)
            NSLayoutConstraint.activate([
                view.topAnchor.constraint(equalTo: content.topAnchor),
                view.leadingAnchor.constraint(equalTo: content.leadingAnchor),
                view.trailingAnchor.constraint(equalTo: content.trailingAnchor),
                view.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            ])
        }
        view = root
        select(selected)
    }

    func select(_ index: Int) {
        guard navigators.indices.contains(index) else { return }
        selected = index
        switcher.selectedIndex = index
        for (position, navigator) in navigators.enumerated() { navigator.controller.view.isHidden = position != index }
        onSelect?(navigators[index])
    }

    func setCount(_ count: Int, for id: String) {
        guard let index = navigators.firstIndex(where: { $0.id == id }), switcher.items.indices.contains(index) else { return }
        let label = count > 0 ? "\(navigators[index].title), \(count)" : navigators[index].title
        if switcher.items[index].label != label { switcher.items[index].label = label }
    }

    func select(id: String) {
        navigators.firstIndex { $0.id == id }.map(select)
    }
}
