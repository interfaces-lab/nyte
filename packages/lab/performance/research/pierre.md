# Pierre research for Nyte

## Scope and revision

Read-only source review of `https://github.com/pierrecomputer/pierre`, cloned to `/tmp/nyte-pierre-research` outside the Nyte checkout.

- Exact Pierre commit: `d302ea0aad461a2a9ee6de5916e3482bced946e5`.
- Commit timestamp: `2026-10-06T17:10:16+08:00`.
- Subject: `[highlights] Fix slop tests and docs (#1177)`.
- Source versions: Diffs `1.5.2`, Trees `1.0.0-beta.6`.
- Nyte base commit: `b9792d38322afe66b06923a8c2b1a24071b091a6`. Nyte has substantial pre-existing uncommitted work. Local references below describe the files actually present, not pristine HEAD.
- Nyte actually installs Diffs `1.4.1` and Trees `1.0.0-beta.4`. Verified package manifests and resolved ESM entrypoints under `node_modules/.pnpm`. Do not assume every upstream implementation detail is in Nyte's installed release.
- No repository edits, dependency installs, builds, dev servers, or performance benchmarks. Only the temporary clone and this report were written. Git LFS was unavailable, so checkout finished with LFS filters disabled. LFS objects remain pointers; the inspected source files are ordinary text. The temporary clone's final status was clean with those filters disabled.

Evidence links below pin the exact Pierre commit. Local Nyte paths use current working-file line numbers. Claims about performance are mechanism analysis, not measured latency or memory results.

## Bottom line

DiffsHub's useful architecture is a bounded *presentation and scheduling* pipeline, not a bounded total diff load.

It streams complete patch files, parses each synchronously on the main thread, accumulates all parsed files, incrementally appends viewer items, and publishes sidebar changes less often. Workers handle highlighting and intraline comparisons. The viewer limits mounted files and mounted lines separately.

**It still eventually fetches and parses every patch file. One enormous file is buffered until its next file boundary or EOF and then parsed synchronously. The 8 ms budget cannot interrupt that parse.** This is the most important limit to preserve in any discussion of its performance.

Nyte already uses Pierre's `CodeView` for the Changes stack and Pierre Trees for the sidebar. Adding another virtualizer is not the first useful change. Priorities are budgeted acquisition/parsing, revision-safe hydration, fewer whole-list scans on scroll, and smaller or byte-aware caches.

## 1. What is actually in this repository

The root README lists open-source Diffs and Trees. This is not source for Pierre's entire hosted code-review product. The concrete app examined here is `apps/diffshub`, a Next.js patch viewer. Its GitHub access, URL resolution, stream handling, sidebar, and comment UI are app code. The reusable rendering and tree engines are separate packages. [S1, S2]

Relevant tree:

```text
apps/diffshub/
  app/[...path]/                 viewer route
  app/api/diff/route.ts          patch proxy and upstream resolution
  app/api/github-diff-file/      whole-file context endpoint
  components/usePatchLoader.ts  stream, parse, publish, abort
  components/DiffsHubViewer.tsx CodeView options and annotations
  components/DiffsHubFileTree.tsx incremental sidebar model
  components/WorkerPoolContext.tsx worker resource policy
  lib/streamGitPatchFiles.ts     complete-file stream framing
  lib/diffsHubDataAccumulator.ts ids, stats, paths, pending deltas
  lib/githubDiffFileLoader.ts    browser whole-file loader
  lib/githubDiffFileServer.ts    refs, blobs, promise caches
packages/diffs/src/
  utils/parsePatchFiles.ts       patch parser
  utils/parseDiffFromFile.ts     two-text diff generation through jsdiff
  components/CodeView.ts         multi-file virtualization and scroll state
  components/VirtualizedFileDiff.ts per-file line windows and metrics
  components/Virtualizer.ts      alternative observer-based virtualization
  renderers/DiffHunksRenderer.ts plain-first/highlighted rendering
  worker/WorkerPoolManager.ts    queue, deduplication, AST result caches
  worker/worker.ts               Shiki and intraline work
packages/trees/src/
  model/FileTreeController.ts    canonical model and visible rows
  model/virtualization.ts        fixed-height row windows
  render/FileTreeView.tsx        Preact view inside shadow DOM
packages/path-store/src/         private canonical-path engine
```

