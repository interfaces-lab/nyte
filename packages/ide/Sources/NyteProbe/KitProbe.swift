import AppKit
@testable import NyteUI

@MainActor func runKitProbe(_ arguments: [String]) {
    guard arguments.first == "check" else { fail("usage: NyteProbe kit check") }
    let application = NSApplication.shared
    application.setActivationPolicy(.prohibited)
    UserDefaults.standard.setVolatileDomain(["NSScrollAnimationEnabled": false], forName: UserDefaults.argumentDomain)
    application.finishLaunching()
    let check = KitCheck()
    check.run()
    print(check.failures == 0 ? "kit check: all \(check.passes) passed" : "kit check: \(check.failures) failed, \(check.passes) passed")
    exit(check.failures == 0 ? 0 : 1)
}

@MainActor class KitProbeWindow: NSWindow {
    static let offscreen = NSPoint(x: -30_000, y: -30_000)

    var occlusion: NSWindow.OcclusionState = .visible {
        didSet { NotificationCenter.default.post(name: NSWindow.didChangeOcclusionStateNotification, object: self) }
    }

    init(size: NSSize) {
        super.init(contentRect: NSRect(origin: Self.offscreen, size: size), styleMask: [.borderless],
                   backing: .buffered, defer: false)
        isReleasedWhenClosed = false
        let content = NSView(frame: NSRect(origin: .zero, size: size))
        content.wantsLayer = true
        contentView = content
        alphaValue = 0
        orderBack(nil)
    }

    var isKey = true
    override var isKeyWindow: Bool { isKey }
    override var occlusionState: NSWindow.OcclusionState { occlusion }

    func place(_ view: NSView, at origin: NSPoint, size: NSSize? = nil) {
        view.translatesAutoresizingMaskIntoConstraints = true
        view.frame = NSRect(origin: origin, size: size ?? view.fittingSize)
        contentView?.addSubview(view)
        view.layoutSubtreeIfNeeded()
    }
}

@MainActor enum Keys {
    static let tab = (code: UInt16(48), text: "\t"), space = (code: UInt16(49), text: " ")
    static let returnKey = (code: UInt16(36), text: "\r"), enter = (code: UInt16(76), text: "\u{3}")
    static let escape = (code: UInt16(53), text: "\u{1b}")
    static let left = (code: UInt16(123), text: "\u{F702}"), right = (code: UInt16(124), text: "\u{F703}")
    static let down = (code: UInt16(125), text: "\u{F701}"), up = (code: UInt16(126), text: "\u{F700}")
    static let home = (code: UInt16(115), text: "\u{F729}"), end = (code: UInt16(119), text: "\u{F72B}")
    static let pageUp = (code: UInt16(116), text: "\u{F72C}"), pageDown = (code: UInt16(121), text: "\u{F72D}")
    static let letterA = (code: UInt16(0), text: "a"), letterO = (code: UInt16(31), text: "o"), letterR = (code: UInt16(15), text: "r")
}

@MainActor final class KitCheck {
    var failures = 0, passes = 0
    static let settle: TimeInterval = 0.25, panelSize = NSSize(width: 240, height: 120)

    func expect(_ label: String, _ condition: Bool, _ got: @autoclosure () -> String = "") {
        if condition { passes += 1; return print("ok   \(label)") }
        failures += 1
        let detail = got()
        print("FAIL \(label)" + (detail.isEmpty ? "" : "\n     got: \(detail)"))
    }

