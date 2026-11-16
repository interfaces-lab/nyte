import AppKit
import BeautifulMermaid
import NyteDesign

enum MarkdownBlock: Equatable {
  case prose(NSAttributedString)
  case code(String, language: String?)
  case diagram(String)
  case rule
}

enum Markdown {
  static func blocks(_ source: String, role: NyteRole = .contentPrimary) -> [MarkdownBlock] {
    let options = AttributedString.MarkdownParsingOptions(
      allowsExtendedAttributes: true, interpretedSyntax: .full, failurePolicy: .returnPartiallyParsedIfPossible)
    guard let parsed = try? AttributedString(markdown: source, options: options) else {
      return [.prose(NSAttributedString(string: source, attributes: base(.nyte(.base), role, NSParagraphStyle())))]
    }

    var out: [MarkdownBlock] = []
    let prose = NSMutableAttributedString()
    var paragraph: Int?
    var style = NSParagraphStyle()
    var listItem: Int?
    var afterList = false
    var done = false
    var quoted = false
    var tables: [Int: NSTextTable] = [:]
    var rows: [Int: (identity: Int, index: Int)] = [:]

    func flush() {
      if prose.length > 0, let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) {
        for match in detector.matches(in: prose.string, range: NSRange(location: 0, length: prose.length)) {
          guard let url = match.url, url.scheme?.hasPrefix("http") == true,
            prose.attribute(.link, at: match.range.location, effectiveRange: nil) == nil,
            prose.attribute(.backgroundColor, at: match.range.location, effectiveRange: nil) == nil
          else { continue }
          prose.addAttribute(.link, value: url, range: match.range)
        }
      }
      if prose.length > 0 { out.append(.prose(NSAttributedString(attributedString: prose))) }
      prose.deleteCharacters(in: NSRange(location: 0, length: prose.length))
      paragraph = nil
      afterList = false
    }

