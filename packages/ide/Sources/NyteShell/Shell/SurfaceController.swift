import AppKit
import NyteUI

@MainActor
final class SurfaceController: NSViewController {
    let surface = ContentSurface()
    private let body: NSViewController
    private var leading: NSLayoutConstraint?

    init(body: NSViewController) {
        self.body = body
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func loadView() {
        let root = FlippedView()
        addChild(body)
        surface.embed(body.view)
        surface.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(surface)
        let leading = surface.leadingAnchor.constraint(equalTo: root.leadingAnchor)
        NSLayoutConstraint.activate([
            leading,
            surface.topAnchor.constraint(equalTo: root.topAnchor),
            surface.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            surface.bottomAnchor.constraint(equalTo: root.bottomAnchor),
        ])
        self.leading = leading
        view = root
    }

    func insetsLeadingEdge(_ inset: Bool) {
        leading?.constant = inset ? ContentSurface.inset : 0
    }
}
