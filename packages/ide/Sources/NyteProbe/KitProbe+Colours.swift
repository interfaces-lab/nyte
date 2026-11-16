import AppKit
import NyteCore
@testable import NyteEditor
@testable import NyteUI

extension KitCheck {
    func semanticColours() {
        let flags: [TokenModifiers] = [.declaration, .readonly, .static, .defaultLibrary, .deprecated]
        let combinations = (0..<(1 << flags.count)).map { mask in
            flags.indices.reduce(into: TokenModifiers()) { if mask & (1 << $1) != 0 { $0.formUnion(flags[$1]) } }
        }
        let disagreements = TokenKind.allCases.flatMap { kind in
            combinations.compactMap { modifiers -> String? in
                let ours = SyntaxColor.SemanticType(rawValue: "\(kind)").flatMap {
                    SyntaxColor.semantic($0, SyntaxColor.SemanticModifiers(rawValue: modifiers.rawValue))
                }
                return ours == SemanticTokensFeature.color(kind, modifiers) ? nil : "\(kind) \(modifiers.rawValue)"
            }
        }
        expect("Semantic colour: the kit's mapping agrees with the editor's for every token type and modifier set",
               disagreements.isEmpty, disagreements.prefix(5).joined(separator: ", "))
        expect("Semantic colour: LSP names resolve, modifiers included",
               SyntaxColor.semantic(type: "function", modifiers: ["defaultLibrary"]) == .builtin
                   && SyntaxColor.semantic(type: "variable", modifiers: ["readonly", "static"]) == .constant
                   && SyntaxColor.semantic(type: "string") == nil && SyntaxColor.semantic(type: "unknownType") == nil)
        expect("Semantic colour: a mark from a letter and a token type name gets its colour",
               RowContent.Mark.code(letter: "m", semanticType: "method") == .code("m", .function)
                   && RowContent.Mark.code(letter: "k", semanticType: "keyword") == .code("k", .keyword))
        expect("StatusItem: an icon-only accessory rests at the secondary content step",
               StatusItem("", symbol: "checkmark").restInk == Palette.contentSecondary
                   && StatusItem("Go", symbol: "circle").restInk == Palette.contentTertiary)
    }

    func signatureColours() {
        let view = DocumentationView()
        view.language = "go"
        view.show(signature: "func Broadcast(msg []byte) int", active: NSRange(location: 15, length: 10), overload: "", note: "")
        let ink = view.notes.textStorage?.attribute(.foregroundColor, at: 0, effectiveRange: nil) as? NSColor
        let same = NSAppearance(named: .aqua).map { appearance in
            var equal = false
            appearance.performAsCurrentDrawingAppearance {
                equal = ink.map { Palette.contrast($0, SyntaxColor.keyword.color) < 1.01 } ?? false
            }
            return equal
        } ?? false
        expect("Documentation: the signature line is syntax-coloured", same)
        expect("Documentation: an unlabelled fence takes the view's language",
               DocumentationView.labelFences("```\nx := 1\n```\ntext", language: "go") == "```go\nx := 1\n```\ntext")
    }

    static let readable = 4.5

    func diffContrast() {
        let grounds: [(String, NSColor, NSColor?)] = [
            ("added line", Palette.diffAddedLine, nil), ("added span", Palette.diffAddedLine, Palette.diffAddedSpan),
            ("removed line", Palette.diffRemovedLine, nil), ("removed span", Palette.diffRemovedLine, Palette.diffRemovedSpan),
        ]
        for name in [NSAppearance.Name.aqua, .darkAqua] {
            guard let appearance = NSAppearance(named: name) else { continue }
            var worst: [String] = []
            appearance.performAsCurrentDrawingAppearance {
                for (label, line, span) in grounds {
                    let ground = Palette.composite(span, over: line)
                    let lowest = SyntaxColor.allCases.map { Palette.contrast(Palette.composite($0.color, over: ground), ground) }.min() ?? 0
                    worst.append("\(label) \(String(format: "%.2f", lowest))")
                    expect("Diff: syntax colours stay above \(Self.readable):1 on the \(label), \(name == .aqua ? "light" : "dark")",
                           lowest >= Self.readable, String(format: "%.2f", lowest))
                }
            }
            print("     diff, \(name == .aqua ? "light" : "dark"), lowest syntax contrast: \(worst.joined(separator: "; "))")
        }
        expect("Diff: every changed-file status has a letter, a word and a gutter bar",
               Set(GitChange.allCases.map(\.letter)).count == GitChange.allCases.count && GitChange.allCases.allSatisfy { !$0.word.isEmpty })
    }
}

extension KitCheck {
    func commentSlant() {
        let sample = "// fan out"
        let obliqued = NSAttributedString(string: sample, attributes: [.font: TextStyle.code.font(),
                                                                         .obliqueness: TextStyle.commentSlant])
        let slanted = NSAttributedString(string: sample, attributes: [.font: TextStyle.code.slantedFont()])
        let difference = zip(columnInk(obliqued), columnInk(slanted)).map { abs($0 - $1) }.reduce(0, +)
        let total = columnInk(obliqued).reduce(0, +)
        expect("Comment slant: the slanted code font lays down the editor's obliqueness within 5%",
               total > 0 && difference / total < 0.05, String(format: "%.3f", difference / max(total, 1)))
        let coloured = TextStyle.code.attributedCode("x := 1 // note", language: "go")
        let font = coloured.attribute(.font, at: 9, effectiveRange: nil) as? NSFont
        expect("Comment slant: attributedCode gives comment ranges the slanted font", font == TextStyle.code.slantedFont())
        for name in [NSAppearance.Name.aqua, .darkAqua] {
            var lowest = Double.infinity
            NSAppearance(named: name)?.performAsCurrentDrawingAppearance {
                lowest = SyntaxColor.allCases.map { Palette.contrast($0.color, Palette.bgBase) }.min() ?? 0
            }
            expect("Syntax colours: every SyntaxColor reads at 4.5:1 or more on the editor ground, \(name == .aqua ? "light" : "dark")",
                   lowest >= Self.readable, String(format: "%.2f", lowest))
        }
    }

    func columnInk(_ text: NSAttributedString) -> [Double] {
        let size = NSSize(width: 120, height: 24)
        guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width), pixelsHigh: Int(size.height),
                                            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
              let context = NSGraphicsContext(bitmapImageRep: bitmap) else { return [] }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        text.draw(at: NSPoint(x: 4, y: 4))
        NSGraphicsContext.restoreGraphicsState()
        return (0..<bitmap.pixelsWide).map { x in
            (0..<bitmap.pixelsHigh).reduce(0) { $0 + Double(bitmap.colorAt(x: x, y: $1)?.alphaComponent ?? 0) }
        }
    }
}
