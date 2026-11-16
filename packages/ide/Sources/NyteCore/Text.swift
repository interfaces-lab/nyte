import Foundation

public struct TextPosition: Sendable, Hashable, Comparable {
    public var line: Int
    public var column: Int

    public init(line: Int, column: Int) {
        self.line = line
        self.column = column
    }

    public static func < (left: TextPosition, right: TextPosition) -> Bool {
        (left.line, left.column) < (right.line, right.column)
    }
}

public struct TextSpan: Sendable, Hashable {
    public var start: TextPosition
    public var end: TextPosition

    public init(start: TextPosition, end: TextPosition) {
        self.start = start
        self.end = end
    }

    public init(at position: TextPosition) {
        start = position
        end = position
    }

    public var isEmpty: Bool { start == end }

    public func contains(_ position: TextPosition) -> Bool {
        start <= position && position < end
    }
}

public struct FileLocation: Sendable, Hashable {
    public var url: URL
    public var range: TextSpan

    public init(url: URL, range: TextSpan) {
        self.url = url
        self.range = range
    }
}

public struct TextEdit: Sendable, Hashable {
    public var range: TextSpan
    public var text: String

    public init(range: TextSpan, text: String) {
        self.range = range
        self.text = text
    }
}

public struct WorkspaceEdit: Sendable, Hashable {
    public struct File: Sendable, Hashable {
        public var url: URL
        public var edits: [TextEdit]

        public init(url: URL, edits: [TextEdit]) {
            self.url = url
            self.edits = edits
        }
    }

    public var files: [File]

    public init(files: [File] = []) {
        self.files = files
    }

    public var isEmpty: Bool { files.allSatisfy(\.edits.isEmpty) }
    public var editCount: Int { files.reduce(0) { $0 + $1.edits.count } }
}
