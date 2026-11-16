import AppKit
import NyteDiagrams
import NyteUI

Diagrams.install()

let given = Array(CommandLine.arguments.dropFirst())
let densityFlag = given.firstIndex(of: "--density")
let arguments = densityFlag.map { index in given.enumerated().filter { $0.offset != index && $0.offset != index + 1 }.map(\.element) } ?? given
if let densityFlag, densityFlag + 1 < given.count, let density = Density(rawValue: given[densityFlag + 1]) {
    MainActor.assumeIsolated { Density.apply(density) }
}
guard let folder = arguments.first else {
    FileHandle.standardError.write(Data("usage: NyteGallery <out-folder> [page ...]\n".utf8))
    exit(2)
}
let output = URL(fileURLWithPath: folder, isDirectory: true)
try? FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)

let application = NSApplication.shared
application.setActivationPolicy(.accessory)

let pages = controlPages + surfacePages + windowPages + editorAnnotationPages + editorAssistPages + languagePages + debugPages
    + agentPages + markdownPages + filesPages + changesPages + searchPages
let wanted = Set(arguments.dropFirst())
let selected = wanted.isEmpty ? pages : pages.filter { wanted.contains($0.name) }
guard !selected.isEmpty else {
    FileHandle.standardError.write(Data("pages: \(pages.map(\.name).joined(separator: ", "))\n".utf8))
    exit(2)
}

var jobs = selected.flatMap { page in
    [(page, NSAppearance.Name.aqua, "light"), (page, NSAppearance.Name.darkAqua, "dark")]
}

@MainActor func drawNext() {
    guard !jobs.isEmpty else { exit(0) }
    let (page, appearance, suffix) = jobs.removeFirst()
    application.appearance = NSAppearance(named: appearance)
    let canvas = Gallery.canvas(title: page.name, content: page.build())
    let window = DrawsAsKeyWindow(
        contentRect: NSRect(origin: .zero, size: canvas.fittingSize),
        styleMask: [.borderless], backing: .buffered, defer: false
    )
    window.contentView = canvas
    window.alphaValue = 0
    window.ignoresMouseEvents = true
    window.orderBack(nil)
    canvas.layoutSubtreeIfNeeded()
    Task { @MainActor in
        await page.prepare?()
        guard await Wait.pause(.seconds(page.settle)) else { return }
        canvas.layoutSubtreeIfNeeded()
        if let bitmap = canvas.bitmapImageRepForCachingDisplay(in: canvas.bounds) {
            canvas.cacheDisplay(in: canvas.bounds, to: bitmap)
            composite(window.childWindows ?? [], over: window, into: bitmap)
            let file = output.appendingPathComponent("\(page.name)-\(suffix).png")
            try? bitmap.representation(using: .png, properties: [:])?.write(to: file)
            print(file.path, "\(bitmap.pixelsWide)x\(bitmap.pixelsHigh)")
        }
        for child in window.childWindows ?? [] { child.orderOut(nil) }
        window.orderOut(nil)
        if jobs.first?.0.name != page.name { await page.teardown?() }
        drawNext()
    }
}

@MainActor func composite(_ panels: [NSWindow], over window: NSWindow, into bitmap: NSBitmapImageRep) {
    guard !panels.isEmpty, let context = NSGraphicsContext(bitmapImageRep: bitmap) else { return }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    for panel in panels {
        guard let content = panel.contentView, let overlay = content.bitmapImageRepForCachingDisplay(in: content.bounds) else {
            continue
        }
        content.cacheDisplay(in: content.bounds, to: overlay)
        let origin = NSPoint(x: panel.frame.minX - window.frame.minX, y: panel.frame.minY - window.frame.minY)
        overlay.draw(in: NSRect(origin: origin, size: panel.frame.size), from: .zero, operation: .sourceOver, fraction: 1,
                     respectFlipped: false, hints: nil)
    }
    NSGraphicsContext.restoreGraphicsState()
}

final class DrawsAsKeyWindow: NSWindow {
    override var isKeyWindow: Bool { true }
}

DispatchQueue.main.async { drawNext() }
application.run()
