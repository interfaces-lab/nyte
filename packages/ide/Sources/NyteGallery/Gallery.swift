import AppKit
import NyteUI

struct GalleryPage {
    let name: String
    var settle: TimeInterval = 0.2
    var prepare: (@MainActor () async -> Void)?
    var teardown: (@MainActor () async -> Void)?
    let build: @MainActor () -> NSView
}

@MainActor
enum Gallery {
    static let width: CGFloat = 1120

    static func canvas(title: String, content: NSView) -> NSView {
        let ground = SurfaceView(fill: Palette.bgChrome)
        let heading = Label(title, style: .xl, color: Palette.contentPrimary, weight: .semibold)
        let stack = NSStackView(views: [heading, content])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = Space.x6
        stack.translatesAutoresizingMaskIntoConstraints = false
        ground.addSubview(stack)
        NSLayoutConstraint.activate([
            ground.widthAnchor.constraint(equalToConstant: width),
            stack.topAnchor.constraint(equalTo: ground.topAnchor, constant: Space.x8),
            stack.leadingAnchor.constraint(equalTo: ground.leadingAnchor, constant: Space.x8),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: ground.trailingAnchor, constant: -Space.x8),
            stack.bottomAnchor.constraint(equalTo: ground.bottomAnchor, constant: -Space.x8),
        ])
        return ground
    }

    static func page(_ sections: [NSView]) -> NSView {
        let stack = NSStackView(views: sections)
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = Space.x8
        return stack
    }

    static func section(_ title: String, note: String = "", onCard: Bool = false, _ rows: [NSView]) -> NSView {
        let heading = Label(title, style: .base, color: Palette.contentPrimary, weight: .semibold)
        var header: [NSView] = [heading]
        if !note.isEmpty { header.append(Label(note, style: .sm, color: Palette.contentTertiary)) }
        let titles = NSStackView(views: header)
        titles.orientation = .vertical
        titles.alignment = .leading
        titles.spacing = Space.x05
        let body = NSStackView(views: rows)
        body.orientation = .vertical
        body.alignment = .leading
        body.spacing = Space.x4
        let content: NSView
        if onCard {
            let card = PaneCard()
            body.translatesAutoresizingMaskIntoConstraints = false
            card.addSubview(body)
            NSLayoutConstraint.activate([
                body.topAnchor.constraint(equalTo: card.topAnchor, constant: Space.x4),
                body.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: Space.x4),
                body.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -Space.x4),
                body.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -Space.x4),
            ])
            content = card
        } else {
            content = body
        }
        let stack = NSStackView(views: [titles, content])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = Space.x3
        return stack
    }

    static func row(_ specimens: [NSView], spacing: CGFloat = Space.x5, alignment: NSLayoutConstraint.Attribute = .bottom) -> NSView {
        let stack = NSStackView(views: specimens)
        stack.orientation = .horizontal
        stack.alignment = alignment
        stack.spacing = spacing
        return stack
    }

    static func specimen(_ caption: String, _ view: NSView) -> NSView {
        let label = Label(caption, style: .xs, color: Palette.contentTertiary)
        let stack = NSStackView(views: [view, label])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = Space.x15
        return stack
    }

    static func wide(_ view: NSView, width: CGFloat) -> NSView {
        view.translatesAutoresizingMaskIntoConstraints = false
        view.widthAnchor.constraint(equalToConstant: width).isActive = true
        view.frame.size.width = width
        view.layoutSubtreeIfNeeded()
        return view
    }

    static func sized(_ view: NSView, width: CGFloat, height: CGFloat) -> NSView {
        view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            view.widthAnchor.constraint(equalToConstant: width),
            view.heightAnchor.constraint(equalToConstant: height),
        ])
        return view
    }
}
