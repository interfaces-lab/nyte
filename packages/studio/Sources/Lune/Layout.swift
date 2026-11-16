import CoreGraphics
import CoreText
import Foundation
import yoga

public struct TextLine: @unchecked Sendable {
  public let line: CTLine
  public let width: CGFloat
  public let baseline: CGFloat
}

public struct TextLayout: @unchecked Sendable {
  public let lines: [TextLine]
  public let size: CGSize
}

public final class LayoutBox: @unchecked Sendable {
  public let node: Node
  public let style: Style
  public let mode: ThemeMode
  public let children: [LayoutBox]
  public fileprivate(set) var frame: CGRect = .zero
  public fileprivate(set) var text: TextLayout?

  init(node: Node, style: Style, mode: ThemeMode, children: [LayoutBox]) {
    self.node = node
    self.style = style
    self.mode = mode
    self.children = children
  }
}

public struct LayoutEnvironment: Sendable {
  public var image: @Sendable (String) -> CGImage?

  public init(image: @escaping @Sendable (String) -> CGImage? = { _ in nil }) {
    self.image = image
  }
}

public struct FrameLayout: Sendable {
  public let root: LayoutBox
  public let origin: CGPoint
  public var size: CGSize { root.frame.size }
  public var rect: CGRect { CGRect(origin: origin, size: root.frame.size) }
}

extension Project {
  public func layout(
    _ sheet: Sheet, mode: ThemeMode, environment: LayoutEnvironment = LayoutEnvironment()
  ) -> [FrameLayout] {
    var builder = BoxBuilder(project: self)
    return sheet.frames.map { frame in
      let box = builder.build(frame, mode: mode)
      FlexLayout(environment: environment).run(box)
      let origin = CGPoint(
        x: box.style.x?.resolve(nil) ?? 0, y: box.style.y?.resolve(nil) ?? 0)
      return FrameLayout(root: box, origin: origin)
    }
  }
}

private struct BoxBuilder {
  let project: Project
  var scopes: [String: Scope] = [:]

  init(project: Project) {
    self.project = project
  }

  mutating func build(_ node: Node, mode inherited: ThemeMode) -> LayoutBox {
    let mode = node.attributes["theme"].flatMap(ThemeMode.init(rawValue:)) ?? inherited
    if scopes[node.scopeFile] == nil { scopes[node.scopeFile] = project.scope(of: node.scopeFile) }
    let style = Style(node: node, scope: scopes[node.scopeFile] ?? Scope(), mode: mode)
    let children = node.children.map { build($0, mode: mode) }.filter { !$0.style.hidden }
    return LayoutBox(node: node, style: style, mode: mode, children: children)
  }
}

private struct FlexLayout {
  let environment: LayoutEnvironment

  private enum Parent {
    case row
    case column
    case layered
  }

  func run(_ root: LayoutBox) {
    let config = YGConfigNew()
    defer { YGConfigFree(config) }
    YGConfigSetPointScaleFactor(config, 1)

    let node = make(root, in: nil, config: config)
    defer { YGNodeFreeRecursive(node) }
    YGNodeCalculateLayout(node, .nan, .nan, .LTR)
    read(node, into: root)
    root.frame.origin = .zero
  }

  private func kind(of box: LayoutBox) -> Parent {
    switch box.node.kind {
    case .row: return .row
    case .box: return .layered
    case .frame:
      switch box.node.attributes["layout"] {
      case "row": return .row
      case "box": return .layered
      default: return .column
      }
    default: return .column
    }
  }

