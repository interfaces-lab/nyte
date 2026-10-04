# @nyte-ai/vercel

Private workspace integration for Workflow **4.8.8**. It does not replace Nyte's admission, leases, effects, or HTTP protocol. No deployment runs as part of using this package.

## Entrypoints

- Root: `advanceNyte`, `createVercelDispatcher`, `withDispatch`, `WakeTarget`.
- `/workflow`: `driveNyte`. Only type imports; safe for the Workflow compiler's workflow bundle.
- `/postgres`: `openPostgresExecution`. Node-only pg pool ownership, Vercel pool attachment, store/outbox initialization, and idempotent resource cleanup.
- `/outbox`: `dispatchOutbox`, `reconcileDispatch`, and their types. PostgreSQL, separate from workflow code.
- `/sandbox`: `vercelSandboxPlugin` and its types. The `vercel-sandbox` environment provider.

Applications own provider configuration, plugins, secrets, server authentication, deployment configuration, and the compiled wrapper files. No factories or closures cross the Workflow journal.

`vercelSandboxPlugin({ connect })` provides the `vercel-sandbox` environment. Install it in `NyteOptions.plugins`, or in `HostOptions.environments` under `createHost`. Opening a workspace `{ kind: "vercel-sandbox", id, cwd, locator }` connects nothing. Every operation calls `connect(workspace)` and acts in the Sandbox it returns, so memoize `connect`. The host assigns `id`. `locator` holds what `connect` needs to reconnect, such as the Sandbox name, and never credentials. `connect` must reject when it cannot reach the files `id` names, such as when a non-persistent Sandbox would resume from its source. Every operation then fails with that error while the session still reports `active`. Use a persistent Sandbox for a workspace that outlives one session. A `cwd` that is not absolute fails the open. Creation, reconnection, credentials, billing, snapshots, and stopping stay with the application's SDK handle.

`VercelSandbox` is a structural subset of the `@vercel/sandbox@3.5.1` `Sandbox`, so the package does not depend on the SDK; re-check it when upgrading. Paths are POSIX and resolve against `cwd`. The image must provide `realpath -e` and GNU `find`; the default image has both.

`exec` runs `/bin/bash -lc`. Log data arrives already decoded as UTF-8 strings, so `onData` does not receive the raw bytes. On abort `exec` sends `SIGKILL` and forwards output until the command exits. The SDK kills the shell process and cannot guarantee that its descendants die. Transport failures propagate as SDK errors. Nothing retries an ambiguous command submission. The tests run against a fake Sandbox, not the service.

## Consumer wrappers

```ts
// src/advance.ts
import { sessionId, type HeadName } from "@nyte-ai/core";
import { advanceNyte } from "@nyte-ai/vercel";
import { openExecution } from "./runtime.ts";

export async function advanceSession(id: string, head: HeadName) {
  "use step";
  return advanceNyte({ input: { sessionId: sessionId(id), head }, openExecution });
}
```

```ts
// workflows/session.ts
import type { HeadName } from "@nyte-ai/core";
import { sleep } from "workflow";
import { driveNyte } from "@nyte-ai/vercel/workflow";
import { advanceSession } from "../src/advance.ts";

export async function runSession(id: string, head: HeadName) {
  "use workflow";
  await driveNyte({ advance: () => advanceSession(id, head), wait: sleep });
}
```

```ts
import { start } from "workflow/api";
import { createVercelDispatcher } from "@nyte-ai/vercel";
import { openExecution } from "./runtime.ts";
import { runSession } from "../workflows/session.ts";

export const wake = createVercelDispatcher({
  workflow: runSession,
  openExecution,
  startWorkflow: start,
});
```

`wait` and `startWorkflow` come from the consumer's Workflow installation. This avoids binding a second runtime through a different pnpm peer resolution. These callbacks are constructed locally, never passed as workflow arguments.

`openPostgresExecution({ pool, createSdk, onPoolError })` creates an owned pg pool and `PostgresStore`, then calls `createSdk(store)`. It returns the SDK plus `outbox` and an idempotent `close()`. The default pool has four connections; supplied pg options override defaults. The application must close HTTP runtimes when replacing them. Each `advanceNyte` call closes its execution even when `advance` throws.

