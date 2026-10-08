# Binary QA

```sh
pnpm --dir packages/tui run test                        # both scenarios, automated
pnpm --dir packages/tui run test --scenario headless    # piped CLI only
pnpm --dir packages/tui run test --scenario tui         # real OpenTUI in a PTY only
pnpm --dir packages/tui run test:show                   # tui scenario, visible in your terminal
pnpm --dir packages/tui run test:show --step            # same, Enter runs each step
```

Each command builds `bin/nyte` and runs that executable. `node qa/run.mjs --binary <path>` tests
an existing executable without rebuilding. There are no other tests in this package.

## The two scenarios

`headless` runs the compiled CLI with pipes on stdin, stdout and stderr, so no terminal exists.
Its steps are in `qa/headless.ts`:

1. `--help` prints plain usage on stdout and exits 0.
2. `-p --json` streams `text` records while the provider still holds its stream, then a
   `completed` result naming the session and its `nyte --session=` command.
3. Piped stdin with `-p` runs a real `seq 1 3` through the bash tool. The answer goes to stdout,
   and the tool name and outcome go to stderr. The tool output reaches the provider.
4. `-p --session <id>` sends the earlier conversation and replays nothing.
5. `--provider`, `--model` and `--effort` set the request's model and `reasoning_effort`. A
   completed run saves them, so the next run without flags uses them.
6. A provider error exits 1 with a `failed` result.
7. SIGTERM while a bash tool runs exits 143 with a `cancelled` result, and the tool's process is
   gone before QA cleanup starts.

`tui` runs the same binary in a real PTY. Nyte draws with OpenTUI as it would for a person, and
OpenTUI's `EmbeddedTerminalRenderable` parses that output, answers terminal queries, and encodes
keys, mouse and resize. The steps are in `qa/tui.ts`:

1. A project plugin makes Nyte ask for workspace trust. The default answer quits with no plugin
   code run and no provider request, and the next launch asks again.
2. Trusting the workspace loads the plugin, and its slash command answers.
3. Each typed key shows in the composer. This is the one timed input: `text.idle` fails above a
   p95 of 16.67 ms or a maximum of 50 ms. The reply shows while the provider still holds its
   stream, then completes.
4. Esc stops a run while its bash tool streams output. The tool process ends, no further provider
   request is made, the typed draft stays, and Ctrl+C clears it.
5. A 150-row reply pages up to its first row, one wheel step moves three rows, and Ctrl+End
   returns to the newest row.
6. Resizing to 64x20 and back keeps the draft, the cursor at its end, and one composer footer.
7. The model picker and Shift+Tab change the footer without a request. The next request carries
   the chosen model and `reasoning_effort`.
8. A run started at `/effort low` keeps `low` for its tool continuation while Shift+Tab sets
   `medium`. A Ctrl+Enter follow-up shows in the queue row, waits for the run to finish, and is
   sent at `medium`.
9. A question tool waits for a picked answer. The answer reaches the provider as the tool result,
   with no extra user message.
10. A `!` command runs locally without a model request, and Esc stops it and its process. `!echo
    kept` puts its output in the composer, and the next prompt carries one exact `<shell>` block.
11. Settings lists the thinking level. Esc closes it.
12. `/quit` prints the two-line resume command. `--session=` reopens the transcript, model and
    level without asking for trust again, and the next request carries the history.
13. SIGTERM prints the same resume command and exits 143.
14. A new session shows the saved model and level, and `/effort low` before its first message
    reaches that request.

A failure names its step. `--show` plays the same `tui` scenario on a real CLI renderer, with the
step and latest input captioned above Nyte's screen and a short pause after each step. Pauses
come before inputs, never between an input and its measured screen. Your keys never reach Nyte:
Enter or Space continues a `--step` run, and Ctrl+C stops the run and cleans up. The terminal must
be at least 100x33.

## Isolation

`run.mjs` sets HOME and an environment allowlist before Bun loads anything. Each scenario gets its
own workspace (with a probe plugin and the public question plugin example), NYTE_HOME, settings, credentials, model catalog and database. Nyte talks to a
loopback provider that speaks chat-completions SSE, and HTTP(S) proxy variables point at the same
server, so a request for anything else is refused there and fails the scenario.

- The catalog is seeded under `rawCatalogs` in `models-store.json` with a fresh `checkedAt`, so Nyte
  never refreshes it. The older top-level shape drops `checkedAt`, and Nyte then fetches the
  public catalog.
- A bash card asks GitHub for the bash grammar. The proxy refuses it, nothing is downloaded, and
  the card stays plain. `tui` names these two refused requests; any other request fails.
- Nyte finds ripgrep on PATH and otherwise downloads it, so QA needs ripgrep 12 or later on PATH
  and stops with an install hint if it is missing. CI installs it with apt.
- Clipboard and browser commands are replaced with failing stubs. No personal credentials or
  sessions are used.

Cleanup stops every process, PTY, renderer, server and fixture directory, after a failure and
when Ctrl+C or a signal stops the run. Provider evidence is written first and kept. A supervisor owns each PTY's process group. Headless runs get their own group, which is
killed at the step deadline and at cleanup. Heartbeat tools record their PID, so cancellation is
checked against the operating system before cleanup runs.

## Evidence

The run prints its evidence directory. It holds the binary path, hash, version, revision and
OpenTUI version, per-step results, input timings, raw PTY output, final screens, headless
stdin/stdout/stderr (`cli.json`), and provider requests (`provider.json`).

A matching emulated screen doesn't prove physical terminal scanout, OS clipboard behavior, IME
composition, or image display. A PTY run of `--show` checks that playback runs. A person still
has to watch it to judge legibility.
