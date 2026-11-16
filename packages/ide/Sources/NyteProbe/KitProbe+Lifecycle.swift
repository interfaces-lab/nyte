import AppKit
@testable import NyteUI

extension KitCheck {
    func census(_ label: String, _ window: KitProbeWindow, _ spinner: Spinner, _ loader: Loader, _ tween: Tween) -> [Int] {
        let counts = [liveAnimations(in: window.contentView), spinner.isAnimating ? 1 : 0, tween.isRunning ? 1 : 0]
        print("     \(label): animations \(counts[0]), timers \(counts[1]), display links \(counts[2])")
        return counts
    }

    func lifecycle() {
        let window = KitProbeWindow(size: NSSize(width: 200, height: 100))
        weak var released: Spinner?
        weak var releasedTween: Tween?
        autoreleasepool {
            let host = NSView(frame: NSRect(x: 0, y: 0, width: 200, height: 100))
            host.wantsLayer = true
            window.contentView?.addSubview(host)
            let spinner = Spinner(), loader = Loader(), meter = Meter(value: nil), mover = Button("Move")
            for (index, view) in [spinner, loader, meter, mover].enumerated() {
                view.translatesAutoresizingMaskIntoConstraints = true
                view.frame = NSRect(x: CGFloat(index) * 40, y: 10, width: 32, height: 16)
                host.addSubview(view)
            }
            let tween = mover.makeTween(0)
            host.layoutSubtreeIfNeeded()
            tween.move(to: 1, duration: 10, curve: Motion.easeOut)
            let shown = census("shown", window, spinner, loader, tween)
            expect("lifecycle: shown views animate (loader, meter, spinner, tween)", shown == [2, 1, 1], "\(shown)")
            host.isHidden = true
            tween.move(to: 0, duration: 10, curve: Motion.easeOut)
            let hidden = census("hidden", window, spinner, loader, tween)
            expect("lifecycle: a hidden view produces no frames", hidden == [0, 0, 0], "\(hidden)")
            host.isHidden = false
            tween.move(to: 1, duration: 10, curve: Motion.easeOut)
            let unhidden = census("unhidden", window, spinner, loader, tween)
            expect("lifecycle: unhiding restarts them", unhidden == [2, 1, 1], "\(unhidden)")
            window.occlusion = []
            let occluded = census("occluded", window, spinner, loader, tween)
            expect("lifecycle: an occluded window produces no timer or animation frames", occluded[0...1] == [0, 0], "\(occluded)")
            window.occlusion = .visible
            let visible = census("visible again", window, spinner, loader, tween)
            expect("lifecycle: a visible window restarts them", visible[0...1] == [2, 1], "\(visible)")
            host.removeFromSuperview()
            let removed = census("removed", window, spinner, loader, tween)
            expect("lifecycle: leaving the window stops everything, on the detached views too",
                   removed == [0, 0, 0] && liveAnimations(in: host) == 0, "\(removed), \(liveAnimations(in: host)) on the detached views")
            expect("lifecycle: a detached tween lands on its target", tween.value == tween.target, "\(tween.value)")
            released = spinner
            releasedTween = tween
        }
        spin()
        expect("lifecycle: removed views and tweens are released", released == nil && releasedTween == nil,
               "spinner \(released == nil ? "freed" : "alive"), tween \(releasedTween == nil ? "freed" : "alive")")
        window.close()
        expect("Spinner: every phase keeps a lit 2 by 2 core", Spinner.lit.allSatisfy { bits in Spinner.blocks.contains { $0 & bits == $0 } })
    }
}
