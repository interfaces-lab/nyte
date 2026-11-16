import AppKit

struct MarkdownAccessGroup {
    let element: MarkdownElement?
    let leaves: [Int]
    let parts: [Int: [NSAccessibilityElement]]
}

extension MarkdownView {
    override public func accessibilityChildren() -> [Any]? {
        let groups = accessGroups ?? makeAccessGroups()
        accessGroups = groups
        return groups.flatMap { group -> [Any] in
            let children = group.leaves.flatMap { leaf -> [Any] in
                let parts: [Any] = group.parts[leaf] ?? []
                guard let panel = realized[leaf] else { return parts }
                return [panel] + parts.dropFirst()
            }
            guard let element = group.element else { return children }
            element.setAccessibilityChildren(children)
            return [element]
        }
    }

    private func makeAccessGroups() -> [MarkdownAccessGroup] {
        let document = layoutEngine.document
        var groups: [MarkdownAccessGroup] = []
        var leaf = 0
        while leaf < document.count {
            let owner = document.owners[leaf]
            let start = leaf
            let space = AccessSpace(flippedHeight: bounds.height)
            let element: MarkdownElement?
            if document.kinds[leaf] == .alertTitle {
                let name = MarkdownAccess.alertName(document.alerts[leaf])
                element = MarkdownAccess.element(.group, label: name, frame: groupFrame(from: leaf), parent: self, space: space)
                element?.setAccessibilityRoleDescription("\(name.lowercased()) alert")
                leaf += 1
                while leaf < document.count, document.owners[leaf] == owner, document.alerts[leaf] != .none { leaf += 1 }
            } else if document.lists[leaf] > 0 {
                element = MarkdownAccess.element(.list, label: "List", frame: groupFrame(from: leaf), parent: self, space: space)
                while leaf < document.count, document.owners[leaf] == owner, document.lists[leaf] > 0 { leaf += 1 }
            } else {
                element = nil
                leaf += 1
            }
            let leaves = Array((element == nil ? start : start + (document.kinds[start] == .alertTitle ? 1 : 0)) ..< leaf)
            let parent: Any = element ?? self
            let inner = element == nil ? space : space.inside(groupFrame(from: start))
            var parts: [Int: [NSAccessibilityElement]] = [:]
            for member in leaves { parts[member] = accessParts(member, parent: parent, space: inner) }
            groups.append(MarkdownAccessGroup(element: element, leaves: leaves, parts: parts))
        }
        return groups
    }

    private func groupFrame(from leaf: Int) -> NSRect {
        let document = layoutEngine.document
        var frame = NSRect.null
        var member = leaf
        while member < document.count, document.owners[member] == document.owners[leaf] {
            frame = frame.union(LayoutBox.rect(layoutEngine, member))
            member += 1
        }
        return frame.isNull ? .zero : frame
    }

    private func accessParts(_ leaf: Int, parent: Any, space: AccessSpace) -> [NSAccessibilityElement] {
        let document = layoutEngine.document
        let words = document.string(document.ranges[leaf]).replacingOccurrences(of: "\u{2028}", with: " ")
        let frame = LayoutBox.rect(layoutEngine, leaf)
        let main: MarkdownElement
        switch document.kinds[leaf] {
        case .heading:
            main = MarkdownAccess.element(NSAccessibility.Role(rawValue: "AXHeading"), label: words, frame: frame, parent: parent, space: space)
            main.setAccessibilityValue(Int(document.values[leaf]))
            main.setAccessibilityRoleDescription("heading level \(document.values[leaf])")
        case .paragraph, .alertTitle:
            let label = document.flags[leaf].contains(.itemStart) && document.markers[leaf] != .none
                ? MarkdownAccess.listLabel(document, leaf: leaf, words: words)
                : document.quotes[leaf] > 0 && document.alerts[leaf] == .none ? words + ", Blockquote" : words
            main = MarkdownAccess.element(.staticText, label: label, frame: frame, parent: parent, space: space)
            if document.lists[leaf] > 0 { main.setAccessibilityRoleDescription("list item") }
        case .code:
            let code = layoutEngine.code(leaf)
            main = MarkdownAccess.element(.group, label: "\(CodePanel.displayName(document.language(leaf))) code", frame: frame,
                                          parent: parent, space: space)
            main.setAccessibilityRoleDescription("code block")
            main.setAccessibilityValue(code)
            main.setAccessibilityCustomActions([NSAccessibilityCustomAction(name: "Copy code") {
                MarkdownPasteboard.write(plain: code, markdown: nil)
                return true
            }])
        case .table:
            let grid = layoutEngine.grid(leaf, width: frame.width)
            main = MarkdownAccess.element(.table, label: "Table, \(grid.rowCount) rows, \(grid.columnCount) columns", frame: frame,
                                          parent: parent, space: space)
            main.setAccessibilityRowCount(grid.rowCount)
            main.setAccessibilityColumnCount(grid.columnCount)
            let rows = MarkdownAccess.rows(grid, parent: main, origin: frame.origin, space: space.inside(frame))
            main.setAccessibilityRows(rows)
            main.setAccessibilityChildren(rows)
        case .image:
            main = MarkdownAccess.element(.image, label: words.isEmpty ? "Image" : words, frame: frame, parent: parent, space: space)
            let source = document.imageSource(leaf)
            main.press = { [weak self] in self?.open(source) }
        case .rule:
            main = MarkdownAccess.element(.splitter, label: "Separator", frame: frame, parent: parent, space: space)
            main.setAccessibilityRoleDescription("separator")
        }
        return [main] + links(in: leaf, parent: parent, space: space)
    }

    private func links(in leaf: Int, parent: Any, space: AccessSpace) -> [NSAccessibilityElement] {
        let engine = layoutEngine
        guard leaf < engine.places.count, let storage = textView.textStorage else { return [] }
        var found: [NSAccessibilityElement] = []
        storage.enumerateAttribute(.link, in: engine.places[leaf]) { value, range, _ in
            guard let value else { return }
            let target = (value as? URL)?.absoluteString ?? (value as? String) ?? ""
            let glyphs = engine.manager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            let box = engine.manager.boundingRect(forGlyphRange: glyphs, in: engine.container)
            let label = (storage.string as NSString).substring(with: range).replacingOccurrences(of: MarkdownInline.lead, with: "")
            let link = MarkdownAccess.element(.link, label: label, frame: box, parent: parent, space: space)
            link.setAccessibilityValue(target)
            link.press = { [weak self] in self?.open(target) }
            found.append(link)
        }
        return found
    }
}

@MainActor
enum LayoutBox {
    static func rect(_ engine: MarkdownLayout, _ leaf: Int) -> NSRect {
        MarkdownLayout.isBlock(engine.document.kinds[leaf]) ? engine.blockRect(leaf) : engine.leafRect(leaf)
    }
}
