import AppKit
import NyteCore
import NyteDesign

public struct EditorTab: Equatable, Sendable {
    public let url: URL
    public var isDirty: Bool
    public var isPreview: Bool

    public var title: String { url.lastPathComponent }
}

/// The caret, 1-based, with the count of selected characters and the document's language name.
public struct EditorPosition: Equatable, Sendable {
    public var line: Int
    public var column: Int
    public var selected: Int
    public var language: String
}

@MainActor
public final class EditorViewController: NSViewController {
    public private(set) var tabs: [EditorTab] = []
    public private(set) var selectedIndex: Int?
    public var onTabsChange: (() -> Void)?
    public var onPositionChange: ((EditorPosition?) -> Void)?

    public init(workspace: Workspace) {
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public func loadView() { view = NSView() }

    public var selectedURL: URL? { selectedIndex.map { tabs[$0].url } }

    public func open(_ url: URL, preview: Bool) {}
    public func select(at index: Int) {}
    public func close(at index: Int) {}
    public func moveTab(from source: Int, to destination: Int) {}
    public func saveSelected() {}
}
