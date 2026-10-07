# Nyte Git lag investigation

## Scope and verdict

Investigated the current dirty working tree at HEAD `b9792d38322afe66b06923a8c2b1a24071b091a6`, on 2026-10-07. This report concerns Nyte, not upstream Pierre research. No production or existing checkout files were edited during the investigation. Synthetic repositories and scripts live under `/tmp`.

**Rethink the read shape. CodeView already virtualizes and Nyte already supplies a highlight worker pool. The expensive work happens before virtualization: whole-scope patch fetching, per-file Git processes, synchronous parsing and hashing, and whole-scope bookkeeping.** A metadata manifest followed by explicit selected-file patches is the smallest useful redesign. A worker alone would move CPU work but leave unnecessary Git work and payloads intact.

Loaded TypeScript and principles-review skills, plus the relevant references: redesign from first principles, subtract before you add, boundary discipline, model the domain, fix root causes, experience first, prove it works, explain the number. Skipped mutation/idempotency/shared-writer and migration reviews as primary findings; this is a read-performance investigation, not a write redesign. Used the unslop writing skill.

Installation: `bin/nyte --version` reports `0.0.16-dev.4`. Matching installed docs were absent from the verified native cache and `share/nyte` candidates. Older installed docs exist, including dev.1, but were not substituted. Read the checkout kernel contract reference separately.

## Measured evidence first

Artifacts retained:

- `/tmp/nyte-git-bench.mjs`, runnable with `pnpm exec node --expose-gc /tmp/nyte-git-bench.mjs` from this checkout. Imports the real dirty `packages/host/src/git.ts`, real Nyte converter/digest, and installed `@pierre/diffs` 1.4.1. No app/server launched.
- `/tmp/nyte-git-bench-results.json`, all per-phase measurements.
- `/tmp/nyte-git-bench.log`, raw run output.
- Repositories under `/tmp/nyte-git-bench-Zwd1gK`, each with two real commits.
- `/tmp/nyte-git-parse-profile.mjs`, `/tmp/nyte-git-parse.cpuprofile`, `/tmp/nyte-git-parse-profile-summary.json`.
- `/tmp/nyte-git-raw-2000x40.patch` and `/tmp/nyte-git-raw-1x100000.patch`, actual bulk Git output for follow-up.

Environment: Apple M4 Pro, arm64, Node v26.10.0, pnpm 12.9.1, Apple Git 2.54.0. Three trials per scenario, sequential phases. Every file replaces all original lines with changed lines. Files are `.ts`, all modified, ASCII. No rename, binary, merge, untracked, network, React mount, highlight worker startup, or Electron IPC benchmark. OS caches were not cleared. Values below are medians with min/max where shown, not end-to-end desktop latency claims.

### Actual sizes and counts

| Files | Replaced lines/file | Changed lines | Raw per-file patches, bytes | JSON full result, bytes | JSON metadata, bytes | JSON selected result, bytes | Real host full Git processes / peak active |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 40 | 8,000 | 385,100 | 419,001 | 4,501 | 4,191 | 102 / 100 |
| 1,000 | 40 | 80,000 | 3,851,000 | 4,190,001 | 45,001 | 4,191 | 1,002 / 1,000 |
| 2,000 | 40 | 160,000 | 7,702,000 | 8,380,001 | 90,001 | 4,191 | 2,002 / 2,000 |
| 1 | 100,000 | 200,000 | 10,555,699 | 11,155,807 | 46 | 11,155,807 | 3 / 1 |

Each cold converter invokes `parsePatchFiles` once per unique per-file patch and produces exactly the file count above. The fixture makes every patch unique through its filename. The parser-only phase asserts one parsed file for every patch. The real host asserts exact file counts and exact added/removed facts. Selected-file patch bytes equal the corresponding full-diff patch in all trials.

