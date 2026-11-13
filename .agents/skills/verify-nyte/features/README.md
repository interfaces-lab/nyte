# Nyte verification map

Each feature file maps a feature to the tests that cover it. Report the run's own result and evidence, not the mapping.

- Run one test file while iterating: `bun test <file>` in `packages/tui`, `pnpm exec vitest run <file>` elsewhere.
- Run a whole suite only as a final sweep. Suites run in parallel load the machine enough that unrelated app tests fail.
- `pnpm e2e:desktop` builds every desktop output and runs every chapter.
- A skipped entry point is not verified through another one.

## Features

- [Conversation](conversation.md): send a prompt, stream a reply, stop it, attach an image, reopen the session.
- [TUI](tui.md): headless `-p`/`--json` and the interactive screen.
- [Desktop browser panel](desktop-browser.md): native pages composited above the app.
- [Provider sign-in](provider-login.md): connect a model provider from the TUI, CLI, desktop or web, by browser, device code or API key, and add a second account.