    for run in parsed.runs {
      let components = run.presentationIntent?.components ?? []
      let text = String(parsed[run.range].characters)
      let kinds = components.map(\.kind)

      if kinds.contains(.thematicBreak) {
        flush()
        out.append(.rule)
        continue
      }
      if case .codeBlock(let language)? = kinds.first {
        flush()
        let code = text.hasSuffix("\n") ? String(text.dropLast()) : text
        if case .code(let before, let same)? = out.last, paragraph == components.first?.identity {
          out[out.count - 1] = .code(before + code, language: same)
        } else if language?.lowercased() == "mermaid" {
          out.append(.diagram(code))
        } else {
          out.append(.code(code, language: language?.isEmpty == false ? language : nil))
        }
        paragraph = components.first?.identity
        continue
      }

      var font = NSFont.nyte(.base)
      var color = role
      var marker = ""
      if components.first?.identity != paragraph {
        let first = prose.length == 0
        if !first { prose.append(NSAttributedString(string: "\n")) }
        paragraph = components.first?.identity
        let next = NSMutableParagraphStyle()
        next.lineSpacing = NyteSpace.s0_5.rawValue
        next.paragraphSpacingBefore = first ? 0 : NyteSpace.s2.rawValue

        let lists = components.filter { $0.kind == .orderedList || $0.kind == .unorderedList }
        if let item = components.first(where: { if case .listItem = $0.kind { return true } else { return false } }),
          case .listItem(let ordinal) = item.kind
        {
          let ordered = lists.first?.kind == .orderedList
          let gutter = (ordered ? NyteSpace.s6 : NyteSpace.s4).rawValue
          let depth = CGFloat(max(1, lists.count))
          let indent = (depth - 1) * NyteSpace.s4.rawValue + gutter
          next.firstLineHeadIndent = indent - gutter
          next.headIndent = indent
          next.tabStops = [NSTextTab(textAlignment: .left, location: indent)]
          next.defaultTabInterval = indent
          if afterList { next.paragraphSpacingBefore = NyteSpace.s1.rawValue }
          if item.identity != listItem {
            marker = (ordered ? "\(ordinal)." : "•") + "\t"
          } else {
            next.firstLineHeadIndent = indent
          }
          listItem = item.identity
          afterList = true
        } else {
          afterList = false
          done = false
        }
        if kinds.contains(.blockQuote) {
          next.firstLineHeadIndent += NyteSpace.s3.rawValue
          next.headIndent += NyteSpace.s3.rawValue
          quoted = true
        } else {
          quoted = false
        }
        for component in components {
          switch component.kind {
          case .header:
            if !first { next.paragraphSpacingBefore = NyteSpace.s4.rawValue }
          case .tableCell(let column):
            guard let owner = components.first(where: { if case .table = $0.kind { return true } else { return false } }),
              case .table(let columns) = owner.kind,
              let line = components.first(where: {
                if case .tableRow = $0.kind { return true }
                return $0.kind == .tableHeaderRow
              })
            else { break }
            let table = tables[owner.identity] ?? {
              let table = NSTextTable()
              table.numberOfColumns = columns.count
              table.collapsesBorders = true
              table.hidesEmptyCells = false
              tables[owner.identity] = table
              return table
            }()
            let before = rows[owner.identity]
            let index = before.map { $0.identity == line.identity ? $0.index : $0.index + 1 } ?? 0
            rows[owner.identity] = (line.identity, index)
            let cell = NSTextTableBlock(table: table, startingRow: index, rowSpan: 1, startingColumn: column, columnSpan: 1)
            cell.setWidth(NyteSpace.s1_5.rawValue, type: .absoluteValueType, for: .padding)
            cell.setWidth(NyteSpace.px.rawValue, type: .absoluteValueType, for: .border, edge: .maxY)
            cell.setBorderColor(.nyte(.strokeTertiary))
            next.textBlocks = [cell]
            next.paragraphSpacingBefore = 0
          default:
            break
          }
        }
        style = next
      }

      for component in components {
        switch component.kind {
        case .header(let level):
          font = .nyte(level <= 1 ? .lg : .base, .semibold)
        case .blockQuote:
          color = .contentSecondary
        case .tableHeaderRow:
          font = .nyte(.base, .semibold)
        default:
          break
        }
      }

      var attributes = base(font, color, style)
      if quoted { attributes[.quoted] = true }
      if let inline = run.inlinePresentationIntent {
        if inline.contains(.stronglyEmphasized) { font = .nyte(.base, .semibold) }
        if inline.contains(.code) {
          font = .nyteCode
          attributes[.backgroundColor] = NSColor.nyte(.fillTertiary)
        }
        if inline.contains(.emphasized) {
          let italic = NSFontManager.shared.convert(font, toHaveTrait: .italicFontMask)
          if italic.fontDescriptor.symbolicTraits.contains(.italic) { font = italic } else { attributes[.obliqueness] = 0.16 }
        }
        if inline.contains(.strikethrough) { attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
        attributes[.font] = font
      }
      if let link = run.link { attributes[.link] = link }

      var words = text
      if !marker.isEmpty, let box = ["[ ] ", "[x] ", "[X] "].first(where: { words.hasPrefix($0) }) {
        words.removeFirst(box.count)
        marker = (box == "[ ] " ? "☐" : "☑") + "\t"
        done = box != "[ ] "
      } else if !marker.isEmpty {
        done = false
      }
      if done, afterList {
        attributes[.foregroundColor] = NSColor.nyte(.contentTertiary)
        attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
      }
      if !marker.isEmpty { prose.append(NSAttributedString(string: marker, attributes: base(.nyte(.base), .contentTertiary, style))) }
      prose.append(NSAttributedString(string: words, attributes: attributes))
    }
    flush()
    return out
  }

