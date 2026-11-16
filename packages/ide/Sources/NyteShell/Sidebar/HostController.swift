import AppKit

@MainActor
final class HostController: NSViewController {
    private(set) var hosted: NSViewController?

    override func loadView() { view = FlippedView() }

    func embed(_ controller: NSViewController) {
        hosted?.view.removeFromSuperview()
        hosted?.removeFromParent()
        hosted = controller
        addChild(controller)
        let content = controller.view
        content.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(content)
        NSLayoutConstraint.activate([
            content.topAnchor.constraint(equalTo: view.topAnchor),
            content.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            content.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
    }
}
