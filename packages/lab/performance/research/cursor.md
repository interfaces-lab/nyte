# Installed Cursor Glass sidebar findings

## Answer to the 180-session question

The installed code distinguishes **listing agent headers** from **loading full composers**. Showing 180 sidebar entries does not, on the traced normal listing path, invoke 180 `loadAgent` or `getComposerHandleById` calls.

That does **not** mean Cursor loads zero unopened-session metadata. Its main process scans recent workspace databases and the global header store, parses metadata for unopened sessions, deduplicates it, and publishes reactive headers. Renderer initialization can fetch additional header-table rows. Those operations have their own CPU, allocation, database, and IPC costs.

The best-supported discriminator is therefore **header/index discovery versus composer/message/session hydration**, not “opened versus entirely untouched.” No runtime measurement was performed, so this report cannot establish an actual count of scans or I/O operations in the user's running instance.

## Installation and scope

Read-only inspection of `/Applications/Cursor.app/Contents/Resources/app`:

- `package.json` and `product.json` both report **3.23.23**.
- Product commit `2dac2428994fe34f12658d9ecad1541b98db2c00`, quality `stable`.
- Product build date is literally `2026-10-05T01:43:43.807Z`. This is recorded from the installation, not inferred from an external release calendar.
- Glass JS: 46,474,294 bytes. Desktop JS: 39,262,113 bytes.
- Matching Glass CSS: 1,275,668 bytes. Desktop CSS: 1,276,105 bytes.
- Also inspected the installed `out/main.js`, because the Glass scan API crosses IPC into it.

Evidence excerpts and SHA-256 hashes are in `/tmp/nyte-cursor-evidence/`. Offsets below are **zero-based UTF-8 byte offsets**, with half-open ranges. Symbols are the installed bundle's minified spellings, not claimed original source names. All excerpts are application code. No user databases, session files, transcripts, logs, or other personal session content were opened. No installed-app or repository file was edited. No app was launched or instrumented.

## 1. Header discovery and its real backend costs

Verified call path:

```text
AWi constructor -> refreshAgents
  -> localAgentStorageService.scanAgents through IPC
  -> main OE.scanAgents -> scanRecentWorkspaces
  -> header parsing / deduplication / bounded result
  -> AWi.agentMap + makeAgentHeader -> agents reactive list
```

`AWi.refreshAgents` calls one service scan and maps returned rows to `makeAgentHeader`, not to `loadAgent`. [E01, E08, E09]

The main-process implementation does real work for unopened sessions. [E02-E07]

- Enumerates `User/workspaceStorage` directories.
- Stats each workspace `state.vscdb`. Skips workspace databases whose mtime is older than **two days**. That is database age, not session age.
- Uses a `Qv` queue with concurrency **8** to inspect recent workspace databases. Reads `workspace.json` for placement and queries `ItemTable` for **`composer.composerData`**.
- Also starts a global-header scan. If the canonical-table marker is set, it issues **`SELECT value FROM composerHeaders`**. This is an unbounded table read in this function, before deduplication and result limiting.
- Falls back to the global `ItemTable` value **`composer.composerHeaders`** when the table is not canonical or that read fails.
- Parses legacy aggregate JSON's `allComposers`, validates scannable rows, deduplicates by composer ID with archive-aware preference, sorts by recency, then returns up to **50 unarchived plus 50 archived** rows. Prioritized IDs occupy slots inside those limits; they do not expand them.

### Backend scan limitations

1. The workspace method is named `readComposerDataFromDb`, but its SQL fetches the legacy **aggregate workspace value**. Its parser extracts `allComposers` metadata. This is not a call to the full per-composer renderer loader. Nevertheless, it reads and `JSON.parse`s the entire aggregate string. If older stored values contain more than lightweight headers, their bytes and parsing cost still count. We did not inspect any stored values to determine their actual shape or size.
2. Global table scanning reads all rows before the 50/50 return cap. The cap is not a guarantee of bounded database bytes, parsing work, or total renderer catalog size.
3. The number of workspace scans depends on workspace-storage directories and mtimes, not one scan per sidebar session. 180 sessions in one workspace do not imply 180 workspace databases. Conversely, many workspace directories can cause many checks or reads.
4. Recent-workspace scanning excludes older databases and certain draft/ephemeral/background-backed rows. It is discovery policy, not an exhaustive proof of all stored sessions.
5. Later renderer header queries, cross-window synchronization, cloud repositories, migration, recovery, and explicit refresh can add work or rows. The initial main scan's 50/50 cap is not a universal “Cursor only has 100 sidebar sessions” claim.

