# Ship cloud adapters without replacing Nyte

**Borrow scheduling and execution transports, not another agent engine.** Proposed `@nyte-ai/vercel` should wrap Workflow dispatch, outcome-driven sleep, and resource cleanup; proposed `@nyte-ai/cloudflare` should first wrap native Durable Objects, SQLite, and alarms. Keep durable admission, fenced steps, cancellation, history, and HTTP/SSE in Nyte core/server. Add sandbox integrations as separate entrypoints, preserving Nyte tool semantics. Eve and Cloudflare Agents offer implementation patterns, not required dependencies. Existing demos establish integration seams, not production durability guarantees.

## Inspected implementations establish scope, not release readiness

This synthesis uses the three research notes' websearch, local clones, and source comparisons. No additional research, builds, deployments, or code changes were performed. Clone paths below are relative to `/Users/workgyver/Developer/nyte-integration-references/`. **Versions identify inspected checkout manifests, not confirmed npm release status or tarball equivalence.**

| Clone directory | Inspected SHA | Manifest version and source |
| --- | --- | --- |
| `vercel-workflow` | `d7217a8fc0fb57eed91835c7bd58d9c292551ba9` | `workflow` 5.0.1 ([Source][workflow-package]) |
| `vercel-eve` | `6c2e941946383a7a3d1f8f90b5bc6828de40c724` | Eve 0.71.0 ([Source][eve-package]) |
| `vercel-sandbox` | `6fc8e16fd606beab8f99546482f11cc40c3e5a8e` | `@vercel/sandbox` 3.5.1 ([Source][V-package]) |
| `cloudflare-agents` | `2f3176b9fa03c6429c805b560c8dc14371c15f64` | `agents` 0.26.0 ([Source][manifest]) |
| `cloudflare-sandbox-sdk` | `f9e972a14123bef3b93e9bb337bab6e83419fe7e` | `@cloudflare/sandbox` 1.0.0 ([Source][C-package]) |

Nyte was inspected at `/Users/workgyver/Developer/nyte`, HEAD `addfa87d07dc80898cf1d4a039eec07afae2dc6a`. Pre-existing edits in execution, runner, bash, and plugin files mean pinned links are baselines for those files. Matching installed documentation was unavailable. Prefer dependencies over vendoring; retain Apache-2.0/MIT and third-party notices where applicable. Nyte publication/licensing remains unresolved.

## Vercel can hide scheduling, but not compilation

**Existing:** the demo already compiles consumer-owned workflow/step files. One step opens execution, calls `advance`, and closes it in `finally`. Its loop drains `continue`/`finished`, exits on `idle` or undated waits, and sleeps for deadlines, retries, busy lease expiry, or fencing. Borrow Eve's bounded execution units, not its checkpoints, compiler, or agent engine ([Source][demo-loop], [Source][demo-step], [Source][eve-model]).

**Proposed:** retain those consumer files and statically import the application's execution factory inside the step. Package helpers can own the loop, dispatch fanout, pool attachment, cleanup, and diagnostics. An application factory cannot cross the journal as a closure; a process-global registry fails on cold starts. Packaged directives require preserved source, framework compilation, and supported discovery, commonly a consumer re-export. Initial scans exclude `node_modules`; dependency import traversal is version-sensitive. **The demo uses Workflow 4.8.8/builders 4.1.13, while the reference is 5.0.1.** Qualify packed-consumer builds against the actual matrix; do not infer compatibility from newer discovery code or the editor plugin. Do not externalize directive-bearing code from Workflow's compilation bundle ([Source][libraries], [Source][discovery], [Source][demo-package]).

**Blocker:** admission commits before Workflow dispatch. A crash between them strands accepted work; an accepted dispatch with a lost response can produce duplicate runs. Ship an atomic admission/wake-intent outbox through a core/store contract, or an independently scheduled reconciler. A separate post-admission outbox insert does not close the gap. Leases tolerate redundant schedulers but cannot make external effects exactly once. Persist Nyte abort and wake; cancelling one Workflow run is insufficient ([Source][demo-chat], [Source][start], [Source][cancellation-v4]).

## Cloudflare needs one alarm owner and storage corrections

