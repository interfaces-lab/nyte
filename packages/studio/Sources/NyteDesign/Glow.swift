import AppKit

public enum NyteMoon {
  public static let rim = CGColor(srgbRed: 0.757, green: 0.816, blue: 0.965, alpha: 1)
  public static let body = CGColor(srgbRed: 0.392, green: 0.498, blue: 0.796, alpha: 1)
  public static let light = CGColor(srgbRed: 1, green: 0.976, blue: 0.847, alpha: 1)

  static func glow(dark: Bool) -> [CGColor] {
    dark
      ? [
        CGColor(srgbRed: 0.25, green: 0.45, blue: 1, alpha: 1),
        CGColor(srgbRed: 0.6, green: 0.42, blue: 1, alpha: 1),
        CGColor(srgbRed: 1, green: 0.5, blue: 0.72, alpha: 1),
        CGColor(srgbRed: 1, green: 0.76, blue: 0.6, alpha: 1),
      ]
      : [
        CGColor(srgbRed: 0.2, green: 0.36, blue: 0.98, alpha: 1),
        CGColor(srgbRed: 0.5, green: 0.36, blue: 0.98, alpha: 1),
        CGColor(srgbRed: 0.9, green: 0.4, blue: 0.8, alpha: 1),
        CGColor(srgbRed: 0.99, green: 0.6, blue: 0.42, alpha: 1),
      ]
  }
}

public final class GlowLayer: CALayer {
  private let bloom = CALayer()
  private let bloomLight = CAGradientLayer()
  private let sweep = CAGradientLayer()
  private let bloomShape = CALayer()
  private let near = CALayer()
  private let far = CALayer()
  private let core = CAGradientLayer()
  private let coreShape = CALayer()
  private let halo = CALayer()
  private let line = CAShapeLayer()
  private var turning = false

  public static let reach: CGFloat = 96
  private static let lineWidth: CGFloat = 1.5
  private static let halo = (band: NyteSpace.s1.rawValue, blur: NyteSpace.s1_5.rawValue)
  private static let near = (band: NyteSpace.s6.rawValue, blur: NyteSpace.s4.rawValue)
  private static let far = (band: NyteSpace.s8.rawValue, blur: CGFloat(40))

  public static let rise: CFTimeInterval = 0.4
  public static let fall: CFTimeInterval = 0.6
  public static let linger: TimeInterval = 1.5
  private static let lap: CFTimeInterval = 6

  public override init() {
    super.init()
    for light in [bloomLight, core] {
      light.startPoint = CGPoint(x: 0, y: 0)
      light.endPoint = CGPoint(x: 1, y: 1)
      light.locations = [0, 0.36, 0.7, 1]
    }
    let opaque = CGColor(gray: 0, alpha: 1)
    for (shape, blur) in [(halo, GlowLayer.halo.blur), (near, GlowLayer.near.blur), (far, GlowLayer.far.blur)] {
      shape.shadowColor = opaque
      shape.shadowOffset = .zero
      shape.shadowRadius = blur
      shape.shadowOpacity = 1
    }
    line.fillColor = nil
    line.strokeColor = opaque
    line.lineWidth = GlowLayer.lineWidth

    sweep.type = .conic
    sweep.startPoint = CGPoint(x: 0.5, y: 0.5)
    sweep.endPoint = CGPoint(x: 0.5, y: 0)
    bloomLight.mask = sweep
    bloom.addSublayer(bloomLight)
    bloomShape.addSublayer(far)
    bloomShape.addSublayer(near)
    bloom.mask = bloomShape
    coreShape.addSublayer(halo)
    coreShape.addSublayer(line)
    core.mask = coreShape
    addSublayer(bloom)
    addSublayer(core)
    tone(dark: true)
    sweep(moving: false)
  }

  public required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  public override init(layer: Any) {
    super.init(layer: layer)
  }

  public func tone(dark: Bool) {
    let colours = NyteMoon.glow(dark: dark)
    bloomLight.colors = colours
    core.colors = colours
    bloom.opacity = dark ? 0.9 : 0.6
  }

  public func surround(_ rect: CGRect, radius: CGFloat) {
    let reach = GlowLayer.reach
    frame = rect.insetBy(dx: -reach, dy: -reach)
    let corner = min(radius, min(rect.width, rect.height) / 2)
    let edge = CGRect(x: reach, y: reach, width: rect.width, height: rect.height)
    let path = CGPath(roundedRect: edge, cornerWidth: corner, cornerHeight: corner, transform: nil)
    let half = GlowLayer.lineWidth / 2
    line.path = CGPath(
      roundedRect: edge.insetBy(dx: -half, dy: -half), cornerWidth: corner + half, cornerHeight: corner + half,
      transform: nil)
    for (shape, band) in [(halo, GlowLayer.halo.band), (near, GlowLayer.near.band), (far, GlowLayer.far.band)] {
      shape.shadowPath = path.copy(strokingWithWidth: band, lineCap: .round, lineJoin: .round, miterLimit: 1)
    }
    for part in [bloom, bloomLight, bloomShape, near, far, core, coreShape, halo, line] as [CALayer] {
      part.frame = bounds
    }
    let side = hypot(bounds.width, bounds.height)
    sweep.bounds = CGRect(x: 0, y: 0, width: side, height: side)
    sweep.position = CGPoint(x: bounds.midX, y: bounds.midY)
  }

  public func turn(_ on: Bool) {
    let moving = on && !NyteMotion.reduced
    guard moving != turning else { return }
    turning = moving
    sweep(moving: moving)
    guard moving else {
      sweep.removeAnimation(forKey: "turn")
      return
    }
    let turn = CABasicAnimation(keyPath: "transform.rotation.z")
    turn.fromValue = 0
    turn.toValue = -2 * Double.pi
    turn.duration = GlowLayer.lap
    turn.repeatCount = .infinity
    turn.timingFunction = CAMediaTimingFunction(name: .linear)
    sweep.add(turn, forKey: "turn")
  }

  public func rise() {
    fade(to: 1, over: GlowLayer.rise, completion: nil)
  }

  public func fall(then completion: @escaping () -> Void) {
    fade(to: 0, over: GlowLayer.fall, completion: completion)
  }

  private func fade(to target: Float, over duration: CFTimeInterval, completion: (() -> Void)?) {
    let shown = presentation()?.opacity ?? opacity
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    CATransaction.setCompletionBlock(completion)
    opacity = target
    let fade = CABasicAnimation(keyPath: "opacity")
    fade.fromValue = shown
    fade.toValue = target
    fade.duration = duration
    fade.timingFunction = CAMediaTimingFunction(name: target > shown ? .easeOut : .easeInEaseOut)
    add(fade, forKey: "nyte.glow")
    CATransaction.commit()
  }

  private func sweep(moving: Bool) {
    func strength(_ alpha: CGFloat) -> CGColor { CGColor(gray: 0, alpha: alpha) }
    if moving {
      sweep.colors = [0.42, 0.42, 1, 1, 0.42, 0.42].map(strength)
      sweep.locations = [0, 0.18, 0.42, 0.58, 0.82, 1]
    } else {
      sweep.colors = [0.7, 0.7].map(strength)
      sweep.locations = [0, 1]
    }
  }
}
