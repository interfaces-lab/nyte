# QA harness

`qa/harness/` holds the scripts the multi-process store harness in
`packages/desktop/e2e/stores` runs with Bun: `tui-driver.ts` drives a TUI in a PTY over stdin,
`seed.ts` stores a key login for the harness's scripted model, and `observe.ts` and `write.ts`
measure how soon one process sees another's commit. `qa/pty.ts` runs the binary in a Bun PTY and parses its
output with OpenTUI's `EmbeddedTerminalRenderable`, which also encodes keys for the modes the
binary negotiated.