  static func render(_ source: String) -> NSAttributedString {
    let out = NSMutableAttributedString()
    for block in blocks(source) {
      if out.length > 0 { out.append(NSAttributedString(string: "\n", attributes: body)) }
      switch block {
      case .prose(let text): out.append(text)
      case .code(let code, _), .diagram(let code):
        out.append(NSAttributedString(string: code, attributes: body.merging([.font: NSFont.nyteCode]) { _, new in new }))
      case .rule: break
      }
    }
    return out
  }

  static var body: [NSAttributedString.Key: Any] {
    let style = NSMutableParagraphStyle()
    style.lineSpacing = NyteSpace.s0_5.rawValue
    return base(.nyte(.base), .contentPrimary, style)
  }

  private static func base(_ font: NSFont, _ role: NyteRole, _ style: NSParagraphStyle) -> [NSAttributedString.Key: Any] {
    [.font: font, .foregroundColor: NSColor.nyte(role), .paragraphStyle: style]
  }
}

extension NSAttributedString.Key {
  fileprivate static let quoted = NSAttributedString.Key("nyte.quoted")
}

private final class ProseLayoutManager: NSLayoutManager {
  override func drawBackground(forGlyphRange glyphsToShow: NSRange, at origin: NSPoint) {
    super.drawBackground(forGlyphRange: glyphsToShow, at: origin)
    guard let storage = textStorage, let container = textContainers.first else { return }
    let characters = characterRange(forGlyphRange: glyphsToShow, actualGlyphRange: nil)
    storage.enumerateAttribute(.quoted, in: characters) { value, range, _ in
      guard value != nil else { return }
      let glyphs = glyphRange(forCharacterRange: range, actualCharacterRange: nil)
      let lines = boundingRect(forGlyphRange: glyphs, in: container)
      let bar = NSRect(
        x: origin.x, y: origin.y + lines.minY, width: NyteSpace.s0_5.rawValue, height: lines.height)
      NSColor.nyte(.strokeTertiary).setFill()
      NSBezierPath(roundedRect: bar, xRadius: bar.width / 2, yRadius: bar.width / 2).fill()
    }
  }

  override func fillBackgroundRectArray(
    _ rectArray: UnsafePointer<NSRect>, count rectCount: Int, forCharacterRange charRange: NSRange, color: NSColor
  ) {
    color.setFill()
    let radius = NyteRadius.indicator.rawValue
    for index in 0..<rectCount {
      let rect = rectArray[index].insetBy(dx: -NyteSpace.s0_5.rawValue, dy: 0)
      NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
    }
  }
}

final class ProseView: NSTextView {
  private let storage = NSTextStorage()

