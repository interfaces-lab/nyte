import AppKit
import BeautifulMermaid
import NyteUI

struct DiagramFit: Equatable, Sendable {
    let scale: CGFloat
    let scrolls: Bool

    static let readableText: CGFloat = 11
    static let annotationText: CGFloat = 10
    static let keyBadgeText: CGFloat = 9
    static let chartText: CGFloat = 12
    static let steps: CGFloat = 100

    static func decide(size: CGSize, smallestText: CGFloat, width: CGFloat) -> DiagramFit {
        guard size.width > width, size.width > 0 else { return DiagramFit(scale: 1, scrolls: false) }
        let floor = min(1, readableText / max(smallestText, 1))
        let fit = width / size.width
        guard fit >= floor else { return DiagramFit(scale: floor, scrolls: true) }
        return DiagramFit(scale: max(floor, (fit * steps).rounded(.down) / steps), scrolls: false)
    }

    static func smallestText(_ graph: PositionedGraph) -> CGFloat {
        let config = RenderConfig.shared
        var sizes = [config.fontSizeNodeLabel]
        switch graph.content {
        case let .flowchart(_, edges, groups), let .stateDiagram(_, edges, groups):
            if edges.contains(where: { !($0.label ?? "").isEmpty }) { sizes.append(config.fontSizeEdgeLabel) }
            if !groups.isEmpty { sizes.append(config.fontSizeGroupHeader) }
        case let .sequenceDiagram(_, messages, blocks, _, _, notes):
            if !messages.isEmpty || !notes.isEmpty { sizes.append(config.fontSizeEdgeLabel) }
            if !blocks.isEmpty { sizes.append(config.fontSizeGroupHeader) }
        case let .classDiagram(classes, relationships):
            if classes.contains(where: { !$0.attributes.isEmpty || !$0.methods.isEmpty }) { sizes.append(config.classMemberFontSize) }
            if classes.contains(where: { !($0.annotation ?? "").isEmpty }) { sizes.append(annotationText) }
            if !relationships.isEmpty { sizes.append(config.fontSizeEdgeLabel) }
        case let .erDiagram(entities, relationships):
            if entities.contains(where: { !$0.attributes.isEmpty }) { sizes.append(config.erAttrFontSize) }
            if entities.contains(where: { $0.attributes.contains { !$0.keys.isEmpty } }) { sizes.append(keyBadgeText) }
            if !relationships.isEmpty { sizes.append(config.fontSizeEdgeLabel) }
        case .xyChart:
            sizes.append(chartText)
        }
        return sizes.min() ?? config.fontSizeNodeLabel
    }

    @MainActor static func expandedSize(diagram: CGSize, within bounds: CGSize) -> NSSize {
        let inset = DiagramPanel.padding * 2
        let margin = FloatingPanel.screenMargin * 2
        return NSSize(width: min(diagram.width + inset, max(0, bounds.width - margin)).rounded(.up),
                      height: min(diagram.height + inset, max(0, bounds.height - margin)).rounded(.up))
    }
}
