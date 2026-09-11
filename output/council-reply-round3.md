1. Partly fixed. Resnapshot race is guarded, but a relevant fold during the read only sets `metadataDirty`; the stale response still publishes `config`/`context`. Discard it when dirty at [session-follow.ts:252](/Users/workgyver/Developer/nyte/packages/core/src/client/session-follow.ts:252).
2. Fixed. Runner cleanup precedes removal even on failure at [session-pool.ts:230](/Users/workgyver/Developer/nyte/packages/core/src/kernel/sdk/session-pool.ts:230).
3. Accepted trade-off. Keep bounded paging; no query stop condition required at [graph.ts:37](/Users/workgyver/Developer/nyte/packages/core/src/kernel/graph.ts:37).
4. Fixed. Ordered consumption stops before unnecessary rejections at [reads.ts:178](/Users/workgyver/Developer/nyte/packages/core/src/kernel/sdk/reads.ts:178).
5. Fixed. Validation precedes the zero-limit return at [sqlite.ts:475](/Users/workgyver/Developer/nyte/packages/core/src/kernel/sqlite.ts:475).
6. Fixed. 500-ID chunks share one transaction at [sqlite.ts:521](/Users/workgyver/Developer/nyte/packages/core/src/kernel/sqlite.ts:521).
7. Fixed. Single class at [store.ts:144](/Users/workgyver/Developer/nyte/packages/core/src/kernel/store.ts:144), re-export at [types.ts:341](/Users/workgyver/Developer/nyte/packages/core/src/kernel/sdk/types.ts:341), direct propagation at [session-pool.ts:210](/Users/workgyver/Developer/nyte/packages/core/src/kernel/sdk/session-pool.ts:210).
8. Fixed. Direct assignments at [nyte.ts:207](/Users/workgyver/Developer/nyte/packages/core/src/kernel/sdk/nyte.ts:207) and [nyte.ts:412](/Users/workgyver/Developer/nyte/packages/core/src/kernel/sdk/nyte.ts:412); deferred closures retained.

Read-only source verification; tests not run.