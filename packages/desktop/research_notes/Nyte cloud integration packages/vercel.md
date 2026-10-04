# Vercel Workflow integration for Nyte

## Can an npm integration hide the directives and compiler setup?

### Takeaway
Hide the scheduling policy, not the application build boundary. Start with small consumer-owned workflow and step files so each step can statically import the application's Nyte factory. A packaged workflow is possible, but it still needs compiler discovery and cannot receive that factory as a serialized argument.

### Cited findings
- Research date: 2026-10-03. Newly shallow-cloned references under `/Users/workgyver/Developer/nyte-integration-references`: `vercel-workflow` at `d7217a8fc0fb57eed91835c7bd58d9c292551ba9`, `vercel-eve` at `6c2e941946383a7a3d1f8f90b5bc6828de40c724`. These are the pinned snapshots linked below. [Workflow snapshot][workflow]; [Eve snapshot][eve].
- Versions are not interchangeable. The Workflow snapshot declares `workflow`, `@workflow/core`, `@workflow/builders`, `@workflow/nitro`, and `@workflow/ai` version **5.0.1**, Apache-2.0. Eve declares **0.71.0**, Apache-2.0, and uses Workflow core/world packages **5.0.1**. Nyte's demo pins `workflow` **4.8.8**, `@vercel/functions` **3.9.7**, `pg` **8.23.0**, Nitro **3.0.260903-beta**. Installed manifests confirm Workflow and Vercel Functions are Apache-2.0; pg and Nitro are MIT. Installed Workflow resolves `@workflow/core` **4.8.8**, Nitro integration **4.1.14**, builders **4.1.13**. [Workflow manifest][workflow-package]; [Eve manifest][eve-package]; [Nyte demo manifest][demo-package]; installed manifests under `packages/demo/server/vercel/node_modules/` and `node_modules/.pnpm/` were read directly.
- The consumer needs a framework integration. Nyte already uses `workflow/nitro`, explicit `dirs: ["./src", "./workflows"]`, Node 24, and a 300-second function setting. Upstream Nitro uses those directories to build and merge Workflow routes into Vercel output. The TypeScript editor plugin alone is not the compiler integration. [Nyte configuration][demo-config]; [Nitro builder, lines 34-61][nitro-builder].
- Discovery does not mean scanning every installed package. Initial globs exclude `node_modules`; the builder then follows imports from selected files. Latest source defaults to discovering imported dependency workflows, with an opt-out. Installed builders 4.1.13 also follows imported package files, detecting directives and following package imports when the package declares a Workflow dependency. [Initial files and graph discovery][discovery]; [Latest dependency traversal][traversal]. Installed evidence: `@workflow/builders/dist/base-builder.js:355-384`, `dist/fast-discovery.js:564-624`.
- Official library guidance recommends a dedicated `./workflows` export and a consumer re-export file. Package code must retain directives until the consumer's Workflow compiler processes it. Its function IDs embed package version; deep unexported paths can produce path-based IDs. Function/closure arguments cannot cross journal boundaries. [Publishing libraries, lines 96-158][libraries]. The guide's claim that discovery starts only in `workflows/` is narrower than the configurable Nitro source implementation; treat the re-export as a supported discovery pattern, not a universal compiler restriction.
- Externalizing a directive-bearing integration package from Workflow's own bundle prevents transformation. This differs from marking the library's `workflow` dependency external during ordinary library publishing, so the consumer supplies the runtime. [External-package warning][externals]; [Library build guidance][libraries].

### Inferences
- Recommended v1: consumer exports `runSession` with `"use workflow"` and `advanceSession` with `"use step"`; package owns the outcome loop and host helpers. Keep workflow imports free of runtime Node dependencies. The step statically imports `openExecution` from consumer code.
- A library-provided workflow can hide both directives only if the library also has a concrete way to reconstruct application execution inside its step. Do not advertise `createWorkflow({ openExecution })` as durable when it merely captures a process-local closure. A global registry also fails on a fresh step-function instance.
- For a fixed, package-owned runtime, a consumer discovery file could use a named re-export, `export { runSession } from "@nyte-ai/vercel/workflows"`. Named exports respect Nyte's import rules. Otherwise retain the wrapper files; avoiding two directives is not worth a custom compiler or runtime loader.

