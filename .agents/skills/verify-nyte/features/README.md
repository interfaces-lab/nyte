# Nyte verification map

Read this before driving Nyte, then open the matching feature file. These entries identify
source coverage. They do not certify a current passing run. Report the current run's result
and evidence in the task response.

## Baseline

- Start with the narrowest proof: the owning test file (`bun test <file>` in `packages/tui`,
  `pnpm exec vitest run <file>` elsewhere), then one journey. A whole suite is a final sweep,
  not the loop; run in parallel, unrelated app tests fail from load.
- Journeys. TUI: `pnpm --dir packages/tui build`, then
  `node packages/tui/qa/run.mjs --scenario tui` (about 25s). `pnpm --dir packages/tui run test`
  adds the unit suite and the headless scenario. Web: `pnpm e2e` (own server at `E2E_ORIGIN`).
  Desktop: `pnpm e2e:desktop`.
- Never drive an instance this run did not start, unless the user asked you to look at theirs.

## Proof

- Action plus resulting state, with explicit screenshot and accessibility snapshot when making
  a visual claim. TUI QA currently records emulated text screens and raw output, not PNGs.
- Name the entry point you used. A skipped entry point is not verified through another one.

## Features

- [Conversation](conversation.md): send a prompt, stream a reply, stop it, reopen the session.
- [TUI](tui.md): headless `-p`/`--json` and the interactive PTY screen.
- [Desktop browser panel](desktop-browser.md): native pages composited above the app.
- [Provider sign-in](provider-login.md): connect a model provider from the TUI, CLI, desktop
  or web, by browser, device code or API key, and add a second account.
