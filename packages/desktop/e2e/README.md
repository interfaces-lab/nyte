# Desktop E2E

Playwright tests for the Electron e2e build (`out-e2e`), configured in `playwright.config.ts`. Its catalog is the offline `Scripted` model: `/hold` streams until stopped, `/error` refuses, `/think` answers with reasoning, `/markdown` answers a showcase, `/long <n>` answers n paragraphs, anything else `Echo: <text>`. Each spec file is a chapter that launches one window over its own copy of a seeded home and walks one surface.

## Chapters

| File | Covers |
| --- | --- |
| `first-run.spec.ts` | An empty home: new chat, nothing listed |
| `startup.spec.ts` | A relaunch with the host held: the last run's chats and model, a draft that sends once the host opens |
| `host-restart.spec.ts` | The Nyte Host killed under a chat: it restarts, the window reconnects through a new port with the same token, a message sent during the outage lands once; a crash loop stops and offers Restart |
| `navigation.spec.ts` | Tabs, history, Chat actions, Environments, Customize, Search, the Done shelf |
| `settings.spec.ts` | Every settings page, the settings search, Back |
| `chat.spec.ts` | Seeded chats, a first message, stop, provider errors, thinking |
| `composer.spec.ts` | Send state, Shift+Enter, drafts, the skills list, attachments, the model button; an image attached through Attach Files… starting a new chat in an open folder |
| `markdown.spec.ts` | Headings, lists, code blocks, tables in an answer |
| `subagents.spec.ts` | Two background agents: one block, a line per report, the parent wakes |
| `transcript.spec.ts` | A 36-turn chat: virtualised window, scroll to top and back |
| `workbench.spec.ts` | The panel, Files, Changes, Terminal, Browser tabs, Expand, closing tabs |
| `browser.spec.ts` | The integrated browser against a local HTTP server |
| `remote-access.spec.ts` | Pairing a Chromium page with the desktop over Remote access |
| `scenario-u.spec.ts` | Scenario U from the keyboard: skill, cold places MCP server, canvas, its link in the browser, an approved command, quit mid-answer, relaunch and resume; each hop's span against its budget |
| `scenario-d.spec.ts` | Scenario D from the keyboard over a temp git repo and the CI MCP server: the skill's route, the 5 MiB log's tail, the canvas's file:line link in the editor and job link in the browser, a terminal rerun, commit and push, quit and resume with the frame compared, Changes from git and from the run's snapshots; each hop against its budget (`NYTE_WATERFALL_DIR` saves the waterfall) |

The seeded home is built once by `baseline.ts` through `sdk.open` over the e2e catalog and cached under `e2e/.cache/<fingerprint>`. The fingerprint covers the baseline, the catalog, the store, core and the lockfile; a change to any of them rebuilds. Each chapter copies the cache into a temp `HOME`, so chapters never share state and run in any order. Closing a chapter's desktop fails if any process of its tree, the Nyte Host utility process or a child it spawned included, is still running 5 s after Electron quits.

## Prerequisites

```sh
pnpm --dir packages/canvas build
pnpm --dir packages/app build
pnpm --dir packages/desktop build
pnpm --dir packages/desktop build:e2e   # needs the regular build
```

## Run

```sh
pnpm e2e:desktop                       # builds the canvas shell, the app, the desktop and its e2e entry first
```

One chapter, against an existing build:

```sh
pnpm --dir packages/desktop exec playwright test --config e2e/playwright.config.ts e2e/settings.spec.ts --reporter=list
```

Each chapter records a trace per test; after a failure, `test-results/<test>/error-context.md` holds the accessibility snapshot at the failing step. Results land in `e2e/test-results/` and `e2e/playwright-report/`.

## Benchmarks

Both benches launch packaged executables (`--exe` the baseline, `--compare` the candidate; budgets judge the last one) and never start a build or dev server. Run either with `--help` for its options.

- `bench-startup.ts` (`pnpm bench:desktop`) launches over fresh, restored-chat and heavy-history homes and gates spawn-to-composer, first meaningful paint (the shell's first frame), long tasks, keystroke-to-paint, round trips and memory on the `metricFields` budgets. `--trace <dir>` adds one launch per build and scenario with a Playwright trace (`<build>-<scenario>.trace.zip`) and a strip of its frames from spawn to the first typed character (`<build>-<scenario>-strip.png`, drawn in Playwright's Chromium).
- `bench-interaction.ts` (`pnpm --dir packages/desktop bench:interaction`) opens a chat of 1,000 turns (2,000 messages), types in it, streams an answer into it, scrolls it, samples every process's CPU for 60 s idle, switches sessions 50 times, runs a soak of 60 turns, then relaunches 5 times (`--panel-launches`) to open the Browser, Terminal, Files and Changes panels cold and warm in each, against the scripted model served as an Anthropic endpoint. `NYTE_BENCH_DEBUG=<dir>` saves a screenshot and an accessibility snapshot of any step that fails.

Revisions before the shared store keep sessions in another format, so `--baseline-seed <script>` seeds the baseline's homes with that revision's own code: `node --conditions=nyte-source <script> <directory> <scenario> [turns]` prints the home as JSON.