### Gaps
- No consumer tarball build or cold-start replay was executed. Neither arbitrary npm packaging nor all framework integrations are proven. Qualify a supported Workflow/Nitro version matrix before release; do not infer 4.8.8 compatibility from 5.0.1 source.

## What does Workflow guarantee, and where does Nyte still need recovery?

### Takeaway
Workflow durably schedules accepted runs and replays completed step results. It does not make Nyte admission plus dispatch atomic, nor make external model/tool effects exactly once. Nyte remains the authority for queue state, leases, cancellation, and conversation history.

### Cited findings
- `Nyte.advance()` is host-only, one leased kernel step. `advanceStep` returns scheduling outcomes and observes abort requests only for its current Nyte run. [Core contract, lines 633-638][advance-contract]; [Core advance, lines 9-109][advance]. Current local `packages/core/src/kernel/step.ts:1176-1194` acquires/releases the head lease; `kernel/lease.ts:12-55` renews slow work and aborts on lost ownership. [Lease renewal][lease].
- Nyte's current workflow calls one `advanceSession` per Workflow step. `continue` and `finished` keep draining; `idle` exits; undated `waiting` exits; dated waits and `retry` sleep until the persisted date; `busy` sleeps beyond lease expiry; `fenced` sleeps one second. Returning immediately on `busy` would risk losing a wake racing an idle executor. [Workflow loop, lines 5-35][demo-loop].
- Workflow steps open execution inside the step and close in `finally`. The demo closes SDK/store on success and initialization failure, bounds pg pools to four connections, and attaches pools to Fluid lifecycle. HTTP initialization is cached and reset on failure. [Step, lines 4-13][demo-step]; [Runtime, lines 8-69][demo-runtime]; [HTTP handler][demo-server]; [Official pool guidance][pool].
- Admission precedes `wake`. `messages.send` wakes even for duplicate receipts; configure/reply/redeliver/abort wake according to their outcomes. An unaddressed wake lists and dispatches all session heads. [Admission wrappers, lines 76-125][demo-chat]; [Dispatcher, lines 6-23][demo-dispatch]. Core submission updates inbox tip and idempotency receipt together, and repeated keys return the original receipt. [Queue, lines 211-220 and 244-276][queue].
- A fresh `start()` call is not a domain-idempotent start. Installed `@workflow/core` 4.8.8 `dist/runtime/start.js:119-121` mints a new ULID, and `152-209` writes run creation and queue dispatch in parallel. Retryable storage errors can be recovered from queued input; queue rejection still throws. This is Workflow-internal resilient start, not a transaction with Nyte's PostgreSQL admission. [Pinned analogous implementation, lines 707-718 and 1196-1223][start]; [Resilient-start design][resilient].
- Deterministic hooks coordinate an active owner, but `getHookByToken` followed by `start` is not atomic. Concurrent starts can both occur before hook registration; workflows must check conflict. A disposed hook does not retain permanent completed-request deduplication. [Idempotency, lines 150-154][idempotency].
- Workflow's default is up to three retries after arbitrary step errors; `FatalError` skips retries and `RetryableError` sets delay. Non-idempotent effects require their own keys. [Errors and retries, lines 15-47][retries]. Eve similarly documents that interrupted steps can repeat model calls, tools, costs, and streamed events; batching widens the replay unit. [Eve recovery, lines 102-109][eve-model].
- Vercel Workflow runs stay on the deployment that started them, including sleeps and retries. Cancel/rerun on new deployment is explicit. Package workflow IDs change with package versions. [Versioning, lines 19-77][versioning]; [Library IDs][libraries].
- Cancelling a Workflow run is not the same as interrupting an in-flight provider call. Installed 4.8.8 `dist/runtime/run.js:78-82` writes `run_cancelled`. The v4 cancellation recipe explicitly says the underlying step keeps running. V5 introduces cooperative cross-step AbortSignals, still not forced termination. [V4 cancellation, lines 60-72][cancellation-v4]; [V5 cancellation, lines 15-55][cancellation-v5].

