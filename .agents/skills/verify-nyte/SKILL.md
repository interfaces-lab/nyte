---
name: verify-nyte
description: >
  Verify Nyte's Electron desktop, terminal client, or web app through the existing Playwright
  and compiled-binary QA runners. Use to reproduce a visible bug, identify where it starts,
  fix it within the requested scope, and replay the same journey before claiming it works.
  Not for looking at a page with the browser_* tools; read the workbench-browser skill for that.
---

# Verify Nyte

Use this skill to prove a visible behavior with a real run. Choose the proof, build and run the runner that owns it, follow the rules for the feature under test, find the cause of any failure, and report the run with its evidence.

## Choose the proof

Rule numbers are stable ids that other skills and reviews cite. A removed rule leaves a gap.

1. **Name the claim.** Write down the action, the visible result and any side effect the claim requires.
2. **Find the owning test.** The feature sections below map each feature to the tests that cover it. Read the test's assertions and skip markers before running it, because a mapped, skipped or `fixme` test is not a passing run.
3. **Run the smallest real journey first.** Run the journey that shows the claim, then nearby behavior, with identical input and fixtures before and after a fix.
4. **Run one test file while iterating.** Use `bun test <file>` in `packages/tui` and `pnpm exec vitest run <file>` everywhere else.
5. **Run a whole suite only as a final sweep.** Suites that run in parallel load the machine enough that unrelated app tests fail.
6. **Do not verify a skipped entry point through another one.** A passing journey through one entry point does not verify an entry point whose test is skipped.
7. **Report the run, not the mapping.** The claim rests on this run's own result and evidence, not on a feature section saying a test covers it.
8. **Add tests only when asked.** Delete a test that a stronger retained test duplicates, and keep any test that covers a unique failure case.
9. **Keep results out of new documents.** Put results in the run's artifacts and in the reply, never in an audit document nobody asked for.
10. **Leave the user's app alone.** Runners launch their own instance under a temporary `HOME`. Touch the user's running app or host only when asked, and never stop or restart it.
11. **Coordinate shared build outputs.** Coordinate with any other agent that builds the same outputs.

## Record and build

12. **Record the build identity.** Record `git rev-parse HEAD`, the working-tree changes, the build command and its outcome, and the exact test command.
13. **Rebuild after every source change.** Timestamps do not show which source a binary came from, and the desktop launcher rejects only missing outputs, not stale ones.
14. **Mark a mid-run change.** If another task changes source or outputs during the run, record where the change happened, compare against a pinned artifact, and rebuild once the tree is stable.

## Desktop runner

15. **Build in order, then run the owning chapter.** Run these from the repository root and stop at the first failed build.

    ```sh
    verification_root=$(mktemp -d /tmp/nyte-verification.XXXXXX)
    pnpm --dir packages/canvas build
    VITE_NYTE_CLERK_PUBLISHABLE_KEY= pnpm --dir packages/app build
    pnpm --dir packages/tui build
    pnpm --dir packages/desktop build
    pnpm --dir packages/desktop build:e2e
    pnpm --dir packages/desktop exec playwright test --config e2e/playwright.config.ts e2e/chat.spec.ts --workers=1 --retries=0 --reporter=list --output="$verification_root/desktop"
    ```

16. **Know what `pnpm e2e:desktop` does.** It builds every desktop output and runs every chapter.
17. **Assert usable controls.** The launcher waits only for `[data-nyte-shell]`, so assert that the controls the journey needs are usable before using them.
18. **Wait for state, never for time.** Use no fixed sleeps. Wait for the state the next action needs, and register an event wait before the action that fires the event.
19. **Replay the whole chapter when tests depend on each other.** A chapter's tests share one window and run in file order, so a failure that depends on earlier tests needs the whole chapter replayed.
20. **Use the shared locators.** Locators and helpers such as `setTheme` live in `packages/desktop/e2e/ui.ts`. Assert the transcript through `messages(page)`, which is the `Messages` region.
79. **Split a single pane by dragging a sidebar row.** A single pane has no header, so press the row, move about 20px first (the drag activates at 8px), move to the pane's edge, wait for `[data-nyte-drop-preview]`, then release. With two panes, scope the composer to its pane, since each has a `Message` combobox.
80. **Hover before clicking a hover-revealed control.** File-tab close buttons stay hidden until their tab is hovered; never force the click.
81. **Match names as the app writes them.** File tab and tabpanel names are workspace-relative paths, and search palette options carry their shortcut (`New Chat ⌘ N`), so match by the full name or a leading pattern.
82. **Return a value from an `expect.poll` callback.** `expect.poll` fails at once when its callback rejects, so turn a transient error such as `ENOENT` into a value that doesn't match.
83. **Size the real window.** Call `setContentBounds` through `desktop.application.evaluate` at a size inside the display's work area; never emulate the viewport.
84. **Keep the pointer off the left edge.** Within `REVEAL_EDGE` of the window's left edge a hidden sidebar starts its floating reveal.
85. **Wait only for document-timeline animations.** The tab strip's edge fade is scroll-driven and runs forever, so skip animations whose timeline isn't the `DocumentTimeline`.
86. **Run a probe as a spec.** Run it through `packages/desktop/e2e/playwright.config.ts`; a separate script that imports Playwright loads it a second time and fails.

