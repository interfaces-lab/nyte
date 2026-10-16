# Desktop E2E tests

Playwright tests for the Electron app. Read `README.md` for how to run them. The web suite's rules in `packages/app/e2e/AGENTS.md` apply here too.

- One spec file is one chapter over one surface. It declares `test.use({ chapter: "<name>" })`, imports `test` from `fixtures.ts`, and drives the single window of the `desktop` fixture in file order; a chapter must pass on its own. Shared locators live in `ui.ts`, seeded chat names in `FIXTURES` from `baseline.ts`.
- The `problems` fixture fails a test on any page error or `console.error`, except lines starting with `DEV:`. An expected error is asserted by name.
- A new seeded chat belongs in `baseline.ts`, answered by the scripted catalog in `src/main/fixtures/e2e-models.ts`; that rebuilds the cache.
- No real providers. The desktop runs the scripted catalog under an isolated `HOME`.
- Collect errors on any page a test opens itself with `collectErrors` from `@nyte-ai/app/e2e/errors`, and assert them.
