# Review request: Nyte core cleanup, round 2

Repository: this directory (pnpm monorepo, TS 7, Node 26). Read-only review; do not edit.
Rules the code must satisfy: AGENTS.md at the root and packages/core/AGENTS.md (no `any`, no `as` casts, erasable syntax, top-level imports, discriminated unions, `_exhaustive` never checks, smallest complete fix, comments explain constraints not control flow).
Design reference: packages/core/src/kernel/README.md ("git's object database with messages in place of files"). Readability target: pi (github.com/earendil-works/pi).

Your round-1 review is at output/council-reply-core-cleanup.md; this round executed its recommendations. Verify each item below against the source, then answer the questions.

## What changed since round 1

A. Store chain query (git commit-graph analogue).
   - packages/core/src/kernel/store.ts `Objects.chain(from, { limit })`: the object at `from` and its `parent` chain, newest first, hash-verified rows, kind/cycle checks left to the caller.
   - packages/core/src/kernel/sqlite.ts: recursive CTE over `json_extract(body,'$.parent')` bounded by `limit`; `delete` is now one `DELETE ... WHERE oid IN (sqlList)` per call (packages/core/src/kernel/sql.ts gained `sqlList`).
   - Worker RPC: store-rpc.ts, store-worker.ts, worker-store.ts carry `chain` like `commits`.
   - packages/core/src/kernel/graph.ts: `history` pages through `chain` (PAGE_SIZE 64), keeps the `seen` cycle error, the "Corrupt commit graph" error on a short page, and `limit`; `contextCommits` still stops at the checkpoint.
   - packages/core/src/kernel/sdk/nyte.ts `sessions.snapshot` passes `session.objects` directly (the per-request `confirmed` cache wrapper is gone).
   - Tests: packages/core/test/kernel/objects-chain.test.ts (new), sdk-snapshot-reads.test.ts now asserts ≤1 chain query for main and ≤2 for a side head.
B. packages/core/src/client/session-follow.ts: per-event snapshot replaced by a coalesced metadata refresh (`metadataDirty`/`metadataRefreshing`, the loop AbortController as generation, new `SessionUpdate` kind `"metadata"`). Events publish synchronously after the fold. Test: packages/core/test/client-session-follow.test.ts.
C. `sessions.list` reads candidates in batches of 8 (packages/core/src/kernel/sdk/reads.ts `LIST_BATCH`), preserving listing order, cursor semantics, filters, and seeding `pooled.createdAt` from the listing row.
G. packages/core/src/tools/edit-diff.ts: fuzzy normalization of the file computed at most once per call and needles once per edit; `applyReplacements` is a forward slice-and-join. packages/core/src/kernel/views/changes.ts keeps a path→index map.
H. packages/core/src/kernel/sdk/nyte.ts decomposed from 2 488 lines into: nyte.ts 772 (wiring + thin namespaces), session-pool.ts 644, runner.ts 416, subagent-host.ts 375, summaries.ts 324, reads.ts 230, relocate.ts 172. Each module is `createX(input)` returning an object of functions; cycles broken by closures; SessionId-keyed side maps folded into `Pooled` (reconciliation, runnerTasks, drives, noticeListeners); `runnerDone` stays disposer-keyed inside `createRunners` with a `settle()` that `allSettled`s every live loop including retired sessions'. `heads.move` navigation stayed in nyte.ts; its summary half is `summaries.summarizeAbandoned`.

Round-1 items already done before this round: dead exports, tools strict `argumentParser`, mergeQueuedLanes cursor merge, unshift loops, Promise.all on independent reads, mediaType moved to protocol, headForRun parallel reads.

Verification run by me: core tests 572 (SQLite) + 439 (worker) pass; client 23, server 27, protocol 93; typecheck clean in core/client/server/protocol/tui; oxfmt clean; oxlint clean except the pre-existing compaction.ts `no-unsafe-finally` owned by another agent.

## Questions

1. Behavior regressions: for each of A, B, C, G, H, read the source and name any path whose observable behavior changed (events emitted, error messages, ordering, CAS assertions, lease handling, close/retire sequencing). Cite file:line.
2. H specifically: does the decomposition read as one concept per file? Is anything now in the wrong module, threaded through too many callbacks, or duplicated across modules? Is `SessionPoolHooks` (stopRunner/requestAbort/closeJobs/pluginsFor passed into the pool) the right seam, or should the pool not know about runners at all? Are there leftover pass-through wrappers?
3. A: is the CTE correct under `WITHOUT ROWID` and the `(session_id, oid)` primary key, and does the `limit` bound make a forged parent loop terminate? Is paging at 64 the right shape, or should `branch()` request the full chain in one query when no early stop applies?
4. B: any window where a metadata refresh applies stale `config`/`context` over a newer fold, or where `selectedVersion` semantics differ from before?
5. Anything that violates the AGENTS.md rules (casts, `any`, optional-field bags where a union was due, comments narrating control flow, files past ~800 lines).
6. What remains as the highest-value next step?

Answer as a review: numbered findings, each with file:line, severity (blocker / should-fix / nit), and the smallest fix. Be terse.
