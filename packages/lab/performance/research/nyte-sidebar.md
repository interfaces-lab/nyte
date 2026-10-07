# Nyte sidebar investigation

## Finding

The structural problem is that directory, ancestry, and idle-work decisions demand a full session read. `readSession` reads the complete main-branch history. `sessions.get` and `sessions.metadata` always use it. `sessions.list` avoids it only while its directory cache holds. Filtering happens after row loading, so even a query for a root with no children examines every stored session.

Do not describe the current local sidebar as walking 180 transcripts on every refresh. A warm core list walks **zero** history commits. A cache-missing list really does walk every examined session's complete main branch. A changed archive fact rebuilds one session's history, not all 180. Desktop archive handling adds uncached reads and a whole-store child lookup. The current headless host has a separate visibility check that can defeat the core list cache for every returned row.

An additional unwanted demand is confirmed in the renderer. Archive and pin buttons sit under the row's pointer-down and focus capture handlers, which request a thread preload before the action. Hover also requests that preload after 50 ms. Whether it fetches a snapshot depends on router and query caches.

## Reproducible measurements first

Retained script: `/tmp/nyte-sidebar-probe.ts`.

SHA-256: `29a55e011c9627488a407a9be20a806fe6a7cc8dd7bd7c6c4e406b4742e3272c`.

Run from this checkout with Node 26.10.0:

```sh
node /tmp/nyte-sidebar-probe.ts 180 256 worker 3
node /tmp/nyte-sidebar-probe.ts 180 1024 worker 3
node /tmp/nyte-sidebar-probe.ts 180 256 direct 3
```

The script's imports name this checkout explicitly. It creates a unique `/tmp/nyte-sidebar-probe-*` directory per trial, seeds only synthetic sessions into a new SQLite file, and removes the database in `finally`. No user session, home store, network provider, browser, runner attachment, or dev server is involved. Provider execution throws. The environment opens only a synthetic temp directory; the project-plugin loader returns an empty set.

Fixture: 180 independent root sessions, one main head each, no runs, pending changes, jobs, or children. Each history has 256 or 1,024 commits from the existing `projectionFixture` in `packages/core/benchmark/fixtures.ts:97`. Every four commits contain a user message, assistant tool call, file-edit tool result, and final assistant response. All histories are structurally identical but stored independently per session. Text is 256 characters. This is not a model of the user's transcript sizes.

Counts below are calls at the real Store/Session interface, not SQLite statement counts and not IPC envelope counts. Several calls can share one worker message. Chain byte counts are the summed serialized fixture commit bodies returned, not wire framing or heap allocation. The script checks result lengths, archive values, empty child lists, and transcript turn counts. Counts are stable across all three trials. Timing is descriptive, not a desktop freeze reproduction.

### Worker store, 180 sessions, 256 commits per session

| Operation | Store calls | `objects.chain` calls | Commit rows returned | Sessions whose history was read | Wall time range, 3 trials |
| --- | ---: | ---: | ---: | ---: | ---: |
| `createNyte` alone | 0 | 0 | 0 | 0 | 0.1 to 3.0 ms |
| Cold list, no listing rows | 4,321 | 720 | 46,080 | 180 | 1,301 to 2,000 ms |
| Warm list | 361 | 0 | 0 | 0 | 14 to 48 ms |
| New SDK, valid persistent listing rows | 1,621 | 0 | 0 | 0 | 257 to 324 ms |
| Archive fact write alone | 4 | 0 | 0 | 0 | 2 to 16 ms |
| `get` after archive | 19 | 4 | 256 | 1 | 9 to 21 ms |
| Child list for archived root, returns zero children | 382 | 4 | 256 | 1 | 53 to 68 ms |
| Second `get`, as `refreshRow` does | 19 | 4 | 256 | 1 | 11 to 20 ms |
| Subsequent desktop-style sweep, pages of 32 | 366 | 0 | 0 | 0 | 36 to 107 ms |
| Warm list excluding archived row | 361 | 0 | 0 | 0 | 10 to 69 ms |
| Metadata for one session | 19 | 4 | 256 | 1 | 10 to 14 ms |
| Snapshot for one session | 21 | 4 | 256 | 1 | 16 to 30 ms |
| List after one non-ref notice | 362 | 0 | 0 | 0 | 47 to 110 ms |
| List after one unrelated fact ref | 382 | 4 | 256 | 1 | 70 to 98 ms |

