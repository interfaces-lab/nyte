# @nyte-ai/bench

`@nyte-ai/bench` is the deterministic test setup for Nyte hosts. The desktop and web Playwright suites and the SDK and TUI tests use its scripted models, recorded provider cassettes, scenario fixtures and host simulation. It is a private workspace package and is never published.

## Quick start

Script a model's replies and put it into a real `Models`:

```ts
import { afterUser, fakeModels, script } from "@nyte-ai/bench";

const turns = script([
  { name: "greet", when: afterUser, reply: { content: [{ type: "text", text: "Hello" }] } },
]);
const { models } = fakeModels({ fallback: turns.answer });
```

Run a host on an echo model and drive it over stdio, one JSON command per line:

```sh
pnpm --dir packages/bench simulate
```

## Scripted model

`fakeModels()` puts one scripted provider into a real `Models`. Each reply streams text, thinking and tool calls.

- A `toolCall` block with `deltas: n` streams its arguments' JSON in `n` `toolcall_delta` events, the way a provider streams a long `canvas_render` source.
- `timing: { firstMs, deltaMs }` waits before the first event and after each delta.
- `clock` decides what those waits use. `realClock` is the default. `manualClock()` moves only when you call `advance(ms)`.

`script(steps)` answers requests in order. Each `Step` has a `name`, an optional `when` matcher such as `afterUser` or `afterTool(name)`, and a reply. A chat-title request gets its title and doesn't use up a step. A request that doesn't match the next step gets a provider error that names both, so a script that drifts fails loudly. `pending()` lists the steps no request has used yet.

## Recorded provider traffic

`openRecorder({ path })` replays one cassette, a JSON file of a test's provider traffic, through a real adapter's `fetch`, so the bytes go through the same parsing as production. `playCassette({ cassette })` wraps it in a `Models` that holds the cassette's real provider and model. Pass `player.models` wherever `fakeModels().models` goes.

- Matching is strict. Each request must equal an unused recorded one in method, url, the `accept`, `content-type`, `anthropic-*` and `openai-beta` headers, and the body as JSON. A request with no match gets a 400 that names each differing field, such as `body.messages.0.content.0.text: expected "…", received "…"`. `close()`, or disposing the player, throws every mismatch and every exchange no request used.
- Redaction runs before anything is compared or written. Credential headers, query parameters and JSON keys become `[REDACTED]`. The home folder becomes `<home>`, the temp folder `<tmp>`, and each `paths` entry `<name>`. Replayed responses get the real paths back. Body fields at the dotted paths in `volatile` become `<volatile>`. Use `volatile` for a cassette's system prompt, tool list and per-session cache keys. Writing refuses a file that still holds a key, token, JWT, private key or the value of a credential-like environment variable.
- Streams replay chunk by chunk, so SSE parsers see separate reads. Codex's WebSocket transport replays through `player.WebSocket`. Install it with `vi.stubGlobal("WebSocket", player.WebSocket)`.

`CASSETTES` lists the cassettes in `src/cassettes/`:

| Key | Traffic |
| --- | --- |
| `anthropicToolUse` | Anthropic Messages with a `read` tool call and the title request |
| `openaiResponses` | OpenAI Responses |
| `openrouterCompletions` | OpenRouter Chat Completions |
| `codexWebSocket` | Codex over WebSocket |

Each cassette was synthesized from the provider's documented streaming format against the requests Nyte sends. Its `source.from` lists the pages. `test/recorded.test.ts` runs them through a host, and the TUI's `test/scenarios/simulation.test.ts` runs the Anthropic one through the TUI.

### Record a cassette

Recording is local-only and refuses to start when `CI` is set. Run the test that plays the cassette with `NYTE_RECORD=1` and the provider's key in the environment, then format:

```sh
NYTE_RECORD=1 ANTHROPIC_API_KEY=… pnpm --dir packages/bench exec vitest --run test/recorded.test.ts -t Anthropic
pnpm format:fix
```

The recorder writes `source: { kind: "recorded" }`. Read the diff before you commit. The real model may answer differently, so update the cassette's `answer` and the test's expectations to match. To record Codex, you need a ChatGPT login and `upstream: { WebSocket: globalThis.WebSocket }`.

## Simulation

`simulate({ models })` opens a real host with `openHost` on a SQLite store in a temp folder. It creates a home and a local workspace there unless you pass your own. Its tool calls run without asking, because `permissions` is `full`. To drive `approve`, apply `ask` first with `simulation.host.settings.apply`.

`drive(command)` runs one step:

| Command | What it does |
| --- | --- |
| `send` | Sends a message, to a new session or the one you name |
| `settle` | Waits until the session's last sent message settles, then returns its view |
| `approve` | Waits for a pending approval and answers it with `once`, `session` or `deny` |
| `interrupt` | Stops the session's runs |
| `view` | Returns the session's view |
| `list` | Lists top-level sessions |
| `listen` | Opens the HTTP endpoint and returns its url and token |
| `kill` | Closes the host and its store |
| `restart` | Opens a new host on the same store and endpoint |

