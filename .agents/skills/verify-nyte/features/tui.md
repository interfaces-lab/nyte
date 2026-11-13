# TUI

The terminal client runs one prompt headless (`nyte -p "<prompt>"`, `--json`) or an interactive screen.

- Interactive journeys live in `packages/tui/test/app`. Headless and compiled-binary cases live in `packages/tui/qa/binary.smoke.ts`, which `test:binary` runs.
- Quit and resume: `resume.test.ts` › "/quit names the resume command; --session reopens the transcript, model and level, and the next request carries the history". It also requires exit 0. Confirm that test passed before claiming either behavior works.

## Gotchas

- Emulated text screens do not prove colors, clipboard, image protocol or physical scanout.
