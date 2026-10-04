# @nyte-ai/cloudflare

Private workspace integration for SQLite-backed Durable Objects. The native host owns its alarm. The optional Agents host delegates alarm ownership to Agents SDK 0.26.0.

## Native host

```ts
import { NyteDurableObject, type CloudflareOptions } from "@nyte-ai/cloudflare";
import { configureModels } from "./models.ts";

export class NyteHost extends NyteDurableObject<Env> {
  protected configure(): CloudflareOptions {
    return {
      nyte: {
        ...configureModels(this.env),
        plugins: [],
        env: { cwd: "/tmp" },
      },
      server: {
        version: "my-host-version",
        auth: { kind: "token", token: this.env.NYTE_TOKEN },
      },
      onAlarmError: (cause) => console.error(cause),
    };
  }
}
```

`configure` runs during initialization. Read `this.env` and `this.ctx`, not fields initialized by a subclass constructor. The package creates the `SqlStore`, Nyte SDK, server, and alarm driver. It uses static plugin configuration, not lazy activation. Do not attach a timer runner or override `alarm()`.

Server options retain authentication, parsed-operation permissions, browser origins, request limits, and error reporting. The package advertises no workspace capability and does not accept an environment/terminal backend. Plugins must be Worker-compatible; the type system cannot prevent a plugin from using unsupported Node APIs or starting local timers/jobs.

The application must declare a SQLite DO binding/migration, enable Node compatibility, and alias `@cf-wasm/photon/node` to `@cf-wasm/photon/workerd`. See the migrated demo's Wrangler configuration. The runtime disables TypeBox acceleration for workerd. No local OAuth or loopback provider is configured by this package.

## Authenticated routing

`routeNyteRequest({ request, namespace, authorize, prefix? })` is also available separately from `/routing`, without importing `cloudflare:workers`.

`authorize(request)` returns either:

- `{ kind: "allow", tenant, environment }` from verified claims;
- `{ kind: "deny", status: 401 | 403 }`.

Authentication runs before object lookup. The object name is `JSON.stringify([tenant, environment])`, so separators in claims cannot create identity collisions. An optional prefix such as `/nyte` is stripped only from matching `/nyte/v1/` routes. Query strings are preserved. Upgrades are rejected. This package serves HTTP/SSE, not WebSockets.

Never derive tenant identity from an unverified path, query, or header. Keep the namespace behind the authorized Worker. Retain server auth inside the DO. For multi-tenant deployments, the inner authorization policy must also bind verified claims to the target object, for example by comparing `namespace.idFromName(JSON.stringify([tenant, environment]))` with `this.ctx.id`. Sharing one unrestricted server token across mutually untrusted tenants does not provide this check. The demo intentionally remains one local tenant, not a production identity service.

The demo now resolves the name `["local","demo"]` instead of `local`. Existing local demo objects are not migrated or deleted. Use an explicit application migration if that data must remain accessible.

## Scheduling and recovery

- Every HTTP POST to `/v1/call/` pre-arms a wake before the server can admit work, then rearms in `finally`. This includes rejected and read-only calls, so newly added protocol mutations cannot silently bypass the admission wake.
- Each alarm arms a 30-second watchdog before advancing any head.
- The driver processes at most 32 heads or 10 seconds between advances by default. `maxHeads` and `budgetMs` are configurable. One model/tool call is not preempted at the time limit.
- SQL keyset queries return one session/head at a time. The `nyte_alarm_scan` table stores the cursor and the earliest observed deadline across batches. A restarted isolate continues the scan. The cursor deliberately follows the current core `sessions` and `refs` layout; schema changes need adapter review.
- Scan targets are the default `main` head plus registered head/stack refs. Create a non-default head with the SDK before sending to it. Arbitrary unregistered head names with only an inbox ref are not discovered.
- `continue` and `finished` schedule another pass; retry, busy-lease, and waiting deadlines are retained. Undated waits do not spin. Fenced work retries after one second.
- Alarm writes are serialized. Admission revisions invalidate an older final calculation, and any already-running alarm write completes before a newer admission's wake is written.
- A full scan rearms no later than 60 seconds even if all heads are idle. This costs idle alarm invocations but repairs work created behind a cursor or by internal mutations. New internal work can wait for the current sweep and the next repair interval.
- A failed head is reported and revisited after 30 seconds without blocking later sessions. SQL/rearm/initialization failures propagate. Cloudflare automatic alarm retries are finite. Monitor failures; after retry exhaustion, an authenticated POST through the host rearms recovery. A missing alarm is also repaired at native-host startup. No dead-letter dashboard or external fleet-wide sweeper is included.

