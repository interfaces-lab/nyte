import Foundation

public enum AgentContext: Sendable, Equatable {
    case file(URL)
    case lines(Lines)
    case diagnostic(Diagnostic)
    case review(Review)
    case terminal(Terminal)
    case stop(Stop)

    public struct LineRange: Sendable, Equatable {
        public let first: Int
        public let last: Int

        public init(first: Int, last: Int) {
            self.first = min(first, last)
            self.last = max(first, last)
        }

        public var count: Int { last - first + 1 }
    }

    public struct Position: Sendable, Equatable {
        public let line: Int
        public let column: Int

        public init(line: Int, column: Int) {
            self.line = line
            self.column = column
        }
    }

    public struct Clip: Sendable, Equatable {
        public let kept: Int
        public let total: Int

        public init(kept: Int, total: Int) {
            self.kept = kept
            self.total = total
        }
    }

    public struct Lines: Sendable, Equatable {
        public let file: URL
        public let range: LineRange
        public let text: String
        public var clip: Clip?

        public init(file: URL, range: LineRange, text: String) {
            self.file = file
            self.range = range
            self.text = text
        }
    }

    public struct Diagnostic: Sendable, Equatable {
        public enum Severity: String, Sendable, Equatable { case error, warning, information, hint }

        public let file: URL
        public let start: Position
        public let end: Position
        public let severity: Severity
        public let message: String
        public let source: String
        public let code: String

        public init(file: URL, start: Position, end: Position, severity: Severity, message: String, source: String, code: String) {
            self.file = file
            self.start = start
            self.end = end
            self.severity = severity
            self.message = message
            self.source = source
            self.code = code
        }
    }

    public struct Review: Sendable, Equatable {
        public enum Side: String, Sendable, Equatable { case old, new }

        public let file: URL
        public let side: Side
        public let range: LineRange
        public let lines: String
        public let comment: String
        public var clip: Clip?

        public init(file: URL, side: Side, range: LineRange, lines: String, comment: String) {
            self.file = file
            self.side = side
            self.range = range
            self.lines = lines
            self.comment = comment
        }
    }

    public struct Terminal: Sendable, Equatable {
        public let text: String
        public let directory: URL?
        public var clip: Clip?

        public init(text: String, directory: URL?) {
            self.text = text
            self.directory = directory
        }
    }

    public struct Stop: Sendable, Equatable {
        public struct Local: Sendable, Equatable {
            public let name: String
            public let type: String
            public let value: String

            public init(name: String, type: String, value: String) {
                self.name = name
                self.type = type
                self.value = value
            }
        }

        public let file: URL
        public let line: Int
        public let function: String
        public let locals: [Local]
        public var clip: Clip?

        public init(file: URL, line: Int, function: String, locals: [Local]) {
            self.file = file
            self.line = line
            self.function = function
            self.locals = locals
        }
    }
}
