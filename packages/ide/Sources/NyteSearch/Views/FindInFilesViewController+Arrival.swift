import AppKit
import NyteUI

extension FindInFilesViewController {
    var isInteracting: Bool { ContinuousClock.now - lastInteraction < Self.interactionGrace }

    func noteInteraction() {
        guard !compensating else { return }
        lastInteraction = .now
    }

    func placeUnplaced() {
        guard !unplaced.isEmpty else { return }
        let interval = signposter.beginInterval("search place")
        defer { signposter.endInterval("search place", interval) }
        let order = results.fileOrder
        unplaced.sort { order[Int($0)] < order[Int($1)] }
        let held = groupsByFolder ? placeGrouped() : placeFlat()
        unplaced = held
        if !held.isEmpty { scheduleIdlePlacement() }
        selectFirstIfNone()
    }

    private func placeFlat() -> [Int32] {
        let interacting = isInteracting
        var held: [Int32] = []
        var starts: [Int] = []
        starts.reserveCapacity(displayFiles.count + 1)
        var total = 0
        for file in displayFiles {
            starts.append(total)
            total += rowCount(of: file)
        }
        starts.append(total)
        var inserted = 0
        var placed = 0
        var appended: Range<Int>?
        for file in unplaced {
            let position = insertionIndex(of: file)
            let start = starts[position - placed] + inserted
            let count = rowCount(of: file)
            let appends = position == displayFiles.count
            let change = RowSplice(start: start, removed: 0, inserted: count)
            let placement = appends ? Placement.now : Placement.decide(change, visible: list.visibleRows, interacting: interacting)
            guard placement != .hold else {
                held.append(file)
                continue
            }
            displayFiles.insert(file, at: position)
            placed += 1
            inserted += count
            guard count > 0 else { continue }
            let rows = rows(of: file)
            rowKind.insert(contentsOf: rows.map(\.kind), at: start)
            rowIndex.insert(contentsOf: rows.map(\.index), at: start)
            rowDepth.insert(contentsOf: [UInt8(0)] + Array(repeating: UInt8(1), count: count - 1), at: start)
            guard appends else {
                flushAppended(&appended)
                apply(change, keepingView: placement == .nowKeepingView)
                continue
            }
            appended = (appended?.lowerBound ?? start)..<start + count
        }
        flushAppended(&appended)
        return held
    }

    private func flushAppended(_ appended: inout Range<Int>?) {
        guard let range = appended else { return }
        appended = nil
        list.insertRows(IndexSet(integersIn: range), animated: false)
    }

    private func placeGrouped() -> [Int32] {
        var next = displayFiles
        for file in unplaced { next.insert(file, at: next.firstIndex { results.fileOrder[Int($0)] > results.fileOrder[Int(file)] } ?? next.count) }
        let layout = RowLayout.build(layoutInputs(display: next))
        let change = RowSplice.diff(identities, layout.identities)
        let placement = Placement.decide(change, visible: list.visibleRows, interacting: isInteracting)
        guard placement != .hold else { return unplaced }
        displayFiles = next
        adopt(layout)
        apply(change, keepingView: placement == .nowKeepingView)
        return []
    }

    private func rowCount(of file: Int32) -> Int {
        guard fileShown[Int(file)] > 0 else { return 0 }
        return fileOpen[Int(file)] ? 1 + Int(fileShown[Int(file)]) : 1
    }

    private func rows(of file: Int32) -> [(kind: RowKind, index: Int32)] {
        guard fileShown[Int(file)] > 0 else { return [] }
        var rows: [(kind: RowKind, index: Int32)] = [(.file, file)]
        guard fileOpen[Int(file)] else { return rows }
        for match in results.fileMatches[Int(file)] where !dismissed[Int(match)] { rows.append((.match, match)) }
        return rows
    }

    private func insertionIndex(of file: Int32) -> Int {
        let order = results.fileOrder
        let key = order[Int(file)]
        var low = 0, high = displayFiles.count
        while low < high {
            let middle = (low + high) / 2
            if order[Int(displayFiles[middle])] < key { low = middle + 1 } else { high = middle }
        }
        return low
    }

    private func apply(_ change: RowSplice, keepingView: Bool) {
        let clip = list.scrollView.contentView
        let origin = clip.bounds.origin
        if change.removed > 0 { list.removeRows(IndexSet(integersIn: change.oldRows), animated: false) }
        if change.inserted > 0 { list.insertRows(IndexSet(integersIn: change.start..<change.start + change.inserted), animated: false) }
        if keepingView {
            compensating = true
            clip.scroll(to: NSPoint(x: origin.x, y: origin.y + CGFloat(change.inserted - change.removed) * list.rowHeight))
            list.scrollView.reflectScrolledClipView(clip)
            compensating = false
        }
        if groupsByFolder { list.reloadRows(IndexSet(integersIn: list.visibleRows)) }
    }

    private func scheduleIdlePlacement() {
        placementTask?.cancel()
        let wait = max(.milliseconds(50), Self.interactionGrace - (ContinuousClock.now - lastInteraction))
        placementTask = Task { [weak self] in
            do { try await Task.sleep(for: wait) } catch { return }
            guard !Task.isCancelled, let self else { return }
            placeUnplaced()
            render()
        }
    }
}
