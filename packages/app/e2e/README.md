# E2E

Two Playwright projects, configured in `playwright.config.ts`.

- `web` runs `server/start.ts`, which serves the built app and an in-memory SDK on `127.0.0.1:5181`. Its provider answers `Echo: <message>` without a network. The specs cover pairing links, reloads, wrong tokens, a first chat, and one workspace journey that reads, saves, blames, searches, and mentions a seeded Git workspace.
- `desktop` launches the Electron e2e build (`packages/desktop/out-e2e`), whose catalog is the offline `Scripted` model: `/hold` streams until stopped, `/error` refuses, `/think` answers with reasoning, `/markdown` answers a showcase, `/long <n>` answers n paragraphs, anything else `Echo: <text>`. Each spec file is a chapter that launches one window over its own copy of a seeded home and walks one surface.

## Desktop chapters

| File | Covers |
| --- | --- |
| `first-run.spec.ts` | An empty home: new chat, nothing listed |
| `navigation.spec.ts` | Tabs, history, Chat actions, Environments, Customize, Search, the Done shelf |
| `settings.spec.ts` | Every settings page, the settings search, Back |
| `chat.spec.ts` | Seeded chats, a first message, stop, provider errors, thinking |
| `composer.spec.ts` | Send state, Shift+Enter, drafts, the skills list, attachments, the model button |
| `markdown.spec.ts` | Headings, lists, code blocks, tables in an answer |
| `transcript.spec.ts` | A 36-turn chat: virtualised window, scroll to top and back |
| `workbench.spec.ts` | The panel, Files, Changes, Terminal, Browser tabs, Expand, closing tabs |
| `browser.spec.ts` | The integrated browser against a local HTTP server |
| `remote-access.spec.ts` | Pairing a Chromium page with the desktop over Remote access |

The seeded home is built once by `desktop/baseline.ts` through `sdk.open` over the e2e catalog and cached under `e2e/.cache/desktop/<fingerprint>`. The fingerprint covers the baseline, the catalog, the store, core and the lockfile; a change to any of them rebuilds. Each chapter copies the cache into a temp `HOME`, so chapters never share state and run in any order.

## Prerequisites

```sh
pnpm --dir packages/app exec playwright install chromium
pnpm --dir packages/app build
pnpm --dir packages/desktop build       # desktop project only
pnpm --dir packages/desktop build:e2e   # desktop project only; needs the regular build
```

## Run

```sh
pnpm e2e                               # web; builds the app first
pnpm e2e:desktop                       # desktop; builds the app, the desktop and its e2e entry first
pnpm --dir packages/app e2e:all        # both projects
```

One chapter, against an existing build:

```sh
pnpm --dir packages/app exec playwright test --config e2e/playwright.config.ts --project=desktop e2e/desktop/settings.spec.ts --reporter=list
```

Each chapter records a trace per test; after a failure, `test-results/<test>/error-context.md` holds the accessibility snapshot at the failing step.

`NYTE_E2E_TOKEN` overrides the web server's token. `NYTE_E2E_PORT` overrides its port, so two runs on one machine can each start their own server. Outside CI an already running server on that port is reused. Results land in `test-results/` and `playwright-report/`; pass `--output` and `--reporter=list` to keep a concurrent run's artifacts apart.

CI's `e2e-web` job builds the app and runs only `web/workspace.spec.ts`. The other web specs run locally until they pass again.

The web build must not carry account sign-in. With `VITE_NYTE_CLERK_PUBLISHABLE_KEY` set, for example from `.env.local`, `/` opens the account screen instead of the connect form and the pairing specs fail. Clear it for the build:

```sh
VITE_NYTE_CLERK_PUBLISHABLE_KEY= NYTE_E2E_PORT=5287 pnpm --dir packages/app e2e
```