  private func make(_ box: LayoutBox, in parent: Parent?, config: YGConfigRef?) -> YGNodeRef? {
    let node = YGNodeNewWithConfig(config)
    let style = box.style
    YGNodeSetContext(node, Unmanaged.passUnretained(box).toOpaque())

    let absolute = parent == .layered || (parent != nil && style.isAbsolute)
    if absolute {
      YGNodeStyleSetPositionType(node, .absolute)
      if let x = style.x { setInset(node, .left, x) }
      if let y = style.y { setInset(node, .top, y) }
    }
    size(node, style.width, horizontal: true, in: parent, absolute: absolute, offset: style.x)
    size(node, style.height, horizontal: false, in: parent, absolute: absolute, offset: style.y)
    if let own = style.selfAlign, !absolute { YGNodeStyleSetAlignSelf(node, align(own)) }

    switch box.node.kind {
    case .text:
      YGNodeSetNodeType(node, .text)
      YGNodeSetMeasureFunc(node, measureText)
      YGNodeStyleSetFlexShrink(node, 1)

    case .icon:
      if style.width == .hug { YGNodeStyleSetWidth(node, Float(style.symbolSize)) }
      if style.height == .hug { YGNodeStyleSetHeight(node, Float(style.symbolSize)) }

    case .image:
      var natural = CGSize(width: 64, height: 64)
      if let source = style.source,
        let image = environment.image(resolvePath(source, from: box.node.definition.file))
      {
        natural = CGSize(width: image.width, height: image.height)
      }
      if style.width == .hug, style.height == .hug {
        YGNodeStyleSetWidth(node, Float(natural.width))
        YGNodeStyleSetHeight(node, Float(natural.height))
      } else if natural.height > 0, style.width == .hug || style.height == .hug {
        YGNodeStyleSetAspectRatio(node, Float(natural.width / natural.height))
      }

    case .ellipse:
      break

    case .frame, .col, .row, .box:
      let own = kind(of: box)
      YGNodeStyleSetFlexDirection(node, own == .row ? .row : .column)
      YGNodeStyleSetPadding(node, .top, Float(style.padding.top))
      YGNodeStyleSetPadding(node, .right, Float(style.padding.right))
      YGNodeStyleSetPadding(node, .bottom, Float(style.padding.bottom))
      YGNodeStyleSetPadding(node, .left, Float(style.padding.left))
      YGNodeStyleSetGap(node, .all, Float(style.gap))
      if box.node.attributes["wrap"] != nil, own == .row { YGNodeStyleSetFlexWrap(node, .wrap) }
      YGNodeStyleSetAlignItems(node, align(style.align))

      if own == .layered {
        // Yoga places an absolute child that names no inset by its parent's alignment,
        // which is how a layered child without `x` or `y` finds its place.
        YGNodeStyleSetJustifyContent(node, justify(style.alignVertical))
      } else {
        switch style.justify {
        case .start: YGNodeStyleSetJustifyContent(node, .flexStart)
        case .center: YGNodeStyleSetJustifyContent(node, .center)
        case .end: YGNodeStyleSetJustifyContent(node, .flexEnd)
        case .between: YGNodeStyleSetJustifyContent(node, .spaceBetween)
        }
      }

      let fits = own == .layered && (style.width == .hug || style.height == .hug)
      var fitted = CGSize.zero
      for (index, child) in box.children.enumerated() {
        let made = make(child, in: own, config: config)
        if fits {
          // Flexbox sizes nothing by an absolute child, so measure each on its own first.
          YGNodeCalculateLayout(made, .nan, .nan, .LTR)
          fitted.width = max(
            fitted.width, CGFloat(YGNodeLayoutGetWidth(made)) + (child.style.x?.resolve(nil) ?? 0))
          fitted.height = max(
            fitted.height, CGFloat(YGNodeLayoutGetHeight(made)) + (child.style.y?.resolve(nil) ?? 0))
        }
        YGNodeInsertChild(node, made, index)
      }
      if fits, style.width == .hug {
        YGNodeStyleSetMinWidth(node, Float(fitted.width + style.padding.horizontal))
      }
      if fits, style.height == .hug {
        YGNodeStyleSetMinHeight(node, Float(fitted.height + style.padding.vertical))
      }
    }

    if let value = number(box, "min-w") { YGNodeStyleSetMinWidth(node, value) }
    if let value = number(box, "max-w") { YGNodeStyleSetMaxWidth(node, value) }
    if let value = number(box, "min-h") { YGNodeStyleSetMinHeight(node, value) }
    if let value = number(box, "max-h") { YGNodeStyleSetMaxHeight(node, value) }
    return node
  }

  private func size(
    _ node: YGNodeRef?, _ dimension: Dimension, horizontal: Bool, in parent: Parent?, absolute: Bool,
    offset: Offset?
  ) {
    switch dimension {
    case .points(let value):
      horizontal ? YGNodeStyleSetWidth(node, Float(value)) : YGNodeStyleSetHeight(node, Float(value))
    case .percent(let value):
      horizontal
        ? YGNodeStyleSetWidthPercent(node, Float(value)) : YGNodeStyleSetHeightPercent(node, Float(value))
    case .hug:
      break
    case .fill:
      if absolute {
        if offset == nil { YGNodeStyleSetPosition(node, horizontal ? .left : .top, 0) }
        YGNodeStyleSetPosition(node, horizontal ? .right : .bottom, 0)
      } else if let parent, (parent == .row) == horizontal {
        YGNodeStyleSetFlexGrow(node, 1)
        YGNodeStyleSetFlexShrink(node, 1)
        YGNodeStyleSetFlexBasis(node, 0)
      } else {
        YGNodeStyleSetAlignSelf(node, .stretch)
      }
    }
  }

