# Cloudflare Agents SDK and @nyte-ai/cloudflare

## Which Cloudflare components should Nyte wrap?

### Takeaway
Ship a direct SQLite-backed Durable Object first. Keep an Agents subclass as an optional integration, not Nyte's default runtime or a replacement for its execution engine.

### Cited Findings
- Reference checkout: `/Users/workgyver/Developer/nyte-integration-references/cloudflare-agents`, freshly cloned with `git clone --depth 1 https://github.com/cloudflare/agents.git`. SHA `2f3176b9fa03c6429c805b560c8dc14371c15f64`, commit dated 2026-10-02, clean checkout. [Pinned commit][commit]. No dependencies installed or upstream code executed.
- Actual package is `agents` **0.26.0**, MIT, not `@cloudflare/agents`. `packages/agents/package.json:2,15-16,26-37,68-126` gives dependencies and optional peers. `@cloudflare/think` **0.20.0**, MIT, is a separate opinionated chat package. These are checkout manifest versions, not independently verified npm dist-tags. [Agents manifest][manifest], [Think manifest][think], [MIT license][license]. Vendored PartyServer is ISC; retain upstream notices if copying substantial code. [Third-party notices][notices]. Prefer dependencies over copying.
- Nyte checkout HEAD is `addfa87d07dc80898cf1d4a039eec07afae2dc6a`, remote `interfaces-lab/nyte`. Demo/server/store files cited below are unchanged locally; core runner and execution files have pre-existing edits. Pinned links describe HEAD, not those edits. Demo is private **0.0.0**, with workspace core/server dependencies and no license declaration in these package manifests. [Demo manifest][demo-package], [Core manifest][core-package], [Server manifest][server-package]. Local TUI manifest says **0.0.12**. [TUI manifest][tui]. `command -v nyte` resolves to checkout `bin/nyte`; installed binary version and matching installed docs were not verified. Checked candidate installed docs paths were absent; checkout docs were not substituted.
- `packages/agents/src/index.ts:1107-1119` shows `Agent<Env, State, Props> extends DurableObject<Env>` and installs Lifecycle. `:1560-1575` executes SQL through `ctx.storage.sql.exec`. `:1620-1656` creates workflow/fiber tables. It is a framework on DO storage, not another storage service. [Agent base and SQL][base], [SDK tables][tables].
- `packages/agents/src/agent-routing.ts:267-379` discovers DO bindings, maps names to kebab-case, parses `/agents/{binding}/{name}`, invokes separate HTTP and WebSocket hooks, then forwards the original URL. It does **not** strip the root route prefix. Authentication is optional middleware, not a tenant guarantee. `getAgentByName`, `:390-416`, performs lifecycle initialization through an SDK-specific RPC method; it is not suitable for an arbitrary plain DO. [Routing implementation][routing].
- `packages/agents/package.json:128-173,245-274` separates root, routing, client, lifecycle, schedules, and workflows exports. `scripts/build.ts:90-103` emits ESM/declarations and leaves `cloudflare:workers`/`cloudflare:email` external. Standalone Lifecycle and Scheduler exports explicitly say experimental. [Exports][exports], [Build][build], [Lifecycle status][lifecycle-status], [Scheduler status][scheduler-status].
- Nyte already has the right seams. `packages/demo/server/cloudflare/src/sqlite.ts:3-20` maps `run/all/exec` to DO SQL and `transact/read` to `transactionSync`. `packages/core/src/kernel/sql.ts:17-35` defines that synchronous connection contract. `kernel/sqlite.ts:1003-1017` opens `SqlStore` and creates its schema inside the connection transaction. [Demo connection][demo-sqlite], [Connection contract][sql-contract], [SqlStore][sql-store].
- `packages/demo/server/cloudflare/src/index.ts:11-69` routes every caller to `getByName("local")`, opens Nyte without workspace plugins, and passes its SDK to `createNyteServer`. `packages/server/src/index.ts:61-143` already defines token/custom auth, parsed-operation permissions, browser origins, body limits, and SSE heartbeat configuration. [Demo host][demo-host], [Server policy][server-policy].

