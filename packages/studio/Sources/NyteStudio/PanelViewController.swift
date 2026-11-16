import AppKit
import Lune
import NyteDesign
import NyteKit

@MainActor
final class PanelViewController: NSViewController {
  private let model: StudioModel
  private var unseen = false
  private var wasBusy = false
  private let inspector: InspectorViewController
  private let chat: ChatViewController
  private let container = NSView()
  private var observer: Observer?

  static let inset = NyteSpace.s4

  init(model: StudioModel) {
    self.model = model
    inspector = InspectorViewController(model: model)
    chat = ChatViewController(model: model)
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) {
    fatalError("Made in code.")
  }

  override func loadView() {
    view = NSView()
    container.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(container)
    container.pin(to: view, edges: [.leading, .trailing, .bottom])
    container.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor).isActive = true
    for child in [inspector, chat] as [NSViewController] {
      addChild(child)
      container.addSubview(child.view)
      child.view.pin(to: container)
    }
    observer = Observer { [weak self] in self?.show() }
  }

  private func show() {
    let design = model.panel == .design
    inspector.view.isHidden = !design
    chat.view.isHidden = design

    let busy = model.transcript?.execution.isBusy ?? false
    if wasBusy, !busy, !model.chatShown { unseen = true }
    if model.chatShown || model.transcript == nil { unseen = false }
    wasBusy = busy
    model.chatUnseen = unseen
  }
}

final class FlippedView: NSView {
  override var isFlipped: Bool { true }
}
