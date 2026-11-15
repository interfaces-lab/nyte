import CoreGraphics
import Foundation
import ImageIO
import Lune
import NyteDesign
import UniformTypeIdentifiers

// lune: check, list and render Lune design files without opening Nyte Studio.

let usage = """
  Usage:
    lune check <file.lune>...              Report parse errors and unresolved names
    lune frames <file.lune>                List a file's frames with their sizes
    lune render <file.lune> [options]      Render frames to PNG
      --frame <name>     Only the frame with this name (default: every frame)
      --out <path>       A .png path for one frame, or a folder for several (default: .)
      --scale <n>        Pixels per point (default: 2)
      --theme <mode>     light or dark (default: light)
      --root <folder>    The project root that `use` and image paths resolve from
                         (default: the nearest folder holding .git, else the file's folder)
  """

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(1)
}

func projectRoot(for file: URL, override: String?) -> URL {
  if let override { return URL(filePath: override).standardizedFileURL }
  var folder = file.deletingLastPathComponent()
  while folder.path != "/" {
    if FileManager.default.fileExists(atPath: folder.appending(path: ".git").path) { return folder }
    folder = folder.deletingLastPathComponent()
  }
  return file.deletingLastPathComponent()
}

func relative(_ file: URL, to root: URL) -> String {
  let path = file.standardizedFileURL.path
  let base = root.standardizedFileURL.path
  return path.hasPrefix(base + "/") ? String(path.dropFirst(base.count + 1)) : file.lastPathComponent
}

/// Loads a file and everything it uses, following `use` from the project root.
func load(_ path: String, root: URL, into project: inout Project) {
  guard project.files[path] == nil else { return }
  guard let source = try? String(contentsOf: root.appending(path: path), encoding: .utf8) else {
    return
  }
  project.set(path, source: source)
  guard let tree = project.files[path]?.tree else { return }
  for element in tree.roots where element.tag == "use" {
    if let target = element.value("src") {
      load(resolvePath(target, from: path), root: root, into: &project)
    }
  }
}

final class ImageCache: @unchecked Sendable {
  private let root: URL
  private let lock = NSLock()
  private var images: [String: CGImage?] = [:]

  init(root: URL) {
    self.root = root
  }

  func image(_ path: String) -> CGImage? {
    lock.lock()
    defer { lock.unlock() }
    if let cached = images[path] { return cached }
    let source = CGImageSourceCreateWithURL(root.appending(path: path) as CFURL, nil)
    let image = source.flatMap { CGImageSourceCreateImageAtIndex($0, 0, nil) }
    images[path] = image
    return image
  }
}

func writePNG(_ image: CGImage, to url: URL) -> Bool {
  guard
    let destination = CGImageDestinationCreateWithURL(
      url as CFURL, UTType.png.identifier as CFString, 1, nil)
  else { return false }
  CGImageDestinationAddImage(destination, image, nil)
  return CGImageDestinationFinalize(destination)
}

var arguments = Array(CommandLine.arguments.dropFirst())
guard let command = arguments.first else { fail(usage) }
arguments.removeFirst()

var options: [String: String] = [:]
var files: [String] = []
var index = 0
while index < arguments.count {
  let argument = arguments[index]
  if argument.hasPrefix("--") {
    guard index + 1 < arguments.count else { fail("\(argument) needs a value.\n\n\(usage)") }
    options[String(argument.dropFirst(2))] = arguments[index + 1]
    index += 2
  } else {
    files.append(argument)
    index += 1
  }
}

guard !files.isEmpty else { fail(usage) }
NyteResources.registerFonts()

switch command {
case "check":
  var failed = false
  for name in files {
    let file = URL(filePath: name).standardizedFileURL
    let root = projectRoot(for: file, override: options["root"])
    let path = relative(file, to: root)
    var project = Project()
    load(path, root: root, into: &project)
    let sheet = project.sheet(path)
    if let error = sheet.error {
      print("\(name):\(error.line):\(error.column): error: \(error.message)")
      failed = true
    }
    for dependency in project.dependencies(of: path) {
      if let error = project.files[dependency]?.error {
        print("\(dependency):\(error.line):\(error.column): error: \(error.message)")
        failed = true
      } else if project.files[dependency] == nil {
        print("\(name): error: It uses \(dependency), which doesn't exist.")
        failed = true
      }
    }
    for warning in sheet.warnings {
      let line = project.files[warning.site.file]?.tree?.line(at: warning.site.path) ?? 1
      print("\(warning.site.file):\(line): warning: \(warning.message)")
      failed = true
    }
    if !failed { print("\(name): ok, \(sheet.frames.count) frame\(sheet.frames.count == 1 ? "" : "s")") }
  }
  exit(failed ? 1 : 0)

case "frames", "render":
  let file = URL(filePath: files[0]).standardizedFileURL
  let root = projectRoot(for: file, override: options["root"])
  let path = relative(file, to: root)
  var project = Project()
  load(path, root: root, into: &project)
  let sheet = project.sheet(path)
  if let error = sheet.error { fail("\(files[0]):\(error.line):\(error.column): \(error.message)") }

  let cache = ImageCache(root: root)
  let environment = LayoutEnvironment(image: { cache.image($0) })
  let mode = ThemeMode(rawValue: options["theme"] ?? "light") ?? .light
  var layouts = project.layout(sheet, mode: mode, environment: environment)

  if command == "frames" {
    for layout in layouts {
      print(
        "\(layout.root.node.name)\t\(formatNumber(layout.size.width))×\(formatNumber(layout.size.height))\tat \(formatNumber(layout.origin.x)),\(formatNumber(layout.origin.y))"
      )
    }
    exit(0)
  }

  if let name = options["frame"] {
    layouts = layouts.filter { $0.root.node.name == name }
    if layouts.isEmpty { fail("No frame named \(name) in \(files[0]).") }
  }
  let scale = CGFloat(Double(options["scale"] ?? "2") ?? 2)
  let out = URL(filePath: options["out"] ?? ".")
  let single = out.pathExtension.lowercased() == "png"
  if single, layouts.count > 1 { fail("--out names one file but \(files[0]) has \(layouts.count) frames. Pass --frame or a folder.") }
  if !single { try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true) }

  for layout in layouts {
    guard let image = layout.image(scale: scale, environment: environment) else {
      fail("Couldn't render \(layout.root.node.name).")
    }
    let name = layout.root.node.name.lowercased()
      .map { $0.isLetter || $0.isNumber ? String($0) : "-" }.joined()
      .split(separator: "-").joined(separator: "-")
    let target = single ? out : out.appending(path: "\(name).png")
    guard writePNG(image, to: target) else { fail("Couldn't write \(target.path).") }
    print(target.path)
  }

default:
  fail(usage)
}
