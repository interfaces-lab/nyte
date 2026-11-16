import AppKit
@testable import NyteTerminal

extension TerminalCheck {
    func firstFrame() {
        for name in [NSAppearance.Name.aqua, .darkAqua] {
            let view = TerminalView()
            view.appearance = NSAppearance(named: name)
            view.frame = NSRect(x: 0, y: 0, width: 200, height: 100)
            let want = view.resolvedColors().background
            guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else {
                return expect(false, "first frame: a view without a shell can be captured")
            }
            view.cacheDisplay(in: view.bounds, to: bitmap)
            let got = bitmap.colorAt(x: 10, y: 10).flatMap { $0.usingColorSpace(.sRGB) }
            let packed = got.map { color in
                [color.redComponent, color.greenComponent, color.blueComponent].map { UInt32(($0 * 255).rounded()) }
            } ?? []
            let wanted = [want >> 16 & 0xFF, want >> 8 & 0xFF, want & 0xFF]
            let close = packed.count == 3 && zip(packed, wanted).allSatisfy { abs(Int($0) - Int($1)) <= 2 }
            expect(close && want != 0, "first frame: before the shell's first frame, a \(name.rawValue) terminal draws its own background, not black",
                   "\(packed) against \(wanted)")
        }
    }
}
