import AppKit

public struct RowContent {
    public enum Disclosure: UInt8, Sendable { case none, closed, open }

    public enum Part: Sendable, Hashable {
        case title, detail, meta, secondaryMeta, counts, value, detailShort, metaShort

        public static let defaultOrder: [Part] = [.detailShort, .metaShort, .detail, .value, .secondaryMeta, .meta, .title]
    }

    public enum Layout: Sendable { case list, tree }

    public enum Truncation: Sendable, Equatable {
        case tail, middle, path
        case keepingExtension(preferEnd: Bool)
    }

    public enum Ink: Sendable, Equatable {
        case primary, secondary, tertiary, quaternary
        case tone(Tone)
        case hue(Hue)
        case syntax(SyntaxColor)

        @MainActor public var color: NSColor {
            switch self {
            case .primary: Palette.contentPrimary
            case .secondary: Palette.contentSecondary
            case .tertiary: Palette.contentTertiary
            case .quaternary: Palette.contentQuaternary
            case let .tone(tone): Palette.color(.contentAccent, tone: tone)
            case let .hue(hue): Palette.color(.contentTertiary, in: hue)
            case let .syntax(syntax): syntax.color
            }
        }
    }

    public enum Mark: Sendable, Equatable {
        case dot(Tone)
        case ring(Tone)
        case progress
        case code(Character, SyntaxColor)
        case task(TaskMark.Status)
    }

    public enum Leading {
        case none
        case symbol(String, Ink)
        case image(NSImage)
        case tinted(NSImage, NSColor)
        case mark(Mark)
    }

    public struct Badge: Sendable, Equatable {
        public var text: String
        public var tone: Tone
        public var symbol: String?
        public var isLabel = false
        public init(_ text: String, tone: Tone = .neutral, symbol: String? = nil) {
            self.text = text
            self.tone = tone
            self.symbol = symbol
        }

        public static func request(_ request: TaskMark.Request) -> Badge {
            var badge = Badge(request.word, tone: Attention.tone)
            badge.isLabel = true
            return badge
        }

        public static let needsInput = Badge(Attention.needsInputText, tone: Attention.tone, symbol: Attention.symbol)
    }

    public struct Action: Sendable, Equatable {
        public var id: String
        public var symbol: String
        public var label: String
        public var key: String
        public var modifiers: NSEvent.ModifierFlags

        public init(_ id: String, symbol: String, label: String, key: String = "", modifiers: NSEvent.ModifierFlags = []) {
            self.id = id
            self.symbol = symbol
            self.label = label
            self.key = key
            self.modifiers = modifiers
        }
    }

    public static let mostActions = 3

    public struct Status: Sendable, Equatable {
        public var letter: Character
        public var ink: Ink
        public init(_ letter: Character, ink: Ink) {
            self.letter = letter
            self.ink = ink
        }
    }

    public var depth = 0
    public var layout = Layout.list
    public var disclosure = Disclosure.none
    public var leading = Leading.none

    public var number = ""
    public var title = ""
    public var titleInk = Ink.primary
    public var titleWeight = NSFont.Weight.regular
    public var titleTruncation = Truncation.tail
    public var monospace = false
    public var emphasis: [NSRange] = []
    public var removed: [NSRange] = []
    public var added: [NSRange] = []
    public var check: Checkbox.State?
    public var accessibilityLabel: String?

    public var detail = ""
    public var detailInk = Ink.tertiary
    public var detailJoinsTitle = false
    public var detailTruncation = Truncation.tail
    public var detailGap = Space.x1
    public var value = ""
    public var valueInk = Ink.primary
    public var valueTruncation = NSLineBreakMode.byTruncatingTail

    public var meta = ""
    public var metaInk = Ink.tertiary
    public var diff: (added: Int, removed: Int)?
    public var badge: Badge?
    public var status: Status?
    public var changeDot: NSColor?

    public var description = ""
    public var descriptionInk = Ink.secondary
    public var descriptionMeta = ""
    public var descriptionWraps = false
    public var descriptionMonospace = false
    public var metaTruncation = Truncation.tail
    public var metaMaxWidth: CGFloat?

    public var isHeader = false
    public var isGroupHeader = false
    public var syntax: [(range: NSRange, color: SyntaxColor)] = []
    public var valueSyntax: [(range: NSRange, color: SyntaxColor)] = []
    public var descriptionSyntax: [(range: NSRange, color: SyntaxColor)] = []
    public var toolTip: String?
    public var detailShort = ""
    public var metaShort = ""
    public var yieldOrder = Part.defaultOrder
    public var endsGroup = false
    public var alignsFacts = false
    public var marksFollowTitle = false
    public var showsFrom: [Part: CGFloat] = [:]
    public static let roomForColumns: CGFloat = 360
    public var showsRuleAbove = false
    public var actions: [Action] = [] { didSet { if actions.count > Self.mostActions { actions = Array(actions.prefix(Self.mostActions)) } } }

