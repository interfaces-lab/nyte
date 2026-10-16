# Desktop E2E

Playwright tests for the Electron e2e build (`out-e2e`), configured in `playwright.config.ts`. Its catalog is the offline `Scripted` model: `/hold` streams until stopped, `/error` refuses, `/think` answers with reasoning, `/markdown` answers a showcase, `/long <n>` answers n paragraphs, anything else `Echo: <text>`. Each spec file is a chapter that launches one window over its own copy of a seeded home and walks one surface.

## Chapters

| File | Covers |
| --- | --- |
| `first-run.spec.ts` | An empty home: new chat, nothing listed |
| `startup.spec.ts` | A relaunch with the host held: the last run's chats and model, a draft that sends once the host opens |
| `navigation.spec.ts` | Tabs, history, Chat actions, Environments, Customize, Search, the Done shelf |
| `settings.spec.ts` | Every settings page, the settings search, Back |
| `chat.spec.ts` | Seeded chats, a first message, stop, provider errors, thinking |
| `composer.spec.ts` | Send state, Shift+Enter, drafts, the skills list, attachments, the model button |
| `markdown.spec.ts` | Headings, lists, code blocks, tables in an answer |
| `subagents.spec.ts` | Two background agents: one block, a line per report, the parent wakes |
| `transcript.spec.ts` | A 36-turn chat: virtualised window, scroll to top and back |
| `workbench.spec.ts` | The panel, Files, Changes, Terminal, Browser tabs, Expand, closing tabs |
| `browser.spec.ts` | The integrated browser against a local HTTP server |
| `remote-access.spec.ts` | Pairing a Chromium page with the desktop over Remote access |

The seeded home is built once by `baseline.ts` through `sdk.open` over the e2e catalog and cached under `e2e/.cache/<fingerprint>`. The fingerprint covers the baseline, the catalog, the store, core and the lockfile; a change to any of them rebuilds. Each chapter copies the cache into a temp `HOME`, so chapters never share state and run in any order.

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

## Startup benchmark

`bench-startup.ts` launches a packaged executable over fresh, restored-chat, and heavy-history homes. Run `pnpm bench:desktop --help` for usage.