### Inferences
- **Wrap:** Cloudflare DO identity/storage/alarms, Nyte `SqlStore`, `createNyte`, and `createNyteServer`. Preserve Nyte's sessions, keyed admission, leases, execution outcomes, events, and HTTP/SSE protocol. Do not implement a second chat engine with Think or mirror Nyte history into Agents `state`.
- **Implement in the adapter:** authenticated tenant-to-DO routing, initialization, mutation wakeup admission, bounded alarm dispatch/rearming, runtime capability restrictions, and deployment guidance. These are platform integration duties, not a new Store implementation.
- A direct DO avoids a second framework's state tables, lifecycle, routing protocol, and alarm ownership. Agents becomes useful when an application specifically needs its WebSocket/RPC, scheduling, MCP, or AgentWorkflow conventions. Put that bridge in an explicit `/agents` export with an optional, tested peer version. Do not depend on experimental Lifecycle/Scheduler composition for v1.
- Export ESM plus declarations, with separate worker/SQLite/optional Agents entry points. Keep browser clients in `@nyte-ai/client`; do not make users bundle worker-only `cloudflare:workers` imports into frontend code.

### Gaps
- Nyte package publication/license decisions remain unresolved; the inspected private manifests do not establish permission to publish a public adapter.
- No npm release availability, build-size, runtime, or deployment claim follows from manifest/source inspection alone.

## What durability do alarms, recovery, and Workflows actually provide?

### Takeaway
Persist work before acknowledging it, then drive Nyte from DO alarms. Promise resumable execution from committed Nyte state, not uninterrupted processes, precise wake times, or exactly-once external effects.

### Cited Findings
- Cloudflare documents one alarm per DO, guaranteed at-least-once handler execution, and automatic retries for uncaught failures starting at two seconds with up to six retries. A later `setAlarm` replaces the earlier time. Constructor rearming must first check the existing alarm. [Official alarms docs][alarms], fetched as official Markdown after websearch.
- The current SDK multiplexes persisted jobs through that alarm. `packages/agents/src/lifecycle/job-queue.ts:205-219` stores `cf_agents_jobs`, including due time, running marker, retry policy, and execution start. `durable-object-lifecycle.ts:799-818` serializes alarm recalculation. `index.ts:4988-5002` delegates Agent `alarm()` to Lifecycle. [Job schema][jobs], [Alarm ownership][rearm], [Agent alarm][agent-alarm].
- `lifecycle/job-driver.ts:283-295` pre-arms a deadman alarm before dispatch. `:346-426` applies bounded callback retries, preserves jobs on platform failures, and applies the failure hook after application retry exhaustion. Scheduler `onJobError`, `schedules/scheduler.ts:362-399`, completes failed one-shots or advances recurrence. Interval recurrence is measured from current completion time, not a fixed wall-clock sequence. [Driver][driver], [Scheduler failures][schedule-errors]. A persisted schedule is not a promise of eventual application success.
- Agent `schedule`, `index.ts:3308-3333`, delegates to Scheduler. Recurring schedules deduplicate by default; one-shots require `idempotent: true`. Matching existing jobs re-arms the physical alarm. This deduplicates schedule insertion, not callback side effects. [Schedule methods][schedule-methods], [Insertion dedup][schedule-dedup].
- Agent `runFiber`, `index.ts:4070-4087`, persists an execution record and supports explicit checkpoints. `onFiberRecovered`, `:4454-4470`, only warns by default. Recovery scanning invokes hooks and can age out records, `:4485-4609`. A fiber does not serialize/resume an arbitrary JavaScript call stack. [Fiber entry][fiber], [Recovery hook][fiber-hook], [Recovery scan][fiber-scan].
- `runWorkflow`, `index.ts:8563-8632`, injects Agent identity, calls the Workflow binding's `create`, then inserts local tracking. `workflows.ts:79-84,132-177,243-258` extends `WorkflowEntrypoint` and resolves the originating Agent before running the user's code. Reporting helpers wrap callbacks in Workflow steps, `:340-365`. Workflow creation and local SQL tracking are separate operations. [Workflow start][workflow-start], [Workflow base][workflow-base], [Workflow callbacks][workflow-callbacks].
- Nyte demo `src/index.ts:76-126` pre-arms a 30-second watchdog, scans sessions/heads, calls `sdk.advance`, and selects the earliest continuation, retry, wait, or lease expiry. Admission wrappers at `:129-139` persist a wake before the mutation and again in `finally`; revision/admission counters detect overlapping requests. Startup at `:66-68` repairs a missing alarm when persisted sessions exist. [Demo alarm driver][demo-alarm].
- Nyte's committed kernel `step.ts:435-470` executes effects with lease renewal and checks fencing before publishing the result. That is a state-commit protection, not an external API transaction. [Lease/fence boundary][fencing].

