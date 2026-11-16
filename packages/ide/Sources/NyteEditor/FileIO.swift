import Foundation
import NyteUI
import NyteCore
import os

enum LineEnding: Sendable { case lf, crlf }

struct TextFormat: Sendable, Equatable {
    var encoding: String.Encoding
    var hasBOM: Bool
    var lineEnding: LineEnding
}

struct DecodedText: Sendable {
    let store: TextStore
    let text: String
    let format: TextFormat
    let detectedIndent: Indent?
    let widestLineColumns: Int
    let digest: Int
}

struct LoadedFile: Sendable {
    enum Content: Sendable {
        case text(DecodedText)
        case binary
        case tooLarge(limit: Int)
        case undecodable
        case unreadable
    }

    let content: Content
    var size = 0
    var modified: Date?
}

struct SavedFile: Sendable {
    let digest: Int
    let modified: Date?
    let encoding: String.Encoding
}

enum FileIO {
    static let sniffLength = 8 * 1024
    static let largestOpenableBytes = 16_000_000
    static let tabColumns = 4
    private static let utf8BOM: [UInt8] = [0xEF, 0xBB, 0xBF]
    private static let utf16LittleBOM: [UInt8] = [0xFF, 0xFE]
    private static let utf16BigBOM: [UInt8] = [0xFE, 0xFF]
    private static let carriageReturn = UInt16(UInt8(ascii: "\r"))
    private static let tab = UInt16(UInt8(ascii: "\t"))
    private static let space = UInt16(UInt8(ascii: " "))
    private static let indentSteps = 2...8
    private static let preferredSteps = [4, 2, 8, 3, 6, 5, 7]
    private static let digestChunk = 4096

