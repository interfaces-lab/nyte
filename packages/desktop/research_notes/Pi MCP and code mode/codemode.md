# Pi MCP and code mode: source findings and Nyte reuse decision

Research snapshot: 2026-10-01. Source-only review. No cloned code, installation scripts, package lifecycle scripts, builds, or tests were executed. Repositories and npm tarballs were downloaded into `/tmp/pi-codemode-research.09cIeK` for reading. The requested researcher reference and TypeScript skill were read first. Only this requested notes file was written in the project.

## 1. Which implementation is this, and can its packages actually be installed independently?

### Takeaway

The likely implementation is now first-party Pi, not an MCP extension assembled with a generic executor. Pi has two standalone libraries, `@earendil-works/pi-codemode` and `@earendil-works/pi-mcp`, plus coding-agent built-in extensions that connect them to session policy and discovery. Both libraries are published independently. The inspected main checkout says `1.0.0`, but the npm registry snapshot still has `0.99.2` as latest. Do not conflate those APIs. [Introduction][announcement]; [release entry][changelog]; [codemode manifest][cm-package]; [MCP manifest][mcp-package]; [codemode registry][cm-registry]; [MCP registry][mcp-registry].

### Cited findings

#### Source and publication pins

| Implementation | Inspected commit | Version at that commit | Status and direct runtime dependencies |
| --- | --- | --- | --- |
| Upstream `earendil-works/pi` main | `86dfceec402ad77e563bf4feab5f26c42d5f5db6` | Standalone libraries and coding-agent `1.0.0` | Main source pin, not the currently published npm version. `pi-codemode` depends only on `quickjs-wasi: 3.6.2`; `pi-mcp` only on `cross-spawn: 7.0.6`. Neither library is private or has Pi peers/workspace dependencies. [Codemode][cm-package]; [MCP][mcp-package]. |
| Published standalone libraries | npm `0.99.2`, `gitHead: 005af57d88ee23b33778f343a9595b32e67ff788` | `0.99.2` | Registry timestamps: codemode `2026-09-30T19:25:08.793Z`, MCP `2026-09-30T19:24:14.649Z`. Downloaded both immutable tarballs and read their manifests, JS, and declarations. [Codemode metadata][cm-registry]; [MCP metadata][mcp-registry]; [codemode tarball][cm-tar]; [MCP tarball][mcp-tar]. |

- The repository root is private and uses npm workspaces. That does **not** make these two packages private. Their manifests contain ordinary registry dependencies, not `workspace:*`, and declare Node `>=22.19.0`. There are no peer dependencies on `pi-ai`, `pi-agent-core`, `pi-coding-agent`, or `pi-tui`. [Root][root-package]; [codemode][cm-package]; [MCP][mcp-package].
- Published tarballs contain compiled `dist` entrypoints and declarations, including the codemode worker. They contain no `src/` files. Use the public ESM import exports, not a source-condition path or `src` deep import. The checkout's `source` conditions are for source consumers, not a promise that npm ships TypeScript source. [Published manifests][cm-registry]; [MCP manifest][mcp-registry]; [codemode archive][cm-tar]; [MCP archive][mcp-tar].
- Copying a package directory from the checkout and running its build is **not** a standalone build setup: both package tsconfigs extend `../../tsconfig.base.json`; `tsc`, Node types, and development tooling are supplied by the workspace. Published `dist` avoids that requirement. The base config targets ES2024, rewrites relative `.ts` imports, emits declarations, and requires erasable syntax. [Codemode build config][cm-build]; [MCP build config][mcp-build]; [base compiler config][base-tsconfig].
- `0.99.2` codemode host and worker source are unchanged at the main pin. Main adds the public `renderToolOutputType` export, missing-member recovery messages, and clearer store-limit errors. Do not call `renderToolOutputType` from an installed `0.99.2` root entrypoint. [Published entrypoint][cm-index-published]; [main entrypoint][cm-index]; [published prelude][prelude-published]; [main prelude][prelude].
- Main MCP adds `stepUpScope` to `/oauth`, OAuth hardening, and tolerance for terminal pagination cursors `null` and `""`. Those are not all present in the published `0.99.2` package. A main-source audit is not an audit of identical npm behavior. [Published OAuth exports][oauth-index-published]; [main OAuth exports][oauth-index]; [MCP changes][mcp-changelog]; [main client][mcp-client].

#### Public exports that matter for “just use it”

- `@earendil-works/pi-codemode` exports `CodemodeSandbox`, `loadQuickJSWasm`, the tool/result/options types, declaration helpers, `toCodemodeIdentifier`, store-size constants, and source-parser/grammar helpers. Current main also exports `renderToolOutputType`. Public subpaths are `/declarations`, `/source`, and `/worker`. `/worker` starts the worker runtime when imported; it is intended for a dedicated worker entry, not a main-thread helper import. [Entry][cm-index]; [exports map][cm-package]; [worker][worker].
- `CodemodeSandbox` exposes `registerTool`, `unregisterTool`, `tools`, `globals`, `execute`, and `close`. The constructor accepts `tools`, `globals`, `timeoutMs`, `memoryLimitBytes`, `wasm`, and `workerUrl`. `execute` accepts a JS body plus `signal`, deadline override, and store snapshot. There is no public hard-output-budget, call-count-budget, concurrency-budget, or streaming-output callback option. [Host class][host]; [options/result types][cm-types].
- `@earendil-works/pi-mcp` exports `McpClient`, `StdioTransport`, `StreamableHttpTransport`, transport/auth interfaces, MCP protocol/content types, `toLlmContent`, and typed protocol/transport errors. Public subpaths are `/oauth` and `/testing`. There is no dependency on the official MCP SDK in this library. [Entry][mcp-index]; [manifest][mcp-package].
- `McpClient` exposes `connect`, `close`, `ping`, `listTools`, resource/template listing including page APIs, `readResource`, `callTool`, generic `request` and `notify`, request-handler registration, and notification/error/close listeners. Important signature differences from SDK-shaped clients: `listTools()` returns a `Tool[]`, and `callTool(name, args, options)` takes a string name rather than `{name, arguments}`. Generic `request<Result>` is a type assertion, not schema validation. [Client API][mcp-client].
- `/oauth` exports discovery, authorization-code/PKCE flow functions, refresh, callback server, `McpOAuthProvider`, and an injectable state-store interface with `MemoryOAuthStateStore`. Persistent credential storage and user interaction are host responsibilities. Main's `stepUpScope` is not in `0.99.2`. [OAuth API][oauth-index]; [published API][oauth-index-published]; [provider implementation][oauth-provider].
- Coding-agent's public root exports `createCodemodeExtension`, `createMcpExtension`, and `createToolSearchExtension`. Those are genuine public APIs, but they require Pi's extension/session harness. `executeCodemode`, `createDiscoveryGlobals`, `createCodemodeDescription`, and the integration's `createMcpToolDefinition` are source implementation details, not standalone library exports. Do not import `pi-coding-agent/src/extensions/...` or assume an unexported `dist/...` path is supported. [Coding-agent entry][ca-index]; [coding-agent exports map][ca-package]; [integration executor][execute]; [tool catalog][cm-tool].

