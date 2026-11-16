# App

Load the nyte-styles skill before writing StyleX, and read the ui package's AGENTS.md before changing
a shared component.

Each source folder owns one concept and sits in a layer; a folder never imports one above it.
`pnpm layers` checks this; when it fails it prints the rule and the fix.

## Priorities

Stability, then simplicity, then performance. A faster path that can break, or that adds a second
way to do the same thing, loses to the plain one.

## Fonts

These rules hold for the app, `@nyte-ai/ui`, the canvas, and the desktop.

- There are two font roles, the UI font and the code font. Users pick both in Settings ›
  Appearance: Inter, the system font, or a local font for the UI; JetBrains Mono, the system
  monospace, or a local font for code.
- Every surface reads a role through the type tokens: `type.fontSans` for the UI font,
  `type.fontMono` or `text.code` for the code font. Sizes come from `text.*`, or a `type.font*`
  with its matching `type.leading*`.
- Never write a literal family in a style, an inline style, or generated SVG. The typography tokens
  name each family once.
- Faces load in one place: the app theme's faces module, which the web and desktop entries import
  at the top, before the theme boot. The canvas document can't see the app's CSS, so its shell font sheet loads the same faces
  and nothing else. Never add a face anywhere else, or a family a user can't pick.
- Mono at semibold or heavier is for real emphasis. Labels, chrome, and metadata in the code font
  stay regular.

## Loading indicators

These rules hold in every package.

- `Spinner` means AI is working: a running chat, turn, subagent, or tool call.
- `Loader` is everything else: a page, an account or sign-in, a download, a process or terminal
  job, a `Button` with `loading`.
- Choose at the call site. A component that can show either takes the fact that decides, as
  `TaskMark` takes `job`, never a style.
- Never restyle a shared indicator to look like the other.

## Workbench editor

- `WorkbenchViewState.tabs` is the only file-tab list. The strip shows Editor as one slot, and
  `move-slot` moves its file records as a block.
- Resolve Editor's target file with `activeEditorFile`.
- Close requests append to the view's `closeQueue` and never replace it. Cancel empties the queue
  and keeps those files open with their drafts. A saving entry can't be discarded.
- Split placement uses the source file's group, not the focused one. Native drag (`FILE_TAB_DRAG`)
  is the only drag owner on file tabs; never wrap them in the strip's `SortableList`.
- The focused group's marker reads `appearance.focusColor`, not `focusRing`, which pointer modality
  clears.

## Renderer tests

- A renderer test is a vitest test that calls `testRenderer(url, setup, { captures })`, plus a
  browser file exporting a `run()` that returns a string.
- To capture, call `window.rendererCapture(name)`, then await the `renderer-captured` document event.
- The window is 800×600. Size the layout with a container element, not the window.