Diffs depends on Shiki, `diff`, `lru_map`, and HAST serialization. Trees depends on `@pierre/path-store`, theming, and Preact. At this commit the catalog pins `diff` 9.0.0, `lru_map` 0.4.1, Next 16.3.3, React 19.2.7, Preact 11.0.0-beta.0, and Shiki-related packages 4.4.1. Diffs declares Shiki compatibility with majors 3 and 4. The existence of `packages/highlights` does **not** mean DiffsHub's examined renderer uses it; the traced worker imports Shiki. [S2, S3, S10]

## 2. Actual patch pipeline

```text
GitHub/CDN/allowed patch URL
  -> Next /api/diff
  -> browser fetch response.body
  -> TextDecoder + complete-file boundary scanner
  -> synchronous processFile(fileText)
  -> accumulator retains metadata, line arrays, paths, stats
  -> initialItems once, then viewer.addItems(batch)
  -> CodeView mounts visible files and line ranges
  -> immediate plain AST, asynchronous Shiki worker result

accumulator -> separately throttled tree publication
            -> model.batch(add delta) + applyGitStatusPatch
```

### Fetching is app responsibility

`/api/diff` resolves GitHub paths, raw PR diff URLs, and the allowed Tangled domain. Selected example URLs map to hosted CDN patch blobs. These examples are not proof of an unrestricted or identical live-GitHub loading path. Authenticated PR fetching resolves base/head refs and requests a compare diff; the route also has fallback targets. Fetches use `no-store`. Before forwarding, it checks upstream status and diff-compatible content type. Request abort and stream cancellation abort upstream. [S4]

The server pumps chunks using `controller.enqueue`. It does not inspect `desiredSize` or implement a pull-based pump. Therefore distinguish browser file-consumption backpressure from fully bounded end-to-end buffering. The browser awaits each file callback before its next reader read, but the server forwarding loop does not mirror that demand explicitly. [S4, S5]

### Streaming is per complete file, not per hunk or line

`streamGitPatchFiles` incrementally decodes UTF-8, scans `diff --git` boundaries, and awaits `onFileText` for each complete file. It preserves a small scan overlap rather than rescanning the full prefix after every chunk. The current file must remain buffered until another boundary or EOF. Commit metadata is associated with file boundaries. If no Git boundary appears, it returns the entire response as fallback patch text. [S5]

`usePatchLoader` calls `processFile` directly in its client effect. There is no parsing worker in this path. The fallback uses `buildDiffsHubData`, which calls `parsePatchFiles` over the whole buffered patch. A `setTimeout(0)` before this fallback lets the loading UI paint; it does not make parsing incremental. [S6, S7, S8]

### Exact scheduling knobs

| Policy | Implemented value | Meaning |
|---|---:|---|
| Work budget | 8 ms | Checked **after** a completed file parse/append |
| Later viewer batches | 25 files or 100 ms elapsed | Threshold checks happen as files arrive, not an independent publication timer |
| Initial viewer batch | viewport-derived 25 to 96 files, or 500 ms elapsed | Fills sidebar/first view without many tiny startup publications |
| Later sidebar publication | 1,000 files or 1,000 ms elapsed | Separate cadence from viewer append |
| Browser yield | RAF, with 50 ms timeout fallback | Prevents waiting indefinitely for a frame in inactive tabs |

The first tree publication is special; the 1,000-file/1-second limit applies after it has published. Final pending viewer/tree data is flushed at completion. These are cooperative thresholds, not hard deadlines. They neither preempt a large file nor publish a partially received file. [S6]

### It retains the complete parsed review

The accumulator stores every `CodeViewItem`, plus an item-to-file index, paths, navigation maps, and stats. Taking pending items empties only the pending batch, not the complete item list. At the end the loader copies the comment index. CodeView also keeps a record and virtualized instance per item, even when its DOM is absent. This is O(total parsed review data), with viewport-bounded DOM. It is not demand-loaded per selected file. [S7, S12]

Source keys are based on route plus file ordinal in this streaming path. They are not content hashes. Nyte should keep its revision/content-derived identity rather than copying a mutable URL-only identity scheme. [S6, N3]

## 3. Parsing and Git semantics

The reusable parser handles Git/unified patch headers and hunks and returns `FileDiffMetadata`, including old/new line arrays, hunk structure, filenames, change type, object IDs when present, and line counts. `processFile` and `parsePatchFiles` are synchronous functions. Passing old/new texts to `parseDiffFromFile` uses `diff.createTwoFilesPatch` and then the same parser, not a Git subprocess and not a background worker. [S8]