Cold list transfers 33,852,240 bytes of commit bodies through chain results. Each repeated one-session walk returns 188,068 bytes.

Exact warm-list breakdown: `store.list` 1, `events.last` 180, workspace `refs.read` 180. No store opens, listing reads, facts, chains, or plugin work.

Exact persistent-cache restart breakdown: `store.list` 1, `store.open` 180, `refs.read` 720, `events.last` 180, `listing.read` 180, `objects.get` 360. It opens 180 logical session handles but does not walk history. Across each cold list, trust, environment open, and project-plugin load each happen once for the shared workspace. Session plugin instantiations remain zero. Warm list does none of those.

### Composed archive and headless visibility read demands

A second run adds composed core sequences. These reproduce the named core calls, not the complete DesktopHost or HTTP runtime.

| Sequence | Store calls | Chain calls | Commit rows | Wall time range, 3 trials |
| --- | ---: | ---: | ---: | ---: |
| Unattached local archive: write, then `refreshRow` get | 23 | 4 | 256 | 8 to 43 ms |
| Action preload's snapshot demand alone, unarchived row | 20 | 4 | 256 | 16 to 35 ms |
| Attached idle root archive: write, get, pending/jobs check, child list, refresh get | 427 | 12 | 768 | 94 to 129 ms |
| Warm list plus headless visibility's one get per root | 3,604 | 720 | 46,080 | 716 to 896 ms |

The attached sequence has **three walks of the same session**, not 180 walks. Its no-child lookup still checks all 180 rows. It excludes event-watch races, detach cleanup, browser release, renderer preload auxiliaries, rendering, and HTTP policy. A real attached session may also have a tracker or observer reading concurrently.

The headless sequence is the core read equivalent of a warm list followed by `rootOf` for each root. It is not a full authenticated host test. It omits journal and registry operations but proves that those extra `get` demands alone restore whole-directory history work despite a warm list cache.

### History scaling and thread projection

With 1,024 commits per session:

- Cold no-cache worker list: 6,481 store calls, 2,880 chain calls, 184,320 commit rows, 135,542,880 bytes. Three trials took 5,262, 5,322, and 5,699 ms.
- Warm list still costs 361 calls and zero commits. Trials took 23 to 76 ms.
- Valid persisted rows still cost 1,621 calls and zero commits. Trials took 92 to 182 ms.
- Each `get` or metadata read costs 31 calls, 16 chain calls, 1,024 rows, and 753,016 bytes. Snapshot costs 33 calls and reads the same 1,024 rows.
- Archive fact write remains four calls and zero commits.

Increasing history fourfold increases cold chain reads and bytes fourfold. The 64-object page size bounds each query, not the total history walked.

Pure in-memory projection, 100 repetitions over 1,024 commits, took 11 to 31 ms for `sessionDirectoryEntry`, and 29 to 33 ms for `transcriptFromCommits`. Those are batch timings, not one-session timings. List/get do not call `transcriptFromCommits`. They do read transcript commit bodies and walk them to calculate preview, activity, and selected configuration. Snapshot adds the actual transcript, context, and usage projections.

The direct SQLite control uses synchronous `DatabaseSync` beneath async methods. A cold 256-commit list took 729 to 907 ms and delayed a zero-delay timer by essentially the whole operation. Worker cold-list timers fired in 0.8 to 2.2 ms in the first dataset. Thus worker-store cold wall latency is real, but this probe does **not** show an uninterrupted desktop main-thread freeze. Worker transfer validation, renderer transcript work, action-triggered preload, layout, and concurrent reads need an isolated UI trace to assign frame stalls. The synthetic measurements were not collected under controlled machine load; worker-1,024 and direct-256 runs overlapped. Do not infer a backend speedup from these times.

Raw results:

- `/tmp/nyte-sidebar-worker-256.jsonl`
- `/tmp/nyte-sidebar-worker-1024.jsonl`
- `/tmp/nyte-sidebar-direct-256.jsonl`
- `/tmp/nyte-sidebar-worker-256-expanded.jsonl`

The retained script includes the expanded phases. Earlier files predate that addition; their shared phase definitions are unchanged.

