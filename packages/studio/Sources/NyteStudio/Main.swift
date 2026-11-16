import AppKit

@main
@MainActor
enum Main {
  private static let delegate = AppDelegate()

  static func main() {
    let application = NSApplication.shared
    application.delegate = delegate
    application.run()
  }
}