## 2. Renderer metadata initialization is a separate path

The shared composer initializer queries the `composerHeaders` collection. In Glass it first requests a recency window of **50** headers. A gated pagination path subsequently requests **200**, missing selected/focused IDs individually, and up to **20 archived** headers. Without that gated path it can query the full applicable collection. Desktop uses workspace-scoped queries. [E17-E19, E33]

These are header-table queries, not `getComposerHandleById` calls. A catalog of 180 rows is consistent with a 200-header window, but the running feature-gate value was not observed. The backend scan and renderer initializer are different sources of header discovery.

`makeAgentHeader` constructs reactive name, environment, archive, status, subtitle, unread, repository, location, and project fields. It explicitly starts with `conversationState: new ia(void 0)`. Metadata can include branch arrays and summaries; “header” does not mean a tiny fixed-size record. [E09]

Canonical synchronization queries headers and updates unloaded header objects. It restores a composer only when that agent is **already loaded** and has a newer checkpoint. It does not hydrate every incoming header. [E42; supporting range in `glass-canonical-header-sync.txt`]

## 3. Full composer/session loading

Verified local open/load path:

```text
loadAgent(id)
  -> reuse live loaded agent / join pending load, otherwise
  -> _loadNewAgentReference
  -> workspace reference + getComposerHandleById in parallel
  -> composerDataHandleManager.getHandle / _resolveHandle
  -> backend.load -> cursorDiskKVGet("composerData:<id>")
  -> deserialize, initial-message reads and migrations
  -> initial-human recovery / capabilities
  -> register loaded agent, optional host-session hydration
```

`loadAgent` checks the loaded-agent map and a pending-load map before starting a new load. The handle manager also joins an existing `LOADING` promise, reuses live weak references, and coordinates finalization. These are per-ID deduplication boundaries. [E10-E14]

`eGr.load` reads the persisted root and optional separate draft in parallel, then calls `rt1`, which parses/deserializes and runs `Be1`. For newer persisted versions, `Be1` calls `composerMessageStorageService.getInitialMessages`. The root loader therefore does more than fetch a title. It also does not prove that every message/blob is eagerly loaded; separate message/checkpoint/blob storage and lazy transcript paths exist. [E14-E15]

`getComposerData(handle)` reads `handle.data`. `getComposerDataIfLoaded(id)` checks an already-loaded handle. These accessors are not hidden disk loaders. [E16]

**Inference:** Normal sidebar discovery and rendering are not sufficient to trigger this full loading chain for every row. **Limit:** That does not rule out full loads without a click from other features. Startup auto-continue, selected-tab restoration, recovery, migration, previews, already-running agents, cloud streams, or explicit APIs can retain/load sessions. The bundle contains such callers; their live gates and state were not tested.

## 4. Sidebar rendering and virtualization

The traced Glass grouped-agent section is **incrementally revealed**, not a viewport virtualizer:

```js
children: Xr => n.headers.slice(0, Xr.effectiveVisible).map(Or)
```

It passes the complete header count to `SidebarPaginatedMenu`, symbol `Ybn`. Its row budget uses `maxVisible: flt`, with **`flt=8`**. `initialMaxVisible`, forced-visible count, section expansion, selected-row handling, and callbacks can change the actual visible count. “More” adds a batch rather than replacing the previous rows. After enough expansions all rows can remain mounted. Do not equate an eight-row reveal increment with only eight metadata records loaded. [E20-E23]

The bundle also contains actual virtual-window calculation, for example `mmS` uses scrollTop, viewport height, row height, and overscan. Those components are not evidence that this Glass sidebar section uses them. Transcript/diff virtualization is another subsystem. [E41]

Desktop's compact agent-history menu similarly slices separate active and archived arrays. Its initial count and increment are **20**, and archived expansion is separate. This is the inspected history menu, not a claim that every desktop history surface has this implementation. [E35-E36]

## 5. Status subscriptions do not imply full loads

The header hooks subscribe to reactive fields, including archive, status, environment, unread, PR URL, project, location, tracked repositories, and timestamp changes. `Nkw` subscribes across the supplied header array, caches field snapshots, and tracks dirty headers. Thus a large catalog can carry per-header subscriptions and synchronous iteration even while most rows are not mounted. [E24-E25]

