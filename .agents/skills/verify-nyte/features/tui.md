# TUI

The terminal client runs one prompt headless (`nyte -p "<prompt>"`, `--json`) or an interactive screen.

- Interactive: `pnpm --dir packages/tui test` runs the journeys in `packages/tui/test/app`, one test each over `startTui()`.
- Headless and the compiled binary: `pnpm --dir packages/tui test:binary` builds the binary and runs `packages/tui/qa/binary.smoke.ts`. `packages/tui/qa/README.md` lists what it covers.
- Quit and resume: `resume.test.ts` › "/quit names the resume command; --session reopens the transcript, model and level, and the next request carries the history". It also requires exit 0. Confirm that test passed before claiming either behavior works.

## Gotchas

- Emulated text screens do not prove colors, clipboard, image protocol or physical scanout.