A selected real-host read always runs 3 Git commands: repository root discovery, full commit name/status discovery, and one `show`. Metadata discovery runs one `diff-tree`. The raw JSON phase stats record zero *instrumented host spawns* for metadata because that helper uses `execFile` rather than the patched `spawn` export; zero does not mean no Git command. Full-host spawn counts and peaks are instrumented actual child lifetimes, not estimates.

### Discovery versus patch work

Milliseconds, median [min, max].

| Files × lines | Metadata-only discovery | Selected real-host diff | Whole-scope real-host diff |
| --- | ---: | ---: | ---: |
| 100 × 40 | 67.07 [42.91, 93.46] | 172.60 [135.36, 232.01] | 3,231.17 [2,500.28, 3,288.57] |
| 1,000 × 40 | 53.72 [16.91, 58.34] | 179.54 [48.13, 207.56] | 27,649.14 [26,480.98, 33,672.93] |
| 2,000 × 40 | 40.37 [18.58, 62.53] | 141.85 [47.85, 216.68] | 46,076.53 [20,766.67, 59,047.13] |
| 1 × 100,000 | 15.27 [14.13, 17.68] | 98.25 [94.93, 112.40] | 96.20 [91.65, 115.61] |

The many-file case spends most measured time inside the real host operation, which launches one Git process per file. The counters confirm the fan-out. These unusually large and noisy subprocess timings should not become a general speedup headline. Child CPU, scheduler pressure, and concurrent machine activity were not separately profiled. The causal result is narrower and solid: explicit selection removes N−1 patch commands and N−1 returned patches; it does not remove full name/status discovery. A giant selected file still has a giant patch.

### Synchronous parse timeline

Milliseconds, median [min, max]. These phases execute in one Node event-loop turn using the same pure functions Nyte calls from renderer render. A scheduled `setImmediate` cannot run until each phase completes. This is evidence of synchronous blockage, not a Chromium frame measurement.

| Files × lines | Nyte hash all patches | Installed parser only | Real converter cold, includes hash | Cold with every file collapsed | Converter warm | Selected converter |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 × 40 | 0.99 [0.89, 3.90] | 7.84 [4.46, 9.08] | 9.09 [8.76, 9.54] | 11.71 [10.73, 14.25] | 0.48 | 0.15 |
| 1,000 × 40 | 7.58 [4.89, 9.31] | 30.94 [17.95, 32.84] | 27.81 [25.65, 34.81] | 62.06 [24.24, 65.42] | 3.50 | 0.08 |
| 2,000 × 40 | 9.16 [8.62, 16.56] | 33.88 [32.69, 111.15] | 51.88 [47.82, 147.32] | 49.09 [46.13, 77.55] | 2.53 | 0.05 |
| 1 × 100,000 | 13.35 [11.84, 13.42] | 38.87 [38.25, 39.49] | 55.57 [52.38, 56.50] | 55.04 [51.71, 55.53] | 1.70 | 56.16 |

The parser-only and converter phases run separately and sequentially, so do not add their timings as if both execute in that order in the app. Warm converter measurements demonstrate the existing cache works. Collapse does not prevent cold parsing.

For the 100,000-line case, cold converter callbacks blocked the event loop for 52.42–56.55 ms. Nyte's separate panel review digest adds another traversal. Raw JSON stringification was 5.41 ms median, JSON parse 9.11 ms; for 2,000 files these were 8.12 and 7.10 ms. `structuredClone` was 1.04 and 2.44 ms respectively. These are isolated serialization costs, not measured Electron contextBridge/IPC overhead.

A focused 100-microsecond CPU-sampling profile ran 20 cold converter passes over each of the 2,000-file and giant-file bulk patches. Top sampled self-time: Nyte `patchDigest` 1,096 ms; text encode/decode 273/269 ms; Pierre `detachString` 214 ms; GC 201 ms; `findLinePrefixIndex` 103 ms; `splitWithNewlines` 97 ms; `_processFile` 89 ms. This establishes CPU/string processing in the isolated synchronous converter, not a worker or network wait. Sampling adds overhead and these aggregate self-times are not the unprofiled per-pass latency above. Profile input is bulk `git show` split into file patches, not the previous per-file `git show` output. Keep that distinction when reproducing sizes.

