import AppKit

extension TabBar {
    override public func mouseMoved(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        hovered = index(at: point)
        hoveringClose = hovered.map { items[$0].isClosable && closeRect($0).contains(point) } ?? false
    }

    override public func mouseExited(with event: NSEvent) {
        super.mouseExited(with: event)
        hovered = nil
        hoveringClose = false
    }

    override public func mouseDown(with event: NSEvent) {
        let start = convert(event.locationInWindow, from: nil)
        guard let index = index(at: start) else { return }
        if items[index].isClosable, hovered == index, closeRect(index).contains(start) { return trackClose(index) }
        if index != selectedIndex { onSelect?(index) }
        let grab = start.x + scroll - offsets[index]
        while let next = window?.nextEvent(matching: [.leftMouseUp, .leftMouseDragged]) {
            let point = convert(next.locationInWindow, from: nil)
            if next.type == .leftMouseUp { return endDrag() }
            guard onMove != nil, items.count > 1 else { continue }
            if drag == nil, abs(point.x - start.x) < Metric.dragThreshold { continue }
            dragTo(index: index, x: point.x + scroll - grab)
        }
        endDrag()
    }

    private func trackClose(_ index: Int) {
        pressingClose = index
        while let next = window?.nextEvent(matching: [.leftMouseUp, .leftMouseDragged]) {
            let inside = closeRect(index).contains(convert(next.locationInWindow, from: nil))
            pressingClose = inside ? index : nil
            guard next.type == .leftMouseUp else { continue }
            pressingClose = nil
            if inside { onClose?(index) }
            return
        }
        pressingClose = nil
    }

    private func dragTo(index: Int, x: CGFloat) {
        let clamped = min(max(x, 0), max(0, contentWidth - widths[index]))
        let centre = clamped + widths[index] / 2
        var target = 0
        var cursor: CGFloat = 0
        for other in items.indices where other != index {
            if centre > cursor + widths[other] / 2 { target += 1 }
            cursor += widths[other] + Self.gap
        }
        let changed = drag?.target != target
        drag = (index, clamped, target)
        hovered = nil
        if changed { animate(from: shown, to: dragLayout(moving: index, to: target)) }
        let visible = clamped - scroll
        if visible < 0 { scroll = clamped } else if visible + widths[index] > stripWidth { scroll = clamped + widths[index] - stripWidth }
        clampScroll()
        needsDisplay = true
    }

    private func dragLayout(moving index: Int, to target: Int) -> [CGFloat] {
        var order = Array(items.indices)
        order.remove(at: index)
        order.insert(index, at: target)
        var positions = offsets
        var x: CGFloat = 0
        for slot in order {
            positions[slot] = x
            x += widths[slot] + Self.gap
        }
        return positions
    }

    private func endDrag() {
        guard let drag else { return }
        self.drag = nil
        var current = shown
        current[drag.index] = drag.x
        guard drag.target != drag.index else { return animate(from: current) }
        pendingMove = (drag.index, drag.target, drag.x)
        shown = current
        onMove?(drag.index, drag.target)
        if pendingMove != nil {
            pendingMove = nil
            animate(from: current)
        }
    }

    func animate(from start: [CGFloat], to end: [CGFloat]? = nil) {
        let duration = Motion.duration(Motion.normal)
        let goal = end ?? offsets
        guard duration > 0, canProduceFrames, start.count == goal.count else {
            shown = goal
            slide = nil
            return needsDisplay = true
        }
        shown = start
        slide = (start, CACurrentMediaTime())
        slideGoal = goal
        if link == nil {
            let link = displayLink(target: self, selector: #selector(slideStep))
            link.add(to: .main, forMode: .common)
            self.link = link
        }
    }

    @objc private func slideStep(_ link: CADisplayLink) {
        guard let slide, slideGoal.count == slide.from.count else { return stopSlide() }
        let progress = min(1, (CACurrentMediaTime() - slide.start) / Motion.duration(Motion.normal))
        let eased = Tween.Curve(Motion.easeOut).solve(progress)
        shown = zip(slide.from, slideGoal).map { $0 + ($1 - $0) * eased }
        needsDisplay = true
        if progress >= 1 { stopSlide() }
    }

    override public func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if window == nil { stopSlide() }
    }

    func stopSlide() {
        link?.invalidate()
        link = nil
        slide = nil
        if drag == nil { shown = offsets }
        needsDisplay = true
    }

    override public func otherMouseUp(with event: NSEvent) {
        guard event.buttonNumber == 2, let index = index(at: convert(event.locationInWindow, from: nil)),
              items[index].isClosable else { return super.otherMouseUp(with: event) }
        onClose?(index)
    }

    override public func menu(for event: NSEvent) -> NSMenu? {
        index(at: convert(event.locationInWindow, from: nil)).flatMap { menuForTab?($0) }
    }

    override public func scrollWheel(with event: NSEvent) {
        guard contentWidth > bounds.width else { return super.scrollWheel(with: event) }
        let delta = abs(event.scrollingDeltaX) > abs(event.scrollingDeltaY) ? event.scrollingDeltaX : event.scrollingDeltaY
        scroll -= delta
        clampScroll()
    }

    override public func keyDown(with event: NSEvent) {
        guard !items.isEmpty else { return super.keyDown(with: event) }
        let current = selectedIndex ?? 0
        switch event.keyCode {
        case KeyCode.left: onSelect?(max(0, current - 1))
        case KeyCode.right: onSelect?(min(items.count - 1, current + 1))
        default: super.keyDown(with: event)
        }
    }

}
