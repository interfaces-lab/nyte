import AppKit
import NyteUI

public struct EditorPreferences: Sendable, Equatable {
    public var fontFamily: String?
    public var fontSize: CGFloat
    public var lineHeight: CGFloat
    public var defaultIndent: Indent
    public var showsIndentGuides: Bool
    public var showsStickyDeclarations: Bool
    public var showsInlayHints: Bool
    public var showsChangeBars: Bool
    public var trimsTrailingWhitespace: Bool
    public var ensuresFinalNewline: Bool

    public init(fontFamily: String? = nil, fontSize: CGFloat = TextStyle.code.size, lineHeight: CGFloat = TextStyle.code.lineHeight,
                defaultIndent: Indent = Indent(usesTabs: false, width: Indent.defaultWidth), showsIndentGuides: Bool = true,
                showsStickyDeclarations: Bool = true, showsInlayHints: Bool = true, showsChangeBars: Bool = true,
                trimsTrailingWhitespace: Bool = false, ensuresFinalNewline: Bool = false) {
        self.fontFamily = fontFamily
        self.fontSize = fontSize
        self.lineHeight = lineHeight
        self.defaultIndent = defaultIndent
        self.showsIndentGuides = showsIndentGuides
        self.showsStickyDeclarations = showsStickyDeclarations
        self.showsInlayHints = showsInlayHints
        self.showsChangeBars = showsChangeBars
        self.trimsTrailingWhitespace = trimsTrailingWhitespace
        self.ensuresFinalNewline = ensuresFinalNewline
    }
}

extension EditorPreferences {
    @MainActor var metrics: CodeRowMetrics {
        CodeRowMetrics(style: .code, size: fontSize, lineHeight: lineHeight, family: fontFamily)
    }
}
