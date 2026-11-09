---
name: verify-nyte
description: >
  Verify Nyte's Electron desktop, terminal client, or web app through the existing Playwright
  and compiled-binary QA runners. Use to reproduce a visible bug, identify where it starts,
  fix it within the requested scope, and replay the same journey before claiming it works.
---

# Verify Nyte

Commands and entry points come from the current runners. A mapped or skipped test is not a
passing run. Read [features/README.md](features/README.md) to choose a journey.

## Choose the proof

Name the user action, expected visible result, and any side effect that must follow. Pick the
owning desktop chapter or TUI scenario. Read its assertions and skip markers before running it.
Use the same input and fixture state before and after a fix.
Remove tests that duplicate stronger retained proof. Keep unique failure cases. Use the
smallest real journey first, then check nearby behavior. Keep results in run artifacts and the
task response; do not create an audit document unless requested.

Follow the root and package `AGENTS.md` files. Use pnpm and the runtimes in `mise.toml`.
Dev servers belong to the user. The test runners below launch their own instances. Inspect a
user's running instance only when asked, and leave its lifecycle alone. Coordinate shared build
outputs if another agent is building app, desktop, or the TUI binary.

## Doctor and launch

Record `git rev-parse HEAD`, relevant working-tree changes, the build command and its outcome,
and the exact test command. Rebuild after source changes. File timestamps alone do not establish
which source a binary contains. Missing dependencies or a failed build are setup failures.
If another task replaces build outputs or changes source during verification, record that
boundary. Use a pinned artifact for comparisons and rebuild once the source is stable.

Desktop uses an offline scripted provider, a temporary HOME and an Electron profile created by
`packages/desktop/e2e/launch.ts`, and each launch's own host launchd job (`nyte-host.js` on Electron's Node) started by
`packages/desktop/e2e/host.ts`. Build the five outputs in this order, then run one chapter.
All commands below run from the repository root.

```sh
verification_root=$(mktemp -d /tmp/nyte-verification.XXXXXX)
pnpm --dir packages/canvas build
VITE_NYTE_CLERK_PUBLISHABLE_KEY= pnpm --dir packages/app build
pnpm --dir packages/tui build
pnpm --dir packages/desktop build
pnpm --dir packages/desktop build:e2e
pnpm --dir packages/desktop exec playwright test --config e2e/playwright.config.ts e2e/chat.spec.ts --workers=1 --retries=0 --reporter=list --output="$verification_root/desktop"
```

Stop on a failed build. Select the matching chapter instead of `chat.spec.ts` when appropriate.
The launcher waits for `[data-nyte-shell]`; the journey must then assert the controls it needs
are usable. Desktop chapters share a window within each file, so replay the whole chapter when
the failing test depends on earlier steps. The fixture owns Electron tracing; a global
`--trace=on` flag does not establish that the ZIP contains Electron snapshots or pixels.

TUI journeys run in process. `startTui()` in `packages/tui/test/harness/tui.ts` mounts the
whole TUI on a test renderer with a manual clock, over an in-process host with `fakeModels` in an
isolated HOME. Run the owning test file first, then the suite. The binary smoke builds the binary
and covers only what it alone shows: pipes, print mode, exit codes, trust, `/quit` and `--session`.

```sh
cd packages/tui && bun test test/app/resume.test.ts
pnpm --dir packages/tui test
pnpm --dir packages/tui test:binary
```

`NYTE_BINARY` points the smoke at an existing build; record which build it ran.

Every runner starts from an empty store, so none of them can see rows an older build wrote.
After changing a stored shape, run `pnpm --dir packages/host check:store [path]`. It reads the
store read-only and exits 1 with each unreadable group, its count and first location.

For web verification, use `pnpm e2e:web`. First read `packages/app/e2e/server/address.ts` and inspect
the selected port with `lsof -iTCP:5181 -sTCP:LISTEN`, substituting `NYTE_E2E_PORT` when set.
The config reuses listeners outside CI. If the listener is unrelated, select an unused port
through `NYTE_E2E_PORT` for the entire command. HTTP readiness still needs a usable-page check.

