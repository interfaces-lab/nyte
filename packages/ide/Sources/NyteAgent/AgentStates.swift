import AppKit
import NyteUI

enum Conversation: Equatable {
    case none, idle, live

    init(_ snapshot: TranscriptSnapshot) {
        self = snapshot.live ? .live : (snapshot.sessionOpen ? .idle : .none)
    }
}

enum PaneState: Equatable {
    case none, ready, connecting, missing
    case incompatible(HostMismatch)
    case failed(String)

    static func decide(connection: ConnectionState, kept: Bool, patient: Bool) -> PaneState {
        guard !kept else { return .none }
        switch connection {
        case .ready: return .ready
        case .missing: return .missing
        case let .incompatible(reason): return .incompatible(reason)
        case let .failed(reason): return .failed(reason)
        case .connecting: return patient ? .connecting : .none
        }
    }
}

@MainActor
enum Reveal {
    case calm
    case waiting(Task<Void, Never>)
    case elapsed

    var hasElapsed: Bool {
        if case .elapsed = self { return true }
        return false
    }

    mutating func wait(_ delay: Duration, then show: @escaping @MainActor () -> Void) {
        guard case .calm = self else { return }
        self = .waiting(Task {
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            show()
        })
    }

    mutating func settle() {
        if case let .waiting(task) = self { task.cancel() }
        self = .calm
    }
}

@MainActor
enum AgentStates {
    static let connectingDelay: Duration = .milliseconds(500)

    static func problem(_ state: PaneState, retry: @escaping () -> Void) -> NSView? {
        let (title, description): (String, String)
        switch state {
        case .missing: (title, description) = ("Nyte isn't running", "Open Nyte, or run nyte host in a terminal.")
        case let .incompatible(mismatch):
            let command = mismatch.hostIsOlder && mismatch.install == .commandLine ? HostMismatch.updateCommand : nil
            let route = command == nil ? AgentStates.updateRoute(mismatch).map { [$0] } ?? [] : []
            return EmptyState(title: "This Nyte can't talk to the IDE", description: mismatch.revisions + " " + mismatch.advice,
                              command: command, actions: route + [("Try Again", retry)])
        case let .failed(reason): (title, description) = ("Nyte couldn't open this folder", reason)
        case .none, .ready, .connecting: return nil
        }
        return EmptyState(title: title, description: description, actions: [("Try Again", retry)])
    }

    static func updateRoute(_ mismatch: HostMismatch) -> (title: String, run: () -> Void)? {
        guard mismatch.hostIsOlder else { return nil }
        switch mismatch.install {
        case let .desktop(app): return ("Open Nyte", { NSWorkspace.shared.open(app) })
        case .commandLine:
            return ("Copy Command", {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(HostMismatch.updateCommand, forType: .string)
            })
        case .unknown: return nil
        }
    }

    static func connecting() -> NSView {
        let loader = Loader()
        let words = Label("Connecting to Nyte", style: .base, color: Palette.contentTertiary)
        let stack = NSStackView(views: [loader, words])
        stack.orientation = .horizontal
        stack.spacing = Space.x2
        stack.translatesAutoresizingMaskIntoConstraints = false
        let holder = NSView()
        holder.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: holder.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: holder.centerYAnchor),
        ])
        holder.setAccessibilityElement(true)
        holder.setAccessibilityRole(.staticText)
        holder.setAccessibilityLabel("Connecting to Nyte")
        return holder
    }
}