Local background-work updates run `_syncUnloadedHeaderStatusesFromBackgroundWork`: it iterates headers and derives status for eligible unloaded agents from background-work metadata, explicitly skipping loaded/synchronized agents. No `loadAgent` occurs in that method. [E26]

`syncFromHandle` connects a loaded handle's data to its header with `getHandleIfLoadedReactive`. It updates status, unread, recency, conversation state, and repository fields without itself forcing a handle load. [E27]

Cloud headers can also exist without a loaded agent. The inspected `getAgentHeader` uses known headers, a live loaded agent, or a loadable-subagent registry. Cloud server-list/status/stream behavior is not equivalent to local SQLite discovery. This report does not establish the number of remote subscriptions or whether background streams were live for the user's account.

## 6. Archive behavior

Local `archiveAgent` optimistically marks the reactive header archived and updates recency. For an already loaded agent it updates the handle, aborts its chat, silences/mutes background completion, force-disposes the loaded agent, and removes its synchronization subscription. It persists archive state with rollback on failure. Archive is not hard deletion of the conversation. [E28]

Persistence can use header data without opening a composer. `persistComposerArchivedState` first uses the in-memory header or loaded handle; it calls `getComposerHandleById` only if **both are absent**. Bulk persistence can create a workspace reference as a fallback. Therefore “archive never loads anything” would also be false. [E29; supporting `_persistAgentsArchivedState` excerpt at Glass byte 44,840,230]

Archived entries remain discoverable: the main scan returns a separate archived slice, the renderer pagination path fetches archived headers, and the desktop menu has an archived array. Hiding archived rows is not necessarily removing their metadata or subscriptions. [E02, E18, E36]

The archive-aware merge prevents a later ambiguous non-archived row from casually resurrecting an archived one. Explicit `isArchived:false` and recency matter. This is a storage reconciliation rule, not just a CSS visibility toggle. [E30]

## 7. Async yielding and remaining synchronous work

- Main scanning uses asynchronous directory/stat/database operations and an eight-way queue. JSON parsing, validation, deduplication, and sorting still run synchronously between those awaits. No per-header timer/idle yield was found in the inspected scanner.
- Both workbench composer services contain an explicit **`await new Promise(...setTimeout(...,0))`** before waiting for initial loading and processing queued selection changes. The surrounding registration excludes Glass for that selected-composer effect, so this is not proof that the Glass header scan yields once per row. [E31-E32]
- Header initialization awaits collection queries and publishes a first window before later header queries. That is async staging, not proof that all parsing or rendering is chunked.
- `async` or `await` alone does not guarantee a browser paint or a macrotask break. Header projection, React memoization, deferred values, reveal limits, and transcript virtualization address different costs. None establishes a latency bound for 180 records.

## 8. Storage boundaries and CSS

The observed boundaries are:

```text
main-process localAgentStorageService IPC
  recent workspace state.vscdb: legacy ItemTable aggregate
  global state.vscdb: composerHeaders table / legacy header blob

renderer storage collection: composerHeaders metadata
renderer cursorDiskKV: composerData:<id> roots, drafts and other sidecars
message/checkpoint/blob services: separate hydration/persistence
reactive header catalog != loaded-agent map != loaded-composer registry
```

The main service has separate `getComposerData` and `getBlob` methods that query `cursorDiskKV`. `scanAgents` does not call those methods on every header. The report does not treat a SQL table scan, per-workspace aggregate parsing, per-ID KV read, message hydration, and a runtime “core scan” as interchangeable operations.

Matching CSS confirms presentation hooks, not data loading. Both CSS bundles include generated `.glass-3nfvp2{display:inline-flex}` and `.composer-history-hover-menu` selection styling. The literal `.glass-sidebar-agent-list-container` class occurs in Glass JS but has no selector in either inspected CSS. Generated StyleX classes carry much of the styling. No selector inspected proves a virtualization or storage policy. [E37-E40]

## 9. Optional Nyte comparison and limits

A small checkout-only comparison was useful, but it is **not an installed-Nyte or backend-scan audit**:

- `packages/app/src/session-directory.ts:6-18` explicitly exhausts root-session list pages with `includeArchived:true` before publishing the list.
- `packages/app/src/queries.ts:288-300` reads the shared workspace session directory.
- `packages/app/src/session-directory-feed.ts:1-29` separates directory revisions/row updates from per-session caches.
- `packages/app/src/chrome/sidebar.tsx:1497-1555` derives row status from `SessionInfo` and schedules hover warming, rather than calling a session snapshot hook in that inspected row setup.

