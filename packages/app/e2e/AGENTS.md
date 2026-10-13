# E2E tests

Playwright tests for the web app and for the desktop. Read `README.md` for how to run them.

- Locate by role, label, or visible text. A CSS selector is a last resort, and only for state the accessibility tree does not expose.
- Assert with web-first matchers such as `toBeVisible`, `toHaveText`, and `toHaveURL`. Never `waitForTimeout` or sleep.
- Register a wait before the action that triggers it, including listeners and `waitForResponse`.
- Assert the exact outcome: the copy the user reads, the value in the field, what is or isn't stored.
- Web: each test gets its own browser context. The web server outlives tests, so never depend on how many chats exist.
- Desktop: one spec file is one chapter over one surface. It declares `test.use({ chapter: "<name>" })`, imports `test` from `desktop/fixtures.ts`, and drives the single window of the `desktop` fixture in file order; a chapter must pass on its own. Shared locators live in `desktop/ui.ts`, seeded chat names in `FIXTURES` from `desktop/baseline.ts`.
- Desktop: the `problems` fixture fails a test on any page error or `console.error`, except lines starting with `DEV:`. An expected error is asserted by name.
- Desktop: a new seeded chat belongs in `baseline.ts`, answered by the scripted catalog in `packages/desktop/src/main/fixtures/e2e-models.ts`; that rebuilds the cache.
- No real providers. The web server's provider echoes; the desktop runs the scripted catalog under an isolated `HOME`.
- Collect page and console errors with `utils/errors.ts` on any page a test opens itself, and assert them.
- Clean up everything a test starts, including browser contexts, servers, and temp directories. Defer each cleanup on an `AsyncDisposableStack` held with `await using`, so a failed step still releases what came before it.
