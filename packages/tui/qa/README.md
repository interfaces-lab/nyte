# Binary smoke

```sh
pnpm --dir packages/tui test:binary                     # builds bin/nyte, then runs the smoke
NYTE_BINARY=/path/to/nyte bun test ./qa/binary.smoke.ts # an existing build
```

Everything a test can see in process lives in `test/`. This smoke covers only what the compiled
binary shows: that `--help` and print mode work through pipes, that a provider error exits 1 and
SIGTERM exits 143 with a `cancelled` result, that the TUI asks to trust a folder with project
files and loads its plugin once trusted, that keys typed at launch reach the composer, that
`/quit` and SIGTERM print the resume command that `--session` reopens, and that a closed terminal,
SIGHUP, and SIGTERM after the terminal closed each end the TUI within 2 s, the first while the
service sees the TUI's streams close.

`qa/service.ts` starts a Nyte service inside the test process, over `fakeModels` from
`@nyte-ai/host/bench`, and registers it in an isolated HOME. The binary finds that registration
and connects to it, so no provider, credential or network is involved, and every request the
binary causes is visible to the test. `qa/pty.ts` runs the binary in a Bun PTY and parses its
output with OpenTUI's `EmbeddedTerminalRenderable`, which also encodes keys for the modes the
binary negotiated.
