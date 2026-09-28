# E2E tests

Playwright tests for the web app and for the desktop's Remote access. Read `README.md` for how to run them.

- Locate by role, label, or visible text. A CSS selector is a last resort, and only for state the accessibility tree does not expose.
- Assert with web-first matchers such as `toBeVisible`, `toHaveText`, and `toHaveURL`. Never `waitForTimeout` or sleep.
- Register a wait before the action that triggers it, including listeners and `waitForResponse`.
- Assert the exact outcome: the copy the user reads, the value in the field, what is or isn't stored.
- Each test gets its own browser context. The web server outlives tests, so never depend on how many chats exist.
- Collect page and console errors with `utils/errors.ts` and assert them. An expected error, like the 403 for a wrong token, is asserted by name.
- No real providers. The web server's provider echoes, and the desktop project runs under its own `NYTE_HOME` and sends no messages.
- Clean up everything a test starts, including Electron, browser contexts, and temp directories. Defer each cleanup on an `AsyncDisposableStack` held with `await using`, so a failed step still releases what came before it.
