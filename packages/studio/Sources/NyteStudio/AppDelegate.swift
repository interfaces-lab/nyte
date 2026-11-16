import AppKit
import NyteDesign

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  private let model = StudioModel()
  private var window: StudioWindowController?

  func applicationDidFinishLaunching(_ notification: Notification) {
    NyteResources.registerFonts()
    NSApp.mainMenu = MainMenu.build()
    let controller = StudioWindowController(model: model)
    window = controller
    controller.showWindow(nil)
    // Run from the build folder there is no bundle, so ask to be a regular app.
    if Bundle.main.bundleIdentifier == nil {
      NSApp.setActivationPolicy(.regular)
      NSApp.activate()
    }
    model.start()
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
  }

  func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
    true
  }
}

@MainActor
enum MainMenu {
  static func build() -> NSMenu {
    let main = NSMenu()
    main.addItem(submenu("Nyte Studio") { menu in
      menu.addItem(withTitle: "About Nyte Studio", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
      menu.addItem(.separator())
      let services = NSMenuItem(title: "Services", action: nil, keyEquivalent: "")
      services.submenu = NSMenu()
      NSApp.servicesMenu = services.submenu
      menu.addItem(services)
      menu.addItem(.separator())
      menu.addItem(withTitle: "Hide Nyte Studio", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
      menu.addItem(item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]))
      menu.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
      menu.addItem(.separator())
      menu.addItem(withTitle: "Quit Nyte Studio", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    })

    main.addItem(submenu("File") { menu in
      menu.addItem(withTitle: "New Chat", action: #selector(StudioWindowController.newChat(_:)), keyEquivalent: "n")
      menu.addItem(withTitle: "Open Project…", action: #selector(StudioWindowController.openProject(_:)), keyEquivalent: "o")
      menu.addItem(.separator())
      menu.addItem(withTitle: "Teach This Project's Agents Lune", action: #selector(StudioWindowController.installSkill(_:)), keyEquivalent: "")
      menu.addItem(.separator())
      menu.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
    })

    main.addItem(submenu("Edit") { menu in
      menu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
      menu.addItem(item("Redo", Selector(("redo:")), "z", [.command, .shift]))
      menu.addItem(.separator())
      menu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
      menu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
      menu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
      menu.addItem(withTitle: "Delete", action: #selector(NSText.delete(_:)), keyEquivalent: "")
      menu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    })

    main.addItem(submenu("View") { menu in
      menu.addItem(item("Zoom to Fit", #selector(CanvasView.zoomToFit(_:)), "1", [.shift]))
      menu.addItem(item("Zoom to Selection", #selector(CanvasView.zoomToSelection(_:)), "2", [.shift]))
      menu.addItem(withTitle: "Actual Size", action: #selector(CanvasView.zoomToActualSize(_:)), keyEquivalent: "0")
      menu.addItem(withTitle: "Zoom In", action: #selector(CanvasView.zoomIn(_:)), keyEquivalent: "=")
      menu.addItem(withTitle: "Zoom Out", action: #selector(CanvasView.zoomOut(_:)), keyEquivalent: "-")
      menu.addItem(.separator())
      menu.addItem(item("Show Designs by Night", #selector(StudioWindowController.toggleNight(_:)), "d", [.command, .shift]))
      menu.addItem(.separator())
      menu.addItem(withTitle: "Enter Zen Mode", action: #selector(StudioWindowController.toggleZen(_:)), keyEquivalent: ".")
      menu.addItem(item("Show Sidebar", #selector(NSSplitViewController.toggleSidebar(_:)), "s", [.command, .control]))
      menu.addItem(item("Show Inspector", #selector(NSSplitViewController.toggleInspector(_:)), "i", [.command, .option]))
      menu.addItem(.separator())
      menu.addItem(item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]))
    })

    main.addItem(submenu("Chat") { menu in
      menu.addItem(withTitle: "Ask Nyte…", action: #selector(StudioWindowController.focusComposer(_:)), keyEquivalent: "k")
      menu.addItem(item("Stop", #selector(StudioWindowController.stopChat(_:)), ".", [.command, .shift]))
      menu.addItem(.separator())
      menu.addItem(item("Continue in Nyte", #selector(StudioWindowController.continueInNyte(_:)), "o", [.command, .shift]))
    })

    let window = submenu("Window") { menu in
      menu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
      menu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
    }
    NSApp.windowsMenu = window.submenu
    main.addItem(window)
    return main
  }

  private static func submenu(_ title: String, _ fill: (NSMenu) -> Void) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
    let menu = NSMenu(title: title)
    fill(menu)
    item.submenu = menu
    return item
  }

  private static func item(_ title: String, _ action: Selector, _ key: String, _ modifiers: NSEvent.ModifierFlags) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
    item.keyEquivalentModifierMask = modifiers
    return item
  }
}
