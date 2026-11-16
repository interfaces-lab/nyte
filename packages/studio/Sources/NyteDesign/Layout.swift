import AppKit

public struct NyteInsets: Sendable {
  public var top: NyteSpace
  public var leading: NyteSpace
  public var bottom: NyteSpace
  public var trailing: NyteSpace

  public init(top: NyteSpace = .none, leading: NyteSpace = .none, bottom: NyteSpace = .none, trailing: NyteSpace = .none) {
    self.top = top
    self.leading = leading
    self.bottom = bottom
    self.trailing = trailing
  }

  public init(horizontal: NyteSpace = .none, vertical: NyteSpace = .none) {
    self.init(top: vertical, leading: horizontal, bottom: vertical, trailing: horizontal)
  }

  public static let zero = NyteInsets()

  public static func all(_ space: NyteSpace) -> NyteInsets {
    NyteInsets(horizontal: space, vertical: space)
  }
}

public struct NyteEdges: OptionSet, Sendable {
  public let rawValue: Int

  public init(rawValue: Int) {
    self.rawValue = rawValue
  }

  public static let top = NyteEdges(rawValue: 1)
  public static let leading = NyteEdges(rawValue: 2)
  public static let bottom = NyteEdges(rawValue: 4)
  public static let trailing = NyteEdges(rawValue: 8)
  public static let horizontal: NyteEdges = [.leading, .trailing]
  public static let vertical: NyteEdges = [.top, .bottom]
  public static let all: NyteEdges = [.top, .leading, .bottom, .trailing]
}

@MainActor
public protocol NyteBox {
  var leadingAnchor: NSLayoutXAxisAnchor { get }
  var trailingAnchor: NSLayoutXAxisAnchor { get }
  var topAnchor: NSLayoutYAxisAnchor { get }
  var bottomAnchor: NSLayoutYAxisAnchor { get }
}

extension NSView: NyteBox {}
extension NSLayoutGuide: NyteBox {}

extension NSView {
  public func pin(to box: NyteBox, insets: NyteInsets = .zero, edges: NyteEdges = .all) {
    translatesAutoresizingMaskIntoConstraints = false
    var constraints: [NSLayoutConstraint] = []
    if edges.contains(.leading) {
      constraints.append(leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: insets.leading.rawValue))
    }
    if edges.contains(.trailing) {
      constraints.append(trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -insets.trailing.rawValue))
    }
    if edges.contains(.top) {
      constraints.append(topAnchor.constraint(equalTo: box.topAnchor, constant: insets.top.rawValue))
    }
    if edges.contains(.bottom) {
      constraints.append(bottomAnchor.constraint(equalTo: box.bottomAnchor, constant: -insets.bottom.rawValue))
    }
    NSLayoutConstraint.activate(constraints)
  }

  public func height(_ control: NyteControl) {
    translatesAutoresizingMaskIntoConstraints = false
    heightAnchor.constraint(equalToConstant: control.rawValue).isActive = true
  }

  public func square(_ control: NyteControl) {
    translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      widthAnchor.constraint(equalToConstant: control.rawValue),
      heightAnchor.constraint(equalToConstant: control.rawValue),
    ])
  }

  public func square(_ glyph: NyteGlyph) {
    translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      widthAnchor.constraint(equalToConstant: glyph.rawValue),
      heightAnchor.constraint(equalToConstant: glyph.rawValue),
    ])
  }

  public func square(_ metric: NyteMetric) {
    translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      widthAnchor.constraint(equalToConstant: metric.rawValue),
      heightAnchor.constraint(equalToConstant: metric.rawValue),
    ])
  }

  public func width(_ metric: NyteMetric, priority: NSLayoutConstraint.Priority = .required) {
    translatesAutoresizingMaskIntoConstraints = false
    let constraint = widthAnchor.constraint(equalToConstant: metric.rawValue)
    constraint.priority = priority
    constraint.isActive = true
  }

  public func matchWidth(of other: NSView, inset: NyteSpace = .none) {
    widthAnchor.constraint(equalTo: other.widthAnchor, constant: -2 * inset.rawValue).isActive = true
  }

  public func fitWidth(in box: NSView, margin: NyteSpace) {
    widthAnchor.constraint(lessThanOrEqualTo: box.widthAnchor, constant: -2 * margin.rawValue).isActive = true
  }
}

