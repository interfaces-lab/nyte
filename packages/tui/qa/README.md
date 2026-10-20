# Binary smoke

```sh
pnpm --dir packages/tui test:binary                     # builds dist/nyte, then runs the smoke
NYTE_BINARY=/path/to/nyte bun test ./qa/binary.smoke.ts # an existing build
```

Everything a test can see in process lives in `test/`. This smoke covers only what the compiled
binary shows: that `--help` and print mode work through pipes, that a provider error exits 1 and
SIGTERM exits 143 with a `cancelled` result, that the TUI asks to trust a folder with project
files and loads its plugin once trusted, that keys typed at launch reach the composer, that a
fresh HOME paints the recorded model and takes Enter before its host opens, that `/quit` and
SIGTERM print the resume command that `--session` reopens, and that a closed terminal, SIGHUP,
and SIGTERM after the terminal closed each end the TUI within 2 s.

`qa/service.ts` serves an Anthropic Messages endpoint and a model catalog over `fakeModels` from
`@nyte-ai/bench`, and stores a key login for it in an isolated HOME. The binary opens that HOME's
store itself and calls the endpoint, so no real provider or network is involved, and every
request the binary causes is visible to the test. `freshHome` stores nothing.

`qa/harness/` holds the scripts the multi-process store harness in
`packages/desktop/e2e/stores` runs with Bun: `tui-driver.ts` drives a TUI in a PTY over stdin,
`seed.ts` stores a key login for the harness's scripted model, and `observe.ts` and `write.ts`
measure how soon one process sees another's commit. `qa/pty.ts` runs the binary in a Bun PTY and parses its
output with OpenTUI's `EmbeddedTerminalRenderable`, which also encodes keys for the modes the
binary negotiated.
