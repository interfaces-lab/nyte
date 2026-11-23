# Desktop

Fonts and loading indicators follow the Fonts and Loading indicators sections of the app package's AGENTS.md. The three apps (Nyte, Code, Studio) are described there too.

## Boundaries

- Preserve the Electron main, preload and renderer boundary. Session behaviour belongs in core.
- Keep API and IPC input validation.
- Use Electron and Node APIs, not Bun-only APIs.
- Keep desktop-owned imports static. The `account` deferred entry (Clerk) is the only exception. `loadDeferred("account")` loads it for an account command, never from the workspace startup graph.

## Behaviour

- Ask for workspace trust once. Child tasks inherit it. Extra approval checks belong in plugins.
- Background agents get no ask-question tool.
- Replacing the app leaves the launchd host running. It retires itself for the newer app once no run or job is busy, and launchd starts the new build.
- A changed operations digest offers Restart Host, which stops running agents.

## Browser pages

Read the integrated-browser skill before adding a floating surface or touching the browser.

- A browser page is a `<webview>` guest. `BrowserGuestHost` mounts it at `layer.page`, so the DOM draws over it by z-index.
- A floating surface that can overlap a page needs a `layer` token above `layer.page`. It also needs no ancestor stacking context at or below that layer. Otherwise it renders behind the page.
- A popup inside a pane is a portal.
- Never move a guest's element in the DOM. That reloads its page.

## Styles

- Renderer geometry sits on the design scale, and colours come from tokens. The lint reports both with the fix.
- Don't widen the design-scale lint's scale to fit a value. Use a step, or name the measurement in the app theme schema.
- A `stylex.defineConsts` value used as a CSS length must be a `"var(--nyte-*)"` string. `defineConsts` emits no declarations and works only by inlining. A bare number resolves to an undeclared variable wherever a file is transformed alone.

## Tests

- Use Vitest for state, host and IPC behaviour, with real local fixtures where possible.
- Tests follow the Testing section of the root `AGENTS.md`.
- Packaging, installer, IPC validation, credential and store tests are contracts. Write one table across channels, not one test per channel.
- Test IPC through the raw message the renderer sends, its channel and payload. Don't go through a typed client.
