# E2E

Playwright tests for the web app, configured in `playwright.config.ts`. The desktop suite lives in `packages/desktop/e2e`.

`server/start.ts` serves the built app and an in-memory SDK on `127.0.0.1:5181`. Its provider answers `Echo: <message>` without a network. The specs cover pairing links, reloads, wrong tokens, a first chat, and one workspace journey that reads, saves, blames, searches, and mentions a seeded Git workspace. `web/scenario-u.spec.ts` starts its own host over a SQLite file and runs scenario U from the keyboard through a host restart; set `NYTE_SCENARIO_U_OUT` to save each run's waterfall, and `NYTE_SCENARIO_U_MEASURE=1` to record without the budget gate. Run it with `--workers 1` when repeating it. `web/scenario-d.spec.ts` does the same for scenario D over a temp git repo, with the CI MCP server and, in a second test, through `gh` without it; set `NYTE_WATERFALL_DIR` to save its waterfall and hop table.

## Prerequisites

```sh
pnpm --dir packages/app exec playwright install chromium
pnpm --dir packages/canvas build        # the app build inlines the canvas shell
pnpm --dir packages/app build
```

## Run

```sh
pnpm e2e                               # builds the canvas shell and the app first
```

One spec, against an existing build:

```sh
pnpm --dir packages/app exec playwright test --config e2e/playwright.config.ts e2e/web/pairing.spec.ts --reporter=list
```

`NYTE_E2E_TOKEN` overrides the web server's token. `NYTE_E2E_PORT` overrides its port, so two runs on one machine can each start their own server. Outside CI an already running server on that port is reused. Results land in `test-results/` and `playwright-report/`; pass `--output` and `--reporter=list` to keep a concurrent run's artifacts apart.

CI's `e2e-web` job builds the canvas shell and the app and runs only `web/workspace.spec.ts`. The other web specs run locally until they pass again.

The web build must not carry account sign-in. With `VITE_NYTE_CLERK_PUBLISHABLE_KEY` set, for example from `.env.local`, `/` opens the account screen instead of the connect form and the pairing specs fail. Clear it for the build:

```sh
VITE_NYTE_CLERK_PUBLISHABLE_KEY= NYTE_E2E_PORT=5287 pnpm --dir packages/app e2e
```