## Exact data flow

```text
ChangesPanel / collapsed workbench stats / scope menu
  -> useVcsDiff, all paths or no path restriction
  -> desktop preload IPC OR HTTP client
  -> SDK workspace.vcs.diff
  -> host root discovery + scope file discovery
  -> Promise.all, one Git patch command per file
  -> host jsdiff facts parse, entire reply
  -> ChangesPanel maps + review digest
  -> ChangesStack useMemo, eager parse/hash of every patch
  -> CodeView virtualization + shared highlight workers
```

Local desktop is not implicitly an HTTP client. `packages/app/src/nyte.ts:19-25,50-52` selects the installed bridge; `packages/desktop/src/preload/index.ts:65-74,133-143` invokes the workspace operations through IPC; `packages/desktop/src/main/index.ts:392-395` routes to `ipc-call.ts:17-23`; `packages/desktop/src/main/host.ts:967-984` validates input, resolves the owner and trust, then dispatches. Backend creation is `host.ts:1675-1682`. `packages/core/src/kernel/sdk/nyte.ts:896-918` resolves the workspace and calls the backend. Host parsing therefore executes in the Electron main process for this local path, not in a renderer worker.

HTTP clients use `packages/client/src/index.ts:192-250,254-278,406-410`: whole JSON response parsing, envelope validation, operation schema validation. `packages/server/src/index.ts:480-487` stringifies the complete response. Neither this path nor IPC pages the diff result. Protocol `workspace.ts:118-129`, `schemas.ts:1488-1507`, and `operations.ts:264-276` promise patch-bearing arrays. The 1,000-path cap at `operations.ts:111,269` limits explicit input paths, not omitted paths, returned files, bytes, or concurrency. SSE frame limits are not diff-call reply limits.

## Findings, in redesign order

### 1. A file listing and counts require fetching file bodies

Where: `packages/app/src/workbench/changes-panel.tsx:291-303,324-355,373-419`; `packages/app/src/workbench/workbench.tsx:165-175,209-212,610-628`; `packages/app/src/workbench/changes-toolbar.tsx:274-295`; `packages/app/src/workbench/change-scopes.ts:177-195`.

The panel requests all working paths and no paths for a commit. Commit sidebar rows do not exist until all patch bodies arrive. The collapsed project rail fetches the whole worktree diff only to reduce added/removed counts. Opening the scope menu also requests full uncommitted, staged, and unstaged diffs for counts. Its comments correctly say menu reads are on-open, not always-on.

The menu/rail no-path query differs from the panel's explicit path-list key, even when both cover the same files. `queries.ts:542-559` encodes that distinction. Thus the comment that a selected-scope menu read is answered from the panel cache is not universally true. TanStack deduplicates identical keys, not semantically equivalent scopes.

Principle: redesign from first principles. Delete body-dependent count reads. Introduce metadata listing for commit/branch scopes, reuse existing status metadata for working scopes, and request patches only for selection or the visible diff window. Initially show file counts without added/removed counts. If line counts are required, use a separate scope-level `--numstat` read, not patch parsing.

### 2. Host diff fans out without a bound and waits for the last file

Where: `packages/host/src/git.ts:543-608,620-652`; `packages/app/src/queries.ts:564-578`.

`scopeRead` discovers the complete scope before filtering explicit paths. The host then spawns a patch operation per requested file with `Promise.all`, parses every patch, and returns only after all finish. Client batching above 1,000 paths is also parallel, so it adds repeated discovery without bounding total subprocesses. A commit with omitted paths bypasses batching entirely. Measured peak children were 100, 1,000, and 2,000.

