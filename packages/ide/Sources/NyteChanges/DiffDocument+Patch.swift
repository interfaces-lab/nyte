import Foundation
import NyteCore
import NyteUI

struct PatchShape: Sendable {
    struct Gap: Sendable {
        var old: Int32
        var new: Int32
        var label: String
    }

    var oldNumbers: [Int32] = []
    var newNumbers: [Int32] = []
    var headings: [String] = []
    var gaps: [Gap] = []
}

extension DiffDocument {
    static func fromPatches(path: String, patches: [String], change: GitChange, scope: String) -> DiffDocument {
        var document = DiffDocument(path: path, oldTitle: "Before " + scope, newTitle: "After " + scope + " (patch)")
        document.change = change
        var shape = PatchShape()
        var old: [UInt8] = [], new: [UInt8] = []
        var hunks: [DiffHunk] = []
        var nextNew = 1
        for (index, patch) in patches.enumerated() {
            for (order, hunk) in PatchText.hunks(patch).enumerated() {
                let label: String? = if patches.count > 1, order == 0 {
                    "Edit \(index + 1) of \(patches.count)"
                } else if hunk.newStart > nextNew {
                    hunk.newStart - nextNew == 1 ? "Line \(nextNew) is not in the patch"
                        : "Lines \(nextNew)–\(hunk.newStart - 1) are not in the patch"
                } else {
                    nil
                }
                if let label {
                    shape.gaps.append(PatchShape.Gap(old: Int32(shape.oldNumbers.count), new: Int32(shape.newNumbers.count), label: label))
                }
                var oldLine = Int32(max(hunk.oldStart, 1)), newLine = Int32(max(hunk.newStart, 1))
                var run: (old: Int, new: Int)?
                func close() {
                    guard let open = run else { return }
                    hunks.append(DiffHunk(old: open.old..<shape.oldNumbers.count, new: open.new..<shape.newNumbers.count))
                    shape.headings.append(hunk.heading)
                    run = nil
                }
                for line in hunk.lines {
                    let bytes = Array(line.text.utf8) + (line.endsLine ? [UInt8(ascii: "\n")] : [])
                    switch line.mark {
                    case UInt8(ascii: "-"):
                        if run == nil { run = (shape.oldNumbers.count, shape.newNumbers.count) }
                        old += bytes
                        shape.oldNumbers.append(oldLine)
                        oldLine += 1
                    case UInt8(ascii: "+"):
                        if run == nil { run = (shape.oldNumbers.count, shape.newNumbers.count) }
                        new += bytes
                        shape.newNumbers.append(newLine)
                        newLine += 1
                    default:
                        close()
                        old += bytes
                        new += bytes
                        shape.oldNumbers.append(oldLine)
                        shape.newNumbers.append(newLine)
                        oldLine += 1
                        newLine += 1
                    }
                }
                close()
                nextNew = Int(newLine)
            }
            nextNew = 1
        }
        document.oldExists = change != .added && change != .untracked
        document.newExists = change != .deleted
        document.old = TextLines(bytes: old)
        document.new = TextLines(bytes: new)
        document.diff = Diff(hunks: hunks, quality: .minimal)
        document.shape = hunks.isEmpty ? .identical : .text
        document.declarations = hunks.map { _ in -1 }
        document.columns = max(widest(document.old), widest(document.new))
        document.language = Language.detect(fileName: (path as NSString).lastPathComponent)
        document.oldStates = entryStates(document.old, document.language)
        document.newStates = entryStates(document.new, document.language)
        document.patch = shape
        return document
    }
}
