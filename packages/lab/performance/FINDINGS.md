# Why these screens do too much work

Source inspection covers the working checkout based on `b9792d38322afe66b06923a8c2b1a24071b091a6`, not a pristine release. The local executable reports `0.0.16-dev.4`; no matching installed documentation index was found at the checked native locations. The implementation references below are checkout source. No user sessions were inspected and no running desktop was profiled.

Rechecked at HEAD `7871d56a`: that commit moved only workbench lines (`workbench.tsx:165-175` is now about `:173-177,212`). Most cited core, host, desktop and app files are uncommitted user work, so their line numbers can drift further.

After the Opus audits, the collapsed-rail/scope-menu count-only patch reads were removed. The sidebar row/neighbor preload removal was rejected and reverted in full. Cursor's explicit hover preload path was missing from the original investigation; see the correction in [the Cursor report](research/cursor.md#correction-hover-prewarming-is-present). Sidebar prewarming is retained. Citations describing deleted Git paths below record the pre-fix findings. The rail and working-tree menu rows now show Git-status file counts, not +/- totals. The main changes panel still acquires complete scopes; viewport demand and giant-patch bounds remain open. See [the impact audit](OPUS-IMPACT-AUDIT.md) for the exact implemented slice. No core/host/protocol/storage change was made, and the broad directory projection is no longer the chosen direction.

## Git: virtualization happens after the expensive input work

```text
changes-panel: all changed paths, or entire commit
  -> useVcsDiff: all path batches concurrently
  -> host diff: discover scope, Promise.all one patch per file
  -> transport: complete patch array
  -> renderer: construct sections, hash patches, parsePatchFiles
  -> Pierre CodeView: virtualize files and lines
  -> workers: syntax highlighting and intraline comparisons
```

Concrete boundaries:

- `packages/app/src/workbench/changes-panel.tsx:290-302` requests all working paths. Commit scope obtains its file list from returned full patches at `:333-350`. `:373-429` constructs sections and hashes every patch before the viewport matters.
- `packages/app/src/queries.ts:539-584` batches paths to meet the protocol path limit, but executes every batch with `Promise.all`. This is request-size partitioning, not a concurrency or total-work bound.
- `packages/host/src/git.ts:620-652` discovers the scope before filtering paths, then concurrently obtains every selected patch. Omitting paths means all files. `:59-113` accumulates subprocess output without a patch-byte limit. The file-content preview cap elsewhere does not bound this path.
- `packages/app/src/workbench/changes-stack-code-view.ts:23-40,116-171` parses all new patches synchronously and retains a map keyed by patch text. Collapsing a file changes presentation; it does not prevent this parse.
- `packages/app/src/workbench/changes-stack.tsx:128-152,223-260` already uses Pierre's CodeView and workers. Replacing it with another virtualizer would leave the eager path above intact. Its scroll callback also walks file positions to find the active file, despite CodeView internally using binary search for its own visible window.
- `packages/app/src/conversation/diff-view.tsx:310-317,352-365,416-425` is a separate path. It synchronously parses receipts and uses ordinary `FileDiff`; the local component does not establish line-virtualizer context. Fixing the changes panel alone would not fix every inline giant patch.
- `packages/app/src/workbench/workbench.tsx:165-175,209-212` fetches the full uncommitted diff for the collapsed project rail's line-count badge. `changes-toolbar.tsx:274-295` requests full diffs for scope-menu counts. A closed diff view therefore does not imply no patch acquisition. Replace these body-dependent count reads too, using genuine metadata or omitting unavailable line totals.

### What Pierre actually does

Reviewed commit `d302ea0aad461a2a9ee6de5916e3482bced946e5`. That source has Diffs 1.5.2 and Trees beta.6; Nyte installs Diffs 1.4.1 and Trees beta.4.

DiffsHub streams complete files and awaits their consumption. After a synchronous file parse it checks an 8 ms cooperative work budget and yields. It appends batches through the viewer handle, while publishing tree changes less frequently. The tree applies path/status deltas rather than rebuilding the whole model. CodeView virtualizes both files and lines. Workers highlight; they do not parse incoming patches.

This is better scheduling, not bounded total acquisition. Diffshub eventually parses and retains the whole review. One giant file remains buffered and synchronously parsed; an 8 ms check after parsing cannot interrupt it. A manifest plus demand-loaded patches is our proposed improvement beyond that reference, not a feature falsely attributed to Pierre.

See [the source-linked Pierre investigation](research/pierre.md), especially sections 2, 4, 5, 6 and 7.

## Sidebar: a directory row is coupled to conversation detail

```text
renderer host.sessionDirectory
  -> desktop periodic sweep, all pages including archived
  -> core sessions.list
  -> store.list all identities
  -> pool.open each candidate
  -> validate cached row OR readSession
       pending + heads + facts + branch history + workspace/activation
  -> filter archived, parent, search
  -> host directory -> renderer rows
```