## TUI runner

21. **Run the owning file, then the suite.** TUI journeys run over `startTui()` with a manual clock, an in-memory store and `fakeModels`. The binary smoke builds `dist/nyte` and covers only what `packages/tui/qa/README.md` lists.

    ```sh
    cd packages/tui && bun test test/app/resume.test.ts
    pnpm --dir packages/tui test
    pnpm --dir packages/tui test:binary
    ```

22. **Record which binary the smoke ran.** `NYTE_BINARY` points the smoke at an existing build instead of a fresh one, so record which build it used.
23. **Run one journey with `--test-name-pattern`.** Each journey is one test. Steps after a failed step stay unverified.
24. **Do not look for playback.** There is no command that plays a journey back visibly.
25. **Drive the TUI the way a user does.** Press keys by command name, and change state through keys and the host, never by importing state setters.
87. **Run the CLI from outside the repository root.** Bun loads the root `.env.local`, whose credentials make an empty home look signed in.
88. **Wait for output before sending SIGINT on a fresh `HOME`.** The CLI installs its signal handlers only after its source loads, which is slow without Bun's cache, so an earlier SIGINT kills it with no output.

## Web runner

26. **Check the port before `pnpm e2e:web`.** Run `lsof -iTCP:5181 -sTCP:LISTEN`, or check the `NYTE_E2E_PORT` port when it is set. Outside CI the config reuses any server already listening there, so if that server is not this run's, set a free `NYTE_E2E_PORT` for the whole command.
27. **Clear account sign-in.** Clear it the way `packages/app/e2e/README.md` shows.
28. **Check that the page is usable.** HTTP readiness alone does not prove the page works, so also check that the page can be used.

## Stored shapes

29. **Check old stores separately.** No runner opens a store that an older build wrote. `pnpm --dir packages/host check:store [path]` without a path reads the real home's store read-only and exits 1 on any row it cannot read.
89. **Copy a live store with `node:sqlite`.** Open `nyte.db` read-only and call `backup(db, dest, { rate: 2147483647 })`, which copies in one step; `sqlite3 .backup` restarts on every write the host makes. Inspect a copy with `sqlite3 "file:<copy>?immutable=1"`.

## Served host

90. **Verify a served host after changing serving, auth or `host.sock`.** The first command starts its own host in a temp home and checks HTTP, the socket, auth, the SDK, WebSocket, MCP, one host per home and SIGTERM. `--attach` reads the live host over `host.sock` without a token.

    ```sh
    pnpm --dir packages/service verify:host
    pnpm --dir packages/service verify:host --attach
    ```

91. **Keep unix socket paths under 104 bytes.** That is macOS's limit, so use a short temp prefix and don't `realpath` the temp directory, which adds `/private`.
92. **Guard WebSocket `{ headers }`.** Node's WebSocket accepts `{ headers }` at runtime, but the DOM type forbids it, so narrow the class with a guard like the SDK's `webSocketClass`.

## Conversation

