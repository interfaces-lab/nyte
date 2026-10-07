# Opus audit of the performance demos

Post-audit correction: the user rejected deleting useful hover prewarming. Direct Cursor source inspection confirmed `onMouseEnter -> preloadComposerHandle(composerId)`. The complete sidebar deletion described in this historical audit has been reverted, including neighbor warming, and is not part of the committed changes. The Git count-read deletion and lab corrections remain. See [the Cursor correction](research/cursor.md#correction-hover-prewarming-is-present).

Auditor: Opus, independent. Scope is the untracked `packages/lab/performance/` tree at HEAD `7871d56a`. Research was based on `b9792d38` plus a dirty tree. This started as a report-only audit. After the user authorized implementation, I edited the lab files and deleted preloading in `packages/app/src/chrome/sidebar.tsx`; see "Changes made after authorization". Temporary checks lived in `/tmp/opus-audit/`.

Principles loaded: explain the number, prove it works, test behavior, boundary discipline, subtract before you add, redesign from first principles, and the architect design red flags (hand-synced list, two ways to do one task). Skipped: idempotency and shared-state references (the demos add no writers), legacy-API migration, experience first, reader-load nits.

## Change and integration radius

- Added: `directory.ts`, `git.ts`, `git-manifest.ts`, `tsconfig.json`, three Markdown files, `results/*.json`, `research/`. Nothing else in the dirty tree belonged to the audited work. My later preload deletion in `sidebar.tsx` is listed under "Changes made after authorization".
- Nothing imports these files. They sit outside `packages/lab/tsconfig.json` (`include: ["src"]`), `tsconfig.node.json`, the Vite build and `turbo typecheck`. Root `oxlint .` and `oxfmt --check` do cover them.
- Re-ran scoped `tsc -p packages/lab/performance/tsconfig.json`, oxlint and oxfmt. All pass.
- Runtime safety holds. Fixtures go in `mkdtemp` and get removed in `finally`, and no temp directories were left behind. Git runs through `sanitizedGitEnv` (`host/src/tree-snapshot.ts:54-70`), which sets `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM`. `git config` writes only to the temp repo. The SDK's `streamFn` throws, so no model work runs, and no user data is touched.
- Drift: HEAD differs from `b9792d38` only in `7871d56a`, which touches workbench files. `workbench.tsx:165-175` has shifted to about `:173-177,212`, and the claim still holds. I spot-checked `reads.ts`, `nyte.ts`, desktop `host.ts`, `sidebar.tsx`, `router.tsx`, `live.ts`, host `runtime/index.ts` and host `git.ts`. Their cited lines still match within a few lines. Every one of those files is uncommitted user work, so these references will keep drifting. Don't treat them as stable anchors.

Both default demos reproduce. Every directory counter and both Git byte counts (696,060 and 3,867) match the recorded JSON exactly. Wall times differ, as expected. Fixture OIDs differ between runs because commit dates aren't pinned, and nothing claims they are.

## Verified defects in the added code

| Sev | Where | What | Principle | Change |
| --- | --- | --- | --- | --- |
| Medium | `directory.ts:155-181`, `README.md:18` | The query selects `n.oid` from `objects`, not the ref's oid. A dangling fact ref therefore reads as "no fact". I checked this in a temp run. With the archived blob missing, the fact query lists the archived session as active. Core drops it with a `CorruptSession` warning (`reads.ts:269`). A hash or kind mismatch makes `fact()` throw and fails the whole list, while core isolates one session. The README says bodies "pass core shape/hash validation", which suggests boundary parity that doesn't exist. | Boundary discipline | Also select `nr.oid`/`ar.oid`/`pr.oid`/`parentr.oid`. In `fact()`, throw `CorruptObject` when the ref oid is set but the object is missing. Wrap each row the way `reads.ts:267-273` does. Add one dangling-`archived` assertion against `client.sessions.list()`. If you skip that, delete the validation sentence and list the difference as a limitation. |
| Medium | `README.md:22-28` | The table leaves out `core-new-sdk-persistent-listings`: 180 opens, 1,663 SQL calls, 0 commits, about 8.4 ms. That's the restart case once the durable listing from `a3536dc2` exists. The "1 vs 4,557" headline compares against a store with no listing rows. A warm core list took 1.9 ms this run and the fact query took 2.5 ms. | Explain the number | Add the fresh-SDK row. Say that history reads remain only for missing or invalidated rows. Show the warm timings beside each other or drop timings everywhere. |
| Low | `directory.ts:333-363`, `README.md:30` | The checks for rejected CAS, repeated archive and archive visibility can't fail because of a projection defect, since no projection exists. The query reads authoritative refs live. The CAS check exercises the existing `SqlStore` CAS. Repeated archive tests core's existing idempotency (`nyte.ts:350-359`). | Test behavior | Relabel these as checks of existing store and SDK behavior. Don't present them as evidence that a transaction-maintained projection stays consistent. |
| Low | `git.ts:87`, `git.ts:181` | Byte equality compares two runs of the same `git show <oid> -- <path>` (`host/src/git.ts:563-574,633`). It shows that path filtering leaves the command unchanged. `git.ts:181` checks a field on an object the demo built itself. The meaningful check is the one comparing the manifest to backend files (`git.ts:187-190`). | Test behavior | Keep these as sanity checks. In the README, lead with the manifest-to-backend parity and stop calling byte equality proof of a correct separate path. |
| Low | `git-manifest.ts:7-33,48-66` | It copies the hardening flags from host `runGit` (`host/src/git.ts:69-80`) and reimplements `nameStatus`/`parseNameStatus` (`:481-535`), supporting only `M`. Two hand-synced lists. | Two ways to do one task | Fine for a lab. Under the README's "essential caller change", say that production should expose the existing `scopeRead().files`, not port this parser. |

All five are addressed in the lab tree. See "Changes made after authorization" below.

## Evidence chain: what follows and what doesn't

1. **The directory demo doesn't support the chosen production design.** It proves that name, archive, pin and parent are history-independent. It also shows the actual waste: `core-list-after-archive` walks 256 commits to rebuild the archived row and then filters it out (`reads.ts:247`, then `:249`). The demo itself reads authoritative refs live and keeps no derived state. That's close to candidate 1, which `FINDINGS.md:94` rejects, not the durable projection that `:95` chooses. The case for a projection rests on preview, activity and all-head status, and the demo measures none of them.
2. **On the Git side, acquisition dominates, not parsing.** Default fixture: a full synchronous parse of 180 files took 5.4 ms (6.5 ms recorded). The baseline read took 459 to 652 ms, almost all of it host subprocess work. Only the 10.5 MB counterexample shows a 42 to 44 ms parse, measured in Node, not in a renderer. No FPS or renderer jank claim follows from any of these numbers.
3. **Some cited evidence isn't reproducible from the tree.** `FINDINGS.md:63` (real WorkerStore; attached archive reading the history three times) comes from `/tmp/nyte-sidebar-probe.ts` (`research/nyte-sidebar.md:13`). That's outside the repo and will disappear. `directory.ts` uses direct `SqlStore`, not WorkerStore. Fix this by copying the probe into `research/` or marking those claims as not reproducible from this tree.
4. **Correct and still standing:** the cold list counts, the warm list's zero commits, the 256-commit rebuild after archiving, manifest bytes without patches, selected and full patch sizes, and the huge-file counterexample (selected equals full, 10,555,715 bytes, recorded JSON only).

## Production design risks (only the P1 row-preload deletion is implemented)

**P1. Delete unjustified demand before adding durable state.** Each step below is small, and each can be measured with the existing `directory.ts` counters:
- Delete whole-row warming (`sidebar.tsx:1637-1638`) and hover preload (`:566-571`). FINDINGS agrees on this. Done; line numbers are from before the change.
- After `setArchived`, `refreshRow` (`desktop host.ts:878,2154-2163`) calls `sessions.get`, and that always runs `readSession` (`nyte.ts:323-329`). The host already knows the fact it just wrote.
- `rowHolds` (`reads.ts:81`) treats any ref event, including `refs/facts/*`, as a full invalidation. For events that only touch facts, re-read the four facts and patch the row.
- On a cache miss, apply the archive and parent filters to facts before `readSession`. The facts are already read separately at `reads.ts:225`. This helps child, root and headless lists. It doesn't help the desktop sweep, which uses `includeArchived: true` (`host.ts:2097`).

Open question: does keeping the "maximum-timestamp preview" require a full branch walk on every append? If it does, that's the real argument for a projection, and it needs its own measurement.

**P2. Display state must not authorize release.** `releaseSessionIfIdle` (`host.ts:1346-1357`) currently decides from `sessions.get` plus pending and jobs reads. If `refreshRow` moves to a compact row, the release path has to keep its authoritative read. Add a test where an archived row with a live child or a pending job is not released.

**P3. Git demand still fans out without bounds.** `diff({paths})` repeats `rev-parse` and `diff-tree` on every call and runs `Promise.all` over the files (`host/src/git.ts:620-652`). If each visible file triggers its own request, N requests run N discoveries. Two fixes: batch the demanded paths, and bound concurrency in host `diff` now, which is independent of any manifest work. Working scopes already have metadata in `VcsSnapshot` (`change-scopes.ts:199-218`). `changes-panel.tsx:291-301` passes all working paths, so the working-scope fix is "pass demanded paths" and needs no new operation. Only commit and branch scopes need a new metadata read. Open question: can `--numstat` feed the rail badge (`workbench.tsx:174-177,212`)?

**P4. Size limits.** `runGit` concatenates output with no cap (`host/src/git.ts:94-109`). The demo's `maxBuffer: 128 MiB` is a fixture limit, not a policy.

## Not verified

- WorkerStore, PostgreSQL, desktop or renderer behavior, IPC, FPS.
- Subfolder `cwd`, renames, binaries, merges.
- Rows with `refs/deleted` (core doesn't filter them either).
- Cursor and Pierre reports. Research timing files beyond inventory.
- I didn't re-run the huge-file case. I didn't run Git at the 512-file cap. Whether about 514 concurrent `git` processes, each with three pipes, hit EMFILE or EAGAIN at default limits is an open question.
- Whether the P1 deletions get close to the projection's benefit. That's untested.

Confidence: high on the verified defects and on evidence points 1, 2 and 4. Medium that P1 is the right first slice. Low on fan-out limits.

## Verdict

**Demos: keep.** They're isolated, safe, they reproduce, and they assert real behavior. The four corrections listed under "Changes made" are now applied.

**Production: no-go on the transaction-maintained directory projection as currently argued.** This evidence doesn't justify it. Row and neighbour preloading are now deleted (see below). Go ahead with the remaining deletion slices: the `refreshRow` hydration after archive, fact-only invalidation, and filtering facts before hydration. Also go ahead with bounded host Git concurrency and demanded paths for working scopes. Each needs a behavioral test and the existing counters. A commit-scope metadata read can proceed to design only with batched demands, byte caps and cancellation. Reconsider the projection only if preview and activity, measured after those deletions, still need history walks.

## Changes made after authorization

The lab demos (audit findings applied):
- `directory.ts`: the query now selects each fact's ref oid. `fact()` throws `CorruptObject` when a ref names a missing object or a non-blob, and `factDirectory` drops that row, the same way `reads.ts:267-273` does. A new unmeasured check runs after all measured phases. It creates one session with a dangling `archived` ref and one with a tampered name, then asserts that core list and the fact query both return the 180 healthy rows. A temp mutant restoring the old "missing object means absent" logic fails this assertion. The measured counters are byte-identical to `results/directory.json`.
- `results/directory-boundary-check.json`: new run of the current script. I left existing result files alone.
- `README.md`: added the fresh-SDK row and an explanation of cold vs persisted listings. Relabeled the CAS and idempotency checks, scoped the Git byte-equality claim, noted that `readGitManifest` is a lab copy, noted that acquisition dominates parse time, revised recommendation 2 to put deletions first, and marked recommendation 1 done.
- `FINDINGS.md`: added a drift note for HEAD and a note that the `/tmp` probe isn't reproducible from the tree. Candidate 2 is now "proposed, unproven" and the fact-only deletions come first. Recorded the sidebar change.
- I made no code change to `git.ts`, `git-manifest.ts` or `tsconfig.json`. Their findings are about wording.

The production slice, `packages/app/src/chrome/sidebar.tsx`, is deletion only, and the user's pagination edits are untouched:
- `SessionRow`: removed `warmTimer`, `cancelWarm`/`warmSoon`/`warmNow`, the unmount cleanup, `onPointerEnter`, `onPointerLeave`, `onPointerDownCapture`, `onFocusCapture`, and the `onHover` prop. These fired for the whole row, including the Pin and Archive buttons and keyboard focus moving to them.
- `Sidebar`: removed the `onHover` wiring to `router.preloadRoute`, plus the effect that preloaded the active session's two neighbours on every active-session, view or working-set change. That made the `useEffect` import, its `no-restricted-imports` waiver and the `useMountEffect` import unused, so they're gone too.
- What each removed preload could request: the session route's `beforeLoad` and `warmThread` (`router.tsx:429-440`, `live.ts:508-552`). `beforeLoad` goes through `readRouteSession`, a `client.query` with `staleTime: Infinity`, so `sessions.get` (which always runs `readSession`, `nyte.ts:323-329`) runs only when that session's query isn't cached. `warmThread`'s children, jobs, catalog, mention-file and snapshot requests are also query-cached or skipped for observed sessions. So the deletion removes potential demand. It doesn't remove one guaranteed history read per hover, and I didn't count how often those caches missed.
- Preserved: `Row.Primary` click and aux-click still call `showSession`, which navigates. The route loader still runs `warmThread`. The Archive and Pin handlers are unchanged, including `removeSession` for the active row. The removed code had no part in keyboard access. Archive still only calls `sessionActions.archive`, with no stop.

Checks: scoped `tsc` for the lab passes. `packages/app` `tsc --noEmit` passes. oxlint and oxfmt pass on all touched TS files. Both default demos re-ran clean, with no leftover temp directories. No sidebar unit test exists, and I didn't add one. The proof is structural: `sidebar.tsx` no longer contains `preloadRoute` or `warmThread`.

Remaining risks:
- A first open of an unvisited chat may now wait for uncached `beforeLoad` and loader work. The route keeps the current screen meanwhile.
- `desktop/benchmark/navigation.spec.ts` ("opens an unvisited session tab") used two sessions. The neighbour effect likely prewarmed the destination, so its latency baseline may shift upward. I didn't run it.
- The agents tray (`conversation/tray/agents.tsx:250-252`) still warms on hover, focus and pointer-down. The router keeps `defaultPreload: "intent"`. Both are outside my ownership.
- Not yet implemented: the `refreshRow`/`rowHolds`/filter-before-hydrate deletions, release-path tests, all Git production work, and any directory projection.
