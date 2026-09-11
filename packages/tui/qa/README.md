# Binary terminal QA

```sh
pnpm --dir packages/tui run test
pnpm --dir packages/tui run test --filter models
pnpm --dir packages/tui run test:show --filter models
```

These commands build Nyte, then run that executable in a real Bun PTY. OpenTUI's
`EmbeddedTerminalRenderable` parses its output, sends terminal replies, encodes keys and paste,
and exposes the emulated screen and cursor. The automated outer renderer uses memory output;
Nyte itself is always a separate process with terminal stdin/stdout.

`node qa/run.mjs --binary /absolute/path/to/nyte` tests a specific existing executable without
rebuilding. `--show` requires terminal stdin and stdout.

## Contracts

- Input actions use `src/constants.ts`. The driver uses its parsed key strokes, not another key map.
- Scenarios assert screens, provider HTTP requests, retained session behavior and exit output.
  They never construct Interactive or read its private state.
- Expected output must not already exist before the measured input. Draft assertions include
  the composer row and cursor movement so padding and completion labels cannot fake a key echo.
- Timing runs use demand-driven outer rendering and frame notifications, not a polling interval
  or a continuous refresh loop. Elapsed time ends when the matching emulated screen is observed.
- A pending message, durable admission, a provider reply and actual cancellation are different
  outcomes. Their timings must not be combined into one input-latency claim.
- Failing production behavior remains a failing case. Fix fixture or observation bugs based on
  captured evidence; do not copy production implementation into the expected result.

## Isolation and evidence

The launcher sets HOME and an environment allowlist before importing Bun modules. Each fixture
uses its own settings, credentials, catalog, workspace and database. A loopback provider speaks
the actual chat-completions SSE protocol. The binary loads configured providers and plugins
through its normal public boundaries. Title requests are handled separately from scripted chat
requests. Unexpected requests fail instead of reaching a live provider.

Browser and clipboard commands are blocked in automated fixtures. No personal credentials or
sessions are used. Terminal cleanup signals target the QA-owned process group. The fixture's
heartbeat tool can record execution and termination for process-lifetime assertions.

Each run prints an evidence directory with:

- Binary path, hash, version, checkout revision and installed OpenTUI version.
- Per-case results and per-action p50, p95, maximum and unmatched input counts.
- Input timestamps, pre-input screens, captured terminal screens, raw PTY output and exit status.
- Provider request/event records beside the scenario workspace when that scenario uses a provider.

An unmatched input has no recorded matching-screen timing. It must not be counted as zero latency.
Per-action p50/p95/max timings are recorded for every case as evidence. Only one input is gated:
`journey.long` marks its idle greeting as `text.idle`, which fails on missing measurements, p95
above 16.67 ms, or any sample above 50 ms, so a gross input stall still fails. Everything else is
judged on outcome. Provider replies and completed shutdown are never local-feedback measurements.

## Journeys

The approved full contract is in `output/nyte-terminal-qa.html`; the suite is built against it and
does not yet cover the whole inventory. It is two continuous sessions plus two boundary cases. Each journey is a sequence of named
beats in `qa/journeys.ts`; a failure names the beat a person was in. Beats assert what the person
sees, what the loopback provider received, what survives a restart, and the exit output.

`journey.short` — a quick session in an untrusted workspace: trust prompt → default declines and
exits → reopen, accept trust → short question and reply → while a second reply streams, queue a
steer and stop (the run continues with the steer; no handback) → stop over a typed draft keeps
the draft; Ctrl+C clears it → stop an unanswered run with nothing queued hands the message back →
`/quit` prints the two-line resume → `--session=` reopens the intact transcript → Ctrl+C exits.

`journey.long` — a working session in a trusted workspace: idle greeting (the one gated latency
check) → a bash tool with long output, backgrounded with Ctrl+Z, then cancelled from `/tasks`
while the parent keeps running (process termination is verified by PID) → a second backgrounded
bash dies when the parent is stopped → parent stop cancels a foreground child and its bash, then a
background child and its bash → a question dialog is dismissed, revisited and answered, then a
second one is answered by typing (each answer arrives as a tool result, no extra user message) → a
queued follow-up is edited, the edit cancelled (draft restored), edited and saved, a second entry
reordered and removed (never delivered) → page up to the first exchange and back down → model
picker filters, moves and confirms the next request's model → Shift+Tab cycles thinking, a burst
keeps the last intent, the picker drafts a level that Esc discards and Enter applies → settings
shows ordinary model controls; usage opens and closes → decomposed `e`+U+0301 and a ZWJ
emoji render and reach the provider intact → one of two background children is cancelled from
`/tasks` while the parent and sibling finish → `/quit`, `--session=` resume keeps transcript,
model and thinking level → local shell prefix rules, foreground cancellation,
private versus retained output, thought expansion and inline edit diffs → quitting
kills the local command tree, then resume restores submitted shell context without
replaying local commands.

`launch.help` covers the CLI boundary. `exit.signals.two-lines` covers SIGINT and SIGTERM.

Still to add: all editor gestures, completion aliases, large-history/resize/mouse coverage, tree
and branch summaries, rich paste/skill recovery, controlled Usage skeleton loading, update
failures, and local latency coverage for every gesture. Do not infer these passed from nearby
beats.

Image pixels, OS clipboard, IME composition, browser login and physical terminal painting need
separate real-terminal checks. Ghostty VT does not compose child Kitty graphics or Sixel images.
A PTY timing is not a measurement of physical display scanout.