    func run() {
        setvbuf(stdout, nil, _IOLBF, 0)
        if NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            print("note Reduce Motion is on: animations stay off, so the lifecycle counts read zero throughout")
        }
        for check in [lifecycle, buttons, splitButton, segmented, toggles, tabOrder, inputs, tabBar, lists, rowHeights, pinnedGroups, detailLayout, semanticColours, diffContrast, pinnedLines, keyFocus, textInk, inputCommands, groupExtents,
                      linkButton, signatureColours, rowParts, groupHeaderStyling, textArea, longBanner, commentSlant,
                      drivenSelection, densities, fieldsOnTheme, hoverPanel, quietScrollers, contentSplit, navigatorAndTabs, searchPanel, settingsParts, marksAfterTitle, specialKeys, pinnedJumps, bannerActions, filterGroup, chipRow, stripField, wrappedSyntax, shiftedKeys, streamedNumbers, folderIcons, sidebarSessions, headerHitAreas, placeholderContrast, sessionMarks, sessionFacts, denseStrip, fitMatchesDrawing, shortFormsFirst, syntaxRuns, segmentBadges, rowNumbers, rowActions, rowPreview, changedSpans, codeView, toolWindow, borderlessTextArea, chips,
                      menus,
                      floatingPanel] { check() }
    }

    func spin(_ seconds: TimeInterval = KitCheck.settle) {
        RunLoop.main.run(until: Date(timeIntervalSinceNow: seconds))
    }

    func key(_ key: (code: UInt16, text: String), _ modifiers: NSEvent.ModifierFlags = [], in window: NSWindow) -> NSEvent {
        var flags = modifiers
        let scalar = key.text.unicodeScalars.first?.value ?? 0
        if scalar >= 0xF700 { flags.insert(.function) }
        if (0xF700...0xF703).contains(scalar) { flags.insert(.numericPad) }
        return NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
                                windowNumber: window.windowNumber, context: nil, characters: key.text,
                                charactersIgnoringModifiers: key.text, isARepeat: false, keyCode: key.code) ?? NSEvent()
    }

    func press(_ key: (code: UInt16, text: String), _ modifiers: NSEvent.ModifierFlags = [], in window: NSWindow) {
        window.sendEvent(self.key(key, modifiers, in: window))
    }

    func mouse(_ type: NSEvent.EventType, at point: NSPoint, in view: NSView, modifiers: NSEvent.ModifierFlags = [],
               clicks: Int = 1) -> NSEvent {
        let window = view.window
        return NSEvent.mouseEvent(with: type, location: view.convert(point, to: nil), modifierFlags: modifiers,
                                  timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window?.windowNumber ?? 0,
                                  context: nil, eventNumber: 0, clickCount: clicks, pressure: 1) ?? NSEvent()
    }

    func click(_ view: NSView, at point: NSPoint? = nil, releaseAt release: NSPoint? = nil,
               modifiers: NSEvent.ModifierFlags = []) {
        let down = point ?? NSPoint(x: view.bounds.midX, y: view.bounds.midY)
        if let release {
            NSApp.postEvent(mouse(.leftMouseDragged, at: release, in: view, modifiers: modifiers), atStart: false)
        }
        NSApp.postEvent(mouse(.leftMouseUp, at: release ?? down, in: view, modifiers: modifiers), atStart: false)
        view.window?.sendEvent(mouse(.leftMouseDown, at: down, in: view, modifiers: modifiers))
        NSApp.discardEvents(matching: .any, before: nil)
    }

    func middleButton(_ type: CGEventType, at point: NSPoint, in view: NSView) -> NSEvent {
        let local = view.convert(point, to: nil)
        let flipped = CGPoint(x: local.x, y: (NSScreen.screens.first?.frame.height ?? 0) - local.y)
        let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: flipped, mouseButton: .center)
        return event.flatMap(NSEvent.init(cgEvent:)) ?? NSEvent()
    }

    func liveAnimations(in view: NSView?) -> Int {
        guard let view else { return 0 }
        var seen = Set<ObjectIdentifier>()
        func count(_ layer: CALayer) -> Int {
            guard seen.insert(ObjectIdentifier(layer)).inserted else { return 0 }
            return (layer.animationKeys()?.count ?? 0) + (layer.sublayers ?? []).reduce(0) { $0 + count($1) }
        }
        func walk(_ view: NSView) -> Int { (view.layer.map(count) ?? 0) + view.subviews.reduce(0) { $0 + walk($1) } }
        return walk(view)
    }

    func layerCount(_ view: NSView) -> Int {
        var seen = Set<ObjectIdentifier>()
        func count(_ layer: CALayer) -> Int {
            guard seen.insert(ObjectIdentifier(layer)).inserted else { return 0 }
            return 1 + (layer.sublayers ?? []).reduce(0) { $0 + count($1) }
        }
        func walk(_ view: NSView) -> Int { (view.layer.map(count) ?? 0) + view.subviews.reduce(0) { $0 + walk($1) } }
        return walk(view)
    }

    func viewCount(_ view: NSView) -> Int { 1 + view.subviews.reduce(0) { $0 + viewCount($1) } }
}