The current parser explicitly detaches retained strings. `detachString` uses reusable UTF-8 scratch storage, with a JSON round trip for surrogate code units, to avoid retaining an entire raw patch backing string through tiny substrings. `processFile` and `processPatch` release an oversized scratch buffer in `finally`. This is a concrete memory detail worth examining against the older installed release. It adds copying work and does not eliminate the parsed line arrays themselves. [S8, S9]

GitHub context loading is distinct from diff fetching:

- Changed and changed-renamed files load both whole sides; old path uses `prevName` when present.
- Pure rename loads only the new file and returns `oldFile: null`.
- Browser loader rejects new/deleted diffs, which do not use this context-hydration path.
- PR context resolution uses the merge base as old ref and head SHA as new ref. Commit context uses the first parent. Compare context reads `base_commit` and resolves the last head commit, with pagination for truncated commit lists.
- Blob contents are read with `response.text()`, then returned to the browser as whole strings. This is lazy context loading, not a range API. [S16, S17]

`FileDiff` ignores loaded results if its target changed, then hydrates the existing partial metadata in place. `hydratePartialDiff` replaces the side arrays and adjusts hunk offsets. It checks required sides/types, but the traced function does not prove that arbitrary fetched text matches the original patch's content. The browser whole-file endpoint request does not include the patch's object IDs. Re-resolving a mutable PR after the initial patch fetch can therefore produce a mismatched pair. Nyte should pin expansion to the same immutable diff revision and handle stale working-tree reads explicitly. [S17, S18]

## 4. Workers and offscreen rendering

### What runs in the workers

The protocol has initialization, render-option updates, file highlighting, and diff highlighting. `handleRenderDiff` calls `renderDiffWithHighlighter`; that function also computes word/character decorations through jsdiff. Returned values are themed code/HAST data. DOM creation, measurement, patch parsing, and layout stay on the main thread. Workers are not a Git backend. [S10, S11]

Pool behavior:

- Matching highlight jobs deduplicate by highlight key and attach multiple subscribers.
- Pending work queues until workers are ready. Setup updates keep workers unavailable until acknowledged.
- `postMessage(task.request)` uses structured cloning, with no transfer list in the traced dispatch.
- Cleanup removes queued subscriptions and active task bookkeeping. It does not send an interrupt message to abort an already-running synchronous Shiki job.
- Initialization has a default 10-second timeout. Startup failure terminates the partial pool and enables main-thread fallback. Treat that fallback as a possible responsiveness regression on large input, not free resilience. [S10, S11]

DiffsHub caps desktop workers at three and mobile workers at one, also respecting hardware concurrency minus one. The app sets the AST cache option to 100 on desktop and 10 on mobile. **The manager allocates separate file and diff LRUs with that limit each.** The option name `totalASTLRUCacheSize` is not a single combined count or byte budget. Diffshub picks Shiki WASM when `WebAssembly` exists, otherwise JS. [S11, S15]

### Plain first does not mean windowed syntax highlighting

The renderer builds a plain AST for the requested visible range while a worker job is pending. When highlights arrive, the renderer rerenders. But highlighted mode deliberately overrides line ranges to the complete input, to preserve grammar context. Full-file metadata can tokenize both complete sides; partial patches group work by hunks. Mounting only visible rows avoids DOM growth, but a highlighted file can still produce full-file worker output and substantial cached AST data. [S10, S11]

No `OffscreenCanvas` use was found in the inspected Diffs renderer or Diffshub. Here, "offscreen rendering" means omitted/unmounted DOM, spacer buffers, retained models/caches, and optional highlight-cache priming for a scroll target. It does not mean painting diffs into a worker-owned canvas. [S12, S13]

## 5. Two levels of diff virtualization

### CodeView is the app's multi-file path

DiffsHub renders `ThemedCodeView` around the library `CodeView`, with sticky headers, line selection, wrap/scroll options, annotations, and a stable imperative handle. The app passes `initialItems`; later streaming data calls `addItems`, rather than reconstructing a React array on every batch once the viewer is mounted. [S6, S19]

`CodeView`:

