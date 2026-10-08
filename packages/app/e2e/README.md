# E2E

Two Playwright projects, configured in `playwright.config.ts`.

- `web` runs `server/start.ts`, which serves the built app and an in-memory SDK on `127.0.0.1:5181`. Its provider answers `Echo: <message>` without a network. The specs cover pairing links, reloads, wrong tokens, a first chat, and one workspace journey that reads, saves, blames, searches, and mentions a seeded Git workspace.
- `desktop` launches the built Electron app with an isolated `NYTE_HOME` and chats seeded by the benchmark fixture in `packages/desktop/benchmark`. It starts Remote access in Settings, pairs a browser, checks that both clients see the same chats, then stops Remote access and checks the browser loses the server.

## Prerequisites

```sh
pnpm --dir packages/app exec playwright install chromium
pnpm --dir packages/app build
pnpm --dir packages/desktop build   # desktop project only
```

## Run

```sh
pnpm e2e                               # web; builds the app first
pnpm e2e:desktop                       # desktop; builds the app and the desktop first
pnpm --dir packages/app e2e:all        # both projects
```

`NYTE_E2E_TOKEN` overrides the web server's token. `NYTE_E2E_PORT` overrides its port, so two runs on one machine can each start their own server. Outside CI an already running server on that port is reused. Results land in `test-results/` and `playwright-report/`; pass `--output` and `--reporter=list` to keep a concurrent run's artifacts apart.

CI's `e2e-web` job builds the app and runs only `web/workspace.spec.ts`. The other web specs run locally until they pass again.

The web build must not carry account sign-in. With `VITE_NYTE_CLERK_PUBLISHABLE_KEY` set, for example from `.env.local`, `/` opens the account screen instead of the connect form and the pairing specs fail. Clear it for the build:

```sh
VITE_NYTE_CLERK_PUBLISHABLE_KEY= NYTE_E2E_PORT=5287 pnpm --dir packages/app e2e
```