## Data flow and source evidence

All paths below are relative to `/Users/workgyver/Developer/nyte` and line numbers refer to the investigated working tree.

### Sidebar directory versus detail requests

```text
Sidebar
  useWorkspaceSessionDirectory
    host.sessionDirectory
      DesktopHost cached directory + background sweeps
        SDK sessions.list
          store.list -> pool.open -> listedInfo -> filter

Row archive
  capture handler -> route preload -> warmThread -> possible snapshot + auxiliaries
  click -> SessionActions.setArchived
    DesktopHost -> SDK fact CAS
      conditional attached-tree idle check -> get + pending/jobs + child list
      refreshRow -> get -> directory upsert
```

- `packages/app/src/chrome/sidebar.tsx:300-307` reads the workspace directory once through the query layer. Rows receive `SessionInfo`; row rendering does not install one SessionObserver per sidebar session.
- `packages/app/src/queries.ts:178-195,288-299` reads `nyte.host.sessionDirectory`, subscribes before startup snapshot, and folds pushed directory updates. `queries.ts:133-174` writes pushed row caches.
- `packages/app/src/chrome/sidebar.tsx:794-830` filters/groups cached rows and limits displayed rows only afterward. The collapsed limit is five at `:111`. This does not limit host/core scanning. The renderer still has list filtering/sorting and layout work, but reducing rendered rows cannot remove backend history demand.
- `packages/app/src/chrome/sidebar.tsx:430-453` preloads at most the two neighbors of the active session. This is separate detail demand, not 180 sidebar snapshots.
- `packages/app/src/live.ts:241-296,357-389` shares observers for named open sessions and closes them on last release. `live.ts:508-553` warms detail without attaching a watch; it always requests child-list, jobs, catalog, and mention-file auxiliaries, subject to their query caches. Snapshot is skipped when already observed or a matching settled snapshot is cached. `queries.ts:401-433` shows the child query and one-second stale times.

### Verified archive/pin preload leak

- `packages/app/src/chrome/sidebar.tsx:566-570` supplies `onHover = router.preloadRoute('/session/$sessionId')`.
- `sidebar.tsx:1541-1552` calls it after a 50 ms hover or immediately through `warmNow`.
- `sidebar.tsx:1631-1638` puts pointer-enter, pointer-down capture, and focus capture on the entire Row.
- `sidebar.tsx:1680-1705` places pin/archive buttons beneath that Row in Row.Actions.
- `packages/ui/src/row.tsx:274-282,369-388` forwards the row's capture handlers and renders actions as a child span. Its primary-action exclusion at `row.tsx:224-228` prevents opening on action click; it does not prevent the ancestor's preload capture handlers from running earlier.
- `packages/app/src/router.tsx:428-440` preloads a route existence read and runs `warmThread`. `packages/app/src/route-session.ts:6-22` can satisfy existence from the pushed query cache with infinite stale time.

Therefore action pointer-down or keyboard focus requests thread warming even though it is not navigation intent. Repeated preload requests may deduplicate. A fresh observed or cached session may avoid a snapshot altogether. This is verified from handler placement and callbacks, not a browser network trace. The measured snapshot-only preload is a demand example, not a guaranteed count per click.

### Archive write and desktop amplification

- `packages/app/src/session-actions.ts:111-169,241-282` handles optimistic archiving, per-session mutation ordering, cache cancellation, and renderer resource release. It does not invalidate/refetch the entire directory after every archive.
- `packages/desktop/src/preload/index.ts:67-74,93-102` forwards operations over IPC. `packages/desktop/src/main/host.ts:869-880` performs core archive, conditional idle release, and refreshRow.
- `packages/core/src/kernel/sdk/nyte.ts:350-359` only checks/writes the archived fact. `session-pool.ts:390-430` puts a blob and CASes its ref. This write has no transcript demand.
- `packages/desktop/src/main/host.ts:1346-1357` returns immediately when there is no local attachment. If attached, it calls `sessions.get` and examines live work.
- `host.ts:1385-1407` reads run phases, per-head pending/jobs, then lists children. No-child lookup uses `sessions.list({parent: sessionId, includeArchived:true})` and therefore still scans the whole store. Recursion repeats that scan per visited session when nothing is live. Worst case is quadratic row checking in a large quiet tree, even when all history caches are valid.
- `host.ts:2154-2168` unconditionally refreshes the mutated row with another `sessions.get`.
- `host.ts:2171-2307` tracks non-settled or attached sessions with watches. Dirty rows trigger `get`; commit/effect events also trigger child lists. This can overlap archive/detail reads.