That frontend distinction does **not** settle whether Nyte's host/core performs a disk/event scan for each unopened session to construct `SessionInfo`. No Nyte host/core call chain was traced here. The Nyte binary on PATH resolves to this checkout's `bin/nyte`; it was not executed and no matching installed-doc contract was asserted.

### What this bundled view cannot establish

The inspected code establishes call boundaries and conditional behavior, not observed runtime counts. There were no usable workbench `.js.map` files at the matching paths checked. Feature gates, canonical migration state, actual database contents/sizes, cloud account state, user selection, cache warmth, timers, and extension/host behavior remain unknown. Negative findings apply to the inspected paths, not every caller in these multi-megabyte bundles.

A privacy-preserving runtime follow-up would count method invocations and elapsed time only: `scanAgents`, workspace-db reads, global-header queries/rows/bytes, `loadAgent`, `getComposerHandleById`, root KV reads, and initial-message hydration. Do not log titles, IDs, paths, or message contents. Compare startup with a large header catalog against explicitly opening one agent. That would separate metadata fan-out from full-session loading.

## Narrow evidence index

Each row names the exact installed source byte range saved as `/tmp/nyte-cursor-evidence/E##.txt`. Preview snippets below are prefixes, not complete functions. Consult the bounded excerpt for the surrounding condition.

Source abbreviations: `G` = `out/vs/workbench/workbench.glass.main.js`; `D` = desktop equivalent; `M` = `out/main.js`; `GC` / `DC` = matching CSS. All are relative to the installed app resource root above.

