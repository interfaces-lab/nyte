1. **Should-fix · B · [session-follow.ts:251](/Users/workgyver/Developer/nyte/packages/core/src/client/session-follow.ts:251).** An in-flight metadata refresh survives an automatic resnapshot within the same loop. Its older response then overwrites newer `config`/`context`; only `info.config` is protected by `acceptSelected`. Reproduced. Invalidate metadata reads whenever a full snapshot starts, and discard responses overtaken by relevant folds. `selectedVersion` acknowledgment now arrives through `"metadata"` instead of `"event"`; its selection guards otherwise remain.

2. **Should-fix · H · [session-pool.ts:224](/Users/workgyver/Developer/nyte/packages/core/src/kernel/sdk/session-pool.ts:224).** If retirement fails before `stopRunner`, `finally` removes the handle while its runner remains live. `close()` cannot stop it, but the new [runner.ts:407](/Users/workgyver/Developer/nyte/packages/core/src/kernel/sdk/runner.ts:407) settlement awaits it indefinitely. Unconditionally stop/drain execution before dropping the handle, preserving cleanup errors.

3. **Should-fix · A · [sqlite.ts:486](/Users/workgyver/Developer/nyte/packages/core/src/kernel/sqlite.ts:486).** The entire page is hash-verified before the caller can stop. A valid checkpoint above corrupt ancestry now makes `contextCommits` throw; finding an ancestor before that corruption also throws. Both reproduced. Carry checkpoint/ancestor stopping conditions into the chain query so it never validates ancestry beyond the requested boundary.

4. **Should-fix · C · [reads.ts:176](/Users/workgyver/Developer/nyte/packages/core/src/kernel/sdk/reads.ts:176).** `list({limit:1})` now rejects when an unnecessary later candidate fails. Reproduced with a valid first session and corrupt second session. Use `allSettled`, consume results in listing order, and throw only for candidates actually needed. Successful ordering, filters, cursors, and `createdAt` seeding are preserved.

5. **Should-fix · A · [sqlite.ts:473](/Users/workgyver/Developer/nyte/packages/core/src/kernel/sqlite.ts:473).** `chain` skips limit validation. Fractions exceed the advertised bound; `Infinity` removes forged-loop termination. Apply the existing `validateLimit` before executing SQL.

6. **Should-fix · A · [sqlite.ts:518](/Users/workgyver/Developer/nyte/packages/core/src/kernel/sqlite.ts:518).** Large deletes now exceed SQLite’s parameter ceiling. Reproduced with 40,000 identifiers; the old implementation accepted them. Chunk statements inside one transaction. Normal GC’s 256-object batches are unaffected.

7. **Should-fix · Rules · [session-pool.ts:20](/Users/workgyver/Developer/nyte/packages/core/src/kernel/sdk/session-pool.ts:20).** The inherited `UnknownSession as StoreUnknownSession` renames a value import, explicitly forbidden. Give the store error a distinct exported name. No casts, `any`, nonerasable syntax, or missing `_exhaustive` checks found in the inspected decomposition.

8. **Nit · H · [nyte.ts:207](/Users/workgyver/Developer/nyte/packages/core/src/kernel/sdk/nyte.ts:207), [nyte.ts:412](/Users/workgyver/Developer/nyte/packages/core/src/kernel/sdk/nyte.ts:412).** Five namespace wrappers only forward arguments. Assign the returned functions directly. Keep the deferred construction callbacks: those resolve actual initialization dependencies.

The CTE correctly uses the composite primary key under `WITHOUT ROWID`; verified query plans use it for both joins. Keep finite paging at 64 for now. An unbounded query delays caller cycle detection until SQL finishes.

G preserves fuzzy duplicate detection, replacement ordering, and first-seen path order. H’s modules are coherent; the pool is broad but its hooks appropriately coordinate retirement and activation teardown. No further split or shared abstraction is warranted. Navigation CAS and relocation lease handling appear preserved. All H files remain under 800 lines; SQLite remains 938. A few narrative comments remain, such as [graph.ts:48](/Users/workgyver/Developer/nyte/packages/core/src/kernel/graph.ts:48).

Highest-value next step: fix the metadata race and retirement failure path, with delayed-response and failure-injection tests, before further decomposition.

Read-only review with focused runtime reproductions; full suites were not rerun. PR discussion lookup failed because GitHub’s API was unreachable.