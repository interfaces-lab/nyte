# Binary smoke

Tests for what only the compiled `nyte` binary shows. Everything a test can see in process lives in
`test/`.

## Run it

Build `dist/nyte` and run the smoke:

```sh
pnpm --dir packages/tui test:binary
```

Run it against an existing build from `packages/tui`:

```sh
cd packages/tui
NYTE_BINARY=/path/to/nyte bun test ./qa/binary.smoke.ts
```

## What it covers

- `--help` and print mode work through pipes.
- A provider error exits 1, and SIGTERM during a run exits 143 with a `cancelled` result.
- The TUI asks to trust a folder with project files, and loads its plugin once trusted.
- Keys typed at launch reach the composer.
- A fresh `HOME` paints the recorded model and takes Enter before its host opens.
- `/quit` and SIGTERM print the resume command, and `--session` reopens that session.
- A closed terminal, SIGHUP, and SIGTERM after the terminal closed each end the TUI within 2 s.
- `nyte host` serves clients that attach with `--host-url` from an empty `HOME`, and an attached
  TUI shows it reconnecting when the host stops.

## How it works

`qa/service.ts` serves an Anthropic Messages endpoint and a model catalog over `fakeModels` from
`@nyte-ai/bench`, and stores a key login for it in an isolated `HOME`. The binary opens that
home's store and calls the endpoint itself. No real provider or network is involved, and the test
sees every request the binary makes. `freshHome` returns an isolated home with nothing stored.

`qa/pty.ts` runs the binary in a Bun PTY and parses its output with OpenTUI's
`EmbeddedTerminalRenderable`, which also encodes keys for the modes the binary negotiated.

`qa/harness/` holds the scripts that the desktop's multi-process store suite in
`packages/desktop/e2e/stores` runs with Bun:

| Script | What it does |
| --- | --- |
| `tui-driver.ts` | Drives a TUI in a PTY over stdin |
| `seed.ts` | Stores a key login for the suite's scripted model |
| `observe.ts`, `write.ts` | Measure how soon one process sees another's commit |

Read [the TUI's AGENTS.md](../AGENTS.md) before changing these tests.