#### Built-in versus third-party

- Pi added built-in codemode, MCP, and tool search in `0.99.0` on 2026-09-29. The upstream announcement explicitly links the earlier `nicobailon/pi-mcp-adapter` while explaining why tool exposure metadata moved into core. Claims that current Pi has no built-in MCP are stale. [Announcement][announcement]; [changelog][changelog].
- Before the follow-up narrowed scope, I inspected three extension repositories. No further ecosystem expansion is needed. They are alternatives, not the implementation of the current first-party packages:

| Extension source pin | What the source actually does | Reuse verdict |
| --- | --- | --- |
| `nicobailon/pi-mcp-adapter`, `4bb5691096f29de490670cf18ddc4f81d20cd945`, manifest `4.0.0`, MIT | Optional `mcpScript` executes JS with `tools.search`, `tools.describe`, `tools.call`, and `{ok,data}` result envelopes. QuickJS-WASI worker, 30-second default, 16 MiB intermediate-transfer and output budgets, its own `executeCall` routing and approval broker. Also integrates deferred tools with current Pi. [Manifest][adapter-package]; [script][adapter-code]; [worker][adapter-worker]; [approval][adapter-approval]. | Useful bounded-transfer pattern. Do not replace Nyte with the whole adapter: it brings MCP SDK v2, task extension, keyring, OAuth/UI, Jev and other dependencies, and its own policy/configuration system. [Dependencies][adapter-package]. |
| `boozedog/pi-codemode`, `a08ba0461572c57441aa4e354925ac9828d98704`, `0.5.1`, MIT | Type-checks TS using an in-memory compiler host before execution. Default executor runs QuickJS-Emscripten on the host thread, 120-second default and 64 MiB guest heap. Its MCP path returns flattened text and does not forward a cancellation signal to `client.callTool`. Source includes an actual optional Deno executor despite README language calling Deno future support. [Compiler][boo-checker]; [execution][boo-execute]; [QuickJS][boo-runtime]; [MCP client][boo-mcp]; [Deno][boo-deno]. | Not the preferred executor. Separate tool bindings/policy, old `@mariozechner/*` peers, heavier dependencies, TS generator falls back to `any`, and weaker MCP cancellation. [Manifest][boo-package]; [bindings][boo-bindings]; [generator][boo-types]. |
| `Hor1zonZzz/pi-codeMode`, `301733543ebcccfd99505e364063daf8bfdc587a`, `0.3.0`, MIT | `exec` runs an async JS function in a worker with `node:vm`, calling seven reconstructed built-in tools directly. It validates their arguments but does not route through Pi's tool hooks. No MCP integration. Logs/result accumulation have no aggregate hard bound. [Implementation][horizon-code]; [manifest][horizon-package]. | Do not use as the security boundary or MCP implementation. Its capability list comes from its own persisted switches, not the caller's current session registry. [Implementation][horizon-code]. |

- Extension licenses were read, not inferred from catalog snippets: adapter copyright Nico Bailon, boozedog copyright Mario Zechner and contributors, Horizon copyright Hor1zonZzz. All three are MIT. [Adapter][adapter-license]; [boozedog][boo-license]; [Horizon][horizon-license].

#### License of the recommended upstream code

- Upstream is MIT, copyright 2025 Mario Zechner. Copying substantial source requires retaining that copyright and permission notice. `packages/mcp/LICENSES/modelcontextprotocol-typescript-sdk.txt` separately retains the MIT notice for SDK-derived code, copyright 2024 Anthropic, PBC. Preserve it if vendoring MCP. [Root license][license]; [MCP notice][mcp-license].
- `quickjs-wasi@3.6.2` is MIT, copyright 2026 Vercel, Inc. Its tarball has `LICENSE`, JS/types, and `quickjs.wasm`; registry metadata lists no runtime dependencies. This is prebuilt WASM, not an Electron native addon requiring an ABI rebuild. Preserve dependency and engine notices when redistributing rather than treating Pi's MIT notice as the only relevant license. [Registry][qjs-registry]; [archive including LICENSE][qjs-tar]; [Pi's dependency][cm-package].
- The downloaded Pi codemode tarball has no root LICENSE file; MCP ships the SDK-derived notice but not Pi's root LICENSE. That packaging observation does not revoke MIT permission. For Nyte notices, retain the pinned repository license explicitly. [Codemode archive][cm-tar]; [MCP archive][mcp-tar]; [root license][license].

### Inferences

- Both standalone libraries can be dependencies in a non-Pi application without importing Pi's coding-agent or recreating its workspace. Their use still requires host adapters for policy, discovery and persistence. The public package boundary is the reusable part; Pi's built-in extension is a reference integration.
- The npm/source mismatch is temporary publication state, not proof of a private package. Pin `0.99.2` if depending on the registry snapshot, or pin source commit `86df...` if vendoring current main.

### Gaps

- Publication is a time-specific registry observation. `1.0.0` may publish after this note. I did not silently substitute it for the downloaded `0.99.2` artifacts.
- No install or consumer import smoke test was run, as requested. Tarball presence, dependency manifests, entrypoint contents and source diff were checked instead.

## 2. How do execution, discovery, policy, cancellation and persistence actually work?

### Takeaway

The standalone codemode package is a JS capability executor, not a TS compiler, permission manager, MCP catalog, or durable agent runtime. Pi's coding-agent supplies those surrounding decisions, and Nyte must keep them in its own core/plugin pipeline. The strongest caveat is that the standalone executor bounds guest memory only when configured, but does not bound aggregate host output or call records. [Types][cm-types]; [host][host]; [integration][execute].

### Cited findings

#### Executor and isolation

