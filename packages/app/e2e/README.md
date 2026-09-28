# E2E

Two Playwright projects, configured in `playwright.config.ts`.

- `web` runs `server/start.ts`, which serves the built app and an in-memory SDK on `127.0.0.1:5181`. Its provider answers `Echo: <message>` without a network. The specs cover pairing links, reloads, wrong tokens, and a first chat.
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

`NYTE_E2E_TOKEN` overrides the web server's token. Outside CI an already running server on 5181 is reused. Results land in `test-results/` and `playwright-report/`.
