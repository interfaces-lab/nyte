# Desktop E2E tests

Playwright tests for the Electron app. Read `README.md` for how to run them. The web suite's e2e rules in the app package apply here too.

- One spec file is one chapter over one surface. It declares `test.use({ chapter: "<name>" })`, imports `test` from the chapter fixtures, and drives the single window of the `desktop` fixture in file order; a chapter must pass on its own. Shared locators sit beside the fixtures; seeded chat names are `FIXTURES`.
- The `problems` fixture fails a test on any page error or `console.error`, except lines starting with `DEV:`. An expected error is asserted by name.
- A new seeded chat belongs in the seeded baseline next to `FIXTURES`, answered by the scripted catalog (`e2eModels`); that rebuilds the cache.
- No real providers. The desktop runs the scripted catalog under an isolated `HOME`.
- Collect errors on any page a test opens itself with `collectErrors` from `@nyte-ai/app/e2e/errors`, and assert them.
