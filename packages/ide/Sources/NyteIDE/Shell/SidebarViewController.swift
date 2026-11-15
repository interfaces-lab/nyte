import AppKit
import NyteCore
import NyteDesign
import NyteFiles

/// The navigator. It has no surface of its own: it sits flat on the window chrome, under the
/// titlebar row, with the workspace named at the top and the file tree below.
@MainActor
final class SidebarViewController: NSViewController {
    let navigator: FileNavigatorViewController
    private let workspace: Workspace
    private let name = Label(style: .base, color: Palette.contentPrimary, weight: .semibold)
    private let branchGlyph = NSImageView()
    private let branch = Label(style: .sm, color: Palette.contentTertiary)

    init(workspace: Workspace) {
        self.workspace = workspace
        navigator = FileNavigatorViewController(workspace: workspace)
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func loadView() {
        view = NSView()
        name.stringValue = workspace.name
        branchGlyph.image = Symbol.image("arrow.triangle.branch", size: 10)
        branchGlyph.contentTintColor = Palette.contentQuaternary
        branchGlyph.translatesAutoresizingMaskIntoConstraints = false
        branch.setContentCompressionResistancePriority(.init(100), for: .horizontal)
        name.setContentHuggingPriority(.defaultHigh, for: .horizontal)

        addChild(navigator)
        let tree = navigator.view
        tree.translatesAutoresizingMaskIntoConstraints = false
        [name, branchGlyph, branch, tree].forEach(view.addSubview)
        NSLayoutConstraint.activate([
            name.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: Space.x4),
            name.centerYAnchor.constraint(equalTo: view.topAnchor, constant: Metric.row / 2),
            branchGlyph.leadingAnchor.constraint(equalTo: name.trailingAnchor, constant: Space.x2),
            branchGlyph.centerYAnchor.constraint(equalTo: name.centerYAnchor),
            branch.leadingAnchor.constraint(equalTo: branchGlyph.trailingAnchor, constant: Space.x1),
            branch.firstBaselineAnchor.constraint(equalTo: name.firstBaselineAnchor),
            branch.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -Space.x2),
            tree.topAnchor.constraint(equalTo: view.topAnchor, constant: Metric.row + Space.x1),
            tree.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tree.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tree.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        refreshBranch()
        NotificationCenter.default.addObserver(
            self, selector: #selector(refreshBranch), name: NSApplication.didBecomeActiveNotification, object: nil
        )
    }

    /// Reads the checked-out branch straight from the repository's HEAD file.
    @objc private func refreshBranch() {
        let current = GitHead.branch(in: workspace.root)
        branch.stringValue = current ?? ""
        branch.isHidden = current == nil
        branchGlyph.isHidden = current == nil
    }
}

enum GitHead {
    /// The branch name, a short commit for a detached HEAD, or nil outside a repository.
    static func branch(in root: URL) -> String? {
        let dotGit = root.appendingPathComponent(".git")
        var directory = dotGit
        if let pointer = try? String(contentsOf: dotGit, encoding: .utf8), pointer.hasPrefix("gitdir:") {
            let path = pointer.dropFirst("gitdir:".count).trimmingCharacters(in: .whitespacesAndNewlines)
            directory = URL(fileURLWithPath: path, relativeTo: root)
        }
        guard let head = try? String(contentsOf: directory.appendingPathComponent("HEAD"), encoding: .utf8) else {
            return nil
        }
        let trimmed = head.trimmingCharacters(in: .whitespacesAndNewlines)
        let prefix = "ref: refs/heads/"
        return trimmed.hasPrefix(prefix) ? String(trimmed.dropFirst(prefix.count)) : String(trimmed.prefix(7))
    }
}
