import Foundation
import NyteUI

@MainActor
final class TextModel {
    var session: EditSession
    var widestColumns: Int
    var widest: CGFloat = 0
    var rowMap = RowMap()

    init(_ session: EditSession = EditSession(TextStore()), widestColumns: Int = 0) {
        self.session = session
        self.widestColumns = widestColumns
    }
}

protocol UnitString {
    var length: Int { get }
    func character(at index: Int) -> unichar
    func substring(with range: NSRange) -> String
}

extension NSString: UnitString {}

struct ShownText: UnitString, Sendable {
    let buffer: TextBuffer

    init(_ buffer: TextBuffer = TextBuffer()) {
        self.buffer = buffer
    }

    var length: Int { buffer.count }
    var string: String { buffer.string }

    func character(at index: Int) -> unichar { buffer[index] }
    func substring(with range: NSRange) -> String { buffer.string(range) }

    func range(of needle: String) -> NSRange {
        let units = Array(needle.utf16)
        let store = TextStore(buffer: buffer, lines: LineIndex(), language: .plain)
        return TextSearch.next(units, in: store, from: 0) ?? NSRange(location: NSNotFound, length: 0)
    }
}