1. The model supplies an **async function body**, not a module or full function. The worker evaluates `(async (tools, console) => { ... })` as `codemode.js`. Top-level `await` and `return` work. No TypeScript transpiler or type checker is invoked. TypeScript declarations describe the tool API to the model; they do not make TS syntax executable. [Worker evaluation][worker]; [declaration rendering][declarations].
2. Every `execute()` creates a fresh Node worker thread and fresh QuickJS-WASI VM in a separate WASM instance. The compiled WASM module is cached and shared through worker data, but JS variables and closures are not shared between executions. [Host startup][host]; [worker VM creation][worker]; [WASM loader][wasm].
3. A prelude hides the host bridge in a closure, freezes injected tool/helper objects, and relays arguments/results as JSON strings. Guest code has no Node `process`, `require`, filesystem, network, timers, modules or `WebAssembly` capability. `eval` and `Function` stay inside QuickJS. This isolates orchestration code; it does not sandbox the injected host tools or the external MCP server process. [Prelude][prelude]; [runtime tests inspected, not run][sandbox-tests]; [worker][worker].
4. Default script globals are `tools`, `ALL_TOOLS`, `text`, `image`, `console`, `exit`, `store`, `load`. Additional globals can be top-level functions or one-level namespaces such as `models.classify`. `spread:true` passes all call arguments as an array. Global calls receive a cancellation signal but are not recorded in standalone `result.calls`. [Types][cm-types]; [host global registration][host]; [prelude][prelude].
5. Tool names get normalized JS aliases. The standalone prelude uses first-wins alias handling, so arbitrary names such as `a-b` and `a_b` can collide. Pi's MCP adapter fixes this before injection with sanitized, hash-suffixed names capped at 64 characters. Reuse the collision-aware naming pattern, not bare sanitization. [Prelude alias handling][prelude]; [MCP naming][mcp-tools].
6. Host worker-message guards check a message tag, not every field. The worker code is host-owned; guest data still enters `execute(args: unknown, {signal})` through JSON. Schemas in `CodemodeTool` affect declarations only, not runtime validation. Do not treat the generated signature as an authorization or validation boundary. [Protocol guards][protocol]; [tool types][cm-types]; [host dispatch][host].

#### Cancellation, deadlines, memory and output bounds

| Boundary | Standalone package | Pi built-in integration | What Nyte must own |
| --- | --- | --- | --- |
| Deadline | Defaults to 300,000 ms; execution override allowed; `Infinity` disables it. [Host][host]; [types][cm-types]. | Explicitly supplies `sourceOptions.timeoutMs ?? Infinity`, so **the built-in default is not the library's five-minute default**. [Executor lines 377-389][execute]. | Choose a host ceiling. Model-provided `timeout_ms` must not enlarge it. |
| CPU interruption | Host sets shared atomic flag, VM polls it, then host terminates the worker. Handles sync loops and microtask-spinning loops. [Host][host]; [worker][worker]; [tests][sandbox-tests]. | Same runtime. [Executor][execute]. | Preserve shared interrupt wiring, including on Bun. |
| Guest heap | Optional `memoryLimitBytes`; absent means no explicit cap beyond WASM32 address space. [Types][cm-types]; [worker][worker]. | Sets 256 MiB. [Executor constant and construction][execute]. | Set a finite limit. It is a guest-heap cap, not a process/host heap cap. |
| Nested cancellation | Each host call gets its own AbortController. Script finish, timeout, caller abort, or `close()` aborts pending calls. Unawaited calls are marked cancelled. [Host dispatch/finish][host]. | Forwards to `ctx.executeTool` then MCP `callTool`. [Executor][execute]; [MCP tool execute][mcp-tools]. | Tools must honor the signal. Cancellation cannot undo a remote write already performed. |
| Text/images emitted | `output[]` accumulates without aggregate hard bytes/items limit. `calls[]` and pending calls likewise have no count/concurrency limit. [Host accumulation][host]; [types][cm-types]. | Truncates combined text **after execution** to a default estimated 10,000 tokens using four chars/token, spills full text, and retains images. [Executor output handling][execute]. | Bound output during emission, host transfer sizes, image bytes, call count and in-flight calls. Post-hoc display truncation is insufficient. |
| Store | Per-value 256 Ki characters of JSON; total 1 Mi characters including keys. `undefined` deletes. [Prelude][prelude]. | Writes only successful changes to transcript. [Executor][execute]. | Validate supplied snapshots and choose retention policy. These are chars, not bytes or tokens. |
| Discovery schemas | Input rendering defaults to 16,000 chars; local-reference expansion limited to 32; recursive/remote refs become `unknown`. [Renderer][declarations]. | Catalog default 3,000 estimated tokens, separate from script output. [Catalog][cm-tool]. | Budget discovery metadata independently. |

- `parseCodemodeSource` validates an optional first-line `// @options:` containing only `max_output_tokens` and `timeout_ms`, then returns parsed options. It does **not** enforce them in `CodemodeSandbox`. `max_output_tokens` can be a nonnegative safe integer without a host policy ceiling; `timeout_ms` is positive and bounded by the platform timer maximum. Callers must clamp values themselves. [Parser][source].
- Successful results contain `value`, `output`, `calls` and `storeWrites`. Failed results retain partial output/call summaries but omit store writes. Error kinds are `script`, `timeout`, `aborted`, `sandbox`. Dead-end promises fail when no host call can settle them. `close()` rejects future executions and aborts current ones. [Result types][cm-types]; [host][host]; [worker/prelude][worker].
- The adapter's `mcpScript` is a useful source reference for cumulative 16 MiB intermediate-transfer and output accounting on both host and worker, including aborting stragglers. Its own comment correctly says this bounds transfer, not upstream allocation. These are design patterns, not public options in the upstream standalone package. [Adapter host budgets][adapter-code]; [adapter worker budgets][adapter-worker].

#### Discovery and API generation