1. Keeps logical item tops and heights.
2. Finds first/last visible items with binary search.
3. Releases mounted items outside the projected window.
4. Pools reusable `diffs-container` hosts; cleans item content but preserves reusable shadow styles/sprite assets.
5. Uses `VirtualizedFileDiff` to render a subset of lines inside each mounted file.
6. Reconciles measured heights and preserves an item or line scroll anchor after layout changes.
7. Can append items wholly below the render window by updating scroll height without rerendering current DOM.

Pooling is bounded approximately by viewport-plus-overscan divided by header height, with a minimum of eight and a multiplier for React-managed containers. The parsed models are not pooled away. [S12, S13]

The current CodeView uses paged logical scrolling because browsers cap physical element height. General-browser container height is 12,000,000 CSS px, with rebasing near the ends; Firefox uses `2 ** 22` to avoid rendering precision loss. This solves coordinate limits, not memory or CPU limits. [S12]

### Observer-based Virtualizer is a different API

The separate `Virtualizer` supports nested individual File/FileDiff components. It uses IntersectionObserver and ResizeObserver, with default 1,000 px overscan and 4,000 px intersection margin. Do not attribute these numbers to Diffshub's CodeView automatically. The React FileDiff hook chooses `VirtualizedFileDiff` only when virtualizer context is present, otherwise ordinary `FileDiff`. [S14]

Inside a virtualized file, buffers account for unmounted rows, hunk offsets speed range calculations, and measured wrapping/annotation heights affect layout. A file outside its line window requests zero lines. Default standalone metrics use 50-line chunks; CodeView defaults to one-line granularity, 20 px line height, 44 px header, and 8 px spacing. Custom typography/unsafe CSS must keep the measured and estimated geometry aligned. [S13]

A shared RAF queue deduplicates rendering callbacks. It is a frame scheduler, not a per-frame CPU deadline that interrupts a slow callback. [S20]

## 6. File tree

Diffshub's sidebar is a tree of **changed patch paths**, not a complete repository checkout. It preserves patch input order with a comparator returning zero. Duplicate/repeated files receive distinct viewer identities while navigation maps the canonical path to the current item; multi-patch metadata can prefix tree paths. [S7, S21]

The main app optimization is incremental model mutation:

- Capture the first bounded paths slice once when constructing the tree.
- Publish a source carrying `pathCount`, a live paths array, navigation map, and a link to the previous publication.
- If that link matches the last applied source, batch only newly appended paths and apply the Git-status patch.
- Otherwise reset the model from a complete paths snapshot.

This avoids repeatedly rebuilding PathStore. However, the producer still calls `Array.from(gitStatusByPath.values())` at each publication, and the linked publications are not immutable snapshots because they share arrays/maps. It is an O(delta) *tree mutation* improvement, not proof that the entire publication path is O(delta). A skipped publication falls back to reset. [S7, S21]

The Trees library owns a canonical PathStore model and a Preact view. Visible-row retrieval is separate from topology. The controller limits the initial projection to 512 rows and has a narrow-range path outside the initial projection. Fixed-height row virtualization computes indexes using `floor(scrollTop / itemHeight)` and a ceil-based end; default overscan is 10 rows. It retains the previous window while it still contains the visible range, reducing churn. Diffshub explicitly uses 24 px rows. Sticky positioning and ResizeObserver handle the displayed window. [S22, S23]

Do not claim the tree is always stored as typed-array SoA. `soa-node-store.ts` explicitly documents an **opt-in count-only mirror**. The default topology uses object nodes and per-directory child indexes. PathStore is documented as a private engine, not an app-level dependency to adopt directly. [S24]

## 7. Large-file budgets: what they do and do not bound

| Control | Exact scope | Caveat |
|---|---|---|
| `tokenizeMaxLength = 100_000` | Force plain diff rendering when either side's stored line-array length exceeds the value | Lines, not bytes; parse already happened |
| `tokenizeMaxLineLength = 1000` | Shiki long-line tokenization option | Not an input-line truncation or fetch cap |
| `maxLineDiffLength = 1000` | Skip intraline comparison if either compared line exceeds the limit | Full patch processing still occurs |
| Full plain AST above 1,000 displayed lines | Disable intraline decorations for non-windowed plain rendering | Windowed plain rendering can retain intraline work |
| AST LRUs | Entry-count limits for file and diff results separately | One enormous entry can dominate memory |
| Worker count | Concurrent highlight jobs | Does not cap individual job size |
| Viewer/tree windows | Mounted DOM | All parsed files/models can remain resident |
| Context loading | Only when requested | Whole side strings, not chunked/range loading |