Bounded scans are not a hard CPU or wall-time guarantee for one `advance`. Platform limits, provider latency, and synchronous SQL cost still apply. Tune limits for your workload. SSE is not a hibernating WebSocket.

## Agents adapter

Import `NyteAgent` and `routeNyteAgentRequest` from `@nyte-ai/cloudflare/agents`. Extend `NyteAgent<Env>` and implement `configureNyte()` with the same `CloudflareOptions` as the native host. Route through `routeNyteAgentRequest` with the same authorization callback; it calls the SDK's `getAgentByName` after authorization, rather than treating Agents as an ordinary DO stub.

`agents@0.26.0` was confirmed by registry metadata, installed in an isolated pnpm probe, and installed/typechecked in this workspace. It is an exact optional peer and a development dependency. No older/newer Agents API is promised. Importing the root native host does not import Agents.

The adapter uses named scheduled callbacks, `schedule`, `cancelSchedule`, and an idempotent 30-second `scheduleEvery` watchdog. It never calls `setAlarm` or `deleteAlarm`. Each re-arm persists a new `nyteTick` one-shot, then cancels every other `nyteTick` one-shot, so a crash between the two leaves at most one duplicate, which the next re-arm removes and core fencing tolerates. Agents rounds schedules down to whole seconds, so future wakes round up to the next second; immediate wakes stay immediate. `onStart` only registers the watchdog; the runtime opens lazily so a startup failure does not disable it. Do not replace `onStart` without calling its superclass implementation or override the SDK alarm. WebSocket upgrades are refused; this is not an Agents chat-state or RPC integration. Routing through the SDK's own `routeAgentRequest` bypasses `authorize`; only the server's token check inside the object then applies.

The adapter was typechecked and bundled with Wrangler, but not exercised in a running Agents Durable Object. Deployment, lifecycle recovery, schedule exhaustion, and authorization isolation remain qualification work.

## SQLite limits

`durableSqlite(storage)` is exported only from `/sqlite`. It adapts synchronous DO SQL and `transactionSync` to core's `SqliteConnection`, without owning alarms.

Every bound `run`/`all` statement rejects more than 100 parameters or an aggregate UTF-8 parameter budget over **1,900,000 bytes**. This deliberately leaves space below Cloudflare's 2 MB string/BLOB/row ceiling for row metadata. Core deletion uses chunks of 99 IDs plus one session parameter. Regression tests insert and delete 501 real SQLite objects and reject oversized multibyte bodies before writing.

The budget is conservative, not a general SQL row-size parser. The core writes complete object/event bodies as parameters; raw literal SQL, accumulated updates, pre-existing oversized rows, and direct `storage.sql` use bypass this guard. Cloudflare remains the authority for the 2 MB row and 10 GB object limits. Large inline images, events, and tool/model results can therefore fail persistence. There is no transparent R2 spill, automatic truncation, or blob-GC protocol. HTTP body limits do not bound generated output; an external effect may have happened before its oversized result is rejected.

## Checks

Run `pnpm --dir packages/cloudflare typecheck` to generate types for the pinned compatibility date and typecheck both entrypoints. `pnpm --dir packages/cloudflare test` runs SQLite, alarm-race, and routing regressions without starting a server. The demo's `build` is a Wrangler dry run, not a deployment. Its existing loopback Codex provider is still local-only. Public packaging, deployed provider compatibility, and exactly-once external effects are not claimed.