  private func setInset(_ node: YGNodeRef?, _ edge: YGEdge, _ offset: Offset) {
    switch offset {
    case .points(let value): YGNodeStyleSetPosition(node, edge, Float(value))
    case .percent(let value): YGNodeStyleSetPositionPercent(node, edge, Float(value))
    }
  }

  private func align(_ alignment: Alignment) -> YGAlign {
    switch alignment {
    case .start: return .flexStart
    case .center: return .center
    case .end: return .flexEnd
    case .stretch: return .stretch
    }
  }

  private func justify(_ alignment: Alignment) -> YGJustify {
    switch alignment {
    case .start, .stretch: return .flexStart
    case .center: return .center
    case .end: return .flexEnd
    }
  }

  private func number(_ box: LayoutBox, _ name: String) -> Float? {
    box.node.attributes[name].flatMap(parseNumber).map { Float($0) }
  }

  private func read(_ node: YGNodeRef?, into box: LayoutBox) {
    box.frame = CGRect(
      x: CGFloat(YGNodeLayoutGetLeft(node)), y: CGFloat(YGNodeLayoutGetTop(node)),
      width: CGFloat(YGNodeLayoutGetWidth(node)), height: CGFloat(YGNodeLayoutGetHeight(node)))
    if box.node.kind == .text {
      box.text = layoutText(box.node.text ?? "", style: box.style, maxWidth: box.frame.width)
    }
    for (index, child) in box.children.enumerated() {
      read(YGNodeGetChild(node, index), into: child)
    }
  }
}

private func measureText(
  _ node: YGNodeConstRef?, _ width: Float, _ widthMode: YGMeasureMode, _ height: Float,
  _ heightMode: YGMeasureMode
) -> YGSize {
  guard let context = YGNodeGetContext(node) else { return YGSize(width: 0, height: 0) }
  let box = Unmanaged<LayoutBox>.fromOpaque(context).takeUnretainedValue()
  let limit: CGFloat? = widthMode == .undefined ? nil : CGFloat(width)
  let text = layoutText(box.node.text ?? "", style: box.style, maxWidth: limit)
  return YGSize(
    width: widthMode == .exactly ? width : Float(text.size.width), height: Float(text.size.height))
}

func layoutText(_ string: String, style: Style, maxWidth: CGFloat?) -> TextLayout {
  let font = FontBook.shared.font(
    family: style.fontFamily, size: style.fontSize, weight: style.fontWeight, italic: style.italic)
  let ascent = CTFontGetAscent(font)
  let descent = CTFontGetDescent(font)
  let lineHeight = style.leading ?? (ascent + descent + CTFontGetLeading(font)).rounded(.up)

  let attributes: [NSAttributedString.Key: Any] = [
    NSAttributedString.Key(kCTFontAttributeName as String): font,
    NSAttributedString.Key(kCTForegroundColorAttributeName as String): style.color.cgColor,
    NSAttributedString.Key(kCTKernAttributeName as String): style.tracking,
  ]
  let attributed = NSAttributedString(string: string, attributes: attributes)
  let typesetter = CTTypesetterCreateWithAttributedString(attributed)
  let length = attributed.length
  let wrap = Double(maxWidth ?? .greatestFiniteMagnitude)

  var lines: [TextLine] = []
  var start = 0
  var widest: CGFloat = 0
  while start < length {
    let last = style.maxLines.map { lines.count == $0 - 1 } ?? false
    var count = CTTypesetterSuggestLineBreak(typesetter, start, wrap)
    if count <= 0 { count = 1 }
    var line = CTTypesetterCreateLine(typesetter, CFRange(location: start, length: count))

    if last, start + count < length, let limit = maxWidth {
      let rest = CTTypesetterCreateLine(typesetter, CFRange(location: start, length: length - start))
      let ellipsis = CTLineCreateWithAttributedString(
        NSAttributedString(string: "…", attributes: attributes))
      line = CTLineCreateTruncatedLine(rest, Double(limit), .end, ellipsis) ?? line
      count = length - start
    }

    let width = CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
      - CGFloat(CTLineGetTrailingWhitespaceWidth(line))
    let top = CGFloat(lines.count) * lineHeight
    let baseline = top + (lineHeight - (ascent + descent)) / 2 + ascent
    lines.append(TextLine(line: line, width: width, baseline: baseline))
    widest = max(widest, width)
    start += count
  }

  let height = CGFloat(max(lines.count, 1)) * lineHeight
  return TextLayout(lines: lines, size: CGSize(width: widest.rounded(.up), height: height))
}