Pass `withDispatch({ sdk, wake, outbox })` to `createNyteServer`. It records a wake intent before `messages.send`, `messages.redeliver`, `sessions.configure`, `runs.reply`, and `runs.abort`. Successful admission dispatches according to the core outcome; duplicate sends dispatch again. An omitted head dispatches all heads returned by `sdk.heads.list`. Other SDK calls and plugin-internal mutations are not intercepted.

## Recovery contract

A record-before-admission outbox **does not by itself close the crash gap** if reconciliation deletes the record. Consider:

1. Record the intent; admission stalls.
2. Reconciliation starts a workflow, which sees idle state, then deletes the intent.
3. Admission commits and the request dies before dispatch.

A grace period shorter than the longest possible admission cannot prove step 3 will not happen. The previous demo's 60-second grace was shorter than its 300-second function limit.

By default, reconciliation **does not settle records**. Only the foreground request settles its record, after admission and successful dispatch, or after a known non-accepting result. Reconciliation claims due records by stamping their attempt time in one statement, so overlapping reconcilers (cron plus cold-start repair) do not wake the same record twice within one grace interval, and it retries unresolved records in last-attempt order. The early-reconcile race therefore still leaves a wake intent when the late admission commits.

`reconcileDispatch({ outbox, wake, graceMs?, limit?, settleAfterMs? })` defaults to a 60-second retry/grace interval and 100 rows, capped at 1,000. It returns `{ dispatched, failed, settled }`, continues after individual dispatch failures, and does not hide database failures. Run it from an **independently scheduled, authenticated** function. Cold-start repair alone is insufficient if no request returns. Monitor `failed`, pending-row count, oldest pending age, and the cron itself.

`settleAfterMs` bounds orphan redispatch. A record at least that old is settled after a successful wake, because that wake started after the age limit. As with a foreground settle, a Workflow that later fails is not recovered. This is safe only if no admission transaction can still commit that late. Choose a value above the admitting function's maximum duration and the time PostgreSQL takes to abort a transaction whose client vanished (`idle_in_transaction_session_timeout`, TCP keepalive). Omit it to retain records indefinitely.

The demo keeps its every-minute cron. Configure `CRON_SECRET`; the endpoint accepts GET with `Authorization: Bearer <CRON_SECRET>`. It deliberately does not fall back to the chat token. Vercel sends `CRON_SECRET`, not `NYTE_TOKEN`. Check your plan's cron frequency limits.

### Remaining windows and costs

- A dispatch may succeed with its response lost, and the foreground request and reconciler can both wake the same record. Each wake starts a new Workflow run. Duplicate runs on one head serialize on the Nyte lease (`busy` waits for lease expiry) and exit when idle. Nyte fences state publication, not external provider/tool side effects.
- Once the foreground request receives a successful dispatch response and settles the intent, a later permanently failed or cancelled Workflow has **no remaining outbox record**. Recovering those runs needs an independent runnable-head scan or operational redispatch. This package does not provide that scan.
- A crash before admission, an admission that throws, or a crash after dispatch leaves a record that keeps dispatching every grace interval until `settleAfterMs` expires it, or forever without that option. An atomic core admission/intent contract would allow earlier cleanup.
- Unwrapped SDK/plugin/delegation mutations need their own wake contract. The demo's restricted chat plugins do not establish general plugin support.
- Outbox and core state must use the same intended database. Records survive restarts, but liveness still depends on database availability, an operating reconciler, and accepted Workflow executions.
- The loop drains queued work without a journal-length cap. Long conversations may require successor workflows. No cross-deployment format migration or exactly-once effect guarantee is supplied.

## Verification scope

The workspace demo compiles with Nitro and Workflow 4.8.8, including its fixture build and workflow/step discovery check. Regression tests use real PGlite storage, database reopen, dispatch failures, the early-reconcile race, overlapping reconcilers, and aged-record settlement. This is not a packed-publication, deployed cold-start, or provider test. Packages remain private pending publication and licensing decisions.
