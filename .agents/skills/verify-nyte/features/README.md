# Nyte verification map

Read this before you drive Nyte, then open the matching feature file. The feature files map
features to the tests that cover them. They don't certify a current passing run. Report the
current run's result and evidence in the task response.

## Baseline

- Start with the narrowest proof, the owning test file, then one journey. Run a test file with
  `bun test <file>` in `packages/tui` and `pnpm exec vitest run <file>` elsewhere.
- Run a whole suite only as a final sweep, not in the loop. When suites run in parallel, the load
  makes unrelated app tests fail.
- Journeys for the TUI: `pnpm --dir packages/tui test` runs the in-process app journeys with the
  unit suite, and `pnpm --dir packages/tui test:binary` builds the binary and runs its smoke test.
- Journeys for the web app: `pnpm e2e:web` starts its own server at `E2E_ORIGIN`.
- Journeys for the desktop app: `pnpm e2e:desktop`.
- Never drive an instance this run didn't start, unless the user asked you to look at theirs.

## Proof

- Show the action and the resulting state. For a visual claim, capture a screenshot and an
  accessibility snapshot. TUI tests record emulated text frames and raw PTY output, not PNGs.
- Name the entry point you used. A skipped entry point is not verified through another one.

## Features

- [Conversation](conversation.md): send a prompt, stream a reply, stop it, reopen the session.
- [TUI](tui.md): headless `-p`/`--json` and the interactive PTY screen.
- [Desktop browser panel](desktop-browser.md): native pages composited above the app.
- [Provider sign-in](provider-login.md): connect a model provider from the TUI, CLI, desktop or
  web, by browser, device code or API key, and add a second account.