- **E01 M [2484891, 2484981)**: `async scanAgents(e){return this.scanRecentWorkspaces(e)}async claimAgentsForAutoContinue(e`
- **E02 M [2485920, 2487680)**: `async scanRecentWorkspaces(e){const t=this.getWorkspaceStorageHome();let n;try{n=await DE.promises.readdir(t,{withFileTypes:!0})}catch(w){return this.`
- **E03 M [2487786, 2488456)**: `async readComposerDataFromDb(e,t,n){const r=await new Promise(s=>{const i=new e(t,1,a=>{s(a?null:i)})});if(!r)return[];try{await this.setBusyTimeout(r`
- **E04 M [2488897, 2489407)**: `async scanGlobalComposerHeadersFromTable(e){const t=await new Promise((r,s)=>{e.all("SELECT value FROM composerHeaders",[],(i,a)=>{i?s(i):r(a)})});if(`
- **E05 M [2488214, 2488959)**: `async scanGlobalComposerHeaders(){const e=await this.globalDbPromise;if(!e)return[];if(await this.isHeaderTableCanonical(e))try{const t=await this.sca`
- **E06 M [2480239, 2480539)**: `function CNe(e,t,n){if(n<=0)return[];if(t.size===0||e.length<=n)return e.slice(0,n);const r=new Set;for(const s of e){if(r.size>=n)break;t.has(s.compo`
- **E07 M [2484506, 2484601)**: `NL=50,xNe=2,FNe=8,WNe="composer.composerData",BNe="composerData:",GNe="agentKv:blob:",VNe=3e3,O`
- **E08 G [44878962, 44879992)**: `async refreshAgents(){let t="failure";try{const e=this.experimentService.checkFeatureGate("glass_configure_multi_root_option",{disableExposureLog:!0})`
- **E09 G [44890015, 44891665)**: `makeAgentHeader(t,e,n){const i=this.repairWorkspaceIdentifier(t.workspaceIdentifier,t);i!==t.workspaceIdentifier&&(t.workspaceIdentifier=i);const r=th`
- **E10 G [44829784, 44830824)**: `async loadAgent(t,e){const n=this._loadedAgents.get(t);if(n&&this._isLiveLoadedAgent(n)){if(!n.workspaceFactory.workspace.value)throw new Error(\`Agent`
- **E11 G [44833354, 44834054)**: `async _loadNewAgentReference(t){const{agent:e,agentId:n,header:i,workbenchReactive:r,traceParent:s}=t,o=Date.now(),a=this.workspaceCollectionService.c`
- **E12 G [38313708, 38313948)**: `async getComposerHandleById(t,e){const n=await this.composerDataHandleManager.getHandle(t,void 0,e);return n&&(await this._ensureInitialHumanRecovery(`
- **E13 G [17021777, 17022557)**: `async _resolveHandle(t,e){const n=this.refById.get(t);if(n?.type==="LOADING")return n.promise;if(n?.type==="FINALIZING")await n.promise;else if(n?.typ`
- **E14 G [17002767, 17004047)**: `_readRootAndDraft(t,e,n){return Promise.all([this.storageService.cursorDiskKVGet(this.getComposerDataStorageKey(t),n),e?this._drafts.read(t):void 0])}`
- **E15 G [16118382, 16118952)**: `async function Be1(t,e){try{let n=t;if("_v"in n&&n._v>=2){const{messages:o,hasCorruptedCheckpoints:a}=await e.composerMessageStorageService.getInitial`
- **E16 G [38335662, 38335947)**: `getComposerData(t){try{return t.data}catch{return}}getComposerDataIfLoaded(t){const e=this.getHandleIfLoaded(t);if(e)return e.data}getComposerDataIfLo`
- **E17 G [16171063, 16171368)**: `const W=await t.collectionQuery(Dz,o?{orderByDesc:"recency",limit:m2a}:{where:{workspaceId:p.id},orderByDesc:"recency",limit:m2a}),z=qwn(I0e(W));if(z.`
- **E18 G [16171524, 16172494)**: `const L=o&&d;let O=await t.collectionQuery(Dz,L?{orderByDesc:"recency",limit:f$r}:o?void 0:{where:{workspaceId:p.id}}),B=[];if(L&&O.length>=f$r){const`
- **E19 G [16175379, 16175407)**: `m2a=50,f$r=200,sEp=20,v$r=t=`
- **E20 G [43098312, 43098712)**: `children:MS(Ybn,{followScrollOnShowMore:!0,forcedVisibleCount:Oi,initialMaxVisible:w,maxVisible:flt,moreLabel:A2n,onShowMore:kn,showMoreHighlighted:f,`
- **E21 G [24320084, 24320111)**: `x2n=5,flt=8,A2n="More",uKt=`
- **E22 G [12296643, 12296968)**: `function Hca(t){const{totalCount:e,initialPageSize:n,extraBatches:i,maxVisible:r,forceExpanded:s,forcedVisibleCount:o}=t,a=NVy({totalCount:e,initialPa`
- **E23 G [12297238, 12298198)**: `Ybn=RVy(function({children:e,className:n,rootStyle:i,maxVisible:r=5,initialMaxVisible:s,expanded:o,forcedVisibleCount:a,resetKey:l=0,onShowMore:c,foll`
- **E24 G [27840537, 27841332)**: `function Nkw(t,e){const n=new Map,i=new Set;let r=!0,s=0;const o=l=>e.map(c=>c.read(l)),a=l=>{const c=o(l),u=n.get(l);return u!==void 0&&Dkw(e,u,c)?!1`
- **E25 G [27838997, 27839257)**: `l4l=[MXt(t=>t.isArchived),MXt(t=>t.status),MXt(t=>t.environment),MXt(t=>t.hasUnreadMessages),MXt(t=>t.prUrl),MXt(t=>t.isProject),l4f,u4f,MXt(t=>t.loca`
- **E26 G [44880038, 44880898)**: `_syncUnloadedHeaderStatusesFromBackgroundWork(){const t=new Set;for(const e of this.backgroundWorkService.backgroundWorkItems.value)e.kind!=="shell"&&`
- **E27 G [44887379, 44887959)**: `syncFromHandle(t,e){if(this._composerHandleSyncByAgentId.has(t))return;const n=e??this._agents.value.find(s=>s.id===t);if(!n)return;const i=n.trackedG`
- **E28 G [44835115, 44837285)**: `async archiveAgent(t,e){const n=this.agentMap.get(t),i=this._agents.value.find(h=>h.id===t),r=n?.isArchived===!0,s=i?.isArchived.value===!0,o=i?.lastU`
- **E29 G [38320795, 38321835)**: `async persistComposerArchivedState(t,e){const n=this.allComposersData.allComposers.find(d=>d.composerId===t),i=n===void 0?void 0:{...n};let r=this.get`
- **E30 G [16092513, 16093033)**: `function DCp(t,e){const n=PCp(t),i=PCp(e);if(i&&!n&&!MCp(t))return!1;if(n&&!i&&!MCp(e))return!0;const r=Gwn(t),s=Gwn(e);return r!==s?r>s:n!==i?n:!0}va`
- **E31 G [38295303, 38295408)**: `await new Promise(se=>setTimeout(se,0)),q&&await q;const te=V.splice(0),ie=new Set,ne=[],re=[];for(const `
- **E32 D [29928406, 29928516)**: `await new Promise(_e=>setTimeout(_e,0)),q&&await q;const se=Z.splice(0),ce=new Set,ae=[],oe=[];for(const _e of`
- **E33 D [14440087, 14440777)**: `function FUf(e,t,n,i,r,s,o,a=!1,c,l,u,h=!1,p){const g=Xy(n.getWorkspace()),f=e.get(s,1);let y={allComposers:[],selectedComposerIds:[],lastFocusedCompo`
- **E34 D [29946810, 29947030)**: `async getComposerHandleById(e,t){const n=await this.composerDataHandleManager.getHandle(e,void 0,t);return n&&(await this._ensureInitialHumanRecovery(`
- **E35 D [28210767, 28210783)**: `eLe=20,Kzt=20;fu`
- **E36 D [28211407, 28213037)**: `function _Jb(e){const{entries:t,archivedEntries:n,menuId:i,onArchiveEntry:r,onClose:s,onFindWithAgent:o,onOpenEntry:a,onRestoreEntry:c,onTogglePinnedE`
- **E37 GC [333690, 333724)**: `.glass-3nfvp2{display:inline-flex}`
- **E38 DC [347906, 347940)**: `.glass-3nfvp2{display:inline-flex}`
- **E39 GC [576764, 576991)**: `.composer-history-hover-menu [data-component=menu-row]:has(.compact-agent-history-react-menu-label[data-selected=true]){background:var( --vscode-list-`
- **E40 DC [613732, 613959)**: `.composer-history-hover-menu [data-component=menu-row]:has(.compact-agent-history-react-menu-label[data-selected=true]){background:var( --vscode-list-`
- **E41 G [13188406, 13188836)**: `function mmS({rowCount:t,scrollTop:e,viewportHeight:n,rowHeight:i,overscan:r}){const s=t*i,o=Math.max(0,s-n),a=Math.min(Math.max(0,e),o),l=Math.min(Ma`
- **E42 G [44883690, 44884680)**: `async syncNewAgentsFromCanonicalComposerHeaders(){const t=await this.storageService.collectionQuery(Dz),e=I0e(t);if(e.length===0)return;const n=[...th`

