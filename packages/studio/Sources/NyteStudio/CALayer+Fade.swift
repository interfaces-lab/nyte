import AppKit
import NyteDesign

extension CALayer {
  func fade(from start: Float? = nil, to opacity: Float, then completion: (() -> Void)? = nil) {
    let shown = start ?? presentation()?.opacity ?? self.opacity
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    CATransaction.setCompletionBlock(completion)
    self.opacity = opacity
    let fade = CABasicAnimation(keyPath: "opacity")
    fade.fromValue = shown
    fade.toValue = opacity
    fade.duration = NyteDuration.slow.rawValue
    fade.timingFunction = NyteMotion.outQuint
    add(fade, forKey: "nyte.fade")
    CATransaction.commit()
  }
}
