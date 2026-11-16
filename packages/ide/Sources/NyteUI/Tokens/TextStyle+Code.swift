import AppKit

extension TextStyle {
    public static let commentSlant: CGFloat = 0.18

    public func slantedFont(_ weight: NSFont.Weight = .regular, flippedTextMatrix: Bool = false) -> NSFont {
        let slant = flippedTextMatrix ? -Self.commentSlant : Self.commentSlant
        let shear = AffineTransform(m11: 1, m12: 0, m21: slant, m22: 1, tX: 0, tY: 0)
        return NSFont(descriptor: font(weight).fontDescriptor, textTransform: shear) ?? font(weight)
    }

    @MainActor public func attributedCode(_ code: String, language: String) -> NSAttributedString {
        let out = NSMutableAttributedString(string: code, attributes: attributes(Palette.contentPrimary))
        let slanted = slantedFont()
        for token in CodeColors.ranges(in: code, language: language) where NSMaxRange(token.range) <= out.length {
            out.addAttribute(.foregroundColor, value: token.color.color, range: token.range)
            if token.color == .comment { out.addAttribute(.font, value: slanted, range: token.range) }
        }
        return out
    }
}