### Inferences
- Honest guarantee: durable Nyte admission and fenced state publication, plus durable scheduling **once Workflow accepts dispatch**. Not exactly-once provider calls, instantaneous cancellation, or unconditional execution of every admitted input.
- Crash gaps to expose: admission committed but dispatch never called; dispatch accepted but response/run ID lost; Workflow permanently failed or cancelled while Nyte work remains; process dies during an external effect before its Nyte result commits. A client retry with the original key repairs the first two only if it actually happens.
- Reliable production recovery needs either an atomic admission/wake-intent outbox, or an independently scheduled reconciler that finds runnable/deadline-due heads and redispatches identifiers. A separate post-admission outbox insert still has the same crash gap. Atomicity needs a provider-neutral core/store transaction contract, not a Vercel-only table bolted onto a wrapper.
- Duplicate Workflow runs are tolerable as redundant schedulers: core leases arbitrate mutation, and losers recheck. A retried Workflow step after Nyte has already committed can read current state and advance another kernel unit. Do not equate a Workflow step ID with a permanent Nyte effect key across replacement runs.
- Preserve `runs.abort` plus wake for user stop. Core's persisted abort observation signals provider/tool work cooperatively. Do not map user stop only to one Workflow run cancellation, particularly when duplicate schedulers exist. Disconnecting SSE should only disconnect the reader.
- Cap work per Workflow run and arrange a durable successor to bound journal growth. New runs can read current Nyte state by IDs instead of migrating an Eve checkpoint. Deployment pinning protects Workflow replay, but old and new Nyte executors can still touch the same database; persisted-format and activation compatibility need a separate policy.

### Gaps
- No fault-injection, deployment, or runtime test was run. Lease fencing protects database commits, not arbitrary external side effects. Failed-run reconciliation, recovery latency, retention, and deployment deletion policy remain requirements, not demonstrated guarantees.
- Nyte checkout HEAD is `addfa87d07dc80898cf1d4a039eec07afae2dc6a`. Inspected demo, queue, lease, advance, and type files are clean relative to that SHA. `kernel/step.ts` and `kernel/sdk/runner.ts` have existing local modifications; their cited local line numbers describe the current working tree, not a pinned GitHub snapshot. No Nyte installed-version docs were located at the checked installed paths; checkout source, not another version's docs, supplied the Nyte findings.

## What should @nyte-ai/vercel wrap versus implement?

### Takeaway
Wrap Workflow scheduling and Vercel resource lifecycle. Keep Nyte execution in core. Eve is a useful example of bounded durable agent steps, not a dependency or a reason to replace Nyte with AI SDK WorkflowAgent.

### Cited findings
- Eve's packaged `workflowEntry` owns session orchestration and calls managed steps; `turnStep` defaults to one model cycle, with optional batching. Eve also owns inbox claims, handoffs, and serialized session checkpoints. [Entry, lines 40-60][eve-entry]; [Turn step, lines 106-114 and 421-422][eve-step]; [Execution model, lines 26-38][eve-model].
- Eve ships its own workflow transformation/registration logic and versioned function identities. This is evidence that framework-owned directives are possible, but entails compiler and deployment machinery beyond an adapter. [Transformer, lines 130-160 and 190-211][eve-transform].
- Upstream deprecated DurableAgent guidance points Workflow 5 applications to `@ai-sdk/workflow`. That agent layer owns model/tool execution, whereas Nyte already exposes its own `advance` boundary and provider plugins. [Agent source, lines 337-353][agent]; [Nyte SDK construction, lines 52-63][demo-chat].

### Inferences
Suggested minimal API, names are proposals, not existing exports:

```ts
import type { Nyte } from "@nyte-ai/core";

type WakeInput = Pick<Parameters<Nyte["advance"]>[0], "sessionId" | "head">;
type HeadInput = Required<WakeInput>;
type AdvanceOutcome = Awaited<ReturnType<Nyte["advance"]>>;
```

