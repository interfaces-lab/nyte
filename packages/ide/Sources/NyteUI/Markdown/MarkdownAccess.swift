import AppKit

@MainActor
enum MarkdownPasteboard {
    static let markdownType = NSPasteboard.PasteboardType("net.daringfireball.markdown")

    static func write(plain: String, markdown: String?, to pasteboard: NSPasteboard = .general) {
        pasteboard.declareTypes(markdown == nil ? [.string] : [.string, markdownType], owner: nil)
        pasteboard.setString(plain, forType: .string)
        if let markdown { pasteboard.setString(markdown, forType: markdownType) }
    }
}

final class MarkdownElement: NSAccessibilityElement {
    var press: (@MainActor () -> Void)?

    override func accessibilityPerformPress() -> Bool {
        guard let press else { return false }
        MainActor.assumeIsolated { press() }
        return true
    }
}

struct AccessSpace {
    let height: CGFloat
    let origin: NSPoint

    init(flippedHeight: CGFloat) {
        height = flippedHeight
        origin = .zero
    }

    private init(height: CGFloat, origin: NSPoint) {
        self.height = height
        self.origin = origin
    }

    func unflipped(_ rect: NSRect) -> NSRect { NSRect(x: rect.minX, y: height - rect.maxY, width: rect.width, height: rect.height) }

    func local(_ rect: NSRect) -> NSRect { unflipped(rect).offsetBy(dx: -origin.x, dy: -origin.y) }

    func inside(_ rect: NSRect) -> AccessSpace { AccessSpace(height: height, origin: unflipped(rect).origin) }
}

@MainActor
enum MarkdownAccess {
    static func element(_ role: NSAccessibility.Role, label: String, frame: NSRect, parent: Any, space: AccessSpace) -> MarkdownElement {
        let element = MarkdownElement()
        element.setAccessibilityParent(parent)
        element.setAccessibilityRole(role)
        element.setAccessibilityLabel(label)
        element.setAccessibilityFrameInParentSpace(space.local(frame))
        return element
    }

    static func rows(_ grid: TableGrid, parent: Any, origin: NSPoint, space: AccessSpace) -> [NSAccessibilityElement] {
        (0 ..< grid.rowCount).map { row in
            let first = grid.cellRect(row * grid.columnCount)
            let line = NSRect(x: origin.x, y: origin.y + first.minY, width: grid.totalWidth, height: first.height)
            let texts = (0 ..< grid.columnCount).map { column in
                row * grid.columnCount + column < grid.cells.count ? grid.cellText(row * grid.columnCount + column) : ""
            }
            let element = Self.element(.row, label: "Row \(row + 1): " + texts.joined(separator: ", "), frame: line, parent: parent,
                                       space: space)
            element.setAccessibilityIndex(row)
            let inner = space.inside(line)
            element.setAccessibilityChildren(texts.enumerated().map { column, text in
                let rect = grid.cellRect(row * grid.columnCount + column).offsetBy(dx: origin.x, dy: origin.y)
                let cell = Self.element(.cell, label: text, frame: rect, parent: element, space: inner)
                cell.setAccessibilityRowIndexRange(NSRange(location: row, length: 1))
                cell.setAccessibilityColumnIndexRange(NSRange(location: column, length: 1))
                if row == 0 { cell.setAccessibilityRoleDescription("column header") }
                return cell
            })
            return element
        }
    }

    static func listLabel(_ document: MarkdownDocument, leaf: Int, words: String) -> String {
        let nested = document.lists[leaf] > 1
        let kind = switch document.markers[leaf] {
        case .open: nested ? "Nested task, unchecked" : "Task, unchecked"
        case .done: nested ? "Nested task, checked" : "Task, checked"
        case .number: (nested ? "Nested list item " : "List item ") + "\(document.values[leaf])"
        default: nested ? "Nested bullet point" : "Bullet point"
        }
        return words + ", " + kind
    }

    static func alertName(_ alert: MarkdownDocument.Alert) -> String {
        switch alert {
        case .none, .note: "Note"
        case .tip: "Tip"
        case .important: "Important"
        case .warning: "Warning"
        case .caution: "Caution"
        }
    }
}