Principle: subtract before you add. Remove eager all-file body requests first. Selected-file reads can already use the real backend unchanged. For a later visible-window batch, keep concurrency bounded in the host. If an export really needs the full scope, evaluate one aggregate Git command with correct per-file partitioning rather than N Git launches. Do not claim limiting concurrency alone makes a listing demand-driven.

### 3. The renderer parses everything before CodeView gets its virtualized items

Where: `packages/app/src/workbench/changes-stack.tsx:131-132,223-229`; `changes-stack-code-view.ts:23-42,116-133`; `changes-panel.tsx:411-419`; `changes-viewed.ts:68-84`; `packages/app/src/conversation/diff-view.tsx:310-317,349-365,413-425`.

Nyte eagerly builds `FileDiffMetadata` for every source in React `useMemo`. Even collapsed files go through `parseDiffs` before their collapse flag is attached. Review marks hash every section; parsing hashes each cold patch again. Transcript `DiffView` also synchronously parses its entire patch and maps every parsed entry to `FileDiff`; raw fallback emits the full text into a `pre` without a local size limit. Transcript mounting constraints can reduce how often that runs, but do not bound the size of an individual receipt.

This is **not absent virtualization**. Installed `packages/app/node_modules/@pierre/diffs/dist/components/CodeView.js:506-508,1584-1642` computes viewport work and virtualized instance setup. `packages/app/src/pierre-worker-provider.tsx:9-24,63-66,126-129` shares a bounded 2–6 worker highlight pool with count-bounded AST caches and a 30-second idle lifetime. That provider does not wrap the synchronous parse call in a worker. The converter's cache is pruned at `changes-stack-code-view.ts:159-169`; it is not an ever-growing history leak, but a single current scope can still be arbitrarily large.

Installed parser evidence only: `.../dist/utils/parsePatchFiles.js:15-37,51-59,163,290,304-315` splits files/hunks/lines and realigns changes synchronously. It returns metadata directly. No upstream design claim is needed.

Principle: fix root causes. Feed the viewer demanded bodies rather than the full scope. Preserve existing virtualization and workers. Move only remaining expensive demanded parsing off-thread when warranted, with request identity and stale-response dropping. Compute patch identity once where bytes enter, then reuse it for view/cache/review state. Do not add another cache of every full commit.

### 4. Payload limits are applied in the wrong place or not at all

Where: `packages/host/src/git.ts:47,91-106,423-451,634-647,675-683,809-823`; protocol citations above.

Tracked patches and commit patches have no byte cap. The 2 MB constant bounds untracked preview and returned content sides, not tracked diff output. `runGit` buffers every chunk, concatenates it, and decodes a full string. `contents` reads full blobs/files before truncating the returned text, and `runGit` decodes even blob reads that only need bytes. Measured tracked commit patch was 10.56 MB, despite the preview constant.

Principle: boundary discipline. Bound bytes during collection, not after allocation. Model large/binary/too-large as explicit outcomes, keep exact metadata available, and offer an intentional raw export separately from the interactive read. A selected-file demo does not solve giant selected files; a production seam needs a body budget and a way to open externally or fetch bounded hunks. Avoid misclassifying truncation as binary.

### 5. Status polling and broad invalidation redo repository discovery

Where: `packages/app/src/queries.ts:449-457,611-617,624-632,690-696`; `packages/app/src/live.ts:212-221,258-281`; `packages/host/src/git.ts:293-303,313-326,334-383,386-407,1339-1348`; `packages/host/src/paths.ts:157-160`; `packages/app/src/screens/workspace-context.tsx:22-37`.

The shared snapshot query polls every five seconds. Consumers include workspace branch chrome, rail, files, and changes. Sharing prevents one request per hook at the same instant; it does not create one timer owner, and separate windows still have separate query caches. Do not multiply hook count into an unsupported scan count.

