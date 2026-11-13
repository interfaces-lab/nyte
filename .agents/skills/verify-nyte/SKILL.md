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

## Choose the proof

1. Name the action, the visible result and any required side effect.
2. Find the owning test in [features/README.md](features/README.md). Read its assertions and skip markers first; a mapped, skipped or `fixme` test is not a passing run.
3. Run the smallest real journey, then nearby behavior, with identical input and fixtures before and after a fix.

- Add tests only when asked. Delete tests a stronger retained one duplicates; keep unique failure cases.
- Put results in run artifacts and the reply, never in an unrequested audit document.
- Runners launch their own instance under a temporary `HOME`. Touch the user's running app or host only when asked; never stop or restart it.
- Coordinate shared build outputs with any other agent building them.

## Record and build

Record `git rev-parse HEAD`, working-tree changes, the build command and outcome, and the exact test command.

Rebuild after every source change. Timestamps do not show a binary's source, and the desktop launcher rejects only missing outputs, not stale ones. If another task changes source or outputs mid-run, record the boundary, compare against a pinned artifact, and rebuild once it is stable.

**Desktop.** From the repository root, build in this order, stop on a failure, then run the owning chapter:

```sh
verification_root=$(mktemp -d /tmp/nyte-verification.XXXXXX)
pnpm --dir packages/canvas build
VITE_NYTE_CLERK_PUBLISHABLE_KEY= pnpm --dir packages/app build
pnpm --dir packages/tui build
pnpm --dir packages/desktop build
pnpm --dir packages/desktop build:e2e
pnpm --dir packages/desktop exec playwright test --config e2e/playwright.config.ts e2e/chat.spec.ts --workers=1 --retries=0 --reporter=list --output="$verification_root/desktop"
```

- The launcher waits only for `[data-nyte-shell]`, so assert that the controls the journey needs are usable.
- No fixed sleeps. Wait for the state the next action needs, and register an event wait before the action.
- A chapter's tests share one window in file order. When a failure depends on earlier tests, replay the whole chapter.
- Locators live in `packages/desktop/e2e/ui.ts`. Assert the transcript through `messages(page)`, the `Messages` region.
- For browser panels, read [features/desktop-browser.md](features/desktop-browser.md).

**TUI.** Journeys run over `startTui()` with a manual clock, an in-memory store and `fakeModels`. Run the owning file, then the suite. The binary smoke builds `dist/nyte` and covers only what `packages/tui/qa/README.md` lists.

```sh
cd packages/tui && bun test test/app/resume.test.ts
pnpm --dir packages/tui test
pnpm --dir packages/tui test:binary
```

- `NYTE_BINARY` points the smoke at an existing build; record which.
- Each journey is one test, so `--test-name-pattern` runs one. Steps after a failed step stay unverified.
- There is no visible playback command.
- Press keys by command name. Change state through keys and the host, never by importing state setters.

**Web.** Before `pnpm e2e:web`, check `lsof -iTCP:5181 -sTCP:LISTEN`, or the `NYTE_E2E_PORT` port when set. Outside CI the config reuses any listener there, so if it is not this run's server, set a free `NYTE_E2E_PORT` for the whole command. Clear account sign-in as `packages/app/e2e/README.md` shows. HTTP readiness still needs a usable-page check.

**Stored shapes.** No runner opens a store an older build wrote. `pnpm --dir packages/host check:store [path]` with no path reads the real home's store read-only and exits 1 on any unreadable row.

## Find the cause

For streaming, focus, resize or scroll changes, assert the transition as well as the end, such as one composer, a kept draft, stable focus or no output after cancel.

At the first mismatch, preserve the failure before cleanup. Check the earliest failed step against provider requests, process or file effects, session state from the SDK or the run's store, and the screen, accessibility tree and logs. The TUI test host keeps its store in memory and deletes its temp home at dispose, so read state inside the test.

Separate setup failures, such as a failed build or wrong fixture, from product and observation failures. A timeout alone names no cause. Read only this run's state; invent no health endpoint and open no personal sessions.

- For an authorized fix, change the cause, rebuild, and replay the same journey with retries off, then nearby behavior.
- For an audit-only request, report and change no product code.
- Never bypass a failing step or weaken its assertion.
- If one failure survives two fixes, revisit the diagnosis instead of adding a delay or guard.

## Evidence and cleanup

- Keep failed and passing runs in separate locations, with file or provider effects beside UI observations.
- The desktop fixture attaches an Electron trace ZIP and main-process output only on failure. A global `--trace=on` gives no Electron snapshots or pixels. Check a ZIP's contents before citing it.
- Passing visual proof needs a screenshot and accessibility snapshot captured in the chapter, kept apart from the failed run's, like the `testInfo.attach` pair in `chat.spec.ts` › "a held response can be stopped". If you may not edit tests, report missing captures as a proof limit.
- TUI tests write no artifacts. Frames are emulated cell text, and the binary smoke reads raw PTY bytes. Copy what the diagnosis needs before the test ends, and keep runner output.
- The composer and startup tests in `packages/tui/test/app` gate typing latency. Compare matching inputs on one identified build; unit-test duration is not app latency.
- Let runner cleanup finish. If interrupted, kill only processes recorded as this run's.
- Keep proof outside temporary fixture homes and confirm it survives cleanup.
- A signal, emulator or screenshot does not prove physical terminal scanout, clipboard, IME or a packaged install.

Report the journey, build identity, command, result, skipped cases, evidence location and what stays unverified. Update feature files only with facts backed by source or a named run.

## Not covered

- Live TUI runs with `pnpm dev:live`, owned by root `AGENTS.md`. Under an isolated `HOME`, `mise` refuses to run, so resolve `N=$(mise which node)` under the real `HOME` and put its directory on `PATH`.
- Light and dark checks, which `nyte-styles` routes here. Desktop `ui.ts` has `setTheme`.
