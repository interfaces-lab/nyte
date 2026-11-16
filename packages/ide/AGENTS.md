# IDE

Nyte IDE is a native macOS app in Swift and AppKit, for macOS 27 and later. It is its own design
that carries Nyte's feeling; it is not a port of the desktop app's layout.

## Build, check and look

- `swift build` builds every target. Each target must compile with zero warnings in Swift 6 mode.
  The app product also builds in release; the development executables are debug only.
- The check script builds and prints only compiler diagnostics. The design script fails on any
  value a view wrote by hand. The rules script fails on the Swift rules a pattern can catch. The
  tokens script regenerates the colour table from `@nyte-ai/ui`. The bundle script makes the
  release app.
- `NyteGallery` draws every kit component and every feature view to PNGs, offscreen, in light and
  dark. `NyteShot` draws the whole window the same way, runs the shell's checks and measures the
  app. `NyteProbe` has one check per module (`kit`, `editor`, `terminal`, `files`, `host`, `lsp`,
  `dap`, `markdown`, `changes`, `search`) that prints one line per assertion and exits non-zero on
  a failure, against real servers, real git and offscreen views, and a bench where speed is a
  promise.
- A behaviour is done when a check asserts it or a render shows it, and a new assertion has been
  seen to fail with its fix taken out. What only a person at a real display can confirm is
  written down as that.
- Several agents share this checkout. Each builds with its own `--build-path .build/<name>`, compiles a file
  before saving the next, and never leaves the tree failing.
- Look at every visual change in light and dark, in the gallery or a window render, before calling
  it done. Renders need no screen recording and take no focus. System glass, vibrancy and system
  bezels are drawn by the window server and do not appear in a render.
- Never send synthetic keys or clicks to the user's session, and never capture their display.

## Code

- No comments and no doc comments. A name or a type says it, or the code is reshaped until one
  does. The exceptions are a tool directive and one line that states behaviour AppKit, the system
  or a protocol forces, checked to be true.
- No SwiftUI and no Combine. The Swift packages in use are the ones the manifest already names;
  adding one is the owner's call. Every megabyte of binary and of resident memory is a cost
  someone has to justify.
- The agent reaches the installed Nyte host over its socket. The app never embeds Node or a host.
- Language servers and debug adapters are child processes found through `Toolchain`. They are
  never bundled.

## Data-oriented rules

- Model many things as rows in flat arrays, not as one object each. A file node, a transcript
  part, a tab, a token, a diagnostic, a completion item and a terminal cell are indices into
  parallel arrays, with names and text in one byte arena. `FileTree` is the reference for this.
- A view draws what is visible from those arrays. It never keeps a view, a layer or an object per
  row of data beyond what the visible rows reuse.
- Do work for what is on screen. Directories load when they open, tokens are computed for visible
  lines, transcript rows lay out when they scroll in. Nothing proportional to a file runs on a
  keystroke.
- Blocking work (disk, sockets, child processes, parsing a large file) runs off the main actor
  and hands back plain `Sendable` values.

## The kit

- `NyteUI` owns every control and surface. A feature composes kit components and never styles
  anything itself. When a component lacks something, the component grows, with a specimen in the
  gallery; a feature does not draw its own variant.
- Every colour, size, radius, type step, opacity and duration is a token: `Palette`, `Space`,
  `Size`, `Radius`, `Glyph`, `Metric`, `TextStyle`, `Motion`, `Elevation`. A value only one view
  needs is a `static let` at the top of that view. A bare number other than 0, 1, 2 or a half is a
  bug, and the design script rejects it. In the gallery and the window renderer a number is
  fixture data unless it sits in a size, an inset, a radius, a font or a duration; the probe draws
  nothing anyone sees and is not checked.
- Colours come from the role table generated from `@nyte-ai/ui`. A view names a role, never a hex,
  a system colour or an alpha.
- A custom control subclasses `Control`, which owns hover, press, keyboard, focus ring, window
  state and accessibility once. Lists are `ListView` fed with `RowContent`. Anything that floats
  over content is a `FloatingPanel`. Menus are real `NSMenu`s built through `Menu`.

## Design rules

- The window has two layers. The chrome is one warm material; the navigator sits flat on it. The
  editor, the bottom dock and the agent share one content surface, inset from the window as the
  desktop app insets its main surface, and split inside by hairlines with no gaps.
- The agent pane starts closed. Its sessions live in the pane, not in the navigator.
- Glass is what the system draws: grouped toolbar items, menus, popovers, sheets. A toolbar button
  that stands alone is plain. Nothing inside the content surface is glass, and nothing clicked
  constantly (rows, tabs, the terminal, the composer) is glass. Floating panels are opaque, with a
  hairline edge and a light shadow.
- One level of container. Inside the content surface nothing sits in a box of its own: a strip
  holds plain controls, a field in a strip has no border or ground at rest, a view switcher inside
  a pane is plain text tabs rather than a segmented track, and a prompt is a borderless row under a
  hairline. Only the content surface and floating panels are surfaces.
- Compact is the default density: fields, rows, headers and controls are as small as stays
  legible and clickable. Every size comes from the density, so Standard is one setting away.
- Settings follow the system's own: a sidebar of categories with search, and grouped rows of a
  title, a description and a trailing control. A category's icon is the one place an SF Symbol may
  sit on a coloured tile.
- Almost no colour. Selection, hover and pressed climb the fill stairs (`fillTertiary`,
  `fillSecondary`, `fillPrimary`) and are never tinted. Hue is for the primary action, keyboard
  focus, an agent waiting on the user, git and diff status, problems, breakpoints and the
  execution line. Amber means a warning and nothing else.