- `@nyte-ai/vercel/workflow`: `driveNyte({ input, advance })`, a workflow-safe outcome loop using Workflow sleep. `advance` is the consumer's compiled step proxy, supplied within the workflow body, **not** a workflow argument or journaled closure.
- `@nyte-ai/vercel`: `advanceNyte({ input, openExecution })`, called inside the consumer's `"use step"` function. Open one owned SDK, call `sdk.advance`, close in `finally`; return only `AdvanceOutcome`. Factory is local step code, not serialized I/O.
- `createVercelDispatcher({ workflow, listHeads })` returns `wake(input)`. Preserve explicit-head dispatch and all-head fanout when omitted. Derive types from the authored workflow so `start` keeps inference. Keep run IDs/deployment metadata in diagnostics, not public Nyte session identity.
- Admission decoration should cover send, configure, redeliver, reply, abort. Prefer provider-neutral `@nyte-ai/server` ownership of these rules, with `wake` injected. Do not ship another protocol/auth implementation in the Vercel package.
- Optional PostgreSQL helper can register a supplied pg pool with `attachDatabasePool`, but storage remains `@nyte-ai/core/postgres`. Consumers choose schema lifecycle, provider configuration, plugin set, auth, and limits. Avoid hard-coded env names, demo model choice, OAuth token syncing, or automatic fallback storage in a general adapter.
- Do not reimplement Workflow compiler, journal, queue, sleep, retries, hooks, or observability. Do not vendor Eve's compiler or checkpoint system. Do implement the small advance scheduler, resource cleanup, dispatch diagnostics, and documented recovery wiring.
- Core owns admission/idempotency, fenced leases, effect recovery, provider execution, plugin/tool semantics, and persisted cancellation. A future shared execution-adapter contract should serve Vercel and Cloudflare; only scheduling/lifecycle code belongs in platform packages. Cloudflare source behavior is outside this note's assigned scope.
- Peer-depend on the explicitly qualified Workflow version line; keep workflow-safe code separate from Node runtime code. Prefer serializable session/head IDs and scheduling outcomes; resolve secrets inside steps. No `@workflow/ai`, Eve, or AI SDK WorkflowAgent dependency is necessary.
- Release checks should build a real packed consumer package, inspect workflow/step manifests, replay after cold start, exercise duplicate admission/dispatch and expired leases, test crash-before-dispatch recovery and cross-host abort, and check old-deployment behavior after upgrade. These are proposed checks, not checks run here. Nyte's existing manifest assertion is a starting point. [Build assertion, lines 22-44][build-check].

### Gaps
- Publishing policy, Nyte public package versions/license, atomic admission intent API, and recovery scan API need product/core decisions. No integration implementation or upstream execution occurred; only reference clones, static inspection, websearch, and this notes file were produced.

