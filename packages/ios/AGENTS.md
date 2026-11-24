# iOS companion

Read [README.md](README.md) and the root instructions first.

## Boundaries

- Keep runtime and provider work in the host.
- Import remote data through `@nyte-ai/sdk`. It hands you a head's `HeadView` and the session rows from one host connection.
- Import shared presentation from `@nyte-ai/plugin/client/presentation`.
- Draw the view. Don't re-derive what the host already decided.
- Never import `@nyte-ai/core` into Metro.
- Leave Metro and other dev servers to the user. Verify with export, typecheck, tests and simulator build commands.

## Source layout

- Follow the [source layout](README.md#source-layout). Feature code stays in its owning flat folder.
- No generic `services`, `hooks` or `utils` directories. No barrel exports.
- The Expo Router folder holds route files only.
- The root layout does startup, providers and the connection gate, and nothing else.
- A route file parses params and renders the owning feature's screen.
- Keep upstream reference provenance in the README. Don't copy unlicensed demo source or bundle provider keys.

## Native feel

- Use React Strict DOM's `css` and `html` for native styled elements. Never emulate StyleX with a local wrapper.
- Use native libraries for keyboard, list, markdown and system controls.
- Use native sheets through Expo UI or Expo Router. Prefer medium and large detents for short details.
- Preserve system swipe dismissal. Wait for dismissal before pushing another screen.
- Follow iOS Human Interface typography. Use semantic SwiftUI text styles and support Dynamic Type.
- Controls grow with Dynamic Type. Touch targets are at least 44pt.
- A header action uses one native glass button surface. Never nest another glass button, outline or ring inside it.
- Settings-row icons and profile images have no added border or tile. Keep their touch targets large.
- Mark a selected card with a clean border, not an added checkmark.
- The composer dock stays transparent around one elevated glass capsule.

## Line heights

- In React Strict DOM `css.create`, write a fixed line height as a pixel string such as `"24px"`. A number there is a CSS ratio.
- Native `TextInput` and Markdown style props still take numeric pixels.