- Code keeps its colour wherever it appears: syntax in the editor, in a hover, in a preview and in
  a debugger value. A file's icon is its Pierre icon. A symbol's kind mark is its letter in that
  kind's syntax colour on a neutral tile, the same mark in completion, Structure and breadcrumbs.
  Nothing else gets an identity hue: avatars, progress and badges without a status are neutral.
- Text never fades with opacity; choose a lower content step. An icon takes its label's step.
- Separate with a hairline or with space, not with a second grey panel. Hover and selection
  fills are inset and rounded. A nested shape's radius is the outer radius minus the padding.
- A row reads as bright primary text, then dimmed secondary text, with counts and times at the
  trailing edge in tabular digits. Hierarchy comes from weight and ink step, not from size. The
  title is what identifies the row: details and counts give way before it is cut.
- A field's placeholder is the tertiary step and what was typed is primary, regular weight.
- An agent's state has one vocabulary everywhere: working is the `Spinner` in neutral ink,
  retrying is the `Loader`'s ring, waiting on the user is the accent with the word for what it
  wants, unread is a neutral dot, failed is the danger mark, and done and read is nothing.
- Icons are SF Symbols through `Symbol.image`, sized by `Glyph`; the exceptions are file icons and
  kind marks. No sparkle, wand or purple for anything the agent does. `Spinner` means an agent is working and nothing else; `Loader` is for
  every other wait.
- A menu item shows an icon only when it names a file, a folder, a place or a key feature, and a
  group shows icons on all of its items or none.
- Feedback is immediate: hover and press change on the event and never wait for an animation.
  Every animation takes its duration from `Motion.duration`, which is zero under Reduce Motion.
- Every control works from the keyboard and has an accessibility label; a custom-drawn list
  exposes its rows as accessibility children.
- When unsure how something should behave on the Mac, Apple's Human Interface Guidelines decide.

## Ownership

- The shell owns the window, the toolbar, pane cards, the tool window table and the command
  table. One command table feeds the menu bar, the command palette and every key.
- A feature module owns its view controllers and its model, and exposes a small public surface
  the shell wires up with closures. Feature modules never import each other.
- `NyteCore` has no AppKit and holds the plain values modules exchange, such as
  `LanguageIntelligence` and its types. `NyteUI` has no feature knowledge.
- The editor's capabilities are `EditorFeature`s, one per file. A feature reaches the text through
  the editor's feature-facing members and never knows another feature.
- No wire shape of a protocol leaves its module: the language module answers in `NyteCore`
  values, the debug module in its own plain structs.

## Swift

These come from reading Ghostty's Mac app, kept where they fit an AppKit-only, data-oriented
codebase. The rules script checks the ones a pattern can catch.

- Every target builds in Swift 6 mode with warnings as errors.
- A C library sits behind one bridge type in the module that owns it. Only that type's file and
  its `Type+Topic` files import the C module, and no C type, constant or enum leaves the bridge:
  convert at the boundary.
- A C handle has one owner that frees it in `deinit`. Every fallible C call is checked. C gets a
  pointer to Swift memory only inside a `with…` closure and never keeps it. Borrowed C data is
  copied into Swift values before any hop or `await`. An unknown C enum value is logged with its
  raw value and answered with a safe default.
- A topic file is named `Type+Topic` and holds only extensions of that type. A file past 600
  lines is split by topic.
- Namespace with caseless enums and nested types. No top-level functions or variables outside an
  executable's entry file.
- A lifecycle or mode is one enum whose cases carry the values that exist only in that phase,
  never several booleans and optionals.
- A decision is a function that returns an enum, and the caller acts on it, so the policy can be
  proven without a window.
- Structure that undo, restoration or diffing needs is an immutable value with methods that
  return a new value.
- No implicitly unwrapped optionals.
- Every user command goes through the command table and the responder chain. A view overrides
  `performKeyEquivalent` only for keys no menu item can carry. Every action a responder implements
  is validated, with its title and state.
- A view that takes text implements the whole input method contract: marked text, committed text
  sent once, the candidate window's rectangle at the requested range, a key that commits a
  composition, a layout change during a key press.
- Focus has one source of truth: first responder and the window's key state.
- A timer, display link, event monitor, observer token or task starts and stops in the same
  lifecycle pair. A hidden view or an occluded window produces no frames.
- State saved between launches is one versioned `Codable` value, decoded with a logged fallback.
- A callback from an unknown thread hops to its owner once. Isolation is stated in the type; a
  `nonisolated` method whose body is `assumeIsolated` is a bug waiting for the wrong caller.
- A stored task is cancelled where its owner stops, and every sleep is followed by a cancellation
  check.
- Each module has one `Logger`. A failure from disk, a socket, a child process or C is logged with
  the operation or shown as state; `try?` is for cases where absence is a normal answer. `print`
  is for the development executables.
- An unreachable branch is an `assertionFailure` and a safe return. `preconditionFailure` is for
  where going on would corrupt memory, and `fatalError` only for `init(coder:)`.
- Names follow the Swift API Design Guidelines: verbs for effects, nouns for values, booleans
  that read as assertions, no abbreviations.
- A feature's events are closures or typed streams the shell wires. `NotificationCenter` is for
  the system's own notifications.
- Logic is shaped as values a probe can prove without a window. Tests are written when asked.
- Nothing proportional to the screen or the document is allocated on a key, a frame, a draw or a
  scroll, and each of those paths carries a signpost interval.