Bundle hashes and sizes: `/tmp/nyte-cursor-evidence/bundle-manifest.json`. Research scripts and bounded extraction files are kept in that directory for reproduction.


## Correction: hover prewarming is present

The original report traced header discovery and full composer loading but omitted the hover preload call sites. That omission did not support deleting Nyte's hover prewarming. The sidebar deletion was subsequently rejected and reverted.

Direct inspection of the same Cursor 3.23.23 installation confirms:

```js
onMouseEnter: () => {
  e.composerDataService.preloadComposerHandle(t.composer.composerId)
}
```

- Glass unified-sidebar caller: `workbench.glass.main.js`, UTF-8 bytes `[44147890, 44148940)`. The same pattern is in desktop bytes `[36931699, 36932749)`. These are bundled unified-sidebar call sites; their presence alone does not prove which sidebar mode is active in a running window.
- Glass method: bytes `[38314543, 38315593)`; desktop method: `[29947645, 29948695)`. `preloadComposerHandle(id, delay = 5000)` immediately calls `getComposerHandleById(id)`, then its promise continuation awaits a timer. The timer is after loading, not a five-second hover delay. Do not infer a strict eviction deadline from it.
- The handle manager's `_resolveHandle` joins an existing `LOADING` promise or reuses a live `REF` before calling `loadFromStorage`. Glass bytes `[17021527, 17023877)`; desktop bytes `[15808459, 15810809)`.
- Editor tabs also preload on mouse enter: Glass bytes `[36920412, 36921462)`, desktop `[25693215, 25694265)`.

This warms the addressed composer through the existing handle loader, not every row merely because the directory is visible. It can load real composer data and capabilities; it is not just warming a title. Focus/send agent-host prewarming also exists, but is a different mechanism and is not needed to establish the sidebar hover path.

No personal session data or running Cursor instance was inspected. The unresolved Nyte question is how to preserve this useful speculation without the current auxiliary child-list read inspecting unrelated session candidates.
