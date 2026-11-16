import CoreText
import Foundation
import Lune

public enum NyteResources {
  public static let interFile = "inter-latin-opsz-normal.woff2"

  public static func url(_ name: String) -> URL? {
    let fileManager = FileManager.default
    var candidates: [URL] = []
    if let resources = Bundle.main.resourceURL { candidates.append(resources.appending(path: name)) }
    if let override = ProcessInfo.processInfo.environment["NYTE_STUDIO_RESOURCES"] {
      candidates.append(URL(filePath: override).appending(path: name))
    }
    let package = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent()
    candidates.append(package.appending(path: "Resources").appending(path: name))
    candidates.append(
      package.appending(path: "node_modules/@fontsource-variable/inter/files").appending(path: name))
    return candidates.first { fileManager.fileExists(atPath: $0.path) }
  }

  @discardableResult
  public static func registerFonts() -> Bool {
    guard let file = url(interFile) else { return false }
    return FontBook.shared.register(family: "Inter", file: file)
  }
}