Clients connect with `sdk.connect` to the `listen` url. The TUI's test setup takes `simulation.host` or that connection.

`pnpm --dir packages/bench simulate [cassette]` serves the same commands over stdio, one JSON command per line in and one JSON outcome per line out. The first line is a `ready` record. Without a cassette key, it runs an echo model. It exits when stdin closes.

## Scenarios

Two end-to-end scenarios cover a user request (U) and a developer request (D).

| | U: "find me a random restaurant nearby" | D: "why did CI fail on my PR, fix it" |
|---|---|---|
| Home | `restaurantHome({ route, env })` | `ciHome({ route, env })` |
| Skill | `restaurant-picker` (`RESTAURANT_SKILL`) | `ci-triage` (`CI_SKILL`), which picks the CI tools when they are listed and `gh` otherwise |
| Script | `restaurantScript({ skill, route: "direct" \| "codemode" })`. Reads the skill, searches places, renders the canvas, answers. | `ciScript({ skill, route: "mcp" \| "gh" })`. Reads the skill, checks runs, reads the job log, renders the canvas, runs `node --test`, edits, reruns, answers. |
| Canvas | `RESTAURANT_CANVAS` with the pick, a web link and a reroll button | `CI_CANVAS` with the failing test and its `file:line` links, the suspect line, a log excerpt and the job link |
| Workspace | any folder | `ciRepo()`, a git repo on `fix-sum` whose `node --test` fails at `test/sum.test.js:6`, with a `gh` stand-in in `bin`. Its `path` puts `bin` first on `PATH`. |

Both canvases compile with `compileCanvas`. Homes and repos are `AsyncDisposable`, so `await using` removes them.

`scenarioHome({ servers, skills })` writes `<home>/.nyte/mcp.json` and `<home>/.agents/skills/<name>/SKILL.md`. Each server runs under this process's Node, with `ELECTRON_RUN_AS_NODE` set when the process is Electron.

## Fixture servers

Each server is a plain Node script with no dependencies. `mcp-server.mjs` holds the shared stdio JSON-RPC loop.

| Server | Export | Serves | Environment knobs |
| --- | --- | --- | --- |
| `places-mcp.mjs` | `PLACES_SERVER` | `search_places` | `PLACES_COLD_MS`, `PLACES_DELAY_MS`, `PLACES_PROGRESS=1`, `PLACES_CRASH=call\|list`, `PLACES_INVALID_SCHEMA=1`, `PLACES_ERROR=1`, `PLACES_LOG_BYTES`, `PLACES_INSTRUCTIONS` |
| `ci-mcp.mjs` | `CI_SERVER` | `list_check_runs`, `get_job_logs` | `CI_COLD_MS`, `CI_DELAY_MS`, `CI_CRASH=call\|list`, `CI_LOG_BYTES` |
| `gh.mjs` | `GH_CLI` | `gh pr checks`, `gh run view <job> --log-failed` | none |

The CI log is 5 MiB by default, with the failure at its tail. `gh.mjs` answers from the same run as `ci-mcp.mjs`, through `ci-log.mjs`.

## Trace spans

A user submit is traced under its receipt id, which the client sends with `head.send`. Each hop records a `performance.measure` entry named after its span: `composer.submit`, `sdk.send`, `host.admit`, `turn.start`, `model.stream`, `mcp.connect`, `mcp.call`, `mcp.serve`, `tool.run`, `canvas.compile`, `canvas.paint`, `pty.spawn`, `pty.output`, `part.publish`, `client.paint`. Each entry's `detail.trace` holds the trace id.

The trace id moves between hops like this:

- Host hops find the trace through the session, with `followTrace` and `followedTrace`.
- MCP calls carry it as `_meta.traceparent`.
- Commands get it as `TRACEPARENT` in their environment.
- Renderer hops use the trace of the last submit.

Turn tracing on:

- In Node, `NYTE_TRACE=1` records spans, and `NYTE_TRACE=stdout` also prints each span as a `NYTE_SPAN <json>` line.
- In a browser or renderer, set the `NYTE_TRACE` key in localStorage.
- In tests, call `enableTracing()` from `@nyte-ai/core`.

Read the spans back:

- From this process, call `readSpans(trace?)` from `@nyte-ai/core`. It works in the renderer and in an in-process host.
- From a fixture server, call `readSpanFile(home.traceFile)`.
- From another process's stdout, call `readPrintedSpans(output)`.

`buildWaterfall(trace, sources)` puts the spans in one order. It also includes untraced spans that overlap the trace's window, such as a cold `mcp.connect`. `formatWaterfall` draws the result as text.

`test/scenarios.test.ts` runs U and D end to end on a SQLite store in a temp folder and checks the hop order. Set `NYTE_WATERFALL_DIR` to save each waterfall as JSON.

## Development

```sh
pnpm --dir packages/bench test
pnpm --dir packages/bench typecheck
```
