# TUI

- Own terminal rendering and keyboard interaction here. Session behavior belongs in core.
- Keep keyboard shortcuts configurable through `CHAT_KEYBINDS`; do not hardcode key checks.
- Test the production TUI with OpenTUI's `createTestRenderer` and `createMockKeys`.
  Mount real components, drive keyboard input, and assert captured frames and state.
  Do not mock OpenTUI or recreate the UI in tests.
- Run the same scenarios in two modes: headless for automated checks, and visible
  through the real terminal renderer in the user's terminal. Share fixtures, input
  sequences, and assertions; visible mode adds playback pacing, not a separate demo.
- Use [test/helpers.ts](test/helpers.ts) for host tests and [test/qa/fixture.ts](test/qa/fixture.ts)
  for the shared headless/terminal fixture. Both use real stores and scripted providers.
- Cover narrow and wide layouts, scrolling, resize, and exit. Await observable state
  or rendered frames instead of fixed sleeps. Close renderers, hosts, and fixtures,
  and restore the terminal after visible runs, including failures.

## Run the TUI tests

From the repository root:

```sh
pnpm --dir packages/tui test:tui
pnpm --dir packages/tui test:tui:show
pnpm --dir packages/tui test:tui:show --record /tmp/nyte-tui-qa
```

The first command runs headlessly and is also included in `pnpm test`. The second
plays the same assertions in your terminal. Ctrl+C stops playback and restores it.
`--record` saves OpenTUI frames per scenario and `results.json`. Add `--filter queue`
to either command for a focused replay; omit it for the full run.

The matrix covers every built-in slash command and alias, all `CHAT_KEYBINDS`,
built-in settings, fixture plugin commands/settings/skills, and interaction flows
for queues, tasks, questions, session switching, paste, the editor, and resize.
Each runs with a one-line assistant reply and a six-turn, 144-line transcript.
Login uses in-memory fixture credentials; `/update` checks the source-run outcome.
The launcher isolates the home and workspace before loading the app.

Add scenarios in [test/qa/scenarios.ts](test/qa/scenarios.ts). Built-in command and
shortcut handlers are exhaustive against the production registries. Assert visible
output and resulting state; adding a command must include its short/long scenarios.