extension NSLayoutYAxisAnchor {
  public func below(_ other: NSLayoutYAxisAnchor, _ space: NyteSpace = .none) -> NSLayoutConstraint {
    constraint(equalTo: other, constant: space.rawValue)
  }

  public func above(_ other: NSLayoutYAxisAnchor, _ space: NyteSpace = .none) -> NSLayoutConstraint {
    constraint(equalTo: other, constant: -space.rawValue)
  }
}

extension NSLayoutXAxisAnchor {
  public func after(_ other: NSLayoutXAxisAnchor, _ space: NyteSpace = .none) -> NSLayoutConstraint {
    constraint(equalTo: other, constant: space.rawValue)
  }

  public func before(_ other: NSLayoutXAxisAnchor, _ space: NyteSpace = .none) -> NSLayoutConstraint {
    constraint(equalTo: other, constant: -space.rawValue)
  }

  public func atLeastBefore(_ other: NSLayoutXAxisAnchor, _ space: NyteSpace = .none) -> NSLayoutConstraint {
    constraint(lessThanOrEqualTo: other, constant: -space.rawValue)
  }
}

extension NSStackView {
  public static func row(
    gap: NyteSpace, align: NSLayoutConstraint.Attribute = .centerY, _ views: [NSView]
  ) -> NSStackView {
    let stack = NSStackView(views: views)
    stack.orientation = .horizontal
    stack.alignment = align
    stack.spacing = gap.rawValue
    stack.translatesAutoresizingMaskIntoConstraints = false
    return stack
  }

  public static func column(
    gap: NyteSpace, align: NSLayoutConstraint.Attribute = .leading, _ views: [NSView] = []
  ) -> NSStackView {
    let stack = NSStackView(views: views)
    stack.orientation = .vertical
    stack.alignment = align
    stack.spacing = gap.rawValue
    stack.translatesAutoresizingMaskIntoConstraints = false
    return stack
  }

  public func add(_ view: NSView, gapAfter: NyteSpace? = nil) {
    addArrangedSubview(view)
    if let gapAfter { setCustomSpacing(gapAfter.rawValue, after: view) }
  }

  public func gapAfterLast(_ space: NyteSpace) {
    if let last = arrangedSubviews.last { setCustomSpacing(space.rawValue, after: last) }
  }

  public func pad(_ insets: NyteInsets) {
    edgeInsets = NSEdgeInsets(
      top: insets.top.rawValue, left: insets.leading.rawValue, bottom: insets.bottom.rawValue,
      right: insets.trailing.rawValue)
  }
}

extension NSView {
  public static func spacer() -> NSView {
    let view = NSView()
    view.translatesAutoresizingMaskIntoConstraints = false
    view.setContentHuggingPriority(.init(1), for: .horizontal)
    view.setContentCompressionResistancePriority(.init(1), for: .horizontal)
    return view
  }
}

public struct NyteMetric: Sendable {
  public let rawValue: CGFloat

  private init(_ points: CGFloat) {
    rawValue = points
  }

  public static let sidebarMin = NyteMetric(208)
  public static let sidebarMax = NyteMetric(340)
  public static let inspectorMin = NyteMetric(264)
  public static let inspectorMax = NyteMetric(400)
  public static let composer = NyteMetric(560)
  public static let valueChip = NyteMetric(64)
  public static let picker = NyteMetric(460)
  public static let agentPanel = NyteMetric(320)
  public static let hero = NyteMetric(48)
  public static let canvasMin = NyteMetric(420)
  public static let windowMinWidth = NyteMetric(1080)
  public static let windowMinHeight = NyteMetric(580)
  public static let windowWidth = NyteMetric(1440)
  public static let windowHeight = NyteMetric(900)
  public static let emptyLine = NyteMetric(320)
  public static let lightsZoneWidth = NyteMetric(96)
  public static let lightsZoneHeight = NyteMetric(44)
}
