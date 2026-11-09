# E2E

Playwright tests for the web app, configured in `playwright.config.ts`. The desktop suite is in [`packages/desktop/e2e`](../../desktop/e2e/README.md).

## Run it

Install Chromium once:

```sh
pnpm --dir packages/app exec playwright install chromium
```

Then build and run every spec:

```sh
pnpm e2e:web
```

`pnpm e2e:web` builds the canvas shell and the app first. The app build inlines the canvas shell, so build both before running specs by hand:

```sh
pnpm --dir packages/canvas build
pnpm --dir packages/app build
pnpm --dir packages/app exec playwright test --config e2e/playwright.config.ts e2e/web/pairing.spec.ts --reporter=list
```

Results land in `e2e/test-results/` and `e2e/playwright-report/`. CI's `e2e-web` job builds the canvas shell and the app and runs every spec. In CI a failed test retries twice and records a trace on the first retry.

### Clear account sign-in

The web build under test must not carry account sign-in. With `VITE_NYTE_CLERK_PUBLISHABLE_KEY` set, for example from `.env.local`, `/` opens the account screen instead of the connect form and the pairing specs fail. Clear it for the build, and use a free port so Playwright doesn't reuse a server already running on 5181:

```sh
VITE_NYTE_CLERK_PUBLISHABLE_KEY= NYTE_E2E_PORT=5287 pnpm --dir packages/app e2e
```

## How it works

`server/start.ts` serves the built app and a host on `127.0.0.1:5181`. The host keeps its store in memory and works in a temporary Git workspace with one commit. It seeds 22 archived chats. Its provider answers `Echo: <message>` without a network. The message `Start an agent.` starts one subagent, `Map the core`. Outside CI, Playwright reuses a server already running on that port.

The specs in `web/` cover:

- Pairing links, reloads and wrong tokens.
- Startup from a saved connection, including one whose host is unreachable.
- A first chat, and a child chat opening in the pane.
- The Inbox's Archived shelf.
- A terminal on the host's Home folder.
- A workspace journey that reads, edits, blames, searches and mentions files in the seeded workspace.

The scenario specs run in their own `timed` project with one worker, after the other specs:

- `web/scenario-u.spec.ts` runs scenario U, the prompt `find me a random restaurant nearby` answered through a places MCP server. It starts its own host over a SQLite file and drives the app from the keyboard through a host restart.
- `web/scenario-d.spec.ts` runs scenario D, the prompt `why did CI fail on my PR, fix it`, over a temp Git repo with the CI MCP server. A second test runs it through `gh` without that server.

The prompts and their fixtures come from `@nyte-ai/bench`.

## Environment variables

| Variable | Default | What it does |
| --- | --- | --- |
| `NYTE_E2E_PORT` | `5181` | Port for the web server, so two runs on one machine can each start their own |
| `NYTE_E2E_TOKEN` | built-in test token | Token the web server accepts |
| `NYTE_SCENARIO_U_OUT` | unset | Folder for each scenario U run's waterfall |
| `NYTE_SCENARIO_U_MEASURE` | unset | Set to `1` to record scenario U without the budget gate |
| `NYTE_WATERFALL_DIR` | unset | Folder for scenario D's waterfall and hop table |

To keep a concurrent run's artifacts apart, pass `--output` and `--reporter=list` along with a different `NYTE_E2E_PORT`.

Read [AGENTS.md](AGENTS.md) before writing or changing a spec.
