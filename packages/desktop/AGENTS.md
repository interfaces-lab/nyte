# Desktop

- Preserve the Electron main/preload/renderer boundary. Session behavior belongs in core.
- Ask for workspace trust once; child tasks inherit it. Extra approval checks belong
  in plugins. Keep API/IPC input validation.
- Background agents get no ask-question tool.
- Use Electron and Node APIs, not Bun-only APIs. Keep desktop-owned imports static.
- Use Vitest for state, host, and IPC behavior with real local fixtures where possible.
- Browser pages are native `WebContentsView`s and composite above every DOM layer.
  A floating surface that can overlap a page must register with
  `renderer/src/components/overlay-occlusion.ts`, or it renders behind the page.
  Register in the shared primitive, not in feature code.