30. **Use the scripted prompts.** `packages/desktop/e2e/chat.spec.ts` uses the offline scripted prompts listed in `packages/desktop/e2e/README.md`.
31. **Prove send with the first-message test.** `chat.spec.ts` › "a new chat is created by its first message, answered and named" covers sending.
32. **Run the follow-up after its setup.** "a follow-up appends to the open chat" needs the chat the previous test created.
33. **Extend the stop test for a fix.** "a held response can be stopped" sends `/hold`, clicks `Stop response` once `Holding` shows, then expects `Echo: After stopping`. It checks no persisted run state and no notice, so extend it within scope for whatever a claimed fix needs.
34. **Prove attachments with the byte count.** `composer.spec.ts` › "an attached image starts a new chat with its first message" stubs `dialog.showOpenDialog`, attaches a PNG, and expects `Echo: <text>[File Image 1, <bytes> bytes, image/png]` and the `Image 1` thumbnail. The byte count proves that the host stored the upload.
35. **Prove upload failures in a browser engine.** Upload failures show only in a browser engine, because Node's fetch streams request bodies over HTTP/1.1 and Chromium does not. SDK unit tests cannot stand in for that run.
36. **Use the web project for reload.** `packages/app/e2e/web/chat.spec.ts` › "a new chat shows the reply and takes its title from the provider" expects the same reply and URL after a reload.
37. **Do not take silence after Stop as proof.** `/hold` emits once, so silence after Stop proves nothing. Require settled run state or an accepted next turn. The host ends a stopped run within 3 s even when its tool ignores the signal.
38. **Prove the stopping state in the app test.** Only the app's `composer-states.electron.test.ts` checks the stopping state that the composer shows from the press until the host's run takes over.

## Provider sign-in

39. **Know the entry points.** Sign-in starts from the TUI's `/login`, from `nyte login`, or from Settings › Models › Connect Provider on desktop and web. `/accounts` in the TUI switches accounts.
40. **Know how desktop and web pick the browser.** They send `browser: "host"` or `"elsewhere"` with `models.login`, chosen from the endpoint hostname. `localhost`, `127.0.0.1` and `[::1]` count as local, so a tunnel to a remote host counts as local too.
41. **Know what `elsewhere` changes.** With `elsewhere`, Anthropic uses a copy-code flow and OpenAI Codex uses a device code, so desktop and web skip the provider's method question. `nyte login` sends `elsewhere` under `--no-open` or when no browser is available.
42. **Know how accounts are named.** The first account is named "Account 1" without a prompt. The TUI and CLI prompt for the names of later accounts, and `nyte login --label` skips that prompt. The name travels as the `label` of `models.login`.
43. **Test host naming, steps and cancel in core and ai.**

    ```sh
    pnpm --dir packages/core exec vitest run test/models.test.ts
    pnpm --dir packages/ai exec vitest run test/models-runtime.test.ts
    ```

44. **Test the provider's method choice in ai.**

    ```sh
    pnpm --dir packages/ai exec vitest run test/anthropic-oauth.test.ts test/openai-codex-oauth.test.ts
    ```

45. **Test the wire in host.** This test round-trips a `label` through `models.accounts`. No wire test sends `browser`.

    ```sh
    pnpm --dir packages/host exec vitest run test/serve/client.test.ts
    ```

46. **Test the TUI dialog frames and journeys.** The first command covers the dialog frames, and the second covers the `/accounts` and API-key `/login` journeys.

    ```sh
    cd packages/tui && bun test test/ui/dialogs/auth.test.tsx test/app/app.test.tsx
    cd packages/tui && bun test test/app/menus.test.ts test/app/app.test.tsx
    ```

47. **Test desktop and web in real Electron without an app build.** The test's bridge, `src/settings/fixtures/login-harness-bridge.ts`, scripts steps with `step(...)` and records the `models.login` input, the `login.answer` codes and the `host.openExternal` calls. `setEndpoint(url)` picks a local or a remote host.

    ```sh
    pnpm --dir packages/app exec vitest run src/settings/models-settings-login.electron.test.ts
    ```

48. **Prove a sign-in change with four facts.** Report the action, the visible step, the recorded `models.login` input or answered code, and the saved `models.accounts` label.
49. **Say that no runner reaches a real provider.** Only the ai tests, with a stubbed `fetch`, prove OAuth flows. Say so when reporting.
50. **Pair the Electron harness with the core test.** The harness fakes the host, so pair it with the core test to prove a saved account.
51. **Name the `setEndpoint` test for a remote-host claim.** There is no web e2e sign-in journey, so a remote-host claim must name the harness's `setEndpoint` test.