### Sweeps and startup are not the same operation

- `packages/desktop/src/main/host.ts:283-300,1911-1928` starts lifetime sweeps on directory demand, every five seconds, with a 1.5-second hydration budget. Closed directories are stale after 60 seconds with a refresh batch of four.
- `host.ts:1982-2041` reads open stores each sweep and batches store targets four at a time. `host.ts:2089-2118` lists open stores in pages of 32, includes archived and child sessions, then calls `releaseSessionIfIdle` for archived rows. That release call is cheap for unattached rows; do not count a get per archived row indiscriminately.
- `host.ts:1835-1907` opens a temporary WorkerStore and lightweight SDK for a closed directory, lists, then closes both. Persistent listing rows survive that close.
- `packages/core/src/kernel/sdk/nyte.ts:156-227` constructs pool/read/runner helpers without scanning sessions. The probe confirms zero store calls at creation.
- `nyte.ts:1143-1172` is the separate `attach` startup scan. Even a named attachment enumerates all stored sessions to discover descendants and opens their logical handles. `packages/core/src/kernel/sdk/runner.ts:715-754` checks coverage first; only covered sessions resolve/instantiate runtime activation and recover jobs. Do not charge every uncovered session plugin activation.
- `packages/desktop/src/main/host.ts:1301-1315` attaches named sessions on execution demand. `packages/host/src/runtime/index.ts:364-366,781-783` attaches each admitted root at headless startup. Multiple root attachments can repeat whole-store enumeration. No attachments ran in these benchmarks.

### Client/server/host distinction

- `packages/client/src/index.ts:362-372` maps list/get/archive/snapshot to transport operations. `packages/server/src/index.ts:634-647,946-958` parses POST operations and dispatches to its supplied SDK. The server transport itself does not add a transcript walk.
- Desktop-host sharing maps list and archive at `packages/desktop/src/main/host.ts:2612-2640`; it retains the local behavior above.
- The new headless runtime adds its own behavior. `packages/host/src/runtime/index.ts:645-649` lists through core and then checks visibility for every result. `:633-634,278-309` shows `visible -> treeState -> rootOf -> sdk.sessions.get` once per ancestor. Root-only listings thus add 180 uncached full-history gets. Descendants repeat ancestor gets too. Its get wrapper at `:640-643` also performs visibility after the initial get.
- `packages/app/src/web/bridge.ts:124-146,298` maintains a web directory over remote list calls and refreshes after mutations. This should not be conflated with desktop's direct local SDK.

### Core reads and storage

- `packages/core/src/kernel/sdk/reads.ts:368-411` obtains every stored ID anew on each page, reverses it, examines batches of eight, and treats limit as the number of matching rows. Up to seven rows past a page boundary can be examined speculatively.
- `reads.ts:242-262` opens/loads the row before checking archive, parent, or search. A selective search or empty child query can examine every session.
- `packages/core/src/kernel/sdk/session-pool.ts:250-301` opens logical store handles, reads parent facts on adoption, and keeps handles until SDK close or retirement. `SqliteStore.open` does not open a separate SQLite connection per session, see `packages/core/src/kernel/sqlite.ts:1090-1107`.
- `reads.ts:200-229` validates in-memory rows using event seq, activation identity, and root workspace oid. Persistent rows at `:172-197` additionally decode/validate the body and resolve current workspace activation. `rowHolds` at `:73-84` accepts identical seq or up to 256 intervening non-ref events. Any ref event, too many events, or an expired cursor causes rebuild. An archive fact and an unrelated plugin-setting fact both invalidate it.
- `session-pool.ts:456-468,580-611` reads four relevant facts, pending main changes, head/stack refs, runs and leases, workspace, and the **complete** main branch. `createdAtFor` at `:570-577` may enumerate the store on a first individual get; list adoption supplies createdAt and avoids that extra enumeration in these measurements.
- `session-pool.ts:637-700,770-819` resolves trust, environment, and project-plugin definitions once per active workspace and remembers per-session activation state. This is not session plugin instantiation. Actual activation is a separate runtime demand.
- `packages/core/src/kernel/sdk/snapshot.ts:192-240` computes directory preview/activity and selected configuration from all main commits and queued changes. `packages/client/src/views/directory.ts:93-121` walks all commits and extracts message text; preview is not bounded to a short string here.
- `packages/core/src/kernel/sdk/nyte.ts:323-329` makes every get call readSession. It never uses listedInfo. `reads.ts:340-353` does the same for metadata despite not returning transcript. `reads.ts:298-319` adds transcript/context/usage projection for snapshot, with another branch read for a non-main head.
- `packages/core/src/kernel/graph.ts:10,27-72` pages chain queries by 64, walks to null, and reverses the complete branch. Unlike `contextCommits` at `:75-95`, directory reads do not stop at checkpoints.
- `packages/core/src/kernel/sqlite.ts:567-593` uses a recursive SQL query per page and loads full bodies. `packages/core/src/kernel/store-schemas.ts:189-196` parses JSON, validates shape, and verifies the body hash for each object. Tool outputs/images ride along even though the directory does not use their contents.
- `packages/core/src/kernel/worker-store.ts:246-259,266-286,415-468` batches RPC requests, structured-clones results across the worker boundary, and validates returned objects in the caller. Only SQLite work is moved off the host thread. Directory and transcript projections still execute in the SDK caller.