The massive-diff threshold is strictly `>` 100,000, based on `max(additionLines.length, deletionLines.length)`. A partial patch measures represented lines; whole-file hydration can change that dramatically. [S10, S11, S13, S15]

In the inspected patch proxy, stream parser, app loader, and whole-file server, I found no hard total-byte cap, per-file parse-time deadline, or byte-weighted cache eviction. Client whole-file promise caches have no size cap. Server ref/file promise caches use 5-/30-minute expiry checks but do not proactively remove unrelated expired entries or bound the map. Request-token context reads bypass shared caches, which is an important isolation detail. Raw patch caching exists in `patchCache.ts` but is explicitly disconnected from the viewer. [S16, S17, S25]

## 8. Implemented versus advertised

| Statement | Evidence status |
|---|---|
| Trees mounts only visible rows | Implemented fixed-row virtualization and sliced model reads |
| Trees renders tens of thousands of items "instantly" | Homepage copy, not a latency result from this review |
| Large-tree dev page supports workloads up to 1.6 million paths | Demo/workload description, not a memory ceiling or universal throughput guarantee |
| DiffsHub handles huge reviews without mounting every file | Implemented two-level CodeView virtualization |
| DiffsHub loads only visible patch files | False for the traced loader; all files eventually fetched/parsed |
| Workers make parsing nonblocking | False for this app; workers highlight already-parsed data |
| Offscreen diff painting runs in workers | Not found; workers return data and main thread manages DOM |
| `8 ms` guarantees no long task | False; checked between files |
| CSS benchmark document proves present performance | It is a runbook, not results reproduced here |

The CSS benchmark document usefully separates plain-text CSS tracing from full highlighted production behavior. Any Nyte measurements should also separate ingestion/parsing, worker tokenization, DOM/layout/paint, and post-GC retained memory. [S26]

## 9. Nyte contrast and recommended design

### What Nyte already has

- `changes-stack.tsx:128-152,223-260` uses CodeView, stable item construction, context loading, sticky headers, and delayed 150 ms scroll persistence. It already has file/line virtualization. Its active-path handler nevertheless loops `sourceById` from the start on scroll. At large file counts that app-level O(N) scan can cancel the benefit of the library's binary-search viewport lookup. [N1]
- `changes-stack-code-view.ts:23-40,116-171` parses new patches synchronously while constructing all CodeView items. It memoizes parsed patches, keeps versioned item identity, and deletes no-longer-used entries. This is good reuse, but virtualized DOM does not postpone first-time parsing of offscreen patches. [N2]
- `changes-panel.tsx:269-308` requests diffs for all working paths through `useVcsDiff`, then maps the complete returned data into sections. This read of the app is enough to identify an eager collection boundary, but I did not claim or re-audit host-side Git budgets from it. [N3]
- `changes-sidebar.tsx:218-266` already batches added/removed paths. It still constructs full sets/ancestor lists and replaces Git status from all files. Borrow publication cadence and true deltas, not a new tree widget. [N4]
- `conversation/diff-view.tsx:310-317,352-365,416-425` parses the whole receipt synchronously in `useMemo` and renders ordinary FileDiff components. It does not itself establish virtualizer context. Its fallback renders raw patch text, also without an explicit size cap. Transcript context may control whether this component is mounted, but that is separate from line virtualization. [N5]
- `pierre-worker-provider.tsx:9-24,76-105` shares a pool across surfaces and keeps it alive 30 seconds after the last surface. It uses 2 to 6 workers and a cache option of 240. The installed manager independently allocates 240-entry file and diff caches. Relative to Diffshub, Nyte can hold more grammar heaps and more result data, while sharing avoids repeated initialization. [N6]
- `conversation/diff-expansion.ts:79-100` reads whole scoped sides on demand, including the old rename path. It must remain revision-safe; transcript receipts should not silently hydrate from a newer working tree. [N7]

### Smallest worthwhile steps

