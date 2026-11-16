import AppKit

extension NyteRole {
  public func components(dark: Bool, hue: NyteHue? = nil) -> (red: CGFloat, green: CGFloat, blue: CGFloat, alpha: CGFloat) {
    let pair = hue.flatMap { NytePalette.hues[$0]?[self] } ?? NytePalette.base[self] ?? (0, 0)
    let value = dark ? pair.dark : pair.light
    return (
      CGFloat((value >> 24) & 0xff) / 255, CGFloat((value >> 16) & 0xff) / 255,
      CGFloat((value >> 8) & 0xff) / 255, CGFloat(value & 0xff) / 255
    )
  }

  public func color(hue: NyteHue? = nil) -> NSColor {
    NSColor(name: nil) { appearance in
      let c = components(dark: appearance.isDark, hue: hue)
      return NSColor(srgbRed: c.red, green: c.green, blue: c.blue, alpha: c.alpha)
    }
  }

  public func cgColor(dark: Bool, hue: NyteHue? = nil) -> CGColor {
    let c = components(dark: dark, hue: hue)
    return CGColor(srgbRed: c.red, green: c.green, blue: c.blue, alpha: c.alpha)
  }
}

extension NSColor {
  public static func nyte(_ role: NyteRole, hue: NyteHue? = nil) -> NSColor {
    role.color(hue: hue)
  }
}

extension NSAppearance {
  public var isDark: Bool {
    bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
  }
}

public enum NyteText: Sendable {
  case xs, sm, base, lg, xl, xxl

  public var size: CGFloat {
    switch self {
    case .xs: return 11
    case .sm: return 12
    case .base: return 13
    case .lg: return 15
    case .xl: return 19
    case .xxl: return 24
    }
  }

  public var lineHeight: CGFloat {
    switch self {
    case .xs: return 14
    case .sm: return 16
    case .base: return 18
    case .lg, .xl: return 24
    case .xxl: return 32
    }
  }
}

extension NSFont {
  public static func nyte(_ style: NyteText, _ weight: NSFont.Weight = .regular) -> NSFont {
    .systemFont(ofSize: style.size, weight: weight)
  }

  public static var nyteCode: NSFont {
    .monospacedSystemFont(ofSize: 12, weight: .regular)
  }
}

public enum NyteSpace: CGFloat, CaseIterable, Sendable {
  case none = 0
  case px = 1
  case s0_5 = 2
  case s1 = 4
  case s1_5 = 6
  case s2 = 8
  case s2_5 = 10
  case s3 = 12
  case s4 = 16
  case s5 = 20
  case s6 = 24
  case s8 = 32
}

public enum NyteControl: CGFloat, CaseIterable, Sendable {
  case xxs = 16
  case xs = 20
  case sm = 24
  case md = 28
  case lg = 32
  case xl = 36

  public var cornerRadius: CGFloat {
    switch self {
    case .xxs, .xs: return 4
    case .sm: return 6
    case .md, .lg: return 8
    case .xl: return 10
    }
  }

  public var glyph: NyteGlyph {
    switch self {
    case .xxs: return .xxs
    case .xs: return .xs
    case .sm: return .sm
    case .md, .lg: return .md
    case .xl: return .lg
    }
  }

  public var system: NSControl.ControlSize {
    switch self {
    case .xxs: return .mini
    case .xs: return .small
    case .sm: return .regular
    case .md, .lg: return .large
    case .xl: return .extraLarge
    }
  }
}

public enum NyteRadius: CGFloat, CaseIterable, Sendable {
  case indicator = 4
  case control = 8
  case card = 12
  case surface = 16
}

public enum NyteGlyph: CGFloat, CaseIterable, Sendable {
  case xxs = 10
  case xs = 12
  case sm = 14
  case md = 16
  case lg = 20

  public var pointSize: CGFloat { rawValue * 13 / 16 }
}

public enum NyteDuration: Double, CaseIterable, Sendable {
  case instant = 0.05
  case fast = 0.1
  case normal = 0.15
  case slow = 0.2
}

public enum NyteMotion {
  public static var outQuint: CAMediaTimingFunction { CAMediaTimingFunction(controlPoints: 0.16, 1, 0.3, 1) }

  public static var reduced: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

  @MainActor
  public static func fade(
    _ view: NSView, to alpha: CGFloat, _ duration: NyteDuration, from start: CGFloat? = nil,
    completion: (() -> Void)? = nil
  ) {
    guard let layer = view.layer else {
      view.alphaValue = alpha
      completion?()
      return
    }
    let shown = start.map(Float.init) ?? layer.presentation()?.opacity ?? layer.opacity
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    CATransaction.setCompletionBlock(completion)
    view.alphaValue = alpha
    let animation = CABasicAnimation(keyPath: "opacity")
    animation.fromValue = shown
    animation.toValue = Float(alpha)
    animation.duration = duration.rawValue
    animation.timingFunction = outQuint
    layer.add(animation, forKey: "nyte.fade")
    CATransaction.commit()
  }

  @MainActor
  public static func show(_ view: NSView, _ shown: Bool, enter: NyteDuration = .slow, exit: NyteDuration = .normal) {
    if shown {
      let hidden = view.isHidden
      if hidden {
        view.alphaValue = 0
        view.isHidden = false
      }
      fade(view, to: 1, enter, from: hidden ? 0 : nil)
    } else if !view.isHidden {
      fade(view, to: 0, exit) { [weak view] in
        if let view, view.alphaValue == 0 { view.isHidden = true }
      }
    }
  }
}

public struct NyteSpring: Sendable {
  public static let travel = NyteSpring(stiffness: 520, damping: 46)

  public let stiffness: Double
  public let damping: Double

  public init(stiffness: Double, damping: Double) {
    self.stiffness = stiffness
    self.damping = damping
  }

  public func state(offset: Double, velocity: Double, after time: Double) -> (offset: Double, velocity: Double) {
    let omega = stiffness.squareRoot()
    let zeta = damping / (2 * omega)
    if abs(zeta - 1) < 1e-6 {
      let b = velocity + omega * offset
      let decay = exp(-omega * time)
      return ((offset + b * time) * decay, (b - omega * (offset + b * time)) * decay)
    }
    if zeta > 1 {
      let root = omega * (zeta * zeta - 1).squareRoot()
      let slow = -omega * zeta + root
      let fast = -omega * zeta - root
      let a = (velocity - fast * offset) / (slow - fast)
      let b = offset - a
      return (a * exp(slow * time) + b * exp(fast * time), a * slow * exp(slow * time) + b * fast * exp(fast * time))
    }
    let damped = omega * (1 - zeta * zeta).squareRoot()
    let b = (velocity + zeta * omega * offset) / damped
    let decay = exp(-zeta * omega * time)
    let cosine = cos(damped * time)
    let sine = sin(damped * time)
    return (
      decay * (offset * cosine + b * sine),
      decay * ((b * damped - zeta * omega * offset) * cosine - (offset * damped + zeta * omega * b) * sine)
    )
  }
}
