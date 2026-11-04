# TUI

The terminal client runs one prompt headless or an interactive screen in a PTY.

## Sub-features

- `headless`: `nyte -p "<prompt>"` and `--json` print the answer and exit cleanly.
- `interactive`: the screen paints local input before host work, scrolls, resizes, and cancels.

## How to get to it (user POV)

- Shell: `nyte -p "..."` or `nyte`.

## Driving it with the TUI tests

- Interactive: `pnpm --dir packages/tui test` runs the app journeys in `packages/tui/test/app`,
  each one test over `startTui()` (`packages/tui/test/harness/tui.ts`): the whole TUI on a
  test renderer and an in-process host with `fakeModels`.
- Headless and the compiled binary: `pnpm --dir packages/tui test:binary` builds the binary and
  runs `packages/tui/qa/binary.smoke.ts`: `--help` and print mode through pipes, a provider
  error, exit codes, trust, launch typeahead, `/quit` and `--session`.
- New coverage: a test in the matching app test file, pressing keys by command name from
  `packages/tui/src/lib/constants.ts`.
- Quit and resume: `packages/tui/test/app/resume.test.ts` sends `/quit`, requires the resume
  command and exit 0, then reopens that session and checks transcript, model, level and the
  history the next request carries.

## Gotchas

- App tests press keys by command name, never by escape sequence; do not set state directly.
- A failed step ends its test. Confirm the named quit/resume test passed before claiming either
  behavior works.
- Emulated text screens do not prove colors, clipboard, image protocol, or physical scanout.
- There is no visible playback or replay command.
