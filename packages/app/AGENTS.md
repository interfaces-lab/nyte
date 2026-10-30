# App

Load the nyte-styles skill before writing StyleX, and read `packages/ui/AGENTS.md` before changing
a shared component.

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
  first. The canvas document can't see the app's CSS, so its shell font sheet loads the same faces
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
