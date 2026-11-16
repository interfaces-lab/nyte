import CoreGraphics

public struct PlacedBox: Sendable {
  public let box: LayoutBox
  public let rect: CGRect
  public let depth: Int
}

extension FrameLayout {
  public func placed() -> [PlacedBox] {
    var out: [PlacedBox] = []
    func walk(_ box: LayoutBox, _ origin: CGPoint, _ depth: Int) {
      let rect = CGRect(
        x: origin.x + box.frame.minX, y: origin.y + box.frame.minY, width: box.frame.width,
        height: box.frame.height)
      out.append(PlacedBox(box: box, rect: rect, depth: depth))
      for child in box.children { walk(child, rect.origin, depth + 1) }
    }
    walk(root, CGPoint(x: -root.frame.minX, y: -root.frame.minY), 0)
    return out
  }

  public func hit(_ point: CGPoint) -> [PlacedBox] {
    var out: [PlacedBox] = []
    func walk(_ box: LayoutBox, _ origin: CGPoint, _ depth: Int) -> Bool {
      let rect = CGRect(
        x: origin.x + box.frame.minX, y: origin.y + box.frame.minY, width: box.frame.width,
        height: box.frame.height)
      let inside = rect.contains(point)
      if box.style.clip, !inside { return false }
      let mark = out.count
      if inside { out.append(PlacedBox(box: box, rect: rect, depth: depth)) }
      for child in box.children.reversed() where walk(child, rect.origin, depth + 1) {
        return true
      }
      if inside { return true }
      out.removeSubrange(mark...)
      return false
    }
    _ = walk(root, CGPoint(x: -root.frame.minX, y: -root.frame.minY), 0)
    return out
  }

  public func box(at occurrence: Occurrence) -> PlacedBox? {
    placed().first { $0.box.node.isAt(occurrence) }
  }
}