    public init(title: String = "", detail: String = "", meta: String = "", leading: Leading = .none,
                depth: Int = 0, disclosure: Disclosure = .none) {
        self.title = title
        self.detail = detail
        self.meta = meta
        self.leading = leading
        self.depth = depth
        self.disclosure = disclosure
    }

    public mutating func emphasizeMatches(of query: String) {
        emphasis = Self.matches(of: query, in: title)
    }

    public static func matches(of query: String, in text: String) -> [NSRange] {
        let needle = Array(query.lowercased().utf16), haystack = Array(text.lowercased().utf16)
        guard !needle.isEmpty, haystack.count == text.utf16.count else { return [] }
        let found = (text as NSString).range(of: query, options: .caseInsensitive)
        if found.location != NSNotFound { return [found] }
        var ranges: [NSRange] = []
        var next = 0
        for (index, unit) in haystack.enumerated() where next < needle.count && unit == needle[next] {
            next += 1
            if let last = ranges.last, NSMaxRange(last) == index {
                ranges[ranges.count - 1].length += 1
            } else {
                ranges.append(NSRange(location: index, length: 1))
            }
        }
        return next == needle.count ? ranges : []
    }

    private struct FitKey: Hashable {
        let title: String
        let width: CGFloat
        let font: String
        let preferEnd: Bool
    }

    @MainActor private static var fitted: [FitKey: String] = [:]
    private static let fittedLimit = 2_048

    @MainActor public static func fit(_ title: String, width: CGFloat, font: NSFont, truncation: Truncation) -> String {
        guard case let .keepingExtension(preferEnd) = truncation else { return title }
        let key = FitKey(title: title, width: width.rounded(.down), font: font.fontName + "\(font.pointSize)", preferEnd: preferEnd)
        if let cached = fitted[key] { return cached }
        if fitted.count >= fittedLimit { fitted.removeAll(keepingCapacity: true) }
        let result = measureFit(title, width: key.width, font: font, preferEnd: preferEnd)
        fitted[key] = result
        return result
    }

    @MainActor private static func measureFit(_ title: String, width: CGFloat, font: NSFont, preferEnd: Bool) -> String {
        let attributes: [NSAttributedString.Key: Any] = [.font: font]
        func fits(_ text: String) -> Bool { ceil((text as NSString).size(withAttributes: attributes).width) <= width }
        guard !fits(title) else { return title }
        let dot = title.lastIndex(of: ".").flatMap { $0 == title.startIndex ? nil : $0 }
        let stem = Array(dot.map { title[..<$0] } ?? Substring(title))
        let suffix = dot.map { String(title[$0...]) } ?? ""
        func candidate(_ kept: Int) -> String {
            let part = preferEnd ? String(stem.suffix(kept)) : String(stem.prefix(kept))
            return preferEnd ? "\u{2026}" + part + suffix : part + "\u{2026}" + suffix
        }
        var low = 0
        var high = stem.count
        while low < high {
            let middle = (low + high + 1) / 2
            if fits(candidate(middle)) { low = middle } else { high = middle - 1 }
        }
        return candidate(low)
    }

    public static func header(_ title: String, detail: String = "", meta: String = "", leading: Leading = .none,
                              depth: Int = 0, disclosure: Disclosure = .none) -> RowContent {
        var row = RowContent(title: title, detail: detail, meta: meta, leading: leading, depth: depth, disclosure: disclosure)
        row.isHeader = true
        return row
    }
}

public struct RowFit: Equatable, Sendable {
    public var titleWidth: CGFloat
    public var titleTruncated: Bool
    public var detail: String
    public var detailWidth: CGFloat
    public var meta: String
    public var showsSecondaryMeta: Bool
    public var showsCounts: Bool
    public var showsValue: Bool
}

extension RowContent {
    @MainActor public func fitted(width: CGFloat, reservesDisclosure: Bool = false, numberColumn: CGFloat = 0,
                                  showsActions: Bool = false) -> RowFit {
        RowRenderer.fit(self, width: width, reservesDisclosure: reservesDisclosure, numberColumn: numberColumn,
                        showsActions: showsActions)
    }
}
