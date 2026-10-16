# Bench fixtures

`@nyte-ai/host/bench` is the deterministic setup for host tests, the desktop and web Playwright suites, and the TUI tests. Everything below is exported from `index.ts`.

## Scripted model

`fakeModels()` puts one scripted provider into a real `Models`. Each reply streams text, thinking and tool calls:

- `toolCall` blocks with `deltas: n` stream their arguments' JSON in `n` `toolcall_delta` events, the way a provider streams a long `canvas_render` source.
- `timing: { firstMs, deltaMs }` waits before the first event (time to first token) and after each delta.
- `clock` decides what those waits use. `realClock` is the default; `manualClock()` only moves when you call `advance(ms)`.

`script(steps)` answers requests in order. Each `Step` has a `name`, an optional `when` matcher (`afterUser`, `afterTool(name)`), and a reply. A chat-title request gets its title and does not use up a step. A request that does not match the next step gets a provider error naming both, so a script that drifts fails loudly. `pending()` lists the steps no request has used yet. Wire a script in with `fakeModels({ fallback: turns.answer })`.

## Scenarios

| | U: "find me a random restaurant nearby" | D: "why did CI fail on my PR, fix it" |
|---|---|---|
| Home | `restaurantHome({ route, env })` | `ciHome({ route, env })` |
| Skill | `restaurant-picker` (`RESTAURANT_SKILL`) | `ci-triage` (`CI_SKILL`), which picks the CI tools when they are listed and `gh` otherwise |
| Script | `restaurantScript({ skill, route: "direct" \| "codemode" })`: read the skill, search places, render the canvas, answer | `ciScript({ skill, route: "mcp" \| "gh" })`: read the skill, check runs, job log, canvas, `node --test`, edit, rerun, answer |
| Canvas | `RESTAURANT_CANVAS`: the pick, a web link, a reroll button | `CI_CANVAS`: the failing test with `file:line` links, the suspect line, a log excerpt, the job link |
| Workspace | any folder | `ciRepo()`: a git repo on `fix-sum` whose `node --test` fails at `test/sum.test.js:6`, plus a `gh` stand-in in `bin` (`path` puts it first on `PATH`) |

Both canvases compile with `compileCanvas`. Homes and repos are `AsyncDisposable`, so `await using` removes them.

`scenarioHome({ servers, skills })` writes `<home>/.nyte/mcp.json` and `<home>/.agents/skills/<name>/SKILL.md`. Each server runs under this process's Node, with `ELECTRON_RUN_AS_NODE` set when the process is Electron.

## Fixture servers

Each one is a plain Node script with no dependencies. `mcp-server.mjs` holds the shared stdio JSON-RPC loop.

- `places-mcp.mjs` (`PLACES_SERVER`) serves `search_places`. Knobs: `PLACES_COLD_MS`, `PLACES_DELAY_MS`, `PLACES_PROGRESS=1`, `PLACES_CRASH=call|list`, `PLACES_INVALID_SCHEMA=1`, `PLACES_ERROR=1`, `PLACES_LOG_BYTES`, `PLACES_INSTRUCTIONS`.
- `ci-mcp.mjs` (`CI_SERVER`) serves `list_check_runs` and `get_job_logs`. The log is 5 MiB by default, with the failure at its tail. Knobs: `CI_COLD_MS`, `CI_DELAY_MS`, `CI_CRASH=call|list`, `CI_LOG_BYTES`.
- `gh.mjs` (`GH_CLI`) answers `gh pr checks` and `gh run view <job> --log-failed` from the same run (`ci-log.mjs`).

## Trace spans

A user submit is traced under its receipt id, which the client already sends with `head.send`, so tracing adds no wire field. The hops record `performance.measure` entries named after their span: `composer.submit`, `sdk.send`, `host.admit`, `turn.start`, `model.stream`, `skill.load`, `mcp.connect`, `mcp.call`, `mcp.serve`, `tool.run`, `canvas.compile`, `canvas.paint`, `pty.spawn`, `pty.output`, `part.publish`, `client.paint`. Each entry's `detail.trace` holds the trace id.

How the trace id moves between hops:

- Host hops find the trace through the session (`followTrace` / `followedTrace`).
- MCP calls carry it as `_meta.traceparent`.
- Commands get it as `TRACEPARENT` in their environment.
- Renderer hops use the trace of the last submit.

How to turn tracing on:

- Node: `NYTE_TRACE=1` records spans, and `NYTE_TRACE=stdout` also prints each span as a `NYTE_SPAN <json>` line.
- Browser or renderer: set the `NYTE_TRACE` key in localStorage.
- Tests: call `enableTracing()`.

How to read the spans back:

- From this process: `readSpans(trace?)`, which works in the renderer and in an in-process host.
- From a fixture server: `readSpanFile(home.traceFile)`.
- From another process's stdout: `readPrintedSpans(output)`.

`buildWaterfall(trace, sources)` puts them in one order. It also includes untraced spans that overlap the trace's window, such as a cold `mcp.connect`. `formatWaterfall` draws the result as text.

`test/scenarios.test.ts` runs U and D end to end on a SQLite store in a temp folder and checks the hop order. To save each waterfall as JSON, set `NYTE_WATERFALL_DIR`.
