# Council brief: Nyte core / client / server cleanup

Repository: /Users/workgyver/Developer/nyte (pnpm monorepo, TS, Node 26). Read-only review.
Scope: packages/core/src, packages/client/src, packages/server/src.
Design: packages/core/src/kernel/README.md ("git's object database with messages in place of files": objects, refs CAS, leases, events).
Reference for readability target: pi (github.com/earendil-works/pi), which core ports its agent loop and tools from.

## What was changed already (verify these, flag anything wrong)

1. Dead exports removed or un-exported (knip-confirmed across the whole workspace, tests included):
   compaction.ts re-export block of estimateTokens/estimateContextTokens/ContextUsageEstimate; SUMMARIZATION_SYSTEM_PROMPT, FileOperations, ProviderCompactionRequest; prepareBranchSummary + generateBranchSummary folded into summarizeBranch (BranchSummaryPreparation.totalTokens dropped, unused).
   context.ts BRANCH_SUMMARY_PREFIX; queue.ts cancelledSet; store-rpc.ts RequestSchema/WireErrorSchema/ResponseSchema; turn.ts isProgressPayload; result.ts Ok/Err; sdk/requests.ts RequestInvocation; step.ts `export type { Landing, LanePolicy }` re-export (helpers.ts now imports Landing from @nyte-ai/protocol); plugins/builtin/agents.ts STOCK_AGENTS_PLUGIN_ID + EXPLORE_TOOLS inlined; plugins/sources.ts loadPluginFile/pluginIdForPath/LoadFailure; tools/index.ts barrel reduced to createAllTools only.
2. tools: read/write/bash/ls/edit no longer hand-roll `Unsafe<T>` JSON schemas + parallel interfaces + `isXInputObject/hasXPath/...` guard chains. Each now declares `Type.Object(...)`, derives its input type with `Static`, and uses one shared strict parser `tools/support/arguments.ts`:
   `argumentParser(schema)` = `Value.Clean(schema, Value.Clone(args))` then `Compile(schema).Check`, throwing `Invalid arguments: <field> <typebox message>`. Rejects coercible values before the loop's coercing validation and drops unknown keys. Edit keeps its leniency (edits as JSON string, single oldText/newText at top level) in a 20-line `prepareEditInput`. Net: -260 lines. Two tests updated (bash message "must be boolean"; ls `{ignored:true}` -> `{}` and NaN limit now rejected).
3. Loops:
   - queue.ts mergeQueuedLanes: was per-item spread + flatMap + full sort + Array.shift (O(N·(L log L + N))); now Map.groupBy + per-lane cursor + linear min scan (O(N·L)). Tie-break unchanged (earliest lane wins).
   - compaction.ts prepareBranchSummary: `messages.unshift(...chunk)` in a reverse loop (O(M²)) -> collect chunks newest-first, `toReversed().flat()` (O(M)).
   - truncate.ts truncateTail: `unshift` per line (O(lines²), runs every 100ms bash progress snapshot) -> push + one reverse.
   - wait.ts / jobs.ts: `["done","aborted","failed"].includes(phase.kind)` -> `isTerminalPhase` from protocol.
   - nyte.ts readFacts, activation.ts listFacts + listSettings, jobs.ts list: sequential awaits over independent keys -> Promise.all. jobs.list also stops re-reading the ref that refs.list already returned.
   - ls.ts: sequential stat per entry (up to 500) -> Promise.all over the first `limit` entries.
   - live-parts.ts: findIndex -> findLastIndex (the extended part is the newest).
   - step.ts publishTools: effect-clear updates built once instead of twice.
   - nyte.ts relocate: the copy-pasted "running job or held job lease" check extracted to `jobsBusy`.
   - nyte.ts createdAtFor: cached on the pooled session; previously `store.list()` (O(sessions)) ran on every sessions.get/snapshot.
   - client + server both had an identical `mediaType(header)`; moved to @nyte-ai/protocol wire.ts.

## Open findings, not yet changed (rank these; say which are worth doing and how)

A. graph.ts `history` walks one `objects.get` per commit; every `branch()` is O(H) sequential store round trips (a postMessage each under WorkerStore). Callers: sessions.snapshot, sessions.list (per session!), messages.list, runs.context/changes/compact, heads.move (x2), step.ts land (for branchConfig at every run start), activation context, childResultText. Git's answer is the commit-graph. SQLite equivalent: a recursive CTE over `json_extract(body,'$.parent')` (or a `parent` column written at put) returning the chain in one query, exposed as a store method such as `objects.chain(tip)`. That is a store-contract change (sqlite, worker RPC, tests).
B. client/session-follow.ts:245 takes a full `sessions.snapshot` on every `run` and `commit` event for the followed head, only to refresh `config` and `context`. With A unfixed, that is O(H) reads per event, O(H²) per session lifetime.
C. nyte.ts sessions.list: per session, sequentially: openPooled + readFacts + pending + listHeads + full branch walk. O(S·H) round trips per page.
D. nyte.ts relocate and attach open every session in the store to find children (parent is a per-session fact). O(S) store opens.
E. events.ts commitsBetween: a backward head move (restore/navigate) walks to the root (up to MAX_WALK=10 000 reads) per watcher, then returns undefined. Possible early exit via commit `at` monotonicity, or a small bound with client resnapshot.
F. sqlite.ts objects.delete: one DELETE per oid in a transaction (GC path, prepared-statement cached). `commits()` re-canonicalizes and re-hashes every commit body on each call.
G. views/changes.ts findIndex by path per patched file (O(F²) over a long session); edit-diff.ts re-normalizes the whole file per edit (NFKC + regex passes) up to 3x per edit.
H. kernel/sdk/nyte.ts is 2 495 lines: one `createNyte` closure holding pool + 6 side maps keyed by SessionId (reconciliations, runnerTasks, driveStates, noticeListeners, runnerDone, plus per-Pooled optional fields). Candidate decomposition: session-pool.ts (adopt/open/retire, facts, cwd), runner.ts (createRunner/reconcile/drive/abort), subagent-host.ts (spawn/wait/interrupt/background child), relocate.ts, summaries.ts (runs.compact + heads.move summary), with the side maps folded into the Pooled record. compaction.ts at 1 366 lines mixes prompts, cut-point search, provider requests, checkpoint publication and branch summaries.
I. Pre-existing lint error not mine: compaction.ts:1184 `throw` inside `finally` (eslint no-unsafe-finally) in uncommitted work by another agent.

## Questions for the council

1. Anything in "What was changed" that regresses behavior or readability? Specifically: is `Value.Clean` before `Check` acceptable as the strict boundary, and is dropping the `{path: undefined, limit: undefined}` shape (now `{}`) safe for consumers that persist prepared args?
2. Of A–H, which two or three give the most complexity reduction per line changed? Is the recursive-CTE commit chain (A) the right git-like move, or should the SDK cache branch tips in memory keyed by tip oid (immutable chains make that trivially correct)?
3. For H, would you decompose createNyte now, or first land A so the decomposition has fewer store-read paths to move? Propose a file map with line estimates.
4. Any loop or hand-rolled utility in these packages the list above misses?

Answer tersely, as a review: numbered findings, each with file:line, verdict, and the smallest fix.
