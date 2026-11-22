# Desktop E2E tests

Playwright tests for the Electron app. `README.md` says how to run them. The web suite's e2e rules in the app package apply here too, quarantine included.

## Chapters

- One spec file is one chapter over one surface. It declares `test.use({ chapter: "<name>" })` and imports `test` from the chapter fixtures.
- A chapter drives the single window of the `desktop` fixture in file order. It must pass on its own.
- Shared locators sit beside the fixtures. Seeded chat names are `FIXTURES`.
- A new seeded chat belongs in the seeded baseline next to `FIXTURES`, answered by the scripted catalog (`e2eAnswers`). Adding one rebuilds the cache.
- A chapter over Nyte, Code and Studio together takes its windows from the `desk` fixture, one launch per test.
- A window the others cover stops drawing. A change that must show live in several windows needs `desk.tile()` first.

## Rules

- No real providers. Each launch's own host reaches the scripted catalog over a local endpoint under an isolated `HOME`. `startE2eHost` owns that host and its launchd job.
- The `problems` fixture fails a test on any page error or `console.error`, except lines starting with `DEV:`. Assert an expected error by name.
- On any page a test opens itself, collect errors with `collectErrors` from `@nyte-ai/app/e2e/errors`. Assert them.
- Change the theme with `setTheme`. Never emulate `colorScheme`. The page and the window's vibrancy both follow the native theme, so emulation makes them disagree.