Every snapshot runs status with all untracked paths, full staged index listing, branch-base reflog/default-branch resolution, hashing, and synchronous filesystem metadata reads for every changed path. `entryAt` uses parent `statSync` plus file `lstatSync`, blocking the host main thread in desktop. Every ordinary VCS call resolves repository root again. Each explicit path batch rediscovers the full scope. Successful tool results, including tools with no known file edit, terminal runs, saves, and manual refresh invalidate status and mention-file discovery. Any changed working-tree revision keys a new whole-scope patch read.

Existing mitigation: live observer recovery tracks sequence numbers and avoids repeating side effects for identical recovery snapshots at `live.ts:258-281`. Session observers are shared by session, not an obvious subscription leak.

Principle: model the domain. Give repository metadata one owner with immutable commit identity and mutable worktree revision. Cache root and base discovery against appropriate repository/ref changes. Coalesce dirty signals; poll only as a fallback, retaining external-editor detection. Preserve the full fresh mutation revision check inside the mutation lock at `git.ts:906-924`; weakening write safety is not a read-performance fix.

### 6. File-tree UI bounds do not bound discovery or model work

Where: `packages/app/src/workbench/files-panel.tsx:123-133,226-258,285-314`; `changes-sidebar.tsx:205-271`; `file-tree.tsx:17-40`; `packages/host/src/workspace-backend.ts:18-21`; `packages/host/src/mention-files.ts:53-71`.

File listing discovers up to 100,000 ripgrep paths, adds ancestors, sorts the complete set, and only then slices to 5,000. It is therefore wrong to call the explorer reply wholly unbounded; there is a 5,000-entry cap, but discovery/transformation is much larger and every broad invalidation reruns it. That mention-oriented cap is also not a complete explorer contract.

The files model is created even when its explorer sidebar is closed. `resetPaths` shares an effect with reveal selection, so revealing a file can reset the complete paths despite unchanged discovery. Changes sidebar builds ancestor sets and updates Git status in `useLayoutEffect`; its ancestor/batch effect also depends on `activePath`, so ordinary scroll selection can redo whole-tree reconciliation. `changes-stack.tsx:254-261` linearly searches file tops during scroll. The wrapper's mutation observer rescans rendered rows and calls layout reads to label the menu. It does clean up at `file-tree.tsx:45-48`; no leak was established.

Dirty-tree mitigation already present: changes sidebar mounts only when `fileTreeVisible` at `changes-panel.tsx:720-729`; explorer DOM mounts only when sidebar visible at `files-panel.tsx:509-542`; diff stack mounts only when the panel is visible at `changes-panel.tsx:730`. Workbench tabs themselves stay mounted and hidden at `workbench.tsx:553-585,654-655`. Disabled queries still observe cache updates and can redo derivations, but this is not every hidden tab rendering a CodeView.

Principle: subtract before you add. Separate selection/reveal effects from path replacement; separate active selection from sidebar structure reconciliation. Use already-known row identity for accessibility labels instead of repeated geometry scans if the dependency allows it. Later give explorer a directory listing contract rather than rebuilding it from mentions. These are secondary to whole-scope Git body work and were not individually timed.

## History and rationale