[workflow]: https://github.com/vercel/workflow/tree/d7217a8fc0fb57eed91835c7bd58d9c292551ba9
[eve]: https://github.com/vercel/eve/tree/6c2e941946383a7a3d1f8f90b5bc6828de40c724
[workflow-package]: https://github.com/vercel/workflow/blob/d7217a8fc0fb57eed91835c7bd58d9c292551ba9/packages/workflow/package.json#L1-L22
[eve-package]: https://github.com/vercel/eve/blob/6c2e941946383a7a3d1f8f90b5bc6828de40c724/packages/eve/package.json#L1-L27
[demo-package]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/demo/server/vercel/package.json#L21-L38
[demo-config]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/demo/server/vercel/nitro.config.ts#L1-L18
[nitro-builder]: https://github.com/vercel/workflow/blob/d7217a8fc0fb57eed91835c7bd58d9c292551ba9/packages/nitro/src/builders.ts#L34-L61
[discovery]: https://github.com/vercel/workflow/blob/d7217a8fc0fb57eed91835c7bd58d9c292551ba9/packages/builders/src/base-builder.ts#L356-L397
[traversal]: https://github.com/vercel/workflow/blob/d7217a8fc0fb57eed91835c7bd58d9c292551ba9/packages/builders/src/fast-discovery.ts#L876-L926
[libraries]: https://github.com/vercel/workflow/blob/d7217a8fc0fb57eed91835c7bd58d9c292551ba9/docs/content/docs/v4/cookbook/advanced/publishing-libraries.mdx#L96-L158
[externals]: https://github.com/vercel/workflow/blob/d7217a8fc0fb57eed91835c7bd58d9c292551ba9/packages/builders/src/base-builder.ts#L426-L429
[advance-contract]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/core/src/kernel/sdk/types.ts#L633-L638
[advance]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/core/src/kernel/sdk/advance.ts#L9-L109
[lease]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/core/src/kernel/lease.ts#L12-L55
[demo-loop]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/demo/server/vercel/workflows/session.ts#L5-L35
[demo-step]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/demo/server/vercel/src/advance.ts#L4-L13
[demo-runtime]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/demo/server/vercel/src/runtime.ts#L8-L69
[demo-server]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/demo/server/vercel/src/server.ts#L4-L14
[demo-chat]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/demo/server/vercel/src/chat.ts#L52-L125
[demo-dispatch]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/demo/server/vercel/src/dispatch.ts#L6-L23
[queue]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/core/src/kernel/queue.ts#L211-L276
[pool]: https://vercel.com/kb/guide/connection-pooling-with-functions
[start]: https://github.com/vercel/workflow/blob/d7217a8fc0fb57eed91835c7bd58d9c292551ba9/packages/core/src/runtime/start.ts#L1196-L1223
[resilient]: https://github.com/vercel/workflow/blob/d7217a8fc0fb57eed91835c7bd58d9c292551ba9/docs/content/docs/v4/changelog/resilient-start.mdx#L16-L23
[idempotency]: https://github.com/vercel/workflow/blob/d7217a8fc0fb57eed91835c7bd58d9c292551ba9/docs/content/docs/v4/foundations/idempotency.mdx#L150-L154
[retries]: https://github.com/vercel/workflow/blob/d7217a8fc0fb57eed91835c7bd58d9c292551ba9/docs/content/docs/v4/foundations/errors-and-retries.mdx#L15-L47
[versioning]: https://github.com/vercel/workflow/blob/d7217a8fc0fb57eed91835c7bd58d9c292551ba9/docs/content/docs/v4/foundations/versioning.mdx#L19-L77
[cancellation-v4]: https://github.com/vercel/workflow/blob/d7217a8fc0fb57eed91835c7bd58d9c292551ba9/docs/content/docs/v4/cookbook/agent-patterns/agent-cancellation.mdx#L60-L72
[cancellation-v5]: https://github.com/vercel/workflow/blob/d7217a8fc0fb57eed91835c7bd58d9c292551ba9/docs/content/docs/v5/foundations/cancellation.mdx#L15-L55
[eve-model]: https://github.com/vercel/eve/blob/6c2e941946383a7a3d1f8f90b5bc6828de40c724/docs/concepts/execution-model-and-durability.mdx#L26-L109
[eve-entry]: https://github.com/vercel/eve/blob/6c2e941946383a7a3d1f8f90b5bc6828de40c724/packages/eve/src/execution/session/entry.ts#L40-L60
[eve-step]: https://github.com/vercel/eve/blob/6c2e941946383a7a3d1f8f90b5bc6828de40c724/packages/eve/src/execution/session/turn-step.ts#L106-L114
[eve-transform]: https://github.com/vercel/eve/blob/6c2e941946383a7a3d1f8f90b5bc6828de40c724/packages/eve/src/internal/workflow-bundle/workflow-transformer.ts#L130-L211
[agent]: https://github.com/vercel/workflow/blob/d7217a8fc0fb57eed91835c7bd58d9c292551ba9/packages/ai/src/agent/durable-agent.ts#L337-L353
[build-check]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/demo/server/vercel/scripts/test-build.ts#L22-L44
