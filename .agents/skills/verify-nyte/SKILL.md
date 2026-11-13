---
name: verify-nyte
description: >
  Verify Nyte's Electron desktop, terminal client, or web app through the existing Playwright
  and compiled-binary QA runners. Use to reproduce a visible bug, identify where it starts,
  fix it within the requested scope, and replay the same journey before claiming it works.
  Not for looking at a page with the browser_* tools; read
  .agents/skills/workbench-browser/SKILL.md for that.
---

# Verify Nyte

A mapped, skipped or `fixme` test is not a passing run. Read [features/README.md](features/README.md) to choose a journey.

## Choose the proof

Name the user action, the visible result and any side effect that must follow. Pick the owning desktop chapter or TUI test and read its assertions and skip markers before running it. Use the same input and fixture state before and after a fix. Start with the smallest real journey, then check nearby behavior. Remove tests that duplicate stronger retained proof; keep unique failure cases. Keep results in run artifacts and the reply, and write no audit document unless asked.

Each runner launches its own instance under a temporary `HOME`. Inspect the user's running app or host only when asked, and leave its lifecycle alone. Coordinate shared build outputs if another agent is building the app, desktop or TUI binary.

## Record and build

Record `git rev-parse HEAD`, relevant working-tree changes, the build command and its outcome, and the exact test command. Rebuild after source changes; a file timestamp does not show which source a binary holds, and the desktop launcher fails only on a missing output, never a stale one. If another task changes source or build outputs mid-run, record that boundary, compare against a pinned artifact, and rebuild once the source is stable.

**Desktop.** From the repository root, build the five outputs in this order and stop on a failure, then run the owning chapter:

```sh
verification_root=$(mktemp -d /tmp/nyte-verification.XXXXXX)
pnpm --dir packages/canvas build
VITE_NYTE_CLERK_PUBLISHABLE_KEY= pnpm --dir packages/app build
pnpm --dir packages/tui build
pnpm --dir packages/desktop build
pnpm --dir packages/desktop build:e2e
pnpm --dir packages/desktop exec playwright test --config e2e/playwright.config.ts e2e/chat.spec.ts --workers=1 --retries=0 --reporter=list --output="$verification_root/desktop"
```

The launcher waits for `[data-nyte-shell]`; the journey must then assert that the controls it needs are usable. A chapter's tests share one window in file order, so replay the whole chapter when a failing test depends on earlier ones.

**TUI.** `startTui()` mounts the whole TUI on a test renderer with a manual clock, over an in-process host with an in-memory store and `fakeModels`. Run the owning file, then the suite. The binary smoke builds `dist/nyte` and covers only what the compiled binary shows, which `packages/tui/qa/README.md` lists.

```sh
cd packages/tui && bun test test/app/resume.test.ts
pnpm --dir packages/tui test
pnpm --dir packages/tui test:binary
```

`NYTE_BINARY` points the smoke at an existing build; record which one. Each journey is one test, so `--test-name-pattern` runs one, and steps after a failed step stay unverified. There is no visible playback command.

**Web.** Before `pnpm e2e:web`, run `lsof -iTCP:5181 -sTCP:LISTEN`, or use the `NYTE_E2E_PORT` value when set. Outside CI the config reuses any listener there, so if it is not this run's server, set a free `NYTE_E2E_PORT` for the whole command. Clear account sign-in for the build as `packages/app/e2e/README.md` shows. HTTP readiness still needs a usable-page check.

**Stored shapes.** No runner opens a store an older build wrote. Desktop seeds its baseline with the current build, and the others start empty. After changing a stored shape, run `pnpm --dir packages/host check:store [path]`. Without a path it reads the real home's store, read-only, and exits 1 on any unreadable row.

## Drive and observe

Desktop locators live in `packages/desktop/e2e/ui.ts`; transcript assertions go through `messages(page)`, the `Messages` region. In TUI tests, press keys by command name and change state through keys and the host, never by importing state setters. Add or extend a test only when asked for coverage.

For streaming, focus, resize or scrolling changes, observe the transition as well as its end, with a concrete assertion such as one composer, a preserved draft, stable focus, or no output after cancellation. A final screenshot cannot show what happened between states.

For browser panels, read `.agents/skills/integrated-browser/SKILL.md` first. Guest pages are native `WebContentsView`s, so an app DOM screenshot cannot prove guest pixels or overlay order. Record guest state and a composited window capture where the platform supports it.

## Find the cause and repeat

At the first mismatch, preserve the failure before cleanup. Find the earliest failed step and compare its input with:

- Provider requests and process or file evidence, for whether the action reached its owner.
- Session state read through the SDK or the run's store before fixture cleanup, for what persisted. The TUI test host keeps its store in memory and deletes its temp home at dispose, so read state inside the test.
- The screen, accessibility tree and logs, for what the client displayed.

Use them to tell a setup failure such as a failed build, a wrong fixture, a product failure and an observation failure apart. A timeout alone does not name the cause. Read only this run's state; do not invent a health endpoint or open personal sessions.

Within an authorized fix, change the cause, rebuild, and replay the same journey with retries off, then the nearby behavior. For an audit-only request, report without changing product code. Never bypass a failing step, weaken its assertion, or count a `skip` or `fixme` as coverage. If the same failure survives two fixes, revisit the diagnosis instead of adding another delay or guard.

## Evidence and cleanup

Keep failed and passing runs in separate locations, with file or provider effects next to UI observations. The desktop fixture owns Electron tracing and attaches a trace ZIP and the main process output only when a test fails; a global `--trace=on` does not give Electron snapshots or pixels. Inspect a ZIP's contents before claiming it shows the Electron interaction. Passing visual proof needs explicit captures in the owning chapter, like the `testInfo.attach` pair in `chat.spec.ts`'s "a held response can be stopped". Without authority to edit tests, report missing captures as a proof limit.

TUI tests write no artifacts. Frames are emulated cell text and the binary smoke reads raw PTY bytes. Copy what the diagnosis needs out of the test before it ends, and keep the runner's output.

For performance, the composer and startup tests in `packages/tui/test/app` gate typing latency. Compare matching inputs on the same identified build; unit-test duration is not application latency.

Let runner cleanup finish. If interrupted, check the recorded process ownership and kill only processes this run created. Keep proof outside temporary fixture homes and confirm it exists after cleanup. A signal, emulator or screenshot does not prove physical terminal scanout, clipboard, IME or a packaged install.

Report the journey, build identity, command, result, skipped cases, evidence location and what remains unverified. Update the feature map only with facts backed by source or a named run.

## Not covered

- Live TUI runs with `pnpm dev:live`, which root `AGENTS.md` owns. With an isolated `HOME`, `mise` refuses to run, so resolve node first with `N=$(mise which node)` under the real `HOME` and put its directory on `PATH`.
- Checking a screen in light and dark, which `nyte-styles` sends agents here for. Desktop `ui.ts` has `setTheme`.
