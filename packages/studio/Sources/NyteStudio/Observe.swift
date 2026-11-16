import Foundation
import Observation

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
      DispatchQueue.main.async { [weak self] in
        guard let self, !self.scheduled else { return }
        self.scheduled = true
        self.track()
      }
    }
  }
}