**Existing:** Nyte's small SQL connection maps DO SQL and `transactionSync` into `SqlStore`; its demo pre-arms a watchdog and rearms around admission. Agents itself extends DO and adds state/lifecycle tables, routing, and scheduling. Borrow its watchdog-before-dispatch and serialized alarm recalculation patterns. Do not mirror Nyte history into Agents state or adopt Think ([Source][demo-sqlite], [Source][demo-alarm], [Source][tables], [Source][driver]).

**Proposed:** default to one authenticated DO per tenant/environment. Bound scans by time/head count, persist continuation cursors, and recheck rearming against stored admissions. Audit every runnable mutation. Alarms are at-least-once with finite automatic retries, so define repair after exhaustion. Optional `/agents` integration must schedule Nyte through Agents and never independently overwrite its sole alarm. Cloudflare Workflows belong in optional application jobs, not a replacement model/tool loop ([Source][alarms], [Source][rearm]).

**Release blockers:** DO SQL allows **100 parameters, 2 MB per string/BLOB/row, and 10 GB per object**; Nyte deletes 500 OIDs plus a session parameter and stores bodies inline. Fix batching and enforce persistence-size limits; R2 references require explicit atomicity/garbage-collection design. Authenticate before resolving the DO, derive identity from verified claims, retain server permissions, and normalize `/v1` routing. The demo's shared `"local"` object and loopback Codex proxy are not production tenancy/provider designs. Ship restricted chat without workspace/terminal first; Node importability does not prove Worker functionality ([Source][limits], [Source][bulk-delete], [Source][demo-host], [Source][demo-readme]).

## Sandbox wrappers should preserve tools, not promise process survival

**Existing:** Vercel provides filesystem transfer, detached Command handles, logs/wait/kill, and snapshots. Cloudflare 1.0 exports Files/backup helpers, **not legacy `Sandbox/getSandbox`**; applications own native Container lifecycle and process supervision. File checkpoints do not restore running processes ([Source][V-command], [Source][C-index], [Source][C-architecture]).

**Proposed:** map Vercel reads/writes to `readFileToBuffer`/`writeFiles`, Cloudflare to `Files`, and bash to explicit shell execution with streamed output, exit observation, and controlled kill. Preserve ENOENT, permission checks, seconds-to-milliseconds conversion, and uncertain execution outcomes. Never silently retry an ambiguous mutation. Core first needs supported tool-factory/operations exports, replaceable local tools, remote POSIX path resolution, and remote queue identity. Preserve approvals and mutation `replay:"never"` ([Source][N-core-package], [Source][N-paths], [Source][N-builtin]).

Proposed architecture and package tree, not implemented exports:

```text
HTTP/SSE -> Nyte server -> durable admission/history
                             ^             |
                      fenced advance <- wake/recovery
                        ^                  |
         Vercel Workflow step     OR     DO alarm
                        |
                 optional sandbox tools

packages/
  vercel/src/{index,workflow,sandbox}.ts
  cloudflare/src/{index,sqlite,sandbox,sandbox-worker}.ts
  cloudflare/src/agents.ts  [later, optional peer]
```

Proposed API sketches, not deployable examples:

```text
vercel: advanceNyte({ input, openExecution })       [inside use step]
vercel/workflow: driveNyte({ input, advance })      [compiled step proxy]
vercel: createVercelDispatcher({ workflow, listHeads }) -> wake
cloudflare: NyteDurableObject; routeNyteRequest({ request, namespace, authorize })
cloudflare/sqlite: durableSqlite({ storage })
vercel/sandbox: createVercelSandboxBackend({ sandbox, cwd })
cloudflare/sandbox: createCloudflareSandboxBackend({ client, cwd })
cloudflare/sandbox-worker: createCloudflareExecutionService({ container, files })
```

## Ship recovery before optional framework bridges

First settle publication policy, shared wake/reconciliation contracts, SQL limits, and tool exports. Next extract Vercel helpers and the restricted native DO host, keeping Node, workflow-safe, Worker, and browser imports separate. Then gate release on packed compiler discovery, cold starts, crash-before-dispatch repair, concurrent rearming, duplicate effects, cross-host abort, tenant isolation, storage boundaries, and a deployed Worker-compatible provider. Finally add sandbox wrappers and optional Agents integration. These checks are requirements, not completed verification.