  init() {
    let manager = ProseLayoutManager()
    let container = NSTextContainer(size: NSSize(width: 0, height: CGFloat.greatestFiniteMagnitude))
    container.widthTracksTextView = true
    container.lineFragmentPadding = 0
    manager.addTextContainer(container)
    storage.addLayoutManager(manager)
    super.init(frame: .zero, textContainer: container)
    translatesAutoresizingMaskIntoConstraints = false
    isEditable = false
    isSelectable = true
    drawsBackground = false
    textContainerInset = .zero
    isVerticallyResizable = false
    isHorizontallyResizable = false
    clipsToBounds = true
    linkTextAttributes = [
      .foregroundColor: NSColor.nyte(.contentAccent, hue: .blue), .cursor: NSCursor.pointingHand,
    ]
    setContentHuggingPriority(.required, for: .vertical)
    setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  func show(_ text: NSAttributedString) {
    guard !storage.isEqual(to: text) else { return }
    storage.setAttributedString(text)
    invalidateIntrinsicContentSize()
  }

  var naturalWidth: CGFloat {
    ceil(storage.boundingRect(with: NSSize(width: 10_000, height: 10_000), options: [.usesLineFragmentOrigin]).width)
  }

  override var intrinsicContentSize: NSSize {
    guard let container = textContainer, let manager = layoutManager else { return super.intrinsicContentSize }
    manager.ensureLayout(for: container)
    return NSSize(width: NSView.noIntrinsicMetric, height: ceil(manager.usedRect(for: container).height))
  }

  override func setFrameSize(_ newSize: NSSize) {
    let changed = newSize.width != frame.width
    super.setFrameSize(newSize)
    if changed { invalidateIntrinsicContentSize() }
  }
}

final class CodeBlockView: AppearanceView {
  private let text = ProseView()
  private let language = NSTextField.nyteLabel("", .xs, .medium, .contentTertiary)
  private lazy var copy = GhostButton(
    symbol: "square.on.square", label: "Copy Code", size: .xs, target: self, action: #selector(copyCode(_:)))
  private var code = ""

  init() {
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false
    layer?.cornerRadius = NyteRadius.control.rawValue
    layer?.cornerCurve = .continuous
    let head = NSStackView.row(gap: .s2, [language, NSView.spacer(), copy])
    let column = NSStackView.column(gap: .s1, [head, text])
    addSubview(column)
    column.pin(to: self, insets: NyteInsets(top: .s1_5, leading: .s2_5, bottom: .s2, trailing: .s1_5))
    head.matchWidth(of: column)
    text.matchWidth(of: column)
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  func show(_ code: String, language name: String?) {
    self.code = code
    language.stringValue = name ?? "Code"
    let style = NSMutableParagraphStyle()
    style.lineSpacing = NyteSpace.s0_5.rawValue
    style.lineBreakMode = .byCharWrapping
    text.show(
      NSAttributedString(
        string: code,
        attributes: [.font: NSFont.nyteCode, .foregroundColor: NSColor.nyte(.contentPrimary), .paragraphStyle: style]))
  }

  @objc private func copyCode(_ sender: Any?) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(code, forType: .string)
    copy.setSymbol("checkmark")
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in self?.copy.setSymbol("square.on.square") }
  }