- The reusable renderer converts JSON Schema into declaration text. `renderDeclarations` renders a `tools` object and global declarations; `renderToolSample` returns documentation plus a single-tool declaration. MCP result schema detection emits `CallToolResult<T>` with the shared MCP preamble. No schema-derived source files are generated on disk and no imported SDK functions are exposed automatically. [Renderer][declarations].
- Standalone `ALL_TOOLS` contains only the tools injected into that sandbox, with normalized names and supplied descriptions. Search and describe helpers are **not** built-in standalone globals. Pi creates `searchTools`, `describeTool`, and `describeNamespace` in its coding-agent executor. Its `ALL_TOOLS` descriptions use rendered tool samples, not just original prose. [Host data][host]; [discovery helpers][discovery]; [prelude][prelude].
- Pi's in-script search uses its local `Bm25Ranker`, over tool name, description/schema and namespace metadata. It does not require another LLM call. `describeTool` accepts original or normalized name. `describeNamespace` returns namespace instructions and names; the instructions are data, not permission grants. [Discovery helpers][discovery]; [ranker and model-side search][tool-search].
- Model-side `tool_search` searches not-yet-active `codemode`/`deferred` tools and activates matches for subsequent calls. It is itself `model-only`. Activating a tool and changing whether the model sees it are separate from whether a script is permitted to call it. [Search filtering/activation][tool-search]; [loadout][cm-tool].
- The codemode catalog is grouped by namespaces, budgeted by round-robin cheapest remaining declaration per group, and excludes deferred tools. In `mode:on`, direct tools remain declared individually and codemode lists the others. In `mode:only`, callable direct-tool declarations are hidden from the provider request but still callable from scripts. This is context management, not a permission denial. [Catalog and prepareLoadout][cm-tool].
- Default MCP configuration exposure `codemode` maps internally to tool exposure `deferred`; the difference from MCP configuration `deferred` is which entry tool is auto-enabled, codemode versus tool search. Avoid confusing the MCP config vocabulary with registry exposure. [MCP mapping][mcp-tools]; [activation logic][mcp-extension].

#### Registry, permissions and child scope

- Pi's exposure vocabulary is `direct`, `model-only`, `codemode`, `deferred`, `hidden`. Active `direct` tools and registered `codemode`/`deferred` tools are script-callable. `model-only` and `hidden` are excluded. Codemode itself is model-only to prevent recursive scripts. [Exposure definitions][exposure]; [callable selection][callable]; [codemode definition][cm-tool].
- Session-level `tools`/`excludeTools` options filter the underlying registry, including extension tools. `_getCallableTools()` then operates on that restricted registry. Merely hiding a provider declaration is not equivalent to applying this registry allowlist. The example subagent launches child Pi processes with `--tools`; the SDK converts `options.tools` into allowed tool names. [SDK restriction][sdk-filter]; [registry filtering][registry-filter]; [subagent example][pi-subagent].
- Each injected tool in the Pi integration calls `ctx.executeTool(tool.name, args, {signal})`. That goes through `runToolCall`, fresh callable-tool lookup, argument validation, before/after hooks, blocking decisions, and nested execution events with `parentToolCallId`. It does not directly execute the raw underlying tool. [Integration routing][execute]; [session nested pipeline][nested-pipeline]; [nested runner][nested].
- There is no intrinsic approval UI in the standalone sandbox. A callback handed to `CodemodeSandbox` can call anything its host authority permits. If Nyte injects a parent/global MCP catalog into a child sandbox, the sandbox will not invent child restrictions. Both discovery and execution must be derived from the **calling session's** permitted registry, with dispatch rechecking current availability. [Host map snapshot and dispatch][host]; [tool context][cm-types]; [Pi reference routing][nested-pipeline].
- Child agents must not prompt users by design. For Nyte, remove question/interactive capabilities from child discovery **and** dispatch; inherit existing workspace trust and plugin grants. Do not add child permission prompts as a fallback. A forbidden or unavailable tool should produce a policy error. Pi's example trust-confirmation UI and the adapter's interactive fallback are not patterns to copy for children. [Pi subagent example][pi-subagent]; [adapter approval fallback][adapter-approval].
- Pi's bare-agent example correctly shows nested execution through `runToolCall`, but its README also includes simpler direct `tool.execute` adapters that explicitly bypass hooks. Copy the dispatch-through-policy pattern, not the bypass. [Standalone integration example][agent-example]; [README warning][cm-readme].

#### MCP transport and result semantics

- First-party `pi-mcp` at this pin negotiates protocol `2025-11-25` and accepts `2025-06-18`, `2025-03-26`, `2024-11-05`. It does not implement the adapter's modern `2026-07-28` negotiation or its task extension. Streamable HTTP handles SSE responses/GET streams, not a separate legacy SSE client API. [Protocol constants][mcp-protocol]; [HTTP transport][http]; [exports][mcp-index].
- Library requests default to 30 seconds; the timer is rearmed on progress notifications. This is not an absolute wall-time limit when progress continues. Abort or timeout rejects locally and sends `notifications/cancelled` except for initialization. Transport fetch uses a transport-lifetime signal, not a per-request fetch controller; cancelling the protocol request does not necessarily stop the POST's underlying HTTP activity or the server's operation. [Client timeout/cancellation][mcp-client]; [HTTP fetch path][http].
- Transports offer `maxMessageBytes`, default 16 MiB, used for stdio lines and SSE events. **HTTP JSON responses call `response.json()` without the same bounded-read check**. Do not claim the transport globally caps all MCP response allocations. `listAll` caps pagination at 1,000 pages and rejects repeated cursors but accumulates items. [Transport constant][transport]; [stdio parsing][stdio]; [HTTP JSON path][http]; [pagination][mcp-client].
- Stdio defaults to inheriting the parent environment. Use `inheritEnv:false` with an explicitly chosen environment if server processes must not receive harness credentials. Shutdown closes stdin then escalates to process-tree termination. The QuickJS guest's inability to access env does not constrain the separate server's environment. [Stdio options/start/shutdown][stdio].
- `McpClient.callTool` checks the result envelope shallowly, not arbitrary tool arguments against `inputSchema` or successful `structuredContent` against the server's output schema. The caller owns full boundary validation. [Result validator and callTool][mcp-client].
- Pi wraps **every** MCP tool's script result as the full MCP `CallToolResult` minus top-level `_meta`: `{content, structuredContent?, isError?}`. Direct model-visible text is limited to 20 KiB, but scripts receive the full result. Declared output schema is the wrapper, not merely the server's payload. Thus scripts should inspect `r.isError`, use `r.structuredContent` when available, or parse text explicitly. [Conversion and schema][mcp-tools].
- Ordinary tool failures without structured output reject inside scripts. A structured MCP `isError` result can instead resolve to its wrapper. Pi's generic “rejects on failure” guidance has this concrete exception. Transport/lookup/validation/policy failures are still errors, not successful structured tool payloads. [toScriptValue][execute]; [MCP converter][mcp-tools].
- MCP resources become session tools in the integration, with exposure based on eligible servers. Removed/unavailable catalog entries are registered hidden. Server instructions and tool-list-changed handling live in the coding-agent extension, not automatically in `CodemodeSandbox`. [MCP extension registry/resource handling][mcp-extension]; [connection notifications][mcp-runtime].