## Conclusion

Sell resumability from committed Nyte state with tested recovery, not uninterrupted execution or exactly-once effects. The useful package boundary is provider scheduling/lifecycle plus transport adaptation; preserving that boundary keeps future provider changes out of Nyte's execution semantics.

[workflow-package]: https://github.com/vercel/workflow/blob/d7217a8fc0fb57eed91835c7bd58d9c292551ba9/packages/workflow/package.json#L1-L22
[eve-package]: https://github.com/vercel/eve/blob/6c2e941946383a7a3d1f8f90b5bc6828de40c724/packages/eve/package.json#L1-L27
[V-package]: https://github.com/vercel/sandbox/blob/6fc8e16fd606beab8f99546482f11cc40c3e5a8e/packages/vercel-sandbox/package.json#L1-L75
[manifest]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/packages/agents/package.json#L2-L126
[C-package]: https://github.com/cloudflare/sandbox-sdk/blob/f9e972a14123bef3b93e9bb337bab6e83419fe7e/packages/sandbox/package.json#L1-L29
[demo-loop]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/demo/server/vercel/workflows/session.ts#L5-L35
[demo-step]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/demo/server/vercel/src/advance.ts#L4-L13
[eve-model]: https://github.com/vercel/eve/blob/6c2e941946383a7a3d1f8f90b5bc6828de40c724/docs/concepts/execution-model-and-durability.mdx#L26-L109
[libraries]: https://github.com/vercel/workflow/blob/d7217a8fc0fb57eed91835c7bd58d9c292551ba9/docs/content/docs/v4/cookbook/advanced/publishing-libraries.mdx#L96-L158
[discovery]: https://github.com/vercel/workflow/blob/d7217a8fc0fb57eed91835c7bd58d9c292551ba9/packages/builders/src/base-builder.ts#L356-L397
[demo-package]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/demo/server/vercel/package.json#L21-L38
[demo-chat]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/demo/server/vercel/src/chat.ts#L52-L125
[start]: https://github.com/vercel/workflow/blob/d7217a8fc0fb57eed91835c7bd58d9c292551ba9/packages/core/src/runtime/start.ts#L1196-L1223
[cancellation-v4]: https://github.com/vercel/workflow/blob/d7217a8fc0fb57eed91835c7bd58d9c292551ba9/docs/content/docs/v4/cookbook/agent-patterns/agent-cancellation.mdx#L60-L72
[demo-sqlite]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/demo/server/cloudflare/src/sqlite.ts#L3-L20
[demo-alarm]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/demo/server/cloudflare/src/index.ts#L66-L139
[tables]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/packages/agents/src/index.ts#L1560-L1656
[driver]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/packages/agents/src/lifecycle/job-driver.ts#L283-L426
[alarms]: https://developers.cloudflare.com/durable-objects/api/alarms/
[rearm]: https://github.com/cloudflare/agents/blob/2f3176b9fa03c6429c805b560c8dc14371c15f64/packages/agents/src/lifecycle/durable-object-lifecycle.ts#L799-L859
[limits]: https://developers.cloudflare.com/durable-objects/platform/limits/
[bulk-delete]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/core/src/kernel/sqlite.ts#L620-L624
[demo-host]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/demo/server/cloudflare/src/index.ts#L11-L69
[demo-readme]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/demo/server/cloudflare/README.md#L63-L74
[V-command]: https://github.com/vercel/sandbox/blob/6fc8e16fd606beab8f99546482f11cc40c3e5a8e/packages/vercel-sandbox/src/command.ts#L185-L361
[C-index]: https://github.com/cloudflare/sandbox-sdk/blob/f9e972a14123bef3b93e9bb337bab6e83419fe7e/packages/sandbox/src/index.ts#L1-L36
[C-architecture]: https://github.com/cloudflare/sandbox-sdk/blob/f9e972a14123bef3b93e9bb337bab6e83419fe7e/docs/architecture.md#L5-L77
[N-core-package]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/core/package.json#L1-L42
[N-paths]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/core/src/tools/support/path-utils.ts#L49-L150
[N-builtin]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/core/src/plugins/builtin/tools-fs.ts#L13-L27