1. **Remove the scroll-time whole-list scan.** Maintain ordered logical item tops and binary-search the active file, or use a verified existing CodeView visible-item API in the installed version. Preserve end-of-review selection behavior and report changes only when the active path changes.
2. **Measure cache bytes and worker memory before increasing resources.** Start with fewer workers than the current upper limit while agents are active. Separate file/diff budgets. Count source bytes and result size, not just cached entry count. This requires app-side policy or upstream work; the current cache option alone is not byte-aware.
3. **Keep synchronous parsing out of React's large first render.** For moderate batches, parse complete files in a cooperative ingestion loop and publish CodeView additions separately from tree/stat updates. For a truly huge single file, use a dedicated parsing worker or host-produced structured diff. Lowering 8 ms to 4 ms does not fix indivisible sync parsing.
4. **Use metadata-first loading if actual total memory must be bounded.** Load a changed-file manifest, then fetch patches for the visible/revealed files with bounded concurrency. This is a deliberate extension beyond Diffshub's architecture, not something Pierre already supplies in the app.
5. **Cap raw and hydrated content separately.** Oversized/binary/generated files should produce a reasoned deferred state, with explicit user action to load or export them. Preserve counts and paths without rendering an unbounded raw `<pre>`.
6. **Retain revision/content keys and immutable receipts.** Pin a load generation, scope, old/new revision or blob identity, and digest. Do not hydrate a patch using freshly re-resolved mutable refs. Cancel stale requests and drop stale results.

### Potential code design, not an implemented change

Keep the renderer reusable and the acquisition policy owned by Nyte. An app-owned discriminated state is preferable to changing the library's internal metadata:

```ts
type DiffEntry =
  | { kind: "pending"; id: string; revision: string; path: string }
  | { kind: "loading"; id: string; revision: string; path: string; requestId: number }
  | { kind: "ready"; id: string; revision: string; path: string; patch: string; digest: string }
  | { kind: "deferred"; id: string; revision: string; path: string; reason: "binary" | "size" }
  | { kind: "failed"; id: string; revision: string; path: string; message: string };

type DiffBudget = {
  concurrentLoads: number;
  maxPatchBytes: number;
  maxHydratedBytes: number;
  retainedPatchBytes: number;
  parseYieldMs: number;
  publishIntervalMs: number;
};
```

Proposed flow:

```text
revision-bound changed-file manifest
  -> stable pending CodeView items and path/status tree
  -> visible/reveal priority queue, bounded requests
  -> byte gate before full accumulation
  -> parsing worker or small complete-file cooperative batch
  -> generation check
  -> ready item update, version bump
  -> slower batched sidebar/stat publication
  -> byte-weighted eviction of offscreen reloadable data
```

Every boundary needs its own budget. A fetch gate must count streamed bytes rather than trust Content-Length. A parse worker protects the UI thread but still needs a byte limit and stale-result policy. Evicting app patch text does not necessarily evict CodeView line arrays or the library AST cache; item replacement/removal and cache policy must be coordinated. Pin a revealed item and its selection during eviction. Recorded transcript diffs are durable receipts, so evict only their render cache, not their authoritative content.

For an eager stream implementation, borrow Pierre's awaited per-file consumer, separate viewer/tree cadence, and delta mutation. Do not copy its mutable snapshot chain as generic React state. A generation plus explicit appended-path/status deltas is easier to reason about when removals and live updates are possible.

Validate with many tiny files, one huge file, a long minified line, wrapping plus tall annotations, rapid scope switches, stale expansion, worker startup failure, and repeated open/close cycles. Measure first usable file, longest main-thread task, scroll handler time, worker queue depth, mounted rows, and post-GC bytes. No benchmark numbers are asserted here.

## Evidence index

All upstream links use commit `d302ea0aad461a2a9ee6de5916e3482bced946e5`.

