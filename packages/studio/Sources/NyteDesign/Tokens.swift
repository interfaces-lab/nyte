import AppKit

// The Nyte design language in AppKit. Colours come from the generated role table; the scales
// below mirror the type, space, control and motion tokens of @nyte-ai/ui.

extension NyteRole {
  /// The role's colour for an appearance, as sRGB components.
  public func components(dark: Bool, hue: NyteHue? = nil) -> (red: CGFloat, green: CGFloat, blue: CGFloat, alpha: CGFloat) {
    let pair = hue.flatMap { NytePalette.hues[$0]?[self] } ?? NytePalette.base[self] ?? (0, 0)
    let value = dark ? pair.dark : pair.light
    return (
      CGFloat((value >> 24) & 0xff) / 255, CGFloat((value >> 16) & 0xff) / 255,
      CGFloat((value >> 8) & 0xff) / 255, CGFloat(value & 0xff) / 255
    )
  }

  /// A colour that follows the appearance it is drawn in.
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

/// A step of the type scale. Chrome is set in the system font, which Nyte offers beside Inter
/// and which native controls draw in anyway; designs on the canvas default to Inter.
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

  public static func nyteMono(_ size: CGFloat = 11) -> NSFont {
    .monospacedSystemFont(ofSize: size, weight: .regular)
  }
}

public enum NyteSpace {
  public static let s1: CGFloat = 4
  public static let s2: CGFloat = 8
  public static let s3: CGFloat = 12
  public static let s4: CGFloat = 16
  public static let s5: CGFloat = 20
  public static let s6: CGFloat = 24
}

public enum NyteControl {
  public static let xs: CGFloat = 20
  public static let sm: CGFloat = 24
  public static let md: CGFloat = 28
  public static let lg: CGFloat = 32
}

public enum NyteRadius {
  public static let xs: CGFloat = 4
  public static let sm: CGFloat = 6
  public static let md: CGFloat = 8
  public static let lg: CGFloat = 10
  public static let panel: CGFloat = 16
}

public enum NyteMotion {
  public static let instant = 0.05
  public static let fast = 0.1
  public static let normal = 0.15
  public static let slow = 0.2

  /// `--nyte-easing-out-quint`: fast off the mark, long settle.
  public static let outQuint = CAMediaTimingFunction(controlPoints: 0.16, 1, 0.3, 1)

  /// Whether the person asked the system for less motion. Things then cut or fade in place.
  public static var reduced: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

  /// Runs an animation group with Nyte's curve, or applies the change at once under Reduce Motion.
  public static func animate(_ duration: Double = normal, _ changes: () -> Void, completion: (() -> Void)? = nil) {
    NSAnimationContext.runAnimationGroup { context in
      context.duration = reduced ? 0 : duration
      context.timingFunction = outQuint
      context.allowsImplicitAnimation = true
      changes()
    } completionHandler: {
      completion?()
    }
  }
}

/// A critically damped spring for things that travel: it arrives without overshoot and never
/// looks like it is easing to a stop. Mass 1, stiffness 520, damping 46.
public struct NyteSpring: Sendable {
  public static let travel = NyteSpring(stiffness: 520, damping: 46)

  public let stiffness: Double
  public let damping: Double

  /// How far along the way from 0 to 1 the spring is after `time` seconds, released at rest.
  public func progress(at time: Double) -> Double {
    let omega = stiffness.squareRoot()
    let zeta = damping / (2 * omega)
    if zeta >= 1 {
      return 1 - (1 + omega * time) * exp(-omega * time)
    }
    let damped = omega * (1 - zeta * zeta).squareRoot()
    let decay = exp(-zeta * omega * time)
    return 1 - decay * (cos(damped * time) + (zeta * omega / damped) * sin(damped * time))
  }

  /// When the spring is within a thousandth of its target.
  public var settling: Double {
    let omega = stiffness.squareRoot()
    return 9.2 / (min(1, damping / (2 * omega)) * omega)
  }
}
