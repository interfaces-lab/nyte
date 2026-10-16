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
`packages/desktop/e2e/launch.ts`. Build the three outputs in this order, then run one chapter.
All commands below run from the repository root.

```sh
verification_root=$(mktemp -d /tmp/nyte-verification.XXXXXX)
VITE_NYTE_CLERK_PUBLISHABLE_KEY= pnpm --dir packages/app build
pnpm --dir packages/desktop build
pnpm --dir packages/desktop build:e2e
pnpm --dir packages/desktop exec playwright test --config e2e/playwright.config.ts e2e/chat.spec.ts --workers=1 --retries=0 --reporter=list --output="$verification_root/desktop"
```

Stop on a failed build. Select the matching chapter instead of `chat.spec.ts` when appropriate.
The launcher waits for `[data-nyte-shell]`; the journey must then assert the controls it needs
are usable. Desktop chapters share a window within each file, so replay the whole chapter when
the failing test depends on earlier steps. The fixture owns Electron tracing; a global
`--trace=on` flag does not establish that the ZIP contains Electron snapshots or pixels.

TUI requires ripgrep 12 or later on PATH. Build once, then run the existing binary QA directly
to choose a scenario without rerunning the unit suite on every investigation.

```sh
rg --version
pnpm --dir packages/tui build
node packages/tui/qa/run.mjs --scenario tui
node packages/tui/qa/run.mjs --scenario headless
```

Run only the relevant scenario first. The wrapper prints a unique evidence directory, installs
an environment allowlist, and starts isolated provider and workspace fixtures. Never invoke
`qa/main.ts` directly. Evidence includes the binary hash and version; its revision field names
the checkout at run time, so retain the build record as well.

Every runner starts from an empty store, so none of them can see rows an older build wrote.
After changing a stored shape, run `pnpm --dir packages/host check:store [path]`. It reads the
store read-only and exits 1 with each unreadable group, its count and first location.

For web verification, use `pnpm e2e`. First read `packages/app/e2e/server/address.ts` and inspect
the selected port with `lsof -iTCP:5181 -sTCP:LISTEN`, substituting `NYTE_E2E_PORT` when set.
The config reuses listeners outside CI. If the listener is unrelated, select an unused port
through `NYTE_E2E_PORT` for the entire command. HTTP readiness still needs a usable-page check.

## Drive and observe

Desktop selectors live in `packages/desktop/e2e/ui.ts`. The composer is
`getByRole("combobox", { name: "Message" })`; transcript assertions use the `Messages` region's
`log`. Use the chapter fixtures and existing user actions. Wait for the specific state required
by the next action. Register event waits before the action and avoid fixed sleeps.

For TUI changes, extend a named `beat` in `qa/tui.ts` or `qa/headless.ts` when coverage is needed.
`qa/drive.ts` and `qa/terminal.ts` already send input, wait for composed screens, resize, signal,
and inspect exit. Public shortcuts live in `src/lib/constants.ts`. Do not replace the compiled
app with imported controllers or state setters.

`pnpm --dir packages/tui test:show --step` plays the scripted scenario in a terminal of at least
100 columns and 33 rows. Enter advances; watcher keys do not reach Nyte. There is no external
start/send/inspect API or artifact replay command yet. Use the existing scenario to reproduce.
There is no named-step filter. If an earlier step fails, a later journey such as `/quit`
remains unverified.

For streaming, focus, resize, or scrolling changes, observe the transition as well as its end.
Choose a concrete assertion such as one composer, preserved draft, stable focus, or no output
after cancellation. A final screenshot cannot establish what happened between states.
The desktop `/hold` provider emits once and then stays silent. Silence after Stop is therefore
insufficient; prove the run settled or a subsequent turn was accepted.

For browser panels, read `.nyte/skills/integrated-browser/SKILL.md`. Guest pages are native
`WebContentsView`s. Record guest state and a composited window capture where the platform
supports it; an app DOM screenshot alone cannot prove guest pixels or overlay order.

## Identify and repeat

At the first mismatch, preserve the failure before cleanup. Locate the earliest failed step
and compare the input with these observations:

- Provider requests and process or file evidence show whether the action reached its owner.
- Session state read through the existing SDK or isolated store before fixture cleanup shows
  what persisted. TUI cleanup deletes the workspace store, so capture a scoped snapshot during
  the scenario when the diagnosis needs one.
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

TUI writes `evidence.json`, `provider.json`, and headless `cli.json` beneath the printed run
directory. Screens are emulated cell data and output is raw PTY bytes, not PNG captures. Input
records omit some payloads, so do not claim they can replay an arbitrary run. An interrupted
scenario may not write `evidence.json`. Preserve the wrapper's output and remaining artifacts.

For performance, inspect `actions["text.idle"]` in the TUI report. QA enforces p95 at or below
16.67 ms and maximum at or below 50 ms. Compare matching inputs on the same identified build;
unit-test duration is not application latency. For packaged desktop startup, use
`pnpm bench:desktop --exe /absolute/path/to/Nyte --scenario fresh --runs 3 --warmup 1 --out /tmp/nyte-startup.json`.
The executable must already be packaged. Report measured count, spread, failures and whether
the five-second splash limit passed. Use `--compare` for two identified builds; a single-build
budget check does not establish a before/after speedup.

Let runner cleanup finish after a pass or failure. If interrupted, inspect the recorded process
ownership before stopping anything. Kill only processes this run created. Keep proof outside
temporary fixture homes and confirm it exists after cleanup. A signal, emulator, or screenshot
does not prove physical terminal scanout, clipboard, IME, or a packaged install.

Report the journey, build identity, command, result, skipped cases, evidence location, and what
remains unverified. Update the feature map only with facts supported by source or a named run.
