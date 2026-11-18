# Desktop E2E

Playwright tests for the Electron e2e build in `out-e2e`, configured in `playwright.config.ts`. Each spec file is a chapter. A chapter launches one window over its own copy of a seeded home and walks one part of the app.

## Run it

```sh
pnpm e2e:desktop
```

This builds the canvas shell, the app, the `nyte` binary, the desktop and its e2e entry, then runs every chapter. To build by hand instead:

```sh
pnpm --dir packages/canvas build
pnpm --dir packages/app build
pnpm --dir packages/tui build
pnpm --dir packages/desktop build
pnpm --dir packages/desktop build:e2e
```

The `packages/tui` build runs on Bun and writes `dist/nyte-tailnet`, the host's sidecar, which needs Go. `build:e2e` needs the regular desktop build.

To run one chapter against an existing build:

```sh
pnpm --dir packages/desktop exec playwright test --config e2e/playwright.config.ts e2e/settings.spec.ts --reporter=list
```

Results land in `e2e/test-results/` and `e2e/playwright-report/`. A failed test saves a screenshot, and `e2e/test-results/<test>/error-context.md` holds the accessibility snapshot at the failing step. Tests run one at a time. In CI a failed test retries twice and records a trace on the first retry. Locally there are no retries, so there is no trace.

CI runs the suite on Linux under `xvfb-run` in three shards and skips `polish.spec.ts`.

## How it works

The model catalog is the offline `Scripted` model. It answers by prompt:

| Prompt | Answer |
| --- | --- |
| `/hold` | Streams until you stop it |
| `/error` | Refuses with a provider error |
| `/think` | Answers with reasoning |
| `/markdown` | Answers with a Markdown sample |
| `/long <n>` | Answers with `n` paragraphs, 12 without `n` |
| `/agents` | Starts two background agents, `Map the core` and `Map the app` |
| `/swarm` | Starts five agents that each stream notes and read a file for eight rounds, then answer |
| `/warm` | Edits both accents in `design/tokens.css` of the sample designs, then says so |
| Anything else | `Echo: <text>` |

Each launch starts its own host, and the app finds it the way it does in production. The e2e build's `nyte-host.js` runs on Electron's Node with `ELECTRON_RUN_AS_NODE=1` for the chapter's isolated `HOME`. On macOS it runs as a launchd job with its own label. Elsewhere the suite spawns it directly. The host is signed in with a key to a local Anthropic endpoint that serves the scripted catalog. The app gets the label in `NYTE_DESKTOP_HOST_LABEL`, finds the job and connects to its socket. Closing the launch boots the job out.

`baseline.ts` builds the seeded home once through `sdk.open` over the scripted catalog and caches it under `e2e/.cache/<fingerprint>`. The fingerprint covers the baseline, the catalog, the e2e host, the store, core, schema and the lockfile. A change to any of them rebuilds the cache. Each chapter copies the cache into a temp `HOME`, so chapters never share state and run in any order.

Closing a chapter's desktop fails if any process of Electron's tree is still running 5 s after it quits, or if its host outlives the job's bootout. The host's log and the scripted catalog's `NYTE_E2E_*` lines join the launch's output.