  override func applyColors() {
    layer?.backgroundColor = NyteRole.fillTertiary.cgColor(dark: isDark)
  }
}

final class DiagramBlockView: AppearanceView {
  private let diagram = MermaidView(frame: .zero)
  private let code = CodeBlockView()
  private lazy var toggle = GhostButton(
    symbol: "chevron.left.forwardslash.chevron.right", label: "Show the Source", size: .xs, target: self,
    action: #selector(flip(_:)))
  private var source = ""
  private var drawn = ""
  private var showsCode = false
  private var ratio: NSLayoutConstraint?
  private var natural: NSLayoutConstraint?
  private var settle: DispatchWorkItem?
  private var holder: NSView?

  init() {
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false
    layer?.cornerRadius = NyteRadius.control.rawValue
    layer?.cornerCurve = .continuous
    diagram.translatesAutoresizingMaskIntoConstraints = false
    for axis in [NSLayoutConstraint.Orientation.horizontal, .vertical] {
      diagram.setContentHuggingPriority(.init(1), for: axis)
      diagram.setContentCompressionResistancePriority(.init(1), for: axis)
    }
    let holder = NSView()
    holder.translatesAutoresizingMaskIntoConstraints = false
    holder.addSubview(diagram)
    self.holder = holder
    let column = NSStackView.column(gap: .none, [code, holder])
    for subview in [column, toggle] as [NSView] { addSubview(subview) }
    column.pin(to: self)
    code.matchWidth(of: column)
    holder.matchWidth(of: column)
    toggle.pin(to: self, insets: NyteInsets(top: .s1_5, trailing: .s1_5), edges: [.top, .trailing])
    let width = diagram.widthAnchor.constraint(equalToConstant: .zero)
    width.priority = .defaultHigh
    natural = width
    NSLayoutConstraint.activate([
      width,
      diagram.topAnchor.below(holder.topAnchor, .s4),
      diagram.bottomAnchor.above(holder.bottomAnchor, .s4),
      diagram.centerXAnchor.constraint(equalTo: holder.centerXAnchor),
      diagram.widthAnchor.constraint(lessThanOrEqualTo: holder.widthAnchor, constant: -NyteSpace.s4.rawValue * 2),
    ])
    let prepared = diagram.mermaidLayer.onPrepareComplete
    diagram.mermaidLayer.onPrepareComplete = { [weak self] in
      prepared?()
      self?.arrange()
    }
    arrange()
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  func show(_ next: String) {
    guard next != source else { return }
    source = next
    code.show(next, language: "mermaid")
    settle?.cancel()
    let work = DispatchWorkItem { [weak self] in
      guard let self else { return }
      self.drawn = self.source
      self.diagram.source = self.source
    }
    settle = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: work)
    arrange()
  }

  @objc private func flip(_ sender: Any?) {
    showsCode.toggle()
    arrange()
  }

  private var isDrawn: Bool {
    drawn == source && diagram.parseError == nil && diagram.diagramBounds.width > 1
  }

  private func arrange() {
    let bounds = diagram.diagramBounds
    if isDrawn {
      natural?.constant = bounds.width
      ratio?.isActive = false
      let next = diagram.heightAnchor.constraint(
        equalTo: diagram.widthAnchor, multiplier: bounds.height / bounds.width)
      next.isActive = true
      ratio = next
    }
    let diagramShown = isDrawn && !showsCode
    diagram.isHidden = !diagramShown
    holder?.isHidden = !diagramShown
    code.isHidden = diagramShown
    toggle.isHidden = !isDrawn
    toggle.isOn = showsCode
    toggle.toolTip = showsCode ? "Show the Diagram" : "Show the Source"
    applyColors()
  }

  override func applyColors() {
    layer?.backgroundColor = diagram.isHidden ? nil : NyteRole.fillTertiary.cgColor(dark: isDark)
    func color(_ role: NyteRole, hue: NyteHue? = nil) -> NSColor {
      NSColor(cgColor: role.cgColor(dark: isDark, hue: hue)) ?? .labelColor
    }
    let theme = DiagramTheme(
      background: color(.bgMuted), foreground: color(.contentPrimary), line: color(.contentTertiary),
      accent: color(.contentAccent, hue: .blue), muted: color(.contentSecondary), border: color(.strokeTertiary),
      font: .nyte(.sm), lineWidth: NyteSpace.px.rawValue, cornerRadius: NyteRadius.control.rawValue,
      transparent: true)
    if theme != diagram.theme { diagram.theme = theme }
    diagram.layer?.backgroundColor = nil
  }
}

final class MessageBody: NSStackView {
  private var shown: [MarkdownBlock] = []

  init() {
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false
    orientation = .vertical
    alignment = .leading
    spacing = NyteSpace.s2.rawValue
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  var onlyProse: ProseView? { arrangedSubviews.count == 1 ? arrangedSubviews.first as? ProseView : nil }

  func show(_ blocks: [MarkdownBlock]) {
    guard blocks != shown else { return }
    shown = blocks
    let views = arrangedSubviews
    for (index, block) in blocks.enumerated() {
      let old = index < views.count ? views[index] : nil
      let view: NSView
      switch block {
      case .prose(let text):
        let prose = old as? ProseView ?? ProseView()
        prose.show(text)
        view = prose
      case .code(let code, let language):
        let box = old as? CodeBlockView ?? CodeBlockView()
        box.show(code, language: language)
        view = box
      case .diagram(let source):
        let box = old as? DiagramBlockView ?? DiagramBlockView()
        box.show(source)
        view = box
      case .rule:
        view = old as? Hairline ?? Hairline()
      }
      if view !== old {
        old?.removeFromSuperview()
        insertArrangedSubview(view, at: index)
        view.matchWidth(of: self)
      }
    }
    for extra in arrangedSubviews.dropFirst(blocks.count) { extra.removeFromSuperview() }
  }
}