- `packages/core/src/kernel/sdk/reads.ts:172-229` reuses cached rows or calls `pool.readSession`. `:234-264` applies filters after obtaining the rich row. `:368-411` starts from the complete catalogue and examines candidates in batches of eight.
- `packages/core/src/kernel/sdk/session-pool.ts:580-609` reads pending changes, heads and main-branch history for that row. `sdk/snapshot.ts:192-240` projects a `SessionInfo` containing fields the directory does not need, including configuration and full heads.
- `reads.ts:76-91` treats every ref event as invalidating the listing. A small metadata mutation can make a rich row stale, even when history did not move.
- `packages/desktop/src/main/host.ts:1911-1928,2089-2117` starts lifetime sweeps and drains list pages including archived sessions. Visible-row limits in the renderer do not limit this work.
- Desktop SQLite runs through `WorkerStore`. The issue is not simply synchronous SQLite on the renderer. Store RPC, decoded histories, projection, host work and renderer updates still exist even when SQLite itself is off-thread.

**The 180-session answer:** yes, the host/core listing path examines unopened session candidates. No, that does not mean 180 model runs or 180 full history walks on every refresh. Existing pooled and durable listings avoid many warm walks. Cold, absent or invalidated listings take the rich path. The demo reports cold and warm separately.

The durable listing cache was already added in `a3536dc2`, `perf(core): keep each session's directory row in the store`. Another memoization layer would preserve the same dependency. The wrong premise is that a directory must be reconstructed through the same read as an opened conversation.

A distinct headless-host path is worse even when the core list is warm. `packages/host/src/runtime/index.ts:645-649` checks visibility for each listed row. `visible -> treeState -> rootOf` at `:278-309,633-634` calls uncached `sdk.sessions.get` once per ancestor just to find ownership. For 180 roots that adds 180 history reads. This is the headless/remote path, not the local desktop directory path. Ownership/ancestry needs its own lightweight query; a directory-only fix must not leave this authorization path hydrating transcripts.

The [core probe](research/nyte-sidebar.md) measured 180 synthetic sessions with 256 commits each through the real WorkerStore. Cold listing returned 46,080 history commits; a warm list returned zero. The composed attached-idle archive sequence read the same 256-commit history three times, plus checked the whole catalogue for children. These are core-call counts, not a trace of a desktop click. The probe script that produced them, `/tmp/nyte-sidebar-probe.ts`, is not in this tree, so these WorkerStore numbers cannot be reproduced from it; `directory.ts` uses direct `SqlStore`.

### Archive has a second, independent eager path

`packages/app/src/chrome/sidebar.tsx:566-571` passes route preloading as `onHover`. The whole row has pointer-down and focus capture at `:1637-1638`, including the row's Archive and Pin controls. Hover also preloads after 50 ms.

The route loader at `packages/app/src/router.tsx:440` calls `warmThread`. `packages/app/src/live.ts:508-552` warms children, background jobs, the session catalog, mention files, and a snapshot when needed. The child query can itself enter the broad parent-filtered list path. This work can start even though the user is archiving, not opening, the conversation.

Then `packages/desktop/src/main/host.ts:869-878` archives, optionally releases an attached idle session, and refreshes its rich row. `:2154-2169` refreshes with `sessions.get`; that method always calls `readSession` at `packages/core/src/kernel/sdk/nyte.ts:323-329`. The core archive operation itself is a small idempotent fact update at `:350-359`.

Do not overstate cleanup: `releaseSessionIfIdle` checks whether an attachment exists before reading detail at `host.ts:1346-1355`. It does not unconditionally hydrate every archived session. Attachment discovery is another separate issue: `sdk/nyte.ts:1143-1162` scans all stored ids even for a named attachment to discover descendants.

The original recommendation to delete hover prewarming was wrong. Keep navigation-intent warming and fix its read scope. Command-specific capture events should not be confused with navigation intent, but that does not justify removing useful hover behavior. No replacement interaction or narrower prewarm read has been implemented yet.

The initial sidebar deletion has been reverted in full. Hover, focus, pointer and neighbor prewarming behave as before this work. Route warming can read a session on a cache miss, but `readRouteSession` and `warmThread` reuse existing query/observer state; it is not a guaranteed history read for every hover. The relevant issue is the amount of work behind a miss, not the existence of hover intent. No sidebar source change is being committed.

## Cursor Glass: headers are not loaded composers

Inspected Cursor 3.23.23, product commit `2dac2428994fe34f12658d9ecad1541b98db2c00`. Read only installed application code, including the main-process side of the IPC boundary.

- `refreshAgents -> scanAgents` discovers header metadata. `makeAgentHeader` initially has no conversation state.
- Full hydration has a separate `loadAgent -> getComposerHandleById -> backend.load` chain, with root/message storage reads.
- Known unloaded headers receive status from background-work metadata without becoming loaded composers.
- Archive can persist a known header without a composer handle. It has fallback loading when neither header nor handle exists. Cursor's archive semantics can abort loaded work; do not copy that behavior into Nyte, where archive is not Stop.
- The inspected grouped Glass sidebar uses incremental reveal, not viewport virtualization. Its ordinary reveal increment is eight. Header loading and row mounting are separate limits.
- Cursor still scans unopened metadata. Its main scanner reads recent workspace aggregates and can run `SELECT value FROM composerHeaders` without a SQL limit before returning a bounded selection. It is not a zero-scan ideal.

