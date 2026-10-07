# Fable review brief

Status: blocked by provider HTTP 429 on the initial run and one same-session retry. Requested reviewer: `anthropic/claude-fable-5-1`, thinking `xhigh`. No completed Fable verdict was returned. These are the hypotheses supplied to the reviewer, not findings approved by it.

## Review contract

Use `/Users/workgyver/.agents/skills/principles-review/SKILL.md`. Read the three demo TS files, README, FINDINGS and recorded results, then the relevant production callers. Separate demo defects from design blockers and implementation recommendations. Each finding needs a verified path/line, principle and concrete edit. No production edits or broad review of unrelated working-tree changes.

The existing demos prove removal of particular history/patch reads. They do not implement the proposed production directory projection, viewport demand, byte limits or a desktop responsiveness fix.

## Scoped ideas to challenge

| Scope | Proposed change | Files and boundaries | Required proof |
| --- | --- | --- | --- |
| A. Sidebar intent | Delete whole-row detail preloading. If retained, navigation prefetch belongs only to the primary navigation action. Inspect adjacent-session warming separately. | `app/src/chrome/sidebar.tsx`, `router.tsx`, `live.ts`, `ui/src/row.tsx` | Pointer/focus on an inactive row's Archive/Pin/Rename does not itself request snapshot, children, jobs, catalog or mention files. Opening still works. Archiving an active row may legitimately navigate elsewhere; do not confuse that with speculative warming. |
| B. Ancestry and archive | Replace history-dependent ownership/parent reads with compact authoritative queries. Avoid rebuilding conversation history solely to refresh an archive flag. | `host/src/runtime/index.ts` visibility/root traversal; `desktop/src/main/host.ts` release/refresh; core SDK get/list/archive/readSession | Visibility and trust remain correct. Active children, pending input, jobs and leases still prevent unsafe resource release. Sidebar display status must not authorize release. Identify migrated callers and obsolete helpers to delete. |
| C. Directory design | Challenge whether a transaction-owned directory projection is necessary and what the smallest complete slice is. Do not silently drop preview/search/activity/status to make listing cheap. | Core store contract, SQLite/PostgreSQL writers, worker RPC, SDK reads and desktop directory | State exact field dependencies, final-batch CAS semantics, parent/workspace inheritance, rewinds, all-head/effect status, interrupted rebuilds and multiple writers. The fact-query demo is not proof of full parity. |
| D. Git demand | Expose scope metadata separately. Require explicit demanded paths for patches. Migrate panel, collapsed rail counts and scope-menu counts together. Keep Pierre viewer/tree virtualization. | `host/src/git.ts` scopeRead/diff; protocol/backend contracts; app queries and workbench changes components | Manifest precedes patch acquisition. Selected patches remain identical. Preserve root/subfolder, rename and scope semantics. Unknown counts and unloaded viewed freshness must not become fabricated zero/unchanged. Delete eager all-scope parse/hash work. |
| E. Giant file | Bound streamed subprocess bytes before concatenation/decoding; return a typed too-large result. Propagate cancellation and stale-request identity. Parse bounded demanded input off the renderer where needed. | Host Git subprocess/output boundary; protocol outcomes; renderer acquisition/parser | A huge selected patch does not allocate/parse its full body on the UI path. Abort stops owned work. No giant raw `<pre>` fallback. Choose policy limits explicitly rather than present arbitrary numbers as measurements. |

Paths above are relative to `packages/`.

## Requested output

Prioritized findings with severity and demo/design classification, concrete A-E implementation order, small API/usage sketches where useful, deletions and behavioral acceptance per slice. Give separate verdicts for the experiment and proposed production design. Favor immediate safe deletions before persistent read-model work. Write a completed review to `FABLE-REVIEW.md` only after the reviewer can finish.
