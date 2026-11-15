import AppKit

@main
@MainActor
enum Main {
  /// The application holds its delegate weakly, so the delegate lives here.
  private static let delegate = AppDelegate()

  static func main() {
    let application = NSApplication.shared
    application.delegate = delegate
    application.run()
  }
}