- `f78f535e`, 2026-09-20, made VCS an SDK primitive across ten operations and deleted desktop-specific routes. Blame attributes per-file patch fan-out and host facts parsing to that commit. Good contract unification; the original diff contract couples list discovery to body materialization.
- `e96846fe`, same day, hardened sanitized environment, literal paths, helper suppression, trash behavior and mutation revision checks under a lease lock. Retain these protections in a manifest/demo; do not optimize them away.
- `aac28ed5`, 2026-09-20, release body names memory/power work and cache bounds. Blame attributes CodeView converter/cold parse cache to this commit. Cache/virtualization reduces repeated rendering but does not defer first parse.
- `5e91033c`, 2026-09-21, performance work. Blame attributes non-commit `gcTime: 0` at `queries.ts:581` to it. This deliberately releases inactive changing-revision bodies; do not report every past worktree revision retained forever.
- `7cd95100`, 2026-09-27, moved renderer to app and kept visited workspaces mounted to preserve terminals/browser pages. Includes same-scope placeholder retention and >1,000-path batching. Placeholder rationale explicitly avoids rebuilding every file twice on a revision refresh. Batching addresses the input cap, not total concurrency or body demand.
- `b6986047`, 2026-10-01, interaction audit. Blame attributes the tree MutationObserver menu labeling to this accessibility work. Preserve the label when replacing its geometry-based implementation.
- Current uncommitted `git.ts` changes move all VCS operations to repository root to fix subfolder path agreement. The extra root lookup is real but removing it blindly would undo correctness. Current dirty sidebar changes improve mount-on-demand. Report line numbers describe the working tree, not solely HEAD.

## Simplest implementation/demo seam

Start with commit review, the user's case. Avoid a repository watcher or new worker system in the first demo.

1. Create a real temporary two-commit repo. Pin the second commit OID.
2. Baseline: `createGitVcs().diff({ cwd, scope: { kind: 'commit', oid }, ignoreWhitespace: false })`.
3. Manifest candidate: one sanitized `git diff-tree -r --root --no-commit-id --name-status --find-renames --no-ext-diff --no-textconv -z <oid>`. Report paths/status/rename origin, no patches. For a first demo limit to regular single-parent modified text files and state limitations.
4. Explicit demand: call the existing real backend with `paths: [selectedPath]`. Assert its patch, status and facts equal the corresponding baseline result. Assert every fixture file appears in metadata. Separately time metadata discovery and selected body work; selected backend still repeats name/status discovery.
5. Parse demanded patches using installed `@pierre/diffs` pure parser. Count input patches, bytes and parsed files; do not load React/CodeView to measure pure parsing.

Production starting points: expose the metadata-only result already computed by `scopeRead` at `git.ts:543-618`, or factor discovery so listing and patch reads share it. Add a small protocol metadata operation rather than transmitting empty `patch` strings or fake `VcsDiff` placeholders. Keep status/metadata separate from a discriminated body state such as pending, text, binary or too-large. The core backend and dispatcher seams are `packages/core/src/kernel/sdk/types.ts:344,436-440`, `nyte.ts:896-918`, `dispatch.ts:54-56`; transport seams above then follow the same operation table.

For the first UI proof, show manifest sidebar plus only the selected diff. If preserving stacked review later, demand a bounded visible-file window and retain metadata headers for the remainder. A placeholder per file must not be passed through the existing eager parser. Defer exact line totals and viewed freshness for unloaded bodies or fetch genuine cheap metadata; do not secretly fetch all patches to preserve count labels.

Acceptance evidence should distinguish: time to file list, time to selected patch, number of actual patch commands, bytes crossing the interface, synchronous parse time, and exact equality. A one-file giant patch should still expose the need for byte/hunk bounds rather than disappear from the benchmark.

## Read-only accounting and remaining limits

Before status recorded 370 entries. After status included two additional modified paths, `packages/desktop/src/shared/ipc.ts` and `packages/tui/scripts/build-binary.ts`, from concurrent checkout activity. No investigative write command targeted the checkout; scripts/report/fixtures were written only to `/tmp`. Status snapshots are retained at `/tmp/nyte-git-status-before.txt` and `...-after.txt`. Do not interpret their difference as an unchanged checkout claim.

No live app, browser, dev server, production mutation, or repo commit was run. This investigation measures real Git reads and pure parser execution, not a complete desktop interaction. Secondary tree, subscription scheduling, schema validation, and actual IPC costs remain unmeasured. All primary eager-work findings are confirmed in source and the synthetic path. Follow-up implementation is intentionally confined to an isolated lab demo.
