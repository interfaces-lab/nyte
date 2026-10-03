# Desktop

- Preserve the Electron main/preload/renderer boundary. Session behavior belongs in core.
- Ask for workspace trust once; child tasks inherit it. Extra approval checks belong
  in plugins. Keep API/IPC input validation.
- Background agents get no ask-question tool.
- Use Electron and Node APIs, not Bun-only APIs. Keep desktop-owned imports static.
- Use Vitest for state, host, and IPC behavior with real local fixtures where possible.
- Browser pages are native `WebContentsView`s and composite above every DOM layer.
  A floating surface that can overlap a page must carry a `data-slot` listed in
  `packages/app/src/components/overlay-occlusion.ts`, or it renders behind the page.
  `@nyte-ai/ui` popups already do; app-owned surfaces such as the tray and the drag
  overlay set their own. Nothing registers by ref. Before touching browser panels,
  read `.nyte/skills/integrated-browser/SKILL.md`.
- Renderer geometry sits on the design scale, and colors come from tokens; the lint
  reports both with the fix. Do not widen the scale in `packages/app/lint/design-scale.js`
  to fit a value: use a step, or name the measurement in
  `packages/app/src/theme/schema.stylex.ts`.
- A `stylex.defineConsts` value used as a CSS length must be a `"var(--nyte-*)"` string.
  `defineConsts` emits no declarations and works only by inlining, so a bare number
  resolves to an undeclared variable wherever a file is transformed alone.
