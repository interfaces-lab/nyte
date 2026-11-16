import AppKit
import NyteCore
import NyteUI
import os

public struct EditorTab: Equatable, Sendable {
    public let url: URL
    public var isDirty: Bool
    public var isPreview: Bool

    public var title: String { url.lastPathComponent }
}

public struct EditorPosition: Equatable, Sendable {
    public var line: Int
    public var column: Int
    public var selected: Int
    public var language: String
    public var usesTabs: Bool
    public var indentWidth: Int
}

@MainActor
public final class EditorViewController: NSViewController {
    static let longestLookUp = 64

    public var tabs: [EditorTab] {
        documents.map { EditorTab(url: $0.url, isDirty: $0.isDirty, isPreview: $0.isPreview) }
    }

    public private(set) var selectedIndex: Int?
    public var onTabsChange: (() -> Void)?
    public var onPositionChange: ((EditorPosition?) -> Void)?
    public var selectedURL: URL? { selectedIndex.map { documents[$0].url } }
    public var hasUnsavedChanges: Bool { documents.contains(where: \.isDirty) }

    public var intelligence: (any LanguageIntelligence)?
    public var onPresentLocations: ((_ locations: [FileLocation], _ title: String) -> Void)?
    public var onPreviewEdit: ((_ edit: WorkspaceEdit, _ title: String) -> Void)?
    public var onProblemsChange: ((ProblemCounts?) -> Void)?
    public var onSymbolPathChange: (([SymbolCrumb]) -> Void)?
    public var breakpoints: ((URL) -> [SourceBreakpoint])?
    public var onToggleBreakpoint: ((_ url: URL, _ line: Int) -> Void)?
    public var onLinesShift: ((_ url: URL, _ line: Int, _ delta: Int) -> Void)?
    public var executionPoint: FileLocation? { didSet { if executionPoint != oldValue { executionPointDidChange() } } }
    public internal(set) var preferences = EditorPreferences()
    public var breakpointMenu: ((_ url: URL, _ zeroBasedLine: Int) -> NSMenu?)?
    public var rulerView: NSRulerView { ruler }
    public var lineNotes: ((URL) -> [LineNote])? { didSet { lineNotesDidChange() } }
    public var onLineNote: ((URL, LineNote) -> Void)?
    public var runMarks: ((URL) -> [RunMark])? { didSet { runMarksDidChange() } }
    public var runMarkMenu: ((_ url: URL, _ mark: RunMark) -> NSMenu?)?
    public var baseText: ((URL) async -> String?)? { didSet { baseTextDidChange() } }
    public var beforeSave: ((_ url: URL, _ deadline: Duration) async -> [TextEdit])?
    public var beforeSaveDeadline = Duration.seconds(1)
    public var onAskAgent: ((AgentContext) -> Void)?
    public var valueHover: ((_ url: URL, _ position: TextPosition, _ expression: String) async -> HoverValue?)?
    public var textMenu: (() -> NSMenu?)?
    public var foldingRanges: ((URL) async -> [ClosedRange<Int>]?)?
    public var onTextChange: ((URL) -> Void)?
    public var onDiskChange: ((URL) -> Void)?

    let workspace: Workspace
    var documents: [Document] = []
    var nextID = 0
    let blank = TextModel()
    let blankUndo = UndoManager()
    let textView = TextEngineView()
    let scrollView = NSScrollView()
    private(set) var features: [any EditorFeature] = []
    var backStack: [FileLocation] = []
    var forwardStack: [FileLocation] = []
    let ruler: LineNumberRuler
    let notice = Label(style: .base, color: Palette.contentTertiary)
    let errorStripe = ErrorStripe()
    let findBar = EditorFindBar()
    var scrollAtTop: NSLayoutConstraint?
    var scrollUnderBar: NSLayoutConstraint?
    var tokens: [UInt64] = []
    var tokenLines: ClosedRange<Int>?
    var paintedRevision = -1
    var isEditingInPlace = false { didSet { textView.recordsHistory = !isEditingInPlace } }
    var lastLineChange = LineIndex.Change(line: 0, removed: 0, inserted: 0)
    var outline: (symbols: [DocumentSymbol], subtreeEnds: [Int]) = ([], []) { didSet { tellFeatures { $0.outlineDidChange() } } }
    var narrowerSelections: [NSRange] = []
    var isNarrowing = false

