import AppKit
import NyteUI
import os

enum DebugLayout {
    static let headerRole = ToolWindowView.Strip.compact
    static let stripRole = ToolWindowView.Strip.dense
    static let framesFraction: CGFloat = 0.35
    static let columnMinimum: CGFloat = 200
    static let typeShare: CGFloat = 0.3

    @MainActor
    static func place(_ field: NSView, across strip: NSView) {
        field.translatesAutoresizingMaskIntoConstraints = false
        strip.addSubview(field)
        NSLayoutConstraint.activate([
            field.leadingAnchor.constraint(equalTo: strip.leadingAnchor, constant: RowCell.Geometry.inset),
            field.trailingAnchor.constraint(equalTo: strip.trailingAnchor, constant: -RowCell.Geometry.inset),
            field.centerYAnchor.constraint(equalTo: strip.centerYAnchor),
        ])
    }
}

struct DebugLayoutMemory: Codable, Equatable {
    static let currentVersion = 1
    static let key = "sh.nyte.ide.debug.layout"

    var version = DebugLayoutMemory.currentVersion
    var framesFraction = Double(DebugLayout.framesFraction)

    static func load() -> DebugLayoutMemory {
        guard let data = UserDefaults.standard.data(forKey: key) else { return DebugLayoutMemory() }
        do {
            let memory = try JSONDecoder().decode(DebugLayoutMemory.self, from: data)
            guard memory.version == currentVersion else {
                Logger.debugger.error("debug layout has version \(memory.version); using the default")
                return DebugLayoutMemory()
            }
            return memory
        } catch {
            Logger.debugger.error("decode debug layout failed, using the default: \(error.localizedDescription, privacy: .public)")
            return DebugLayoutMemory()
        }
    }

    func save() {
        do {
            UserDefaults.standard.set(try JSONEncoder().encode(self), forKey: Self.key)
        } catch {
            Logger.debugger.error("encode debug layout failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    static func framesWidth(fraction: Double, of width: CGFloat) -> CGFloat {
        guard width > DebugLayout.columnMinimum * 2 else { return (width / 2).rounded() }
        return min(max((width * CGFloat(fraction)).rounded(), DebugLayout.columnMinimum), width - DebugLayout.columnMinimum)
    }
}
