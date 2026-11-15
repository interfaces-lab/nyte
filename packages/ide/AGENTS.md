# IDE

Nyte IDE is a native macOS app in Swift and AppKit, for macOS 27 and later. It is its own design
that carries Nyte's feeling; it is not a port of the desktop app's layout.

## Build and look

- `swift build` builds every target. Each target must compile with zero warnings in Swift 6 mode.
- The check script prints only compiler diagnostics; the bundle script makes the app; the shot
  script opens it on a folder, captures the window to a PNG and quits it by PID.
- Look at every visual change in light and dark with the shot script before calling it done.
- When two agents build at once, each passes its own `--build-path`.

## Dependencies

- No SwiftUI, no Combine, no third-party Swift packages without the owner's say. Every megabyte
  of binary and every megabyte of resident memory is a cost someone has to justify.
- The agent reaches the installed Nyte host over its socket. The app never embeds Node or a host.

## Data-oriented rules

- Model many things as rows in flat arrays, not as one object each. A file node, a transcript
  part, a tab, a token and a terminal cell are indices into parallel arrays, with names and text
  in one byte arena. `FileTree` is the reference for this.
- A view draws what is visible from those arrays. It never keeps a view, a layer or an object per
  row of data beyond what the visible rows reuse.
- Do work for what is on screen. Directories load when they open, tokens are computed for visible
  lines, transcript rows lay out when they scroll in.
- Blocking work (disk, sockets, child processes, parsing a large file) runs off the main actor
  and hands back plain `Sendable` values.

## Design rules

- Every colour, size, radius, type step and duration comes from `Palette`, `Space`, `Radius`,
  `Metric`, `TextStyle` and `Motion`. A new reusable decision is a new token; a raw literal in a
  view is a bug.
- The window has two layers. The chrome is one warm material; the navigator and the titlebar row
  sit flat on it. The editor, terminal and agent are `PaneCard`s on it, one gutter apart.
- Glass is only for the few controls in the titlebar row (`GlassButton`) and what the system
  draws itself, such as menus. Nothing inside a pane is glass, and nothing clicked constantly
  (rows, tabs, the terminal, the composer) is glass.
- Almost no colour. Selection, hover and pressed climb the fill stairs (`fillTertiary`,
  `fillSecondary`, `fillPrimary`) and are never tinted. Hue is for the primary action, keyboard
  focus, git and diff status, and errors.
- Text never fades with opacity; choose a lower content step. An icon takes its label's step.
- Separate with a hairline or with space, not with a second grey panel. Hover and selection
  fills are inset and rounded. A nested shape's radius is the outer radius minus the padding.
- Words keep a 12pt inset from a pane's edge. Row text sits at 16pt from the sidebar's edge.
- SF Symbols only, through `Symbol.image`, at one size and weight per context. No sparkle, wand
  or purple for anything the agent does.
- Feedback is immediate: hover and press change in under 100ms and never wait for an animation.
  Every animation takes its duration from `Motion.duration`, which is zero under Reduce Motion.
- Every control works from the keyboard and has an accessibility label; a custom-drawn list
  exposes its rows as accessibility children.

## Ownership

- The shell owns the window, the titlebar row, the tab strip, pane cards and pane headers.
- A feature module owns one view controller and its model, and exposes a small public surface
  the shell wires up with closures. Modules never import each other.
- `NyteCore` has no AppKit. `NyteDesign` has no feature knowledge.