    public init(workspace: Workspace) {
        self.workspace = workspace
        ruler = LineNumberRuler(scrollView: scrollView)
        super.init(nibName: nil, bundle: nil)
        textView.isEditable = false
        textView.attach(blank)
        ruler.clientView = textView
        ruler.lineIndex = { [weak self] in self?.selectedText?.lines }
        ruler.caretLine = { [weak self] in self?.caretLine }
        connectTextView()
        installFeatures()
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func install(_ feature: any EditorFeature) {
        features.append(feature)
    }

    override public func loadView() {
        let root = NSView()
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.borderType = .noBorder
        scrollView.drawsBackground = true
        scrollView.backgroundColor = Palette.bgBase
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.documentView = textView
        scrollView.verticalRulerView = ruler
        scrollView.hasVerticalRuler = true
        scrollView.rulersVisible = true
        scrollView.contentView.postsBoundsChangedNotifications = true
        scrollView.contentView.postsFrameChangedNotifications = true
        notice.alignment = .center
        root.addSubview(scrollView)
        root.addSubview(notice)
        findBar.isHidden = true
        root.addSubview(findBar)
        scrollUnderBar = scrollView.topAnchor.constraint(equalTo: findBar.bottomAnchor)
        let atTop = scrollView.topAnchor.constraint(equalTo: root.topAnchor)
        scrollAtTop = atTop
        NSLayoutConstraint.activate([
            atTop,
            findBar.topAnchor.constraint(equalTo: root.topAnchor),
            findBar.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            findBar.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            scrollView.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            notice.centerXAnchor.constraint(equalTo: root.centerXAnchor),
            notice.centerYAnchor.constraint(equalTo: root.centerYAnchor),
            notice.leadingAnchor.constraint(greaterThanOrEqualTo: root.leadingAnchor, constant: Space.x3),
        ])
        view = root
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(visibleRegionDidChange), name: NSView.boundsDidChangeNotification,
                           object: scrollView.contentView)
        center.addObserver(self, selector: #selector(clipDidResize), name: NSView.frameDidChangeNotification,
                           object: scrollView.contentView)
        center.addObserver(self, selector: #selector(applicationDidBecomeActive), name: NSApplication.didBecomeActiveNotification, object: nil)
        show()
    }

    public func open(_ url: URL, preview: Bool) {
        let url = url.standardizedFileURL
        stash()
        if let existing = documents.firstIndex(where: { $0.url == url }) {
            if !preview { documents[existing].isPreview = false }
            return present(existing)
        }
        let opening = OSSignposter.editor.beginInterval("open")
        let document = Document(id: nextID, url: url, isPreview: preview, opening: opening)
        nextID += 1
        let slot: Int
        if preview, let reused = documents.firstIndex(where: \.isPreview) {
            forget(documents[reused])
            documents[reused] = document
            slot = reused
            if selectedIndex == reused { selectedIndex = nil }
        } else {
            slot = selectedIndex.map { $0 + 1 } ?? documents.count
            documents.insert(document, at: slot)
            if let selected = selectedIndex, selected >= slot { selectedIndex = selected + 1 }
        }
        present(slot)
        load(document.id, url: url, language: document.language)
    }

    public func select(at index: Int) {
        guard documents.indices.contains(index) else { return }
        stash()
        present(index)
    }

    public func close(at index: Int) {
        guard documents.indices.contains(index) else { return }
        let id = documents[index].id
        guard documents[index].isDirty else { return remove(id) }
        select(at: index)
        let alert = NSAlert()
        alert.messageText = "Do you want to save the changes you made to “\(documents[index].url.lastPathComponent)”?"
        alert.informativeText = "Your changes will be lost if you don’t save them."
        alert.addButton(withTitle: "Save")
        let discard = alert.addButton(withTitle: "Don’t Save")
        discard.hasDestructiveAction = true
        discard.keyEquivalent = "d"
        discard.keyEquivalentModifierMask = .command
        alert.addButton(withTitle: "Cancel")
        let finish: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            Task { @MainActor in
                switch response {
                case .alertFirstButtonReturn: if await self?.save(id) == true { self?.remove(id) }
                case .alertSecondButtonReturn: self?.remove(id)
                default: break
                }
            }
        }
        guard let window = view.window else {
            finish(alert.runModal())
            return
        }
        alert.beginSheetModal(for: window, completionHandler: finish)
    }

    public func moveTab(from source: Int, to destination: Int) {
        guard source != destination, documents.indices.contains(source), documents.indices.contains(destination) else { return }
        let selected = selectedIndex.map { documents[$0].id }
        documents.insert(documents.remove(at: source), at: destination)
        selectedIndex = selected.flatMap(row)
        onTabsChange?()
    }

    public func focus() {
        textView.window?.makeFirstResponder(textView)
    }

    public func saveSelected() {
        guard let index = selectedIndex, documents[index].isDirty else { return }
        let id = documents[index].id
        Task { await save(id) }
    }

    private func present(_ index: Int) {
        selectedIndex = index
        show()
        onTabsChange?()
    }

    func remove(_ id: Int) {
        guard let index = row(id) else { return }
        stash()
        forget(documents[index])
        documents.remove(at: index)
        if let selected = selectedIndex {
            if selected == index {
                selectedIndex = documents.isEmpty ? nil : min(index, documents.count - 1)
            } else if selected > index {
                selectedIndex = selected - 1
            }
        }
        show()
        onTabsChange?()
    }

    func row(_ id: Int) -> Int? { documents.firstIndex { $0.id == id } }

    var selectedText: Document? {
        guard let index = selectedIndex, documents[index].body.isText else { return nil }
        return documents[index]
    }

    var shown: Document? {
        guard let document = selectedText, textView.model === document.model else { return nil }
        return document
    }

    func document(for url: URL) -> Document? {
        let url = url.standardizedFileURL
        return documents.first { $0.url == url }
    }

    func setPendingReveal(_ range: TextSpan, for url: URL) {
        guard let index = documents.firstIndex(where: { $0.url == url.standardizedFileURL }) else { return }
        documents[index].pendingReveal = range
    }

    func tellFeatures(_ body: (any EditorFeature) -> Void) { features.forEach(body) }

    var history: (back: [FileLocation], forward: [FileLocation]) {
        get { (backStack, forwardStack) }
        set { (backStack, forwardStack) = newValue }
    }

    private var caretLine: Int? {
        shown?.lines.line(at: textView.selectedRange().location)
    }
}