## TUI

52. **Know where TUI tests live.** The terminal client runs one prompt headless (`nyte -p "<prompt>"`, `--json`) or shows an interactive screen. Interactive journeys live in `packages/tui/test/app`. Headless and compiled-binary cases live in `packages/tui/qa/binary.smoke.ts`, which `test:binary` runs.
53. **Prove quit and resume with the resume test.** `resume.test.ts` › "/quit names the resume command; --session reopens the transcript, model and level, and the next request carries the history" also requires exit code 0. Confirm that this test passed before claiming that either quit or resume works.
54. **Do not claim terminal output from emulated screens.** Emulated text screens do not prove colors, clipboard, the image protocol or physical scanout.

## Browser panel

55. **Read the integrated-browser skill first.** Desktop shows web pages as native `WebContentsView`s above the app's DOM. The Testing section of the integrated-browser skill says which test proves an overlay or occlusion change.
56. **Use the browser journey.** `packages/desktop/e2e/browser.spec.ts` › "the integrated browser journey" serves a local HTTP fixture and walks the panel in named steps, checking the guest's URL, title and loading state through Electron.
57. **Capture the window, not the DOM.** DOM screenshots miss native views.
58. **Do not claim the skipped blocking step.** The step "pause and restore blocking for this host" is `test.step.skip`, and the rest of the journey does not exercise it.
59. **Do not claim pixels from guest state.** Guest-state assertions do not prove the composited page pixels.

## Find the cause

60. **Assert the transition as well as the end.** For streaming, focus, resize or scroll changes, assert what happens on the way, such as one composer, a kept draft, stable focus or no output after cancel.
61. **Preserve the first failure.** At the first mismatch, save the failure before any cleanup runs. Check the earliest failed step against provider requests, process or file effects, session state from the SDK or the run's store, and the screen, accessibility tree and logs.
62. **Read TUI state inside the test.** The TUI test host keeps its store in memory and deletes its temporary home at dispose, so state is gone once the test ends.
63. **Separate setup failures from product failures.** A failed build or a wrong fixture is a setup failure, not a product or observation failure. A timeout alone names no cause.
64. **Read only this run's state.** Do not invent a health endpoint, and do not open personal sessions.
65. **Replay after an authorized fix.** Change the cause, rebuild, and replay the same journey with retries off, then nearby behavior.
66. **Change no product code in an audit.** For an audit-only request, report the findings and leave the product code as it is.
67. **Never bypass a failing step.** Do not skip a failing step or weaken its assertion.
68. **Revisit the diagnosis after two failed fixes.** If one failure survives two fixes, go back to the diagnosis instead of adding a delay or a guard.

## Evidence and cleanup

69. **Keep failed and passing runs apart.** Store them in separate locations, with file or provider effects next to the UI observations.
70. **Check a trace ZIP before citing it.** The desktop fixture attaches an Electron trace ZIP and main-process output only on failure. A global `--trace=on` gives no Electron snapshots or pixels.
71. **Capture passing visual proof in the chapter.** Passing visual proof needs a screenshot and an accessibility snapshot captured in the chapter and kept apart from the failed run's, like the `testInfo.attach` pair in `chat.spec.ts` › "a held response can be stopped". If you may not edit tests, report the missing captures as a limit of the proof.
72. **Copy TUI evidence before the test ends.** TUI tests write no artifacts. Frames are emulated cell text, and the binary smoke reads raw PTY bytes. Copy what the diagnosis needs before the test ends, and keep the runner output.
73. **Measure typing latency with the gating tests.** The composer and startup tests in `packages/tui/test/app` gate typing latency. Compare matching inputs on one identified build, because a unit test's duration is not app latency.
74. **Let runner cleanup finish.** If a run is interrupted, kill only the processes you recorded as this run's.
75. **Keep proof outside fixture homes.** Store proof outside temporary fixture homes, and confirm it survives cleanup.
76. **Name what a run cannot prove.** A signal, an emulator or a screenshot does not prove physical terminal scanout, clipboard, IME or a packaged install.
77. **Report the whole run.** Report the journey, the build identity, the command, the result, the skipped cases, where the evidence is and what stays unverified.
78. **Back every change to this skill.** Update the feature sections of this skill only with facts backed by source or by a named run.
