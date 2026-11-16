import Foundation

public struct DiffSelection: Sendable, Hashable {
    public var old: IndexSet
    public var new: IndexSet

    public init(old: IndexSet = [], new: IndexSet = []) {
        self.old = old
        self.new = new
    }

    public init(hunks: some Sequence<DiffHunk>) {
        var old = IndexSet(), new = IndexSet()
        for hunk in hunks {
            old.insert(integersIn: hunk.old)
            new.insert(integersIn: hunk.new)
        }
        self.init(old: old, new: new)
    }

    public var isEmpty: Bool { old.isEmpty && new.isEmpty }
    public var reversed: DiffSelection { DiffSelection(old: new, new: old) }

    public func apply(from base: TextLines, toward target: TextLines, hunks: [DiffHunk]) -> [UInt8] {
        var output: [UInt8] = []
        output.reserveCapacity(max(base.bytes.count, target.bytes.count))
        let steps = GitPatch.steps(base: base, target: target, hunks: hunks, selection: self)
        for step in steps {
            switch step {
            case let .keep(line):
                output.append(contentsOf: base.bytes[base.range(of: line)])
            case .remove:
                continue
            case let .add(line):
                output.append(contentsOf: target.bytes[target.range(of: line)])
            case let .terminate(line):
                output.append(contentsOf: base.bytes[base.range(of: line)])
                output.append(TextLines.newline)
            }
        }
        return output
    }
}

public enum GitPatch {
    public struct File: Sendable, Hashable {
        public var path: String
        public var isNew: Bool
        public var mode: UInt32

        public init(path: String, isNew: Bool = false, mode: UInt32 = 0o100644) {
            self.path = path
            self.isNew = isNew
            self.mode = mode
        }
    }

    enum Step: Equatable {
        case keep(Int)
        case remove(Int)
        case add(Int)
        case terminate(Int)

        var isChange: Bool {
            if case .keep = self { return false }
            return true
        }
    }

    static let missingNewline = Array("\\ No newline at end of file\n".utf8)

    public static func make(_ file: File, from base: TextLines, toward target: TextLines, hunks: [DiffHunk],
                            selecting selection: DiffSelection, context: Int = 3) -> Data? {
        let steps = steps(base: base, target: target, hunks: hunks, selection: selection)
        guard steps.contains(where: \.isChange) else { return nil }
        var oldBefore = [Int](repeating: 0, count: steps.count + 1)
        var newBefore = [Int](repeating: 0, count: steps.count + 1)
        for (index, step) in steps.enumerated() {
            let consumes = switch step {
            case .keep, .terminate: (1, 1)
            case .remove: (1, 0)
            case .add: (0, 1)
            }
            oldBefore[index + 1] = oldBefore[index] + consumes.0
            newBefore[index + 1] = newBefore[index] + consumes.1
        }
        var patch = Data()
        let name = quoted(file.path)
        patch.append(contentsOf: "diff --git a/\(name) b/\(name)\n".utf8)
        if file.isNew {
            patch.append(contentsOf: "new file mode \(String(file.mode, radix: 8))\n--- /dev/null\n".utf8)
        } else {
            patch.append(contentsOf: "--- a/\(name)\n".utf8)
        }
        patch.append(contentsOf: "+++ b/\(name)\n".utf8)
        var index = 0
        var floor = 0
        while index < steps.count {
            guard steps[index].isChange else {
                index += 1
                continue
            }
            let start = max(floor, index - context)
            var last = index
            var probe = index
            while probe < steps.count {
                if steps[probe].isChange {
                    last = probe
                } else if probe - last > context * 2 {
                    break
                }
                probe += 1
            }
            let end = min(steps.count, last + 1 + context)
            let oldCount = oldBefore[end] - oldBefore[start], newCount = newBefore[end] - newBefore[start]
            let oldStart = oldCount == 0 ? oldBefore[start] : oldBefore[start] + 1
            let newStart = newCount == 0 ? newBefore[start] : newBefore[start] + 1
            patch.append(contentsOf: "@@ -\(oldStart),\(oldCount) +\(newStart),\(newCount) @@\n".utf8)
            for step in steps[start..<end] {
                switch step {
                case let .keep(line): append(&patch, " ", base, line)
                case let .remove(line): append(&patch, "-", base, line)
                case let .add(line): append(&patch, "+", target, line)
                case let .terminate(line):
                    append(&patch, "-", base, line)
                    patch.append(UInt8(ascii: "+"))
                    patch.append(contentsOf: base.bytes[base.range(of: line)])
                    patch.append(TextLines.newline)
                }
            }
            floor = end
            index = end
        }
        return patch
    }

    static func steps(base: TextLines, target: TextLines, hunks: [DiffHunk], selection: DiffSelection) -> [Step] {
        var steps: [Step] = []
        steps.reserveCapacity(base.count + selection.new.count)
        var cursor = 0
        for hunk in hunks {
            for line in cursor..<hunk.old.lowerBound { steps.append(.keep(line)) }
            for line in hunk.old { steps.append(selection.old.contains(line) ? .remove(line) : .keep(line)) }
            for line in hunk.new where selection.new.contains(line) { steps.append(.add(line)) }
            cursor = hunk.old.upperBound
        }
        for line in cursor..<base.count { steps.append(.keep(line)) }
        var producesAfter = false
        for index in steps.indices.reversed() {
            switch steps[index] {
            case let .keep(line):
                if producesAfter, !base.endsWithNewline(line) { steps[index] = .terminate(line) }
                producesAfter = true
            case .add, .terminate: producesAfter = true
            case .remove: continue
            }
        }
        return steps
    }

    static func append(_ patch: inout Data, _ prefix: Character, _ text: TextLines, _ line: Int) {
        patch.append(contentsOf: String(prefix).utf8)
        patch.append(contentsOf: text.bytes[text.range(of: line)])
        guard !text.endsWithNewline(line) else { return }
        patch.append(TextLines.newline)
        patch.append(contentsOf: missingNewline)
    }

    static func quoted(_ path: String) -> String {
        let needs = path.unicodeScalars.contains { $0 == "\"" || $0 == "\\" || $0.value < 0x20 || $0.value == 0x7F }
        guard needs else { return path }
        var result = "\""
        for byte in path.utf8 {
            switch byte {
            case UInt8(ascii: "\""): result += "\\\""
            case UInt8(ascii: "\\"): result += "\\\\"
            case UInt8(ascii: "\t"): result += "\\t"
            case UInt8(ascii: "\n"): result += "\\n"
            case 0..<0x20, 0x7F...0xFF:
                let digits = String(byte, radix: 8)
                result += "\\" + String(repeating: "0", count: 3 - digits.count) + digits
            default: result.unicodeScalars.append(Unicode.Scalar(byte))
            }
        }
        return result + "\""
    }
}