#### Provider compatibility and persistence/replay

- The standalone executor is provider-independent. Pi's outer tool has a required string `code` property and optional grammar-constrained sampling. Providers supporting OpenAI grammar tools receive raw code through a custom tool; unsupported providers fall back to ordinary JSON tool input. Nyte can begin with `{code:string}` without adopting Pi's provider-specific custom-tool machinery. [Codemode tool definition][cm-tool]; [grammar fallback][sampling]; [custom-tool conversion][responses].
- `models.classify` and image generation are optional Pi integration globals, not a requirement of standalone codemode. Pi resolves catalog model IDs on the host and drops script-supplied headers/base URLs, uses session credentials and accounts usage; concurrency is limited to four model calls. This is distinct from a limit on general tool calls, which the standalone runtime lacks. [Model helpers][models]; [executor constants][execute].
- `store/load` persistence is an explicit value snapshot/delta protocol. Pi folds `codemode-store` custom entries along the current branch and appends successful writes. Branching before a write gives the old values; there is no persistent QuickJS VM or automatic replay of source code. [Store fold and append][execute]; [branch/store tests inspected][store-tests]; [prelude][prelude].
- Nested calls are attached to the parent tool result as bounded metadata: at most 256 records, 8 KiB argument bytes per call, 32 KiB total argument bytes, and 500 error chars. Oversized arguments are omitted and the summary marked incomplete. This bounds transcript metadata, **not execution count**, all intermediate results, or the live codemode `details.calls` array. [Recorder][nested]; [session result attachment][nested-attachment]; [executor live details][execute].
- Pi supplies cancellation and records past calls, but no exactly-once transaction across a whole script's remote effects. Script failure discards store writes while leaving completed tool effects in place. Output explicitly warns that earlier calls are not undone. Transport-level SSE event resumption is not durable script replay. [Failure summary/store handling][execute]; [HTTP resumption][http].

### Inferences

- Tool callbacks are the authority boundary. A sandboxed orchestrator can still request destructive real tools. “No Node/network in guest” is not a substitute for caller-specific routing.
- Reconstruct discovery from the same allowed tool set used at dispatch, but keep live dispatch checks. A per-execution sandbox snapshot alone does not handle revocation or disconnection after discovery.
- The caller should cap deadlines, concurrency, results, logs, image sizes and total call count. Neither declaration budgets nor a guest heap cap protects the host from repeated output messages.
- Do not automatically rerun a interrupted script that may already have issued non-idempotent MCP calls. Successful snapshot restoration is not permission to replay remote effects.

### Gaps

- No independent sandbox security audit or runtime test was performed. Upstream test cases were read to understand intended behavior, not reported as locally passing.
- I found no durable VM continuation or child-task suspension protocol in standalone codemode. Integrating Nyte's parked effects/`ToolWait` requires a separate design or initial exclusion of such tools from scripts.

## 3. What should Nyte copy or depend on, and what is not drop-in?

### Takeaway

**Recommended implementation: first-party `packages/codemode`, not a third-party extension.** The unmodified standalone library is usable today as exact dependency `@earendil-works/pi-codemode@0.99.2`. For a production Nyte integration that needs hard aggregate output/call limits, I recommend narrowly vendoring its ten source files at `86dfceec402ad77e563bf4feab5f26c42d5f5db6`, keeping `quickjs-wasi@3.6.2` as a dependency. The public API cannot enforce those limits during emission. Do not vendor Pi's coding-agent harness, and do not replace Nyte's MCP transport just to add code mode. [Public options][cm-types]; [unbounded host accumulation][host]; [published metadata][cm-registry]; [source tree][cm-tree]; [existing Nyte MCP][nyte-mcp].

### Cited findings

#### Concrete dependency versus vendor decision

| Piece | Decision | Reason and exact source |
| --- | --- | --- |
| First-party QuickJS executor | Narrow vendor for Nyte production; exact npm dependency for an unmodified prototype | Runtime already separates guest computation from the main event loop, handles Bun WASM interruption and cancellation. But hard aggregate output/call limits need host/worker/prelude edits, with no public interception hook. [Host][host]; [worker][worker]; [types][cm-types]. |
| QuickJS engine | Keep registry dependency `quickjs-wasi: 3.6.2` | Prebuilt WASM plus JS wrapper, no need to copy/build the engine. [Manifest][cm-package]; [engine metadata][qjs-registry]. |
| JSON Schema declaration generator | Reuse upstream `declarations.ts` and `identifier.ts` with the executor, or public `/declarations` export | No compiler dependency. Local refs, `unknown` fallback and input-size limit are already implemented. Reject alias collisions before generating declarations. [Generator][declarations]; [identifier][identifier]. |
| Source parser | Copy `source.ts` if adopting `// @options:`; otherwise ordinary outer `{code}` schema is enough | Parsing is separate from limit enforcement and provider grammar support. [Parser][source]; [provider fallback][sampling]. |
| Discovery/catalog | Adapt relevant operations, not the Pi extension wholesale | BM25 search, describe, namespace catalog and fair inline budgeting are source references, tied to Pi loadout/session types. [Discovery][discovery]; [ranker][tool-search]; [catalog][cm-tool]. |
| Tool dispatch | Nyte-owned core integration | Preserve current session registry, argument validation, plugin hooks, jobs wrappers, durable intent semantics and child restrictions. Pi reference is `ctx.executeTool -> runToolCall`, not raw `execute`. [Pi pipeline][nested-pipeline]; [Nyte registry][nyte-registry]; [Nyte loop][nyte-loop]; [Nyte binding][nyte-bind]. |
| MCP | Keep existing Nyte pool/plugin first | Nyte already has connection pooling, dynamic catalogs, a per-session on/off setting, cancellation and `replay:"never"`. Code mode needs a structured result adapter more urgently than a transport replacement. [Nyte MCP][nyte-mcp]. |
| Optional future lightweight MCP replacement | `@earendil-works/pi-mcp@0.99.2` dependency, not full coding-agent | Standalone, only cross-spawn runtime dependency. Audit protocol scope, OAuth main-versus-published fixes, HTTP JSON response bounds and environment inheritance before replacing the current SDK. [Manifest][mcp-package]; [registry][mcp-registry]; [client][mcp-client]; [HTTP][http]; [stdio][stdio]. |

