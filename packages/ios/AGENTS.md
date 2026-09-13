# iOS companion

- Read [README.md](README.md) and the root instructions.
- Keep runtime and provider work in the host. Import remote data through `@nyte-ai/client` and `@nyte-ai/protocol`. Reuse the Node-free `@nyte-ai/core/client` entrypoint for session state; do not import the root `@nyte-ai/core` entrypoint into Metro.
- Use React Strict DOM's `css` and `html` for native styled elements. Use native libraries for keyboard, list, markdown, and system controls. Never emulate StyleX with a local wrapper.
- In React Strict DOM `css.create`, use pixel strings for fixed line heights, such as `"24px"`; numeric line heights are CSS ratios. Native TextInput and Markdown style props still use numeric pixels.
- Keep upstream reference provenance in the README. Do not copy unlicensed demo source or bundle provider keys.
- Leave Metro and other dev servers to the user. Use bundle, typecheck, tests, and simulator build commands for verification.
- Follow the [source layout](README.md#source-layout). Keep feature code in its owning flat folder; do not add generic `services`, `hooks`, or `utils` directories or barrel exports. Keep `app.tsx` limited to startup, providers, and connection lifecycle.
