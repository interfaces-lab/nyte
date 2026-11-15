import Foundation
import Observation

/// Runs a closure now, and again after anything observable it read has changed. This is how an
/// AppKit view follows the model without a binding layer.
@MainActor
final class Observer {
  private let apply: () -> Void
  private var scheduled = false
  private var stopped = false

  init(_ apply: @escaping () -> Void) {
    self.apply = apply
    track()
  }

  func stop() {
    stopped = true
  }

  private func track() {
    guard !stopped else { return }
    scheduled = false
    withObservationTracking(apply) { [weak self] in
      DispatchQueue.main.async {
        guard let self, !self.scheduled else { return }
        self.scheduled = true
        self.track()
      }
    }
  }
}
