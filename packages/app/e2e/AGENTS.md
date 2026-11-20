# E2E tests

Playwright tests for the web app. Read `README.md` for how to run them. The desktop suite lives in the desktop package's e2e folder.

- Locate by role, label, or visible text. A CSS selector is a last resort, and only for state the accessibility tree does not expose.
- Assert with web-first matchers such as `toBeVisible`, `toHaveText`, and `toHaveURL`. Never `waitForTimeout` or sleep.
- Register a wait before the action that triggers it, including listeners and `waitForResponse`.
- Assert the exact outcome: the copy the user reads, the value in the field, what is or isn't stored.
- Each test gets its own browser context. The web server outlives tests, so never depend on how many chats exist.
- No real providers. The web server's provider echoes.
- Collect page and console errors with `collectErrors` from `@nyte-ai/app/e2e/errors` on any page a test opens itself, and assert them.
- Clean up everything a test starts, including browser contexts, servers, and temp directories. Defer each cleanup on an `AsyncDisposableStack` held with `await using`, so a failed step still releases what came before it.
- A test that fails on `main` for a reason outside the change at hand gets `@quarantine` in its title. CI skips it and runs it nightly without failing. Fix or delete it within 14 days, and remove the tag in the same change as the fix. Never quarantine a test your own change broke.