## Complexity

Let N be stored sessions, M examined candidates, H_i a session's main-history length, Q_i pending-chain length, and P a returned page size.

- Warm whole list: O(N) directory enumeration and O(M) row validation calls, zero history work.
- Cache-missing or dirty rows: O(sum H_i + sum Q_i + heads/runs/effects read costs) over examined candidates. Every commit body is loaded, not just preview fields.
- Individual get/metadata: O(H_i + Q_i + head/run projection) every time, independently of list cache.
- Filtered child/search list: worst-case M = N, even if zero results. Page size is not a candidate limit.
- Full paged sweep repeats full ID enumeration per page. With 180 matching rows and pages of 32, six enumerations plus 360 warm row-validation calls. Across many pages, the enumeration component scales as O(N * ceil(N/P)).
- Quiet attached-tree idle check: one whole-store child scan per visited node. Worst-case O(N * tree size) row checks plus repeated history gets.
- Headless visibility: a full-history get per returned row/ancestor after core list. A warm cache alone cannot remove that demand.

## History and rationale

Blame puts readSession's main-branch walk and filtered-list shape in `acca25be`, "complete host and protocol integration". It was a shared projection that made selected configuration, pending choices, preview, and head state agree. It also made a directory row depend on all history.

`8400c9ae`, `perf(core): avoid redundant history work on reads and events`, explicitly changed in-memory list reuse to tolerate non-ref events. This avoids a rebuild for each streaming delta. It retained ref-wide invalidation.

`a3536dc2`, `perf(core): keep each session's directory row in the store`, describes a real 2.4 GB, 512-session store taking 5 to 15 seconds for a cold list. It added persistent listings because rebuilding every main branch delayed first paint. The commit reports the next launch returning 137 top-level rows in about 200 ms. That is historical author evidence, not a number remeasured here. The current probes confirm the intended cache distinction.

`aac28ed5`, release 0.0.9-alpha, introduced the desktop attached-tree release checks during memory/power and browser-lifetime work. The safety rule is reasonable: archiving must not release live session/subagent resources. Its implementation uses expensive directory/session reads to answer a narrow activity question.

`573c0679`, `fix(desktop): shelve a chat as Working while its subagent runs`, explicitly includes children in sweeps because core already examines every session before filtering. Its rationale is finding live descendants of apparently settled roots. This is an intentional discovery requirement, not evidence that all sidebar rows should instantiate agents.

Investigated HEAD is `b9792d38`; the tree is extensively dirty. Relevant uncommitted core changes concern model identity/context and command ordering, not the measured list/readSession/archive shape. DesktopHost's tracked diff concerned sharing auth. No repository files were edited by this investigation. Status snapshots show additional concurrent changes to desktop shared IPC and the TUI build script; those were not this investigation's writes.