### Inferences
- Direct DO v1 should keep the demo's pre-arm/admit/rearm pattern, but bound each scan by head count and elapsed time and continue via a durable scan cursor. Serialize/recheck final alarm calculations so an older scan cannot erase a newer admission wake. Derive all recovery decisions from storage, not surviving in-memory counters.
- Audit every operation that can make a head runnable, including internal delegated work, imports/restores, configuration, replies, redelivery, and abort. The current demo wraps a specific subset; package correctness needs a complete wakeup contract. Do not attach Nyte's timer runner as well as its alarm driver.
- Arm a watchdog before advancing. Rearm from persisted state after each bounded batch. Preserve retry timestamps, lease expiries, and waiting deadlines; waiting without a deadline can sleep until new admission. Add backoff, telemetry, and a dead-letter/repair policy for repeatedly failing work rather than claiming infinite retries.
- For optional Agents mode, **never copy the demo's `alarm()` or direct `setAlarm/deleteAlarm` calls into an Agent subclass**. Let Agents own the alarm; invoke a bounded Nyte driver through a named scheduled callback, reconcile pending work on startup, and define durable repair for exhausted one-shots. Merely calling `super.alarm()` plus independent Nyte alarm writes still risks competing schedules.
- Use Workflows for application-level multi-step jobs, long waits, and approval gates. Wrap native bindings or `AgentWorkflow` when using the optional Agent host. Do not move Nyte's model/tool loop into `step.do` wholesale. Workflow retries still need stable operation keys and reconciliation around the create-before-track window and all external side effects.
- Honest contract: acknowledged admissions and committed history survive isolate restarts; alarms can re-enter Nyte after clients disconnect, subject to platform limits and the adapter's tested recovery policy. Model streams and tools may rerun after interruption. External writes must accept idempotency keys or application compensation. No exactly-once guarantee.

### Gaps
- Source inspection is not a crash test. Restart/deploy, concurrent admission/rearming, retry exhaustion, delayed alarms, and duplicate external calls require real Worker/DO verification before a durable-host guarantee ships.

## What minimal package, tenant policy, and deployment should ship?

### Takeaway
Start with a restricted, authenticated chat host using a real Worker-compatible model endpoint. The existing loopback Codex demo is useful local evidence, not a production deployment template.