## Drive and observe

Desktop selectors live in `packages/desktop/e2e/ui.ts`. The composer is
`getByRole("combobox", { name: "Message" })`; transcript assertions use the `Messages` region's
`log`. Use the chapter fixtures and existing user actions. Wait for the specific state required
by the next action. Register event waits before the action and avoid fixed sleeps.

For TUI changes, add or extend a test in `packages/tui/test/app` when coverage is needed. The
`startTui()` handle sends text, presses keys by command name with `press`, waits for a composed
frame with `frame`, and resizes. Command names and shortcuts live in
`packages/tui/src/lib/constants.ts`. Drive state through keys and the host, never by importing
state setters. Behaviour only the compiled binary shows goes in `packages/tui/qa/binary.smoke.ts`.

There is no visible playback command. Each journey is one test, so `bun test <file>` with
`--test-name-pattern` runs one. If an earlier step in a test fails, its later steps remain
unverified.

For streaming, focus, resize, or scrolling changes, observe the transition as well as its end.
Choose a concrete assertion such as one composer, preserved draft, stable focus, or no output
after cancellation. A final screenshot cannot establish what happened between states.
The desktop `/hold` provider emits once and then stays silent. Silence after Stop is therefore
insufficient; prove the run settled or a subsequent turn was accepted.

For browser panels, read `.agents/skills/integrated-browser/SKILL.md`. Guest pages are native
`WebContentsView`s. Record guest state and a composited window capture where the platform
supports it; an app DOM screenshot alone cannot prove guest pixels or overlay order.

## Identify and repeat

At the first mismatch, preserve the failure before cleanup. Locate the earliest failed step
and compare the input with these observations:

- Provider requests and process or file evidence show whether the action reached its owner.
- Session state read through the existing SDK or isolated store before fixture cleanup shows
  what persisted. A TUI test deletes its isolated HOME when it ends, so read the store inside
  the test when the diagnosis needs it.
- The screen, accessibility tree, and logs show what the client displayed.

Use these to distinguish a setup failure, an incorrect fixture, a product failure, and an
observation failure. A timeout alone does not identify the cause. Keep reads scoped to this
run's state. Do not invent a health endpoint or inspect personal sessions.

Within an authorized fix, change the cause and rebuild. Replay the same journey with retries
disabled, then the nearby behavior the change could affect. For an audit-only request, report
the finding without changing product code. Do not bypass a failing step, weaken its assertion,
or count a `skip` or `fixme` as coverage. If the same failure survives two fixes, revisit the
diagnosis instead of adding another delay or guard.

## Evidence and cleanup

Keep the failed and passing runs in separate locations. For desktop, retain the command output,
trace, explicit result screenshot and accessibility snapshot when a visual claim needs them.
The default chapter fixture saves its own trace only on failure. Inspect a trace ZIP's contents
before claiming it shows the Electron interaction. Passing visual proof currently requires
explicit captures in the owning chapter. Save file or provider effects alongside UI observations.
While the fixture is alive, use `testInfo.attach` with the PNG returned by
`desktop.page.screenshot()` and text returned by `desktop.page.locator("body").ariaSnapshot()`.
For an audit that does not authorize test edits, report missing captures as a proof limit.

TUI tests write no artifacts. Frames are emulated cell data from the test renderer and the
binary smoke reads raw PTY bytes, not PNG captures. Copy what a diagnosis needs out of the test
before it ends, and keep the runner's output.

For performance, the composer test holds each typed key to one frame (16.67 ms) at p95 and
50 ms at worst, and the startup tests hold keys typed at launch to 50 ms. Compare matching
inputs on the same identified build; unit-test duration is not application latency.

Let runner cleanup finish after a pass or failure. If interrupted, inspect the recorded process
ownership before stopping anything. Kill only processes this run created. Keep proof outside
temporary fixture homes and confirm it exists after cleanup. A signal, emulator, or screenshot
does not prove physical terminal scanout, clipboard, IME, or a packaged install.

Report the journey, build identity, command, result, skipped cases, evidence location, and what
remains unverified. Update the feature map only with facts supported by source or a named run.