- **S1** Repository scope: [README:1-14](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/README#L1-L14).
- **S2** Versions/dependencies: [Diffs package.json:1-109](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/package.json#L1-L109), [Trees package.json:1-91](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/trees/package.json#L1-L91), [Diffshub package.json](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/apps/diffshub/package.json).
- **S3** Dependency catalog: [pnpm-workspace.yaml:76-127](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/pnpm-workspace.yaml#L76-L127).
- **S4** Patch proxy: [route.ts:10-48](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/apps/diffshub/app/api/diff/route.ts#L10-L48), [URL rules:116-177](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/apps/diffshub/app/api/diff/route.ts#L116-L177), [upstream validation/abort:458-561](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/apps/diffshub/app/api/diff/route.ts#L458-L561), [authenticated PR compare:565-615](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/apps/diffshub/app/api/diff/route.ts#L565-L615), [pump/no-store:779-826](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/apps/diffshub/app/api/diff/route.ts#L779-L826).
- **S5** Complete-file stream/backpressure: [streamGitPatchFiles.ts:9-45](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/apps/diffshub/lib/streamGitPatchFiles.ts#L9-L45), [buffer/scanner/fallback:79-188](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/apps/diffshub/lib/streamGitPatchFiles.ts#L79-L188).
- **S6** Main-thread parsing/scheduling: [usePatchLoader.ts:49-56](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/apps/diffshub/components/usePatchLoader.ts#L49-L56), [request/fallback:220-317](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/apps/diffshub/components/usePatchLoader.ts#L220-L317), [publish/parse loop:325-492](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/apps/diffshub/components/usePatchLoader.ts#L325-L492), [yield:643-657](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/apps/diffshub/components/usePatchLoader.ts#L643-L657), [batch sizing:constants.ts:29-45](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/apps/diffshub/lib/constants.ts#L29-L45).
- **S7** Retained accumulator/identity/tree publication: [diffsHubDataAccumulator.ts:82-178](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/apps/diffshub/lib/diffsHubDataAccumulator.ts#L82-L178), [full fallback:326-361](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/apps/diffshub/lib/diffsHubDataAccumulator.ts#L326-L361).
- **S8** Parser: [parsePatchFiles.ts:39-155](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/utils/parsePatchFiles.ts#L39-L155), [retained lines:720-734](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/utils/parsePatchFiles.ts#L720-L734), [parseDiffFromFile.ts:1-75](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/utils/parseDiffFromFile.ts#L1-L75).
- **S9** String memory handling: [detachString.ts:1-41](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/utils/detachString.ts#L1-L41).
- **S10** Worker operations: [worker.ts:1-79](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/worker/worker.ts#L1-L79), [highlight/results:132-245](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/worker/worker.ts#L132-L245), [whole-input highlight:renderDiffWithHighlighter.ts:36-86](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/utils/renderDiffWithHighlighter.ts#L36-L86), [intraline limit:320-341](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/utils/renderDiffWithHighlighter.ts#L320-L341).
- **S11** Worker manager/render handoff: [WorkerPoolManager.ts:130-152](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/worker/WorkerPoolManager.ts#L130-L152), [cleanup/startup/fallback:375-479](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/worker/WorkerPoolManager.ts#L375-L479), [dedup:900-946](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/worker/WorkerPoolManager.ts#L900-L946), [clone dispatch:1205-1223](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/worker/WorkerPoolManager.ts#L1205-L1223), [active cancellation:1381-1386](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/worker/WorkerPoolManager.ts#L1381-L1386), [plain-first:DiffHunksRenderer.ts:1160-1224](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/renderers/DiffHunksRenderer.ts#L1160-L1224).
- **S12** CodeView: [scroll rebasing:644-690](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/components/CodeView.ts#L644-L690), [pool:1395-1523](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/components/CodeView.ts#L1395-L1523), [append:1745-1798](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/components/CodeView.ts#L1745-L1798), [window/unmount:3504-3590](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/components/CodeView.ts#L3504-L3590), [binary search/layout:4295-4360](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/components/CodeView.ts#L4295-L4360).
- **S13** Line virtualization/budgets: [VirtualizedFileDiff.ts:1976-1990](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/components/VirtualizedFileDiff.ts#L1976-L1990), [hunk buffers:2179-2196](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/components/VirtualizedFileDiff.ts#L2179-L2196), [constants.ts:58-70](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/constants.ts#L58-L70), [massive threshold:DiffHunksRenderer.ts:2704-2711](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/renderers/DiffHunksRenderer.ts#L2704-L2711).
- **S14** Alternative virtualizer: [Virtualizer.ts:23-103](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/components/Virtualizer.ts#L23-L103), [React instance selection:useFileDiffInstance.ts:165-215](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/react/utils/useFileDiffInstance.ts#L165-L215).
- **S15** App worker limits: [WorkerPoolContext.tsx:13-69](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/apps/diffshub/components/WorkerPoolContext.tsx#L13-L69), [highlighter preference](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/apps/diffshub/lib/getPreferredHighlighter.ts#L1-L8), [initialization timeout type:worker/types.ts:162-165](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/worker/types.ts#L162-L165).
- **S16** Whole-file server refs/cache: [githubDiffFileServer.ts:15-197](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/apps/diffshub/lib/githubDiffFileServer.ts#L15-L197), [ref semantics/text:225-408](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/apps/diffshub/lib/githubDiffFileServer.ts#L225-L408).
- **S17** Browser whole-file cache/request: [githubDiffFileLoader.ts:30-125](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/apps/diffshub/lib/githubDiffFileLoader.ts#L30-L125).
- **S18** Hydration: [FileDiff.ts:1274-1310](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/components/FileDiff.ts#L1274-L1310), [hydratePartialDiff.ts:21-78](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/utils/hydratePartialDiff.ts#L21-L78).
- **S19** App viewer: [DiffsHubViewer.tsx:427-484](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/apps/diffshub/components/DiffsHubViewer.tsx#L427-L484).
- **S20** Shared RAF scheduler: [UniversalRenderingManager.ts:1-47](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/src/managers/UniversalRenderingManager.ts#L1-L47).
- **S21** App sidebar delta application: [DiffsHubFileTree.tsx:25-27](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/apps/diffshub/components/DiffsHubFileTree.tsx#L25-L27), [initial snapshot/deltas:54-129](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/apps/diffshub/components/DiffsHubFileTree.tsx#L54-L129).
- **S22** Tree row windows: [virtualization.ts:8-134](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/trees/src/model/virtualization.ts#L8-L134), [rendered window:FileTreeView.tsx:3744-3790](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/trees/src/render/FileTreeView.tsx#L3744-L3790), [resize:2829-2871](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/trees/src/render/FileTreeView.tsx#L2829-L2871).
- **S23** Sliced model: [FileTreeController.ts:108-112](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/trees/src/model/FileTreeController.ts#L108-L112), [visible reads:513-553](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/trees/src/model/FileTreeController.ts#L513-L553).
- **S24** PathStore scope/storage: [README.md:1-29](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/path-store/README.md#L1-L29), [SoA caveat:soa-node-store.ts:1-17](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/path-store/src/soa-node-store.ts#L1-L17).
- **S25** Disconnected raw patch cache: [patchCache.ts:1-20](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/apps/diffshub/lib/patchCache.ts#L1-L20).
- **S26** Advertised claims/methodology: [tree homepage copy:DemoVirtualizationClient.tsx:43-54](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/apps/docs/app/%28trees%29/_components/DemoVirtualizationClient.tsx#L43-L54), [large workload page:trees-dev/page.tsx:27](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/apps/docs/app/%28trees%29/trees-dev/page.tsx#L27), [CSS benchmark runbook:1-36](https://github.com/pierrecomputer/pierre/blob/d302ea0aad461a2a9ee6de5916e3482bced946e5/packages/diffs/benchmarks/CSS_PERFORMANCE_BENCHMARK.md#L1-L36).

Local Nyte evidence, under `/Users/workgyver/Developer/nyte`:

- **N1** `packages/app/src/workbench/changes-stack.tsx:128-152,223-260`.
- **N2** `packages/app/src/workbench/changes-stack-code-view.ts:23-40,116-171`.
- **N3** `packages/app/src/workbench/changes-panel.tsx:269-308,373-385`; `packages/app/src/conversation/diff-expansion.ts:24-47` for root/scope/digest keys.
- **N4** `packages/app/src/workbench/changes-sidebar.tsx:180-201,218-266`.
- **N5** `packages/app/src/conversation/diff-view.tsx:310-317,352-365,416-425`.
- **N6** `packages/app/src/pierre-worker-provider.tsx:9-24,76-105`; `packages/app/node_modules/@pierre/diffs/dist/worker/WorkerPoolManager.js:68-69` for installed independent caches.
- **N7** `packages/app/src/conversation/diff-expansion.ts:79-100`.
- Installed versions: `packages/app/package.json:39-40`; `packages/app/node_modules/@pierre/diffs/package.json:1-3`; `packages/app/node_modules/@pierre/trees/package.json:1-3`.
- Installed CodeView cross-check: `packages/app/node_modules/@pierre/diffs/dist/components/CodeView.js:505-556,1989-2025` has pooling and binary-search visibility; `dist/constants.js:40` has the 100,000-line default. These checks support the existing virtualization/cache contrast, not blanket equivalence with upstream HEAD.