Representative UTF-8 byte offsets in `workbench.glass.main.js`: header construction `44890015`, full load `44829784`, archive `44835115`, archive persistence `38320795`, grouped reveal `43098312`. The full [Cursor report](research/cursor.md) records source ranges, conditions and limits; [bundle hashes](research/cursor-bundles.json) identify the exact installation. No runtime Cursor latency or call-count claims are made.

## Architecture decision

Two structurally different candidates were considered using the architect workflow.

1. Direct lightweight per-session reads. This deletes cache machinery but drops preview search, exact activity and all-head status unless those expensive reads creep back in. Rejected as the complete product design.
2. A store-owned queryable directory projection, maintained with successful authoritative ref transactions. This moves filtering and paging before session hydration while retaining product semantics. Proposed as a production direction, not implemented and not proven by this experiment.

The executable directory demo is deliberately smaller: a read-only relational query over current fact refs. It proves that listing explicit names and flags need not read history, without introducing another cache. It reads authoritative refs live, which is closer to candidate 1 than candidate 2, so it cannot show that a maintained projection stays consistent. It is not the complete projection from candidate 2 and must not replace production `SessionInfo` unchanged.

Before building candidate 2, remove the history reads that fact-only changes cause today: `refreshRow` after archive calls `sessions.get`, `rowHolds` (`sdk/reads.ts:73-87`) invalidates on any ref event, and `listedSession` hydrates a row before its archive/parent filter. The case for a projection then rests on preview, activity and all-head status, which no demo here measures.

### Production field ownership

| Display field | Authority | Required update |
| --- | --- | --- |
| Explicit name, pinned, archived, parent | Validated fact refs | Successful fact CAS, creation, deletion |
| Preview and activity | Selected main branch | Append, rewind, non-forward move, head deletion |
| All-head status | Current run refs across heads | Run transition, head creation/deletion; derive rather than equate main idle with tree idle |
| Participant question/wait | Current run's effects and calls | Effect/run transitions; phase alone is insufficient |
| Workspace | Root workspace ref and parent relationship | Root relocation or parent change; children join root binding |
| Host activation/trust | Host observation | On explicit activation/revalidation, never infer availability from absent observations |
| Resource-release eligibility | Runtime heads, jobs, leases and descendants | Separate authoritative lifecycle query, never a sidebar badge |

Preview must retain current maximum-timestamp selection and equal-time tie behavior. Activity can decrease on a rewind. A transaction-maintained projection must see the final ref batch, not half-applied refs. A failed CAS changes neither refs nor the projection. SQLite, PostgreSQL, worker RPC and importers must all obey the contract before old listing APIs are removed.

Rebuild must publish atomically under writer exclusion or a checked generation. An interrupted rebuild must not mark an incomplete generation ready or overwrite a newer mutation. Do not make missing projection rows trigger hidden history walks from a sidebar query. Arbitrary branch moves can still require a history fold at write time; measure that write-lock cost rather than calling it free.

### Git ownership

Keep scope discovery and demanded-patch acquisition together in `host/git.ts`, where scope and rename semantics already live. Expose metadata separately. Require explicit paths for payload reads; an omitted argument must not accidentally mean the entire repository. Keep existing tree and CodeView virtualization.

The production payload path also needs streamed byte limits, bounded concurrency, cancellation through the subprocess, immutable revision identity, and parsing outside the renderer for an enormous single file. These are real requirements, not features implemented by the selected-path demo. A mutable worktree is not an atomic snapshot. Unloaded counts and reviewed state must remain unknown rather than fabricated zero/unchanged.

## Principles review

Applied root causes, subtraction, first-principles redesign, domain modeling, boundaries, types, shared-state ownership, idempotency, API deletion, reader load, experience, behavioral proof and measurement. Skipped cosmetic review. The full projection is not ready to ship merely because the reduced demo passes.

| Where | Finding | Principle | Concrete change |
| --- | --- | --- | --- |
| Core list/readSession boundary | Directory computation inherits history and activation work | Model the domain | Separate compact directory rows from selected-session details; query before hydration |
| Prewarm demand | One hovered session can trigger a catalogue-wide child lookup | Fix root causes | Preserve hover warming; separate target-session demand from broad directory/auxiliary reads |
| Changes acquisition and adapter | Every patch is acquired and parsed before virtualized display | Fix root causes | Fetch a manifest, then only demanded patches; remove eager full-scope preparation |
| Existing listings cache | Read-time repair depends on broad ref invalidation | Single ownership | Replace, rather than wrap, with transaction-owned directory semantics when all callers migrate |
| Proposed direct SQL prototype | Reduced facts omit user-visible metadata and may bypass corruption checks | Boundary discipline / prove it works | Label its scope explicitly; never claim full semantic parity or desktop FPS improvement |

Verdict: the isolated experiment can demonstrate removed work. Production needs deletions of fact-only history reads and demand-driven UI integration first, not another cache around the existing reads; a directory projection is unproven.