#### Exact codemode vendor set

Copy this bounded library unit, preserving relative layout and a recorded upstream commit. Do not also copy the coding-agent implementation's Pi imports:

| File | Role | Pinned permalink |
| --- | --- | --- |
| `packages/codemode/src/index.ts` | Public entrypoint | [source][cm-index] |
| `packages/codemode/src/types.ts` | Tools, options, output and success/error results | [source][cm-types] |
| `packages/codemode/src/identifier.ts` | Script identifier normalization | [source][identifier] |
| `packages/codemode/src/declarations.ts` | Schema-to-TS rendering | [source][declarations] |
| `packages/codemode/src/source.ts` | Options parser and grammar | [source][source] |
| `packages/codemode/src/wasm.ts` | Cached WASM loading | [source][wasm] |
| `packages/codemode/src/runtime/host.ts` | Worker lifecycle, dispatch, cancellation and result assembly | [source][host] |
| `packages/codemode/src/runtime/worker.ts` | QuickJS VM and worker relay | [source][worker] |
| `packages/codemode/src/runtime/protocol.ts` | Worker messages and data | [source][protocol] |
| `packages/codemode/src/runtime/prelude-source.ts` | Guest API, JSON bridge, store and helpers | [source][prelude] |

Retain the [root MIT license][license] and a separate engine notice from [quickjs-wasi's archive][qjs-tar]. A runtime-only subset is seven files: host, worker, protocol, prelude, types, wasm and identifier. It omits declarations/parser/index. Copy all ten if retaining the documented public API. The copied build config must be Nyte-owned rather than extending Pi's absent workspace config. [Host imports][host]; [entrypoint imports][cm-index]; [build config][cm-build].

If choosing dependency reuse instead, import only the root or documented `/declarations`, `/source`, `/worker` exports. No deep import is needed for tools, cancellation, custom worker packaging, WASM loading or store deltas. Do not rely on main-only `renderToolOutputType` with `0.99.2`. Dependency reuse does **not** solve live aggregate output limits; an after-return truncation wrapper cannot prevent prior host allocations. [Published API][cm-index-published]; [exports][cm-registry]; [host][host].

#### Node, Electron and Bun packaging

- Ordinary Node: the package resolves `quickjs-wasi/quickjs.wasm` through `createRequire` and chooses a `.js` worker next to its runtime module when running published dist. Requires Node `>=22.19.0` per manifest. No runtime build of WASM or Pi workspace is required. [Loader][wasm]; [default worker URL][host]; [manifest][cm-package].
- Electron: use a Node-capable host process and the worker, not renderer/preload-exposed execution. Nyte's current Electron main build targets Node 24 and already declares usage/store worker entries. Add a dedicated code-mode worker entry and ship WASM as an explicit readable resource. Pass `workerUrl` and `wasm:loadQuickJSWasm(resourcePath)` through the public constructor. Do not depend on a bundled `import.meta.url` accidentally locating an unpublished sibling worker or WASM inside ASAR. [Public packaging knobs][cm-types]; [bundled-host guidance][cm-readme]; [Nyte build entries][nyte-electron].
- Electron packaging is plausible from those Node APIs, but not verified by upstream's stated Node/Bun support or by this source-only review. Confirm worker path resolution, WASM reads, signing/hardened-runtime behavior and packaged resource placement on the actual application. No native engine-addon rebuild is implied, but worker/WASM packaging is still real work. [Runtime imports][worker]; [engine artifact][qjs-tar]; [Nyte packaging][nyte-packaging].
- Bun: upstream documents ordinary Node/Bun parity and a special compiled-binary worker path. A compiled Bun executable needs an additional worker build entry and a relative string specifier from the embedded module graph, plus a supplied WASM path/module. The atomic interrupt is important because Bun termination alone may not interrupt spinning WASM. Preserve this; desktop-owned code should still use Node APIs, not a Bun-only executor. [Host guidance][cm-readme]; [interrupt protocol][protocol]; [host finish][host].
- The library is ESM. Its export map supplies `import`, not a CommonJS `require` entry. Do not promise a synchronous CJS consumer or browser runtime. [Codemode exports][cm-package]; [MCP exports][mcp-package].

#### Nyte-specific integration constraints

The inspected Nyte source files below are clean at repository commit `b6986047dcb12bb663116ccfa6e6d2ae737bb138`. Existing unrelated working-tree changes were left alone. The current `nyte` command resolves to the checkout native binary and reports `0.0.10`; its matching installed docs index was verified and read at `/Users/workgyver/Developer/nyte/share/nyte/0.0.10/docs/README.md`. Those installed docs offer CLI examples, not a public library code-mode API.

1. **Inject the caller's registry, not process-wide MCP handles.** Nyte's `ToolMapDraft.set` binds argument validation and image normalization; wrapping a raw server/tool factory can bypass later plugin contributions. The loop separately runs `beforeToolCall` blocking and post-hook argument validation. The code-mode bridge needs the equivalent whole pipeline, not merely calling a bound tool. [Registry][nyte-registry]; [binding][nyte-bind]; [loop][nyte-loop].
2. **Keep child capabilities absent.** Child agents must have no ask-question/prompt capability through code mode, search, describe, alias guessing or raw dispatch. Parent-only tools cannot reappear because they exist in a global catalog. Trust/grants are inherited policy inputs, not reasons to create another child approval channel. Pi shows registry-level allowlists as the enforcement pattern; it does not supply Nyte's child policy. [Pi filter][registry-filter]; [Nyte session-aware plugins/delegation][nyte-delegation].
3. **Preserve structured MCP data.** Current Nyte MCP converts results to text/images, drops `structuredContent`, and throws on MCP `isError`; its bridged tool does not publish an output schema. Directly adapting that result gives scripts strings, not typed API payloads. Retain a validated structured MCP result through a Nyte-owned tool-result contract, distinct from bounded user-visible content. Decide explicitly whether an `isError` wrapper resolves or rejects. [Nyte converter][nyte-mcp]; [Pi structured adapter reference][mcp-tools].
4. **Bound the host before accepting messages.** Add cumulative bytes/items, image bytes, per-transfer/result size, call count and in-flight limits. Accounting should occur before retention and preferably in the worker before posting, with host checks too. Abort outstanding calls when any budget is exceeded. Keep display truncation/spill policy separate, and protect spill files containing private data. The upstream integration's MCP spill uses mode `0600`; its codemode text spill does not explicitly set that mode. [Host accumulation][host]; [adapter budget pattern][adapter-code]; [MCP private spill][mcp-tools]; [codemode spill][execute].
5. **Treat the whole script as non-replayable initially.** Nyte persists tool intents with replay policy, and existing MCP tools already say `replay:"never"`. Until nested tool calls have durable identities/outcomes, rerunning the outer script may duplicate completed writes. Branch-local store deltas alone do not solve this. Successful store writes also need atomic coordination with the persisted outer result to avoid a crash window. [Nyte effects][nyte-effects]; [Nyte MCP replay policy][nyte-mcp]; [Pi store append][execute].
6. **Do not accidentally convert parking into a guest error.** Nyte has `ToolWait`/wake semantics, background jobs and persistent child sessions. The standalone codemode host catches thrown host values and turns them into ordinary script errors; it has no VM suspension/resumption contract. Initially exclude parking/interactive tools from script callbacks, or design a proper host continuation protocol. Preserve already-running background jobs rather than making sandbox cleanup terminate their independent lifetime. [Nyte tool contracts][nyte-tool-types]; [Nyte jobs wrapping][nyte-delegation]; [codemode host catch/finish][host].
7. **Do not copy Pi's model globals by default.** Code mode can start with tools, discovery and explicit output. Classifier/image model globals add credential routing and cost accounting that belong to Nyte's model runtime if wanted later. [Optional model integration][models].
8. **Adapt source to local type discipline.** Upstream uses assertions and `any` in some helpers and integrations. Vendoring is permission to reuse the implementation, not an exemption from Nyte's no-casts/no-`any` source guidelines. A dependency leaves its own source style external; a copy needs boundary narrowing and schema-derived types. [Host store parsing][host]; [integration tool adapters][execute]; [declaration tool types][cm-types].

### Inferences

- The smallest useful Nyte integration is an outer `{code:string}` tool, a fresh bounded sandbox per call, declaration/search helpers over the caller's allowed registry, and nested calls through Nyte's existing execution authority. MCP is one source of those tools, not the code-mode executor's owner.
- Vendor only the small standalone library if Nyte needs limits unavailable in its public API. Keep transport pooling, trust, child policy, durable replay decisions and frontend presentation in Nyte. This avoids importing Pi's CLI/session/UI architecture.
- A later upstream public output/call budget API would make exact dependency reuse preferable to maintaining a runtime fork. The current source does not offer it.

### Gaps

- This is a reuse recommendation, not a production-ready integration. No Nyte source was changed and no packaged Electron/Bun run was tested.
- I did not audit every OAuth protocol path or all transitive engine provenance. The direct package licenses/dependencies and Pi's SDK-derived notice were inspected. If replacing Nyte's transport or distributing a fork, complete that review separately.

### Pinned source index

All Pi links below use `86dfceec402ad77e563bf4feab5f26c42d5f5db6` unless explicitly marked published. The published npm source pin is `005af57d88ee23b33778f343a9595b32e67ff788`. Registry version endpoints and tarballs are separate publication evidence, not substitutes for pinned source.

[announcement]: https://earendil.com/posts/you-said-no-mcp/
[changelog]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/coding-agent/CHANGELOG.md#L110-L140
[root-package]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/package.json
[cm-package]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/codemode/package.json
[mcp-package]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/mcp/package.json
[cm-registry]: https://registry.npmjs.org/@earendil-works%2Fpi-codemode/0.99.2
[mcp-registry]: https://registry.npmjs.org/@earendil-works%2Fpi-mcp/0.99.2
[cm-tar]: https://registry.npmjs.org/@earendil-works/pi-codemode/-/pi-codemode-0.99.2.tgz
[mcp-tar]: https://registry.npmjs.org/@earendil-works/pi-mcp/-/pi-mcp-0.99.2.tgz
[qjs-registry]: https://registry.npmjs.org/quickjs-wasi/3.6.2
[qjs-tar]: https://registry.npmjs.org/quickjs-wasi/-/quickjs-wasi-3.6.2.tgz
[cm-build]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/codemode/tsconfig.build.json
[mcp-build]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/mcp/tsconfig.build.json
[base-tsconfig]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/tsconfig.base.json
[cm-index-published]: https://github.com/earendil-works/pi/blob/005af57d88ee23b33778f343a9595b32e67ff788/packages/codemode/src/index.ts
[prelude-published]: https://github.com/earendil-works/pi/blob/005af57d88ee23b33778f343a9595b32e67ff788/packages/codemode/src/runtime/prelude-source.ts
[oauth-index-published]: https://github.com/earendil-works/pi/blob/005af57d88ee23b33778f343a9595b32e67ff788/packages/mcp/src/oauth/index.ts
[cm-index]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/codemode/src/index.ts
[cm-types]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/codemode/src/types.ts
[host]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/codemode/src/runtime/host.ts
[worker]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/codemode/src/runtime/worker.ts
[protocol]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/codemode/src/runtime/protocol.ts
[prelude]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/codemode/src/runtime/prelude-source.ts
[wasm]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/codemode/src/wasm.ts
[declarations]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/codemode/src/declarations.ts
[identifier]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/codemode/src/identifier.ts
[source]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/codemode/src/source.ts
[cm-tree]: https://github.com/earendil-works/pi/tree/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/codemode/src
[cm-readme]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/codemode/README.md
[sandbox-tests]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/codemode/test/sandbox.test.ts
[mcp-index]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/mcp/src/index.ts
[mcp-client]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/mcp/src/client.ts
[mcp-protocol]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/mcp/src/protocol/types.ts
[mcp-changelog]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/mcp/CHANGELOG.md
[oauth-index]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/mcp/src/oauth/index.ts
[oauth-provider]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/mcp/src/oauth/provider.ts
[transport]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/mcp/src/transports/transport.ts#L1-L17
[http]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/mcp/src/transports/streamable-http.ts
[stdio]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/mcp/src/transports/stdio.ts
[license]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/LICENSE
[mcp-license]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/mcp/LICENSES/modelcontextprotocol-typescript-sdk.txt
[ca-index]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/coding-agent/src/index.ts#L405-L409
[ca-package]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/coding-agent/package.json
[execute]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/coding-agent/src/extensions/codemode/execute.ts#L219-L433
[discovery]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/coding-agent/src/extensions/codemode/execute.ts#L436-L517
[models]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/coding-agent/src/extensions/codemode/execute.ts#L519-L710
[cm-tool]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/coding-agent/src/extensions/codemode/tool.ts#L153-L385
[tool-search]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/coding-agent/src/extensions/tool-search/tool.ts
[mcp-tools]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/coding-agent/src/extensions/mcp/tools.ts
[mcp-extension]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/coding-agent/src/extensions/mcp/index.ts#L350-L475
[mcp-runtime]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/coding-agent/src/extensions/mcp/runtime.ts#L371-L398
[exposure]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/coding-agent/src/core/extensions/types.ts#L490-L509
[callable]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/coding-agent/src/core/agent-session.ts#L1503-L1519
[registry-filter]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/coding-agent/src/core/agent-session.ts#L3448-L3504
[sdk-filter]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/coding-agent/src/core/sdk.ts#L264-L270
[nested-pipeline]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/coding-agent/src/core/agent-session.ts#L698-L735
[nested]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/coding-agent/src/core/nested-tool-calls.ts
[nested-attachment]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/coding-agent/src/core/agent-session.ts#L1075-L1085
[pi-subagent]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/coding-agent/examples/extensions/subagent/index.ts
[agent-example]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/agent/examples/mcp-codemode/tools.ts#L78-L172
[sampling]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/ai/src/api/constrained-sampling.ts#L251-L283
[responses]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/ai/src/api/openai-responses-shared.ts
[store-tests]: https://github.com/earendil-works/pi/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/packages/coding-agent/test/suite/agent-session-codemode.test.ts#L472-L514
[adapter-package]: https://github.com/nicobailon/pi-mcp-adapter/blob/4bb5691096f29de490670cf18ddc4f81d20cd945/package.json
[adapter-code]: https://github.com/nicobailon/pi-mcp-adapter/blob/4bb5691096f29de490670cf18ddc4f81d20cd945/mcp-code.ts#L154-L543
[adapter-worker]: https://github.com/nicobailon/pi-mcp-adapter/blob/4bb5691096f29de490670cf18ddc4f81d20cd945/mcp-script-worker.mjs
[adapter-approval]: https://github.com/nicobailon/pi-mcp-adapter/blob/4bb5691096f29de490670cf18ddc4f81d20cd945/tool-approval.ts#L100-L222
[adapter-license]: https://github.com/nicobailon/pi-mcp-adapter/blob/4bb5691096f29de490670cf18ddc4f81d20cd945/LICENSE
[boo-package]: https://github.com/boozedog/pi-codemode/blob/a08ba0461572c57441aa4e354925ac9828d98704/package.json
[boo-checker]: https://github.com/boozedog/pi-codemode/blob/a08ba0461572c57441aa4e354925ac9828d98704/src/type-checker.ts#L195-L287
[boo-execute]: https://github.com/boozedog/pi-codemode/blob/a08ba0461572c57441aa4e354925ac9828d98704/src/execute-tool.ts#L427-L526
[boo-runtime]: https://github.com/boozedog/pi-codemode/blob/a08ba0461572c57441aa4e354925ac9828d98704/src/executor/quickjs-executor.ts
[boo-mcp]: https://github.com/boozedog/pi-codemode/blob/a08ba0461572c57441aa4e354925ac9828d98704/src/mcp-client.ts#L355-L373
[boo-deno]: https://github.com/boozedog/pi-codemode/blob/a08ba0461572c57441aa4e354925ac9828d98704/src/executor/deno-executor.ts#L124-L189
[boo-bindings]: https://github.com/boozedog/pi-codemode/blob/a08ba0461572c57441aa4e354925ac9828d98704/src/tool-bindings.ts#L274-L305
[boo-types]: https://github.com/boozedog/pi-codemode/blob/a08ba0461572c57441aa4e354925ac9828d98704/src/type-generator.ts#L235-L305
[boo-license]: https://github.com/boozedog/pi-codemode/blob/a08ba0461572c57441aa4e354925ac9828d98704/LICENSE
[horizon-code]: https://github.com/Hor1zonZzz/pi-codeMode/blob/301733543ebcccfd99505e364063daf8bfdc587a/extensions/code-mode.ts
[horizon-package]: https://github.com/Hor1zonZzz/pi-codeMode/blob/301733543ebcccfd99505e364063daf8bfdc587a/package.json
[horizon-license]: https://github.com/Hor1zonZzz/pi-codeMode/blob/301733543ebcccfd99505e364063daf8bfdc587a/LICENSE
[nyte-mcp]: https://github.com/interfaces-lab/nyte/blob/b6986047dcb12bb663116ccfa6e6d2ae737bb138/packages/plugin/src/mcp.ts
[nyte-registry]: https://github.com/interfaces-lab/nyte/blob/b6986047dcb12bb663116ccfa6e6d2ae737bb138/packages/core/src/plugins/registry.ts#L60-L76
[nyte-bind]: https://github.com/interfaces-lab/nyte/blob/b6986047dcb12bb663116ccfa6e6d2ae737bb138/packages/core/src/tools/bind-tool.ts#L23-L46
[nyte-loop]: https://github.com/interfaces-lab/nyte/blob/b6986047dcb12bb663116ccfa6e6d2ae737bb138/packages/core/src/kernel/loop/agent-loop.ts#L252-L329
[nyte-effects]: https://github.com/interfaces-lab/nyte/blob/b6986047dcb12bb663116ccfa6e6d2ae737bb138/packages/core/src/kernel/effects.ts#L154-L195
[nyte-tool-types]: https://github.com/interfaces-lab/nyte/blob/b6986047dcb12bb663116ccfa6e6d2ae737bb138/packages/core/src/kernel/loop/types.ts#L256-L421
[nyte-delegation]: https://github.com/interfaces-lab/nyte/blob/b6986047dcb12bb663116ccfa6e6d2ae737bb138/packages/core/src/kernel/sdk/delegation.ts#L115-L160
[nyte-electron]: https://github.com/interfaces-lab/nyte/blob/b6986047dcb12bb663116ccfa6e6d2ae737bb138/packages/desktop/electron.vite.config.ts#L8-L22
[nyte-packaging]: https://github.com/interfaces-lab/nyte/blob/b6986047dcb12bb663116ccfa6e6d2ae737bb138/packages/desktop/electron-builder.config.ts