### Cited Findings
- `packages/demo/server/cloudflare/src/models.ts:8-44` fixes the provider URL to `http://127.0.0.1:8788/backend-api`. README `:68-74` says direct workerd Codex requests failed in that test and explains its local Node proxy, Photon alias, and interpreted TypeBox mode. No token files, model JSON, or credential stores were read. [Model setup][demo-models], [Demo limitations][demo-readme].
- Demo package pins Photon **0.4.0**, TypeBox **1.3.7**, and Wrangler **4.146.0**. Existing local dependency manifests identify Apache-2.0, MIT, and MIT OR Apache-2.0 respectively. [Version source][demo-package], [Photon license metadata](file:///Users/workgyver/Developer/nyte/packages/demo/server/cloudflare/node_modules/@cf-wasm/photon/package.json), [TypeBox metadata](file:///Users/workgyver/Developer/nyte/packages/demo/server/cloudflare/node_modules/typebox/package.json), [Wrangler metadata](file:///Users/workgyver/Developer/nyte/packages/demo/server/cloudflare/node_modules/wrangler/package.json).
- Official DO SQL limits include **100 bound parameters**, **2 MB per string/BLOB/row**, and **10 GB per DO**. Nyte `kernel/sqlite.ts:41-42,620-624` uses delete chunks of 500 OIDs plus the session parameter; `:56-62` stores object bodies in a single TEXT field. This is a concrete compatibility gap in the generic SqlStore, not something Agents inheritance fixes. [DO SQL limits][limits], [Nyte chunk constant][delete-size], [Bulk delete][bulk-delete], [Object schema][object-schema].
- Worker limits include **128 MB per isolate** and **15 minutes wall duration per DO alarm**. DO CPU defaults to **30 seconds**, configurable to five minutes. [Worker limits][worker-limits], [DO limits][limits].
- Node compatibility is partial. `node:sqlite` and `node:child_process` are importable non-functional stubs. `/tmp` is an in-memory, nonpersistent, request-local VFS. For compatibility dates since **2026-08-04**, Node compatibility is enabled by default; older dates need `nodejs_compat`. [Node docs][node], [VFS docs][fs]. Do not repeat the older blanket claim that Workers have no filesystem.
- Hibernation discards in-memory state, and pending timers/I/O prevent it. Hibernated WebSockets have dedicated support; Nyte's SSE transport does not gain that support by subclassing Agent. [DO lifecycle][do-lifecycle], [Nyte server protocol][server-protocol].
- Demo `wrangler.jsonc:5-13` selects compatibility date `2026-10-02`, aliases Photon to its workerd build, binds `NYTE`, and declares `new_sqlite_classes`. Upstream Workflow example adds a separate workflows binding. [Nyte config][demo-config], [Workflow config][workflow-config].

### Inferences
Suggested v1 public API, names are proposals rather than implemented exports:

| Export | Responsibility |
| --- | --- |
| `NyteDurableObject<Env>` from `@nyte-ai/cloudflare` | Extend native DO; initialize SqlStore/Nyte/server; serve existing `/v1` protocol; own bounded alarm driver. App subclasses provide `configure({ env, identity })` with model/provider options and server policy. Adapter owns store and execution lifecycle. |
| `routeNyteRequest({ request, namespace, authorize })` | Authenticate before resolving/waking a DO; return a validated tenant/environment identity or a denial; derive a canonical DO key and normalize the forwarded URL. No caller-selected binding name. |
| `durableSqlite({ storage })` from `/sqlite` | Small typed connection adapter for applications with their own DO class. No new database schema. |
| Later `NyteAgent<Env>` from `/agents` | Optional `agents` peer. Delegate `onRequest` to Nyte's handler and wakeups to Agents scheduling; do not override its alarm. No Think dependency. |

- `authorize` should return a discriminated decision, validated at the boundary. Derive names from verified issuer/account/tenant/environment claims with unambiguous encoding or a stable hash; never accept a tenant ID solely from URL/query/headers. Use one DO per tenant/environment initially so session listing and the existing server protocol stay coherent; shard only with an explicit session-directory design.
- Retain server auth inside the DO and parsed-operation/watch permissions. Bind verified identity to the resolved object and reject mismatches. Strip forged internal identity headers at ingress; never mistake a public name, CORS, or Workers Access availability for automatic authorization. Authenticate both HTTP and WebSocket paths if enabling SDK routing, and allowlist bindings. Rewrite external routing prefixes to Nyte's exact `/v1` paths.
- Package owns the DO connection adapter, admission wakeups, alarm driver, platform constraints, and examples. Core keeps persistence/leases/replay/step semantics; server keeps JSON/SSE/auth/validation; app owns tenancy policy, model credentials, billing, quotas, and deployment. No local OAuth syncing, credential discovery, proxy process, terminal, or desktop backend in the package.
- V1 capability declaration should say no workspace/terminal. Supply HTTP/Workers-AI-compatible model configuration through environment bindings. Do not equate imported Node modules with working APIs. Keep TypeBox interpreted and Photon workerd alias until a verified package build removes the need. Avoid runtime code generation, native addons, and process spawning.
- Release blockers: make SqlStore's bulk SQL respect the 100-parameter ceiling; impose row-size limits on all persistence boundaries. Large inline images/events/commits can exceed DO limits despite the server's 8 MiB HTTP body allowance. Use explicit rejection for v1, or design a separate blob-reference Store/R2 integration with atomicity and garbage-collection rules. A simple SQL adapter cannot transparently solve these differences.

Minimal proposed `wrangler.jsonc`, preserving the inspected demo's date. Class must be exported by application entry point; this is not a verified deployment:

```jsonc
{
  "name": "nyte-cloud",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-02",
  "alias": { "@cf-wasm/photon/node": "@cf-wasm/photon/workerd" },
  "durable_objects": {
    "bindings": [{ "name": "NYTE", "class_name": "NyteHost" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["NyteHost"] }]
}
```

Configure auth/model credentials as deployment secret bindings, not plaintext `vars`. Current official docs make `nodejs_compat` redundant at this date; the existing demo still includes it. Workflows are optional and need their own exported class and binding. No Cron Trigger is required for per-object alarms. Add explicit CPU/observability configuration only after workload measurement.

### Gaps
- No installs, builds, tests, upstream scripts, deploys, or credential reads were performed. Existing Nyte source and pre-existing edits were left untouched; only this research note was written.
- Production portability remains unproven until a real Worker-compatible provider passes bundle/deploy, auth-isolation, SQL-limit, restart-recovery, backpressure, and disconnected-client checks. The local Codex proxy cannot satisfy that gate.

[commit]: https://github.com/cloudflare/agents/commit/2f3176b9fa03c6429c805b560c8dc14371c15f64
[manifest]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/packages/agents/package.json#L2-L126
[think]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/packages/think/package.json#L2-L30
[license]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/LICENSE
[notices]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/THIRD_PARTY_LICENSES.md#L7-L13
[base]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/packages/agents/src/index.ts#L1107-L1119
[tables]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/packages/agents/src/index.ts#L1560-L1656
[routing]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/packages/agents/src/agent-routing.ts#L267-L416
[exports]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/packages/agents/package.json#L128-L274
[build]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/packages/agents/scripts/build.ts#L90-L103
[lifecycle-status]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/packages/agents/src/lifecycle/index.ts#L1-L5
[scheduler-status]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/packages/agents/src/schedules/index.ts#L1-L8
[jobs]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/packages/agents/src/lifecycle/job-queue.ts#L205-L219
[rearm]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/packages/agents/src/lifecycle/durable-object-lifecycle.ts#L799-L859
[agent-alarm]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/packages/agents/src/index.ts#L4988-L5002
[driver]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/packages/agents/src/lifecycle/job-driver.ts#L283-L426
[schedule-errors]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/packages/agents/src/schedules/scheduler.ts#L362-L399
[schedule-methods]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/packages/agents/src/index.ts#L3308-L3333
[schedule-dedup]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/packages/agents/src/schedules/scheduler.ts#L775-L829
[fiber]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/packages/agents/src/index.ts#L4070-L4087
[fiber-hook]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/packages/agents/src/index.ts#L4454-L4470
[fiber-scan]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/packages/agents/src/index.ts#L4485-L4609
[workflow-start]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/packages/agents/src/index.ts#L8563-L8632
[workflow-base]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/packages/agents/src/workflows.ts#L79-L258
[workflow-callbacks]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/packages/agents/src/workflows.ts#L340-L365
[workflow-config]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/examples/workflows/wrangler.jsonc#L10-L29
[demo-package]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/demo/server/cloudflare/package.json#L1-L29
[core-package]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/core/package.json
[server-package]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/server/package.json
[tui]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/tui/package.json#L1-L5
[demo-sqlite]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/demo/server/cloudflare/src/sqlite.ts#L3-L20
[sql-contract]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/core/src/kernel/sql.ts#L17-L35
[sql-store]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/core/src/kernel/sqlite.ts#L1003-L1017
[demo-host]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/demo/server/cloudflare/src/index.ts#L11-L69
[server-policy]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/server/src/index.ts#L61-L143
[demo-alarm]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/demo/server/cloudflare/src/index.ts#L66-L139
[fencing]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/core/src/kernel/step.ts#L435-L470
[demo-models]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/demo/server/cloudflare/src/models.ts#L8-L44
[demo-readme]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/demo/server/cloudflare/README.md#L63-L74
[delete-size]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/core/src/kernel/sqlite.ts#L41-L42
[bulk-delete]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/core/src/kernel/sqlite.ts#L620-L624
[object-schema]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/core/src/kernel/sqlite.ts#L56-L62
[server-protocol]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/server/src/index.ts#L1-L15
[demo-config]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/demo/server/cloudflare/wrangler.jsonc#L3-L15
[alarms]: https://developers.cloudflare.com/durable-objects/api/alarms/
[limits]: https://developers.cloudflare.com/durable-objects/platform/limits/
[worker-limits]: https://developers.cloudflare.com/workers/platform/limits/
[node]: https://developers.cloudflare.com/workers/runtime-apis/nodejs/
[fs]: https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/
[do-lifecycle]: https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/