    static func modificationDate(_ url: URL) -> Date? {
        (try? FileManager.default.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date
    }

    static func load(_ url: URL, language: Language) -> LoadedFile {
        let attributes: [FileAttributeKey: Any]
        do {
            attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        } catch {
            Logger.editor.error("read attributes of \(url.path, privacy: .private): \(error.localizedDescription, privacy: .public)")
            return LoadedFile(content: .unreadable)
        }
        let size = (attributes[.size] as? NSNumber)?.intValue ?? 0
        let modified = attributes[.modificationDate] as? Date
        guard size <= largestOpenableBytes else {
            return LoadedFile(content: .tooLarge(limit: largestOpenableBytes), size: size, modified: modified)
        }
        let data: Data
        do {
            data = try Data(contentsOf: url, options: .mappedIfSafe)
        } catch {
            Logger.editor.error("read \(url.path, privacy: .private): \(error.localizedDescription, privacy: .public)")
            return LoadedFile(content: .unreadable, size: size, modified: modified)
        }
        return LoadedFile(content: decode(data, language: language), size: size, modified: modified)
    }

    static func decode(_ data: Data, language: Language) -> LoadedFile.Content {
        let utf16BOM = data.starts(with: utf16LittleBOM) || data.starts(with: utf16BigBOM)
        if !utf16BOM, data.prefix(sniffLength).contains(0) { return .binary }
        if !utf16BOM, let loaded = TextLoader.load(data, language: language) {
            return .text(described(loaded.store, format: loaded.format, widest: loaded.widestColumns))
        }
        guard let (decoded, encoding, hasBOM) = decodeText(data) else { return .undecodable }
        var crlf = 0
        var lf = 0
        var previous: UInt16 = 0
        for unit in decoded.utf16 {
            if unit == LineIndex.newline { if previous == carriageReturn { crlf += 1 } else { lf += 1 } }
            previous = unit
        }
        let lineEnding: LineEnding = crlf > lf ? .crlf : .lf
        let text = lineEnding == .crlf ? decoded.replacingOccurrences(of: "\r\n", with: "\n") : decoded
        let units = Array(text.utf16)
        let store = units.withUnsafeBufferPointer { TextStore($0, language: language) }
        let widest = units.withUnsafeBufferPointer { TextLoader.widestColumns($0) }
        return .text(described(store, format: TextFormat(encoding: encoding, hasBOM: hasBOM, lineEnding: lineEnding), widest: widest))
    }

    private static func described(_ store: TextStore, format: TextFormat, widest: Int) -> DecodedText {
        DecodedText(store: store, text: store.string, format: format, detectedIndent: indent(store), widestLineColumns: widest,
                    digest: digest(store.buffer))
    }

    private static func decodeText(_ data: Data) -> (String, String.Encoding, Bool)? {
        if data.starts(with: utf8BOM), let text = String(data: data.dropFirst(utf8BOM.count), encoding: .utf8) {
            return (text, .utf8, true)
        }
        if let text = String(data: data, encoding: .utf8) { return (text, .utf8, false) }
        var converted: NSString?
        var lossy = ObjCBool(false)
        let raw = NSString.stringEncoding(
            for: data, encodingOptions: [.allowLossyKey: false], convertedString: &converted, usedLossyConversion: &lossy
        )
        guard raw != 0, let converted else { return nil }
        return (converted as String, String.Encoding(rawValue: raw), false)
    }

    static func indent(_ store: TextStore) -> Indent? {
        var tabbed = 0
        var spaced = 0
        var steps = [Int](repeating: 0, count: indentSteps.upperBound + 1)
        var previous = 0
        for line in 0..<store.lineCount {
            let range = store.lineRange(line)
            guard range.length > 0 else { continue }
            if store[range.location] == tab {
                tabbed += 1
                continue
            }
            var end = range.location
            while end < NSMaxRange(range), store[end] == space { end += 1 }
            guard end < NSMaxRange(range) else { continue }
            let spaces = end - range.location
            if spaces > 0 { spaced += 1 }
            let step = abs(spaces - previous)
            if indentSteps.contains(step) { steps[step] += 1 }
            previous = spaces
        }
        guard tabbed + spaced > 0 else { return nil }
        if tabbed > spaced { return Indent(usesTabs: true, width: Indent.defaultWidth) }
        guard let best = preferredSteps.max(by: { steps[$0] < steps[$1] }), steps[best] > 0 else { return nil }
        return Indent(usesTabs: false, width: best)
    }

    static func encode(_ text: String, format: TextFormat) -> (data: Data, encoding: String.Encoding) {
        let body = format.lineEnding == .crlf ? text.replacingOccurrences(of: "\n", with: "\r\n") : text
        let encoding = body.data(using: format.encoding) == nil ? String.Encoding.utf8 : format.encoding
        var data = body.data(using: encoding) ?? Data(body.utf8)
        if format.hasBOM, encoding == .utf8 { data.insert(contentsOf: utf8BOM, at: 0) }
        return (data, encoding)
    }

    static func save(_ text: String, format: TextFormat, to url: URL) -> Result<SavedFile, any Error> {
        let (data, encoding) = encode(text, format: format)
        do {
            let manager = FileManager.default
            if manager.fileExists(atPath: url.path) {
                let folder = try manager.url(for: .itemReplacementDirectory, in: .userDomainMask, appropriateFor: url, create: true)
                let temporary = folder.appendingPathComponent(url.lastPathComponent)
                try data.write(to: temporary)
                _ = try manager.replaceItemAt(url, withItemAt: temporary)
                do {
                    try manager.removeItem(at: folder)
                } catch {
                    Logger.editor.debug("remove \(folder.path, privacy: .private): \(error.localizedDescription, privacy: .public)")
                }
            } else {
                try data.write(to: url, options: .atomic)
            }
            return .success(SavedFile(digest: digest(TextBuffer(text)), modified: modificationDate(url), encoding: encoding))
        } catch {
            Logger.editor.error("save \(url.path, privacy: .private): \(error.localizedDescription, privacy: .public)")
            return .failure(error)
        }
    }

    static func rewrite(_ url: URL, applying edits: [TextEdit]) -> Bool {
        guard case .text(let file) = load(url, language: .plain).content else {
            Logger.editor.error("rewrite \(url.path, privacy: .private): not a text file")
            return false
        }
        var store = file.store
        let ranges = edits.compactMap { edit -> (NSRange, String)? in
            guard let start = store.lines.offset(of: edit.range.start, length: store.length),
                  let end = store.lines.offset(of: edit.range.end, length: store.length), end >= start
            else { return nil }
            return (NSRange(location: start, length: end - start), edit.text)
        }.sorted { $0.0.location > $1.0.location }
        guard ranges.count == edits.count else {
            Logger.editor.error("rewrite \(url.path, privacy: .private): an edit falls outside the file")
            return false
        }
        for (range, replacement) in ranges { store.replace(range, with: Array(replacement.utf16)) }
        guard case .success = save(store.string, format: file.format, to: url) else { return false }
        return true
    }

    static func digest(_ buffer: TextBuffer) -> Int {
        var hasher = Hasher()
        var location = 0
        while location < buffer.count {
            let count = min(digestChunk, buffer.count - location)
            buffer.withUnits(NSRange(location: location, length: count)) { units in
                hasher.combine(bytes: UnsafeRawBufferPointer(units))
            }
            location += count
        }
        hasher.combine(buffer.count)
        return hasher.finalize()
    }
}
