import Foundation

public enum CodeColors {
    private static let newline = UInt16(UInt8(ascii: "\n"))
    private static let carriageReturn = UInt16(UInt8(ascii: "\r"))

    public static func ranges(in code: String, language name: String) -> [(range: NSRange, color: SyntaxColor)] {
        let language = Language.detect(fence: name)
        guard language.family != .plain else { return [] }
        let units = Array(code.utf16)
        var tokens: [UInt64] = []
        units.withUnsafeBufferPointer { buffer in
            var state = LexState.normal
            var start = 0
            while start <= buffer.count {
                let end = buffer[start...].firstIndex(of: newline) ?? buffer.count
                let stop = end > start && buffer[end - 1] == carriageReturn ? end - 1 : end
                state = Lexer.line(UnsafeBufferPointer(rebasing: buffer[start..<stop]), state: state, language: language,
                                   offset: start, tokens: &tokens, emit: true)
                start = end + 1
            }
        }
        return tokens.map { (Token.range($0), Token.kind($0)) }.filter { $0.1 != .plain }
    }
}
