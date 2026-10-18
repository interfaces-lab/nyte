# Binary smoke

```sh
pnpm --dir packages/tui test:binary                     # builds bin/nyte, then runs the smoke
NYTE_BINARY=/path/to/nyte bun test ./qa/binary.smoke.ts # an existing build
```

Everything a test can see in process lives in `test/`. This smoke covers only what the compiled
binary shows: that `--help` and print mode work through pipes, that a provider error exits 1 and
SIGTERM exits 143 with a `cancelled` result, that the TUI asks to trust a folder with project
files and loads its plugin once trusted, that keys typed at launch reach the composer, that a
fresh HOME paints the recorded model and takes Enter before the service the binary starts has
registered, that `/quit` and SIGTERM print the resume command that `--session` reopens, and that
a closed terminal, SIGHUP, and SIGTERM after the terminal closed each end the TUI within 2 s, the
first while the service sees the TUI's streams close.

`qa/service.smoke.ts` runs the binary's services in temporary HOMEs: of two services started at
once one serves and the other exits 0; a service or `nyte serve` whose registration names another
process exits 0 with its jobs stopped; a nyte retires a service registered with an older build,
which exits 0; with Nyte.app registered, nyte uses its host and `nyte service stop` leaves it
running; and `nyte service install` run through `~/.nyte/bin/nyte` writes a unit that runs that
link, against a stand-in `launchctl` and `systemctl`.

`qa/service.ts` starts a Nyte service inside the test process, over `fakeModels` from
`@nyte-ai/bench`, and registers it in an isolated HOME. The binary finds that registration
and connects to it, so no provider, credential or network is involved, and every request the
binary causes is visible to the test. `freshHome` registers nothing, so the binary starts its
own service there; disposing it waits for that service to register, then stops it. `qa/pty.ts` runs the binary in a Bun PTY and parses its
output with OpenTUI's `EmbeddedTerminalRenderable`, which also encodes keys for the modes the
binary negotiated.
