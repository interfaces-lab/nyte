# TUI

The terminal client runs one prompt headless or an interactive screen in a PTY.

## Sub-features

- `headless`: `nyte -p "<prompt>"` and `--json` print the answer and exit cleanly.
- `interactive`: the screen paints local input before host work, scrolls, resizes, and cancels.

## How to get to it (user POV)

- Shell: `nyte -p "..."` or `nyte`.

## Driving it with the TUI QA

Preconditions: ripgrep 12+; run from the repo root.

- Build: `pnpm --dir packages/tui build`.
- Headless: `node packages/tui/qa/run.mjs --scenario headless`; inspect `report.json` and
  `1-headless/cli.json` under the printed run directory.
- Interactive: `node packages/tui/qa/run.mjs --scenario tui`; inspect `1-tui/evidence.json`
  and `1-tui/provider.json`. Visible playback is `pnpm --dir packages/tui test:show --step`.
- New coverage: a named `beat` in the matching scenario, using shortcuts from
  `src/lib/constants.ts`. `qa/drive.ts` supplies screen waits, typing, quit and session helpers.
- Quit and resume: the existing step sends `/quit`, requires the public two-line resume command
  and exit 0, then reopens that session and checks transcript, model, level and provider history.

## Gotchas

- QA drives the compiled binary; do not import the app controller.
- An earlier failed step prevents later steps from running. Confirm the named quit/resume
  step passed before claiming either behavior works.
- Emulated text screens do not prove colors, clipboard, image protocol, or physical scanout.
- `--step` advances fixed inputs. It does not accept ad hoc keys for Nyte, and artifacts lack
  the full input payloads needed for replay.
