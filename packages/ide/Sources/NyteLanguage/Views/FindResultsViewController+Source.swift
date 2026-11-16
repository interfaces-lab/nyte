import AppKit
import NyteCore
import NyteUI

extension FindResultsViewController {
    static let kindRow: Int32 = -2

    func kindRow(for kind: Usage.Kind) -> RowContent {
        let groups = fileKind.indices.filter { fileKind[$0] == kind }
        let count = groups.reduce(0) { total, file in
            let first = Int(fileFirst[file])
            return total + itemPasses[first..<first + Int(fileCount[file])].lazy.filter { $0 }.count
        }
        var row = RowContent.header(kind.title, meta: count.formatted())
        row.accessibilityLabel = "\(kind.title), \(Counted.phrase(count, "result", "results"))"
        return row
    }

    func selectionDidChange(_ rows: IndexSet) {
        guard mode == .usages, let row = rows.first, row < rowItem.count, rowItem[row] >= 0 else { return }
        preview(Int(rowItem[row]))
    }

    func preview(_ item: Int) {
        let url = fileURLs[Int(itemFile[item])]
        let places = itemRange.indices.filter { fileURLs[Int(itemFile[$0])] == url }.map { itemRange[$0] }
        source.show(url, places: places, current: itemRange[item], buffer: openText?(url))
    }
}

@MainActor
final class SourcePreview: NSObject, NSSplitViewDelegate {
    static let sideBySideWidth: CGFloat = 720
    static let listShare: CGFloat = 0.55
    static let shareRange: ClosedRange<CGFloat> = 0.2...0.8
    static let fewestListRows: CGFloat = 6
    nonisolated static let lexedLimit = 1 << 22

    struct Loaded: Sendable {
        var url: URL
        var lines: [String]
        var states: [UInt8]
    }

    let split = GutterSplitView()
    let code = CodeView()
    private var loaded: Loaded?
    private var loading: Task<Void, Never>?
    var onVisibilityChange: ((Bool) -> Void)?
    private var isShown = false
    private var choice: Bool?
    private(set) var isVisible = false
    private var share = listShare
    private var isArranging = false
    private var startsAtTop = false
    private weak var list: ListView?

    func embed(_ list: ListView, in container: NSView) {
        self.list = list
        split.dividerStyle = .thin
        split.delegate = self
        for view in [list, code] {
            view.translatesAutoresizingMaskIntoConstraints = true
            split.addSubview(view)
        }
        let host = SplitHost()
        host.onLayout = { [weak self] bounds in
            self?.split.frame = bounds
            self?.place()
        }
        split.translatesAutoresizingMaskIntoConstraints = true
        host.addSubview(split)
        Pin.fill(host, in: container)
        code.isHidden = true
    }

    func reset(showing shown: Bool, width: CGFloat) {
        loading?.cancel()
        loaded = nil
        startsAtTop = true
        isShown = shown
        code.clear()
        arrange(width: width)
    }

    func arrange(width: CGFloat) {
        let sideBySide = width >= Self.sideBySideWidth
        if split.isVertical != sideBySide { split.isVertical = sideBySide }
        place()
    }

    static func symbol(sideBySide: Bool) -> String {
        sideBySide ? "rectangle.righthalf.inset.filled" : "rectangle.bottomhalf.inset.filled"
    }

    func toggle() {
        choice = !isVisible
        place()
    }

    func place() {
        let visible = isShown && (choice ?? listFits)
        if code.isHidden == visible { code.isHidden = !visible }
        if visible != isVisible {
            isVisible = visible
            onVisibilityChange?(visible)
        }
        defer { scrollToTopOnce() }
        guard let list = split.subviews.first else { return }
        let extent = split.isVertical ? split.bounds.width : split.bounds.height
        guard extent > 0 else { return }
        let target = visible ? ((extent - split.dividerThickness) * share).rounded() : extent
        let current = split.isVertical ? list.frame.width : list.frame.height
        guard abs(current - target) > 1 else { return }
        isArranging = true
        split.setPosition(target, ofDividerAt: 0)
        split.layoutSubtreeIfNeeded()
        isArranging = false
    }

    var listFits: Bool {
        guard !split.isVertical, let list, split.bounds.height > 0 else { return true }
        let room = (split.bounds.height - split.dividerThickness) * Self.listShare - 2 * list.verticalInset
        return room >= Self.fewestListRows * list.rowHeight
    }

    private func scrollToTopOnce() {
        guard startsAtTop, let list, list.bounds.height > 0 else { return }
        startsAtTop = false
        let clip = list.scrollView.contentView
        clip.scroll(to: NSPoint(x: 0, y: -list.scrollView.contentInsets.top))
        list.scrollView.reflectScrolledClipView(clip)
    }

    func splitViewDidResizeSubviews(_ notification: Notification) {
        guard !isArranging, isVisible, NSApp.currentEvent?.type == .leftMouseDragged, let list = split.subviews.first else { return }
        let extent = split.isVertical ? split.bounds.width : split.bounds.height
        let first = split.isVertical ? list.frame.width : list.frame.height
        guard extent > 0 else { return }
        share = min(max(first / extent, Self.shareRange.lowerBound), Self.shareRange.upperBound)
    }

    func splitView(_ splitView: NSSplitView, shouldHideDividerAt dividerIndex: Int) -> Bool { !isVisible }

    func show(_ url: URL, places: [TextSpan], current: TextSpan, buffer: String?) {
        let marks = places.filter { $0.start.line == $0.end.line || $0 == current }.map { place in
            CodeMark(line: place.start.line, start: place.start.column,
                     end: place.end.line == place.start.line ? place.end.column : place.start.column, isCurrent: place == current)
        }
        if let loaded, loaded.url == url {
            return present(loaded, marks: marks)
        }
        loading?.cancel()
        loading = Task { [weak self] in
            let read = await Self.read(url, buffer: buffer)
            guard let self, !Task.isCancelled else { return }
            loaded = read
            present(read, marks: marks)
        }
    }

    private func present(_ loaded: Loaded, marks: [CodeMark]) {
        let lines = loaded.lines
        let states = loaded.states
        var source = CodeViewSource(name: loaded.url.lastPathComponent, language: Language.detect(loaded.url), lineCount: lines.count) {
            $0 < lines.count ? lines[$0] : ""
        }
        if !states.isEmpty { source.state = { $0 < states.count ? states[$0] : nil } }
        code.show(source, marks: marks, revealing: marks.first(where: \.isCurrent))
    }

    @concurrent
    static func read(_ url: URL, buffer: String?) async -> Loaded {
        let text = buffer ?? (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false).map { String($0.hasSuffix("\r") ? $0.dropLast() : $0) }
        let language = Language.detect(url)
        guard text.utf16.count <= lexedLimit, language.family != .plain else { return Loaded(url: url, lines: lines, states: []) }
        var states: [UInt8] = []
        states.reserveCapacity(lines.count)
        var state = LexState.normal
        var tokens: [UInt64] = []
        for line in lines {
            states.append(state)
            let units = Array(line.utf16)
            state = units.withUnsafeBufferPointer {
                Lexer.line($0, state: state, language: language, offset: 0, tokens: &tokens, emit: false)
            }
        }
        return Loaded(url: url, lines: lines, states: states)
    }
}

@MainActor
final class SplitHost: NSView {
    var onLayout: ((NSRect) -> Void)?

    override func layout() {
        super.layout()
        onLayout?(bounds)
    }
}