Every start says where its time went before a test could act. Each host prints an `e2e host:` line (the scripted catalog, signing in, the launchd job until it serves), each launch a `desktop launch:` line (Electron's launch, the first window, the shell showing), and each chapter a `<chapter> startup:` line with Playwright's share in front (the runner until the run's first worker started, then that worker's boot), the seeded home, the launch, and starting Playwright's tracing. Every test attaches the chapter's line as `desktop-startup`, and a bench writes it into its JSON as `startup`.

The chapters that drive Nyte, Code and Studio together take their windows from the `desk` fixture instead of `desktop`: one launch per test over its own seeded home with the sample designs in `design`, the Nyte window open on a seeded chat, and the apps the test names with `test.use({ opened })` opened beside it from the titlebar's app buttons. Every window's page errors and console errors fail the test, and a failed test keeps a capture of every window. A window the others cover entirely stops drawing, so a test that watches a change land in several windows lays them out side by side with `desk.tile()`, and `desk.capture` raises a window and lets its transitions end before capturing it. Captures come from the window server, so they show the vibrancy, the traffic lights and the shadow; with the Mac's screen locked they fall back to the page alone, and the test says so in an annotation.

## Chapters

| File | Covers |
| --- | --- |
| `first-run.spec.ts` | An empty home: new chat, nothing listed |
| `startup.spec.ts` | A relaunch with the host held: the last run's chats and model, and a draft that sends once the host opens. With `NYTE_PERF_DIR`, also a relaunch into a long chat with the host left running, traced from before the window loads. Saves `startup.json`: each startup mark since launch, how long the skeleton was mounted and on screen, and the renderer's time split into host wait, transfer, React, layout and other |
| `host-restart.spec.ts` | The host killed under a chat. launchd restarts it, the window reconnects, and a message sent during the outage lands once. Quitting the app leaves the host running, and a relaunch reconnects to the same process |
| `navigation.spec.ts` | Tabs, the chat card, history, Chat actions, Customize, Search |
| `panes.spec.ts` | Dragging chats onto pane edges and centers: the drop preview, splits and restacks, Escape cancelling, and the open pane never remounting. The split sash, sidebar and workbench handles dragged with the mouse, clamped, reset and stepped from the keyboard. The ratio across a reload |
| `settings.spec.ts` | Settings opening on Server with the running host's card, every settings page, the settings search, Back |
| `chat.spec.ts` | A first message, stop, provider errors, thinking |
| `composer.spec.ts` | Send state, Shift+Enter, drafts, the skills list, the model button, and paste with no field focused. An image attached through Attach Files… starting a new chat in an open folder. The footer under the composer in a git folder: branch and machine segments, checking out, creating, and git's refusal |
| `markdown.spec.ts` | Headings, lists, code blocks, tables in an answer |
| `subagents.spec.ts` | Two background agents: one block, a line per report, the parent wakes. A transcript link opens the child next to its parent, and its tab menu reopens the parent. A tray row previews, Open as full chat opens the tab, and Clear Finished empties the tray |
| `transcript.spec.ts` | A 36-turn chat: the virtualized window, scrolling to the top and back. Unread replies: the divider clearing after a visit, and a new divider for replies that arrive while the window is away |
| `chat-rendering.spec.ts` | Chat switching, native history scrolling, the latest-turn footer handoff, and message edit, cancel and save. Observes row coverage and identity through transitions and saves a video, screenshots and accessibility snapshots |
| `subagent-load.spec.ts` | Typing while five agents stream, a child chat open, and the agents row evicted and remounted, with the app's work counters on. Gates each typing step's work against ceilings that don't grow with the stream: the composer commits once per typed key plus three, the parent chat, its rows, the agents rows and tray a fixed few times, and store notifications at most 1.5 per view publication. Attaches the counts as `work`. With `NYTE_PERF_DIR`, also traces the run, gates keydown-to-paint p99 at 50 ms and maximum at 100 ms, whole-run render work p99 at 16.67 ms, and no renderer task over 50 ms from the start of typing to completion, and saves the trace, frame cadence, latency, row churn and work counts |
| `chat-switching.spec.ts` | Six seeded 120-turn chats, each opened once and then once more, with the app's work counters on (`NYTE_TRACE`). Gates the median switch's commits, row selections, view publications and notifications against a budget per counter, set about 20% over a calibration whose medians matched in every run, and attaches them as `work-per-switch`. With `NYTE_PERF_DIR`, saves them as `chat-switching-work.json`, then switches in a fixed order 20 times in one launch, each switch timed from the click to the new chat's last message painted, and saves `chat-switching.json` with the median, p95, and each switch's time split into host wait, transfer, React, layout and other, its forced layouts and skeleton time, and the hottest functions of the slowest switches, plus the CPU profile and the renderer thread's trace |
| `workbench.spec.ts` | The panel, the Editor, Changes, Terminal and Browser tabs, Expand, closing tabs |
| `apps.spec.ts` | Nyte, Code and Studio on one project: the titlebar's app buttons, Code maximized on the Editor and Studio on Design with only their launchers, an editor selection kept across a flip (Control+Shift+Space) and landed in a Code window opened by its key, Studio's empty state and then its designs list and board, a new Studio window's board flying to an element selected in the one before, and each window back as its kind after a relaunch. Launches twice over one app-data folder, as `startup.spec.ts` does |
| `scenarios.spec.ts` | Nyte, Code and Studio on the sample designs, one launch per test. Studio alone, with Nyte closed: the board, and its own chat asking for an agent's change that lights the frames and warms the accent. Code alone: what is typed in it saved to disk, and the agent beside it changing the open file as it lands. The three side by side: a selection in Code's editor ringing its element on Studio's board, words retyped on the board appearing in Code's open file, an edit saved in Code redrawing the board, and an agent's change asked for in Nyte lighting the board and landing in Code's open file |
| `budget.spec.ts` | macOS only. The three windows side by side on the sample designs: the app's processes' `phys_footprint` idle (at most 1.5 GB), working while five agents stream and Code types and saves (2.5 GB), the cost of one more window (300 MB), and with 300 more frames on Studio's board (4 GB); and key-to-screen, keydown to the next paint, of typing in Code's editor while that runs (p95 at most 50 ms). Attaches the readings as `budget`, and saves the typing's trace |
| `material.spec.ts` | macOS only, and skipped while the screen is locked. Each window kind in light, dark and light again: a capture of the window shows the material opaque behind the clear backing, in the theme's tone and back the same in light, and the screen shows a red and then a blue window placed behind it through the material. The traffic lights' centre within a point of the titlebar's middle, measured from window captures, when each window shows, loses and gains the keyboard, and after each change of appearance |
| `functions.spec.ts` | One capture per function of each window kind, in dark and in light, for grading by eye: Studio's board, a hover, a selection, words typed, a frame moving, a screen, the other light, its chat and an agent's change; Code's file, a selection, the agent's change, Changes and Terminal; Nyte's chat, a new chat and its workbench; and every window without the sidebar. Asserts only what a capture needs to be of the right moment |
| `browser.spec.ts` | The integrated browser against a local HTTP server |
| `remote-access.spec.ts` | Settings > Server reading the host's own Tailscale node |
| `scenario-u.spec.ts` | Scenario U from the keyboard: a skill, a cold places MCP server, a canvas and its link in the browser, an approved command, quitting mid-answer, relaunching and resuming. Checks each hop's span against its budget |
| `scenario-d.spec.ts` | Scenario D from the keyboard over a temp git repo and the CI MCP server: the skill's route, the 5 MiB log's tail, the canvas's file:line link in the editor and job link in the browser, a terminal rerun, commit and push, quit and resume with the frame compared, and Changes from git and from the run's snapshots. Checks each hop against its budget. Set `NYTE_WATERFALL_DIR` to save the waterfall |
| `editor-scenarios.spec.ts` | Runs only with `NYTE_PIERRE_OUT`. The Code window alone on two real projects, with the app kept in the background (no window takes the focus): Go (cobra and golang.org/x/tools, cloned to `/tmp/cobra` and `/tmp/xtools`, with gopls) with eight typical files and x/tools' largest, and TypeScript (a copy of this repository's files at `NYTE_PIERRE_TS`, with typescript-language-server). Measures the Code window's `phys_footprint` with no file open, idle and after work, before and after a forced GC; cold open, tab switches, key-to-screen and Enter-to-screen in a typical and the largest file with a plain textarea's as the floor, main-thread time per key from a CPU profile, wheel-scroll frame times, and time to declaration. Writes `<NYTE_PIERRE_LABEL>-<scenario>.json` there, and the traces and CPU profiles to the output folder. `NYTE_E2E_OUT` launches a copy of an `out-e2e` build instead, so two builds can be compared while the tree changes |
| `grid.spec.ts` | Runs only with `NYTE_GRID_OUT`; `NYTE_GRID_OUT=<dir> pnpm --dir packages/desktop grid` runs it. Twelve window states, at a size that fits the display, checked against the spatial grid in `grid/rules.ts`: spacing, sizes, radii, icons, type pairs, half pixels, each region's rails and row rhythm, rows that face each other across regions, and each chat pane showing its last line. Writes `report.json`, `summary.txt` ending in `score: N`, and an overlay PNG per state; each violation names the `--nyte-*` token and the StyleX line behind it. The renderer's clock is held, so relative times read "now" and two runs of one build give the same report and pixels. Passes at any score. `pnpm --dir packages/desktop grid:diff <before> <after>` pairs two reports by violation id and labels each removed, kept, added, or revealed (masked before at the same value), exiting 1 when anything is added; a change is accepted when nothing is added. The Changes and Browser step excludes the home's `.nyte/` and `Library/` from git and edits README.md so Changes lists one file, and it stays last because any state after it would see a different git status |
| `polish.spec.ts` | Scenarios U and D against the packaged app at `dist/mac-arm64/Nyte.app`. Set `NYTE_POLISH_EXE` to use another executable and `NYTE_POLISH_OUT` to choose where the evidence goes. `NYTE_POLISH_LABEL=before` records without judging |

Scenarios U and D are two benchmark prompts. The [web suite's README](../../app/e2e/README.md#how-it-works) describes them.

## Test at 60 Hz

To test renderer scheduling at 60 Hz on a 120 Hz display:

```sh
NYTE_E2E_60FPS=1 NYTE_PERF_DIR=/tmp/nyte-perf-60 pnpm --dir packages/desktop exec playwright test --config e2e/playwright.config.ts e2e/subagent-load.spec.ts --workers=1 --retries=0 --reporter=list
```

`NYTE_E2E_60FPS=1` launches Electron with Chromium's `ThrottleMainFrameTo60Hz` feature. It applies to every chapter, `chat-rendering.spec.ts` included. The workload records unmodified animation-frame timestamps and rejects a median cadence outside 60 Hz. On other refresh rates the feature may produce a different cadence, which doesn't count as a 60 Hz run. The flag doesn't enable macOS Low Power Mode, throttle the CPU or change the display refresh rate.

Read [AGENTS.md](AGENTS.md) before adding or changing a chapter.
