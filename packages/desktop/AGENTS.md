# Desktop

Fonts and loading indicators follow the Fonts and Loading indicators sections of the app
package's AGENTS.md.

- Preserve the Electron main/preload/renderer boundary. Session behavior belongs in core.
- Ask for workspace trust once; child tasks inherit it. Extra approval checks belong
  in plugins. Keep API/IPC input validation.
- Background agents get no ask-question tool.
- Replacing the app leaves the launchd host running; a newer app asks it to retire once no run
  or job is active. A changed operations digest offers Restart Host, which stops running agents.
- Use Electron and Node APIs, not Bun-only APIs. Keep desktop-owned imports static.
  The `account` deferred entry (Clerk) is the desktop's only one: `loadDeferred("account")`
  loads it for an account command, never from the workspace startup graph.
- Use Vitest for state, host, and IPC behavior with real local fixtures where possible.
- Tests follow the Testing section of the root `AGENTS.md`. Here, packaging, installer, IPC validation, credential and store tests are contracts: one table across channels, not one test per channel.
- Test IPC through the raw message the renderer sends (channel and payload), not through a typed client.
- Browser pages are `<webview>` guests that `BrowserGuestHost` mounts at `layer.page`, so the
  DOM draws over them by z-index. A floating surface that can overlap a page needs a `layer`
  token above `layer.page` and no ancestor stacking context at or below it, or it renders behind
  the page; a popup inside a pane is a portal. Moving a guest's element in the DOM reloads its
  page. Before adding a floating surface or touching the browser, read the integrated-browser
  skill.
- Renderer geometry sits on the design scale, and colors come from tokens; the lint
  reports both with the fix. Do not widen the design-scale lint's scale
  to fit a value: use a step, or name the measurement in the app theme schema.
- A `stylex.defineConsts` value used as a CSS length must be a `"var(--nyte-*)"` string.
  `defineConsts` emits no declarations and works only by inlining, so a bare number
  resolves to an undeclared variable wherever a file is transformed alone.