Required unslop, TypeScript guidance, principles-review, core README and kernel README were read. Applied principles are fix root causes, redesign from first principles, explain the number, and prove it works. Skipped unrelated diff-review principles because this is an investigation, not a proposed production diff.

The available `bin/nyte` reports 0.0.16-dev.4. It is a checkout binary, not evidence that the live desktop matches this source. Matching installed native docs were not found in checked candidate paths. Checkout core contracts were used as checkout contracts, not substituted for installed version docs.

## Candidate synthesis and simplest structural fix

The shared root cause is **detail demand used to answer directory and control questions**. React memoization cannot stop these reads. A larger cache still falls back to the same wrong-shaped read.

1. **Delete accidental detail intent first.** Put warming on the primary navigation target, not the whole Row. Archive/pin focus and pointer-down must not request snapshots, catalog, files, or child lists. Keep intentional route warming explicitly scoped. This is a small complete fix for the verified UI demand leak, not the entire core fix.
2. **Separate directory/control reads from transcript reads in core.** Stop constructing SessionInfo by calling full readSession. Give directory/get a compact projection made from facts, parent/workspace identity, heads/current run state, queued selected choices, and a commit-derived summary. Snapshot owns history/transcript demand. Activity/ancestry checks should consume narrow facts/refs rather than SessionInfo. Reuse that path for desktop refreshRow and headless visibility.
3. **Make the directory projection queryable without session-pool admission.** Bulk-read directory rows with their source positions from storage. Apply parent/archive/search selection and pagination there before opening runtime handles. Persist parent/root identity as derived directory data so child discovery and named attachment do not rediscover ancestry by opening the entire store. Keep it rebuildable, not a fifth authority.

The simplest complete production design is a storage-backed directory read model, shared by list and get, plus a narrow tree-activity read. Reuse and reshape the existing `listings` facility instead of adding an unrelated cache manager. Split commit-derived summary from volatile metadata so archiving/pinning/name changes do not invalidate unchanged history. Update or repair the summary only when the history/config inputs change. Arbitrary ref events must not demand a full branch rebuild. Missing/invalid projections may need a one-time recovery walk, but that must be an explicit repair path, not normal archive behavior.

This requires covering all writers, including remote CAS and head moves, not only locally optimistic actions. Preserve queued-config ordering, workspace moves, deletion, terminal run/lease semantics, corruption handling, and snapshot equivalence. A valid stored row cannot permanently substitute for live lease/activity state. Do not just route get through today's listedInfo and declare victory.

Cheaper partial candidates are early archive/parent filtering and returning/reusing the row read during idle-release. Both remove work, but neither eliminates history demand for get/visibility nor fixes whole-store child lookup. Choose them only as clearly labeled interim steps.

Expected contracts after the structural fix:

- A valid cold or warm directory page opens zero runtime session handles and reads zero transcript commits.
- Archive/pin writes and row refresh read zero unchanged transcript commits.
- A root with no children does not enumerate unrelated rows to prove that fact.
- Headless visibility reads parent/root identity, not full SessionInfo history.
- Actual navigation/snapshot still reads and projects the selected conversation accurately.

## Isolated demo seam for follow-up

No demo or production mutation was made. Use a new experiment directory such as `packages/lab/src/sidebar-demand/` after candidate selection, with its own page and fixture transport. Do not repurpose the already dirty sidebar experiments or connect it to `window.nyte`, a real profile, real host, or user session store.

Keep the Node benchmark as the real-store reference. The browser lab page can consume its JSONL results and demonstrate demand through a synthetic transport; do not label browser fixture timings as real SQLite performance. An isolated temp-only runner can supply freshly measured files when needed.

Show the same 180 synthetic rows in both modes, with controls for missing persistent cache, valid persistent cache, warm state, history size, active attachment, and intentional versus leaked preload. Display store calls, distinct histories, commit rows/bytes, detail requests, and event-loop/frame stalls separately. Demo controls should archive one row, focus/pointer-down on action buttons, hover for 50 ms, query an empty child list, and open the actual thread.

Compare current demand against the candidate directory/control contract. Opening a thread must still show the same transcript; archiving should change one row without loading a conversation. Demonstrate caches honestly: today's warm local list already has zero history reads. The improvement to prove is removal of unnecessary metadata/ancestry/history demand and all-row validation, not a fabricated "180 full scans every click" baseline.
