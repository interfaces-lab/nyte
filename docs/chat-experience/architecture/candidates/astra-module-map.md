# Module map

## Scope and evidence

Base references below are relative to `packages/app/src` at the grounding commit, `5aabfa0cd`, unless a builder name prefixes them. The supplied `chat-experience` documents are the behavioral contract. No repository files were changed.

The requested `git diff chat-experience...HEAD --stat` was read for all six builders. Several builders had no committed diff yet, so their working-tree files were also read. These are observations, not a promise that their final merge will have the same lines.

| Builder | Observed HEAD | Relevant input and decision |
| --- | --- | --- |
| chat-sidebar | `e9a743dc5`, dirty | `chrome/sidebar-view.ts:90–150` still maps wire status and holds shelves. Keep A's calendar groups, pins, fold exceptions and keyboard behavior, feed them `ChatRecord` instead. `preferences/index.ts:131–146` persists view/fold/reveal settings; preserve these keys. |
| chat-composer | `e9a743dc5`, dirty | `conversation/composer-keys.ts:46–107` introduces ComposerSituation/enterBehavior. Keep this composer operation model; supply own-run busy from the shell. `screens/pane-host.tsx:29–102` adds paste and picker routing; move those guards into the single focus owner. |
| chat-blocks | `8ea0ea0d9` | `conversation/step-group-presentation.ts:19–79,148` owns aggregate verbs and live counts; keep it with transcript content. `turn-view.tsx:691–756` owns worked-for/actions. `copy-confirmation.ts:3–23` is a reusable 2-second UI confirmation, not shell state. Reuse it in E's card, rather than create a second timer policy. |
| chat-unread | `19149f9fd`, dirty | D1 adds `SessionView.seenThrough` in `packages/schema/src/views.ts:150–154`; `packages/core/src/fold/project.ts:94,108–111` derives it from the principal's seen commit. Adopt that addition and the protocol patch; do not add a second read mark to SessionInfo. Move `conversation/transcript-unread.ts:19–136` into attention; fix the observed time-based down cursor to count first eligible message identities. Its current `timeline.tsx:164–175` and `session-conversation.tsx:248–278` still split capture from `see`. |
| chat-shell | `332ccdf9e` | `components/chat-card.tsx:84–110` already reads Git/GitHub by workspace ID. Move the lookup into sources and keep the card render/timing. `chat-card-facts.ts:43–64` uses the source folder and infers Remote from web; do not keep those assumptions. `packages/plugin/src/client/notifications.ts:18` only excludes `api.session`; that cannot cover split panes, focus or occlusion. Keep E3's failed distinction and E4/E5 workbench changes. |
| chat-tabs | `e9a743dc5`, dirty | `tabs/model.ts:24–86,261–294` introduces preview types/intents. Keep its rules, but next-to-parent receives an actual parent address. `tabs/window-tabs.ts:202–205` has `openChat` as a dispatch alias; replace it with the full operation. `tabs/use-window-tabs.tsx:162–184` fixes child names through a second list join; delete that join when all-chat identity lands. |

## Target folders

```text
packages/app/src/
  app.tsx                         Mounts adapters and composes the window
  router.tsx                      Route parser/mirror; not a navigation owner
  shell/
    chat-shell/
      index.ts                    Only external import path
      contracts.ts                Domain types, exported through index
      private/
        runtime.ts                One writer, one snapshot, commands/effects
        sources.ts                SDK/list/view/workspace adaptation
        identity.ts               Title, location, activation
        status.ts                 Plugin mark + terminal/descendant refinement
        attention.ts              Exposure, seen, visits, divider/pills, toast decision
        navigation.ts             Tabs + pure pane layout operations
        focus.ts                  Window focus requests and keyboard ownership
        state.ts                  Drafts, memory, local persistence
    focus-owner.ts                Existing DOM key-owner rule, reused unchanged
  chrome/
    sidebar/                      Existing sidebar view/render files
    tabs/                         Window tab strip renderer
    chat-card.tsx                 Renders ChatIdentity; no fetching
    titlebar.tsx                   Composition and commands
    search-palette.tsx            Reads the same records
  conversation/
    composer/                     Editor, queue/edit/send, history, model picker
    transcript/                   Rows/turns, grouping, scroll, TanStack adapter
    agents/                       Tray, detail and inline child links
    shared/                       Copy confirmation and content UI
  screens/                        Pane/blank/chat composition; no seen/focus policy
  workbench/                      Existing workspace-keyed panel owner
  platform/
    connection.tsx                Non-chat connection/watch transport from sdk.tsx
    host.ts                       Host activation/bridge boundary
    plugins.tsx                   Plugin mounting and typed app notification adapter
    workspace-data.ts             Non-chat workspace capabilities and query cache
  preferences/                    Existing user/machine preferences
  theme/, components/, settings/, web/, account/  Unchanged purposes
```

Only shared chat-shell knowledge moves into the concept. Step-group verbs, reply actions, prompt history, geometry and copy feedback stay with their features. A snapshot of the whole transcript would be larger and slower than the code it replaces.

## Ownership and access paths

| Concept | Owner | Dominant lookup / write |
| --- | --- | --- |
| Chat identity | Private identity projection | all-chat directory map → workspace map by ID → workspace-keyed metadata. Same record for root, child, card, tab, title bar, reference context and toast. |
| Current run | Private status projection | one execution chosen in sources → plugin executionMark → terminal/refined own state → descendant summary from one parent adjacency. No component reads Execution for a current status. |
| Visibility | Private attention projection | active tab's actual layouts + tray detail + explicit workbench coverage + transcript readiness + document focus/visibility. Produces selected/presented/looking, not several competing predicates. |
| Read mark | Host per principal/head | Sources expose D1's pre-visit time and selected-head tip internally. Runtime alone sends `head.see`. Reading never changes host run outcome or lastActivityAt. |
| Divider and pills | Private per-presentation visit | address → visit → eligible message IDs. Geometry observations update this visit; rendering cannot advance the host mark. |
| Opening/placement | Private navigation in one runtime | `openChat` → resolve/activate → reducer → one publication and URL mirror. No independently mutable pane controller. |
| Focus | Private window focus record | addressed editor binding + window sequence + input revision → keyOwner guard → DOM focus. No per-tab counter collision. |
| Draft buffer | Private window state | window + chat ID, or window + new-draft ID. Composer code requests writes; it does not maintain a second durable buffer. |
| Scroll/folds | Private memory; geometry remains transcript-owned | address+chat → scroll; chat+group → disclosure. One scroll adapter writes offsets. |
| Sidebar preferences | Existing preference storage, consumed through shell | A's view/fold/reveal values. Shell owns only transient selection/shelf hold. Grouping consumes records, not SDK lists. |
| Workbench | Existing controller | workspace path → panel state. Shell reads its coverage facts; controller never decides whether a chat is read. |

`runtime → concept function` is one call. A component reaches a completed operation through `index → runtime → concept function`, with I/O at the edge. Private projections do not subscribe to each other. There is no event bus, effect queue persisted to disk, distributed ordering mechanism, or list/view reconciliation service.

### Directory and streaming

One all-chat directory supplies root filtering, parent relationships, child identities and optimistic updates. Keep the first-frame roots snapshot only as a startup seed until the full directory arrives. A missing row in that seed cannot prove a child is gone. A direct session info lookup supports route IDs outside the loaded list. Root rename/pin/archive optimistic overlays apply before publication, including child records, rather than only in a roots hook.

For each chat, the active unpaced view wins over list execution after that watch generation emits its first value. A retained cached view cannot win merely because a component warmed it earlier. Releasing the view returns authority to the list. This can correct status at the handoff; it does not claim to order the two host streams. All shell readers consume the selected result. Current-run badges in transcript/composer use it too; historical turn failures and the latest turn's live tools remain descriptions of their particular turn, not another session-status mapping.

The source cache holds SDK messages. The shell retains only metadata relevant to identity, status and attention. Prose append frames do not invalidate the sidebar; a new eligible message, an execution transition or a location update can. Use existing reference-preserving projections and selector subscriptions rather than a new cache library. `useChatIdentity` retains workspace metadata for a mounted card/context and reads the same identity record. Active panes retain their location too. A hover must not mark anything read.

### Location and the one active host workspace

A chat's `workspace` resolves its own cwd, worktree path and machine. A worktree's source folder exists separately for sidebar grouping. Copying the folder in the card copies the chat's actual path. Per-workspace Git/GitHub capability lookups provide repo and current branch; isolation branch is a fallback. No server change is needed for this data. When the provider cannot resolve a repo, show the folder without inventing one. Machine uses known connection provenance, otherwise unknown; renderer kind is not machine provenance.

The host's active workspace still follows the focused pane. It is a side effect of successful foreground activation, not identity input. A foreground open, route adoption or tab activation waits for the destination to resolve and for trust/folder activation to succeed. Failure keeps the prior selection. A background open activates nothing. Rapid sidebar clicks already exercise asynchronous activation; reuse the existing serial desired-folder behavior, with the requested placement committed only if still current. Do not add locks, deadlines or rollback journals.

File mentions and reference openers bind a pane's workspace capability explicitly. The shared workbench chooses the focused pane's workspace view, but a reference from the other pane still resolves against that other chat. A draft captures its target when created; `draft-start.ts` must stop sampling `selectedWorkspaceId()` at send completion.

### One status, two questions

A record distinguishes the own run from its shell summary. The summary answers whether this chat or its descendants are still working. Every current-chat indicator uses that summary; commands use own-run capabilities. Otherwise the composer either lies that a waiting approval is generating, or offers to stop an idle parent because its child is working.

| Selected execution | Own run | Shared summary |
| --- | --- | --- |
| live | working, possibly stopping | working |
| waiting on part | waiting-for-approval, reason approval/question if known | waiting-for-approval |
| waiting on run/job/timer | working, waiting-on-work | working |
| retrying | working, retrying | working with retry detail |
| idle/no last run | idle | idle |
| idle/completed | completed | completed |
| idle/stopped | stopped | stopped, not failed |
| idle/failed | failed | failed |
| terminal own + active descendant | unchanged own result | subagent-still-working |

Failure remains an independent attention flag, even when a descendant supplies the working glyph. Nyte retains successful-completion-only unread marking per 01-sidebar.md's Nyte delta. Reading a failure does not erase it. The tray lists failures distinctly; the shell does not change every failure into unread just to copy Glass. Tool-only subagent rows without a known child can still use shared plugin tool presentation; as soon as the child is known, they read its chat record.

### Looking and visits

| Situation | Presented | Looking | Visit |
| --- | --- | --- | --- |
| Either ready split pane, focused visible window | yes | yes | active |
| Ready tray detail, transcript on screen | yes | yes | independent detail visit |
| Same transcripts, window blurred/hidden | possibly / no | no | retain and freeze boundary |
| Maximized non-chat workbench covers transcript | no | no | retain and freeze boundary |
| Another window tab/page selected | no | no | end old slot's visit |
| Warm watch or hidden Activity cache | no | no | none |

Focus on the sidebar does not itself occlude the transcript. A small menu is a keyboard owner, not automatic whole-transcript coverage. Tray detail covers its parent only if the rendered layout really replaces the parent transcript. Do not reuse native-browser overlay rectangles for chat visibility.

Initialize every newly presented ready visit from its first pre-see `seenThrough` value, then permit automatic `see` effects. No render/effect ordering between sibling components is responsible for that invariant. Loading the mark and having no mark are different states. Blur freezes a following boundary; tab/page departure ends the visit. Group expansion may change the row containing a divider but never its message identity. An unresolved history anchor must not cause the owner to conclude there are no unread replies; keep the fixed boundary until relevant history is known.

Down-pills count first eligible content identities since leaving the end, including an already-created empty assistant reply that gains its first text later. Own prompts never count; eligible system-generated prompts can count down, not anchor the divider. Suppressed/display-only/background completion notices count neither. Sources assign a window-local first-content sequence once per eligible identity; explicit history merges never assign an arrival. A visit captures that cursor on leaving the end. This is a correction to the observed D builder's time-only down cursor, not a new read-mark wire type or an ordering claim about host streams. Keep one pill, down first. Down-dismiss does not read or scroll. Up-dismiss explicitly reads and removes that divider. Up-click acknowledges and jumps without clearing it. The plain bottom arrow follows and focuses the addressed composer. Keep D's separate 4px follow, 60px UI and 2px saved-end thresholds; geometry stays in TanStack's existing scroll adapter.

Notifications use the same looking predicate, including focus and coverage, not merely membership in the active tab. A blurred displayed chat is not being looked at. The app mounts its own built-in `notifications` plugin in place of the imported default. Private sources registers its handler through the lower platform plugin adapter; the platform never imports shell internals. App composition supplies renderer contributions to that adapter, avoiding a domain import of conversation UI. The typed hook translates existing run-end events into `Completion` and asks attention for a notice using the latest record. `mountClientPlugins` keeps its startup seeding and run-ID dedupe; stopped and child events stay silent, and root events retain today's timing/all-head scope. There is no new delayed notification awaiting child completion. Other plugin toasts pass through unchanged. TUI/mobile retain the default plugin. No approval banners, OS notifications or public plugin context extension is needed for this task.

### Opening and focus

`openChat` is the only existing-chat placement API. Sidebar click/modified-click, palette, parent link, child citation, tray expand, routes and row drops use it. Ordinary opens dedupe globally and do not promote an existing preview. `next-to-parent` carries the actual parent tab/pane/chat; when a preview already exists its replacement slot wins, otherwise a new preview is inserted after the parent. A preview parent is kept before its child takes the preview slot.

Explicit split/drop moves an existing full-chat placement; it does not duplicate a mutable editor. The source pane becomes blank without adding a closed-tab history entry. Inside one split retain current swap/reorder rules. A third chat replaces the intended pane without disturbing its sibling. New blank split promotes the tab too. This is the candidate's deliberate behavioral departure, called out for synthesis rather than smuggled into implementation. Tray readers can still show the same chat independently.

`navigate` handles tab activation/close/reorder, page/draft opening and empty splits, never another existing-chat open. Draft landing is an internal continuation of the send operation, not a public bypass. It replaces only a pane still showing that draft. Archive/delete removes the chat from placements and closed entries; undo restores only the untouched blank, preserving today's undo behavior.

Focus requests use one sequence per window and include tab, pane and draft/chat owner. Send promotes at accepted submission, not on typing or after the response. `submit` wraps the existing composer send/edit/queue workflow through its registered binding, supplying the owner's buffer and resolved workspace target. It does not reimplement receipts, holds, draft recovery or delivery. Preserve B's steer/queue alternate, Escape precedence and per-chat prompt recall. Jump, picker-close and tab-switch produce requests to the same owner. The DOM adapter applies them after layout using `keyOwner`, eligibility and whether the user acted meanwhile. PageUp/Down remain transcript operations. Popup finalFocus and composer portal movement feed this owner rather than making competing focus decisions.

## State keys and persistence

| State | Scope / key | Persistence and two-writer behavior |
| --- | --- | --- |
| Tabs/layout/active/recent/closed | window ID | Keep `nyte.window.v1:<windowId>:tabs` and F's value version. 250ms and pagehide; previews stripped; web remains nonpersistent. One runtime writes. |
| Existing-chat draft | window ID + chat ID | Keep `…:drafts:session:<chatId>` and attachment keys. 200ms per owner. Moving a chat preserves its buffer; different windows have independent buffers. |
| New-chat draft/index/target | window ID + draft ID, index tab/pane | Keep `…:drafts:draft:<id>`. Add target to stored draft with a one-time decoder migration, preserve text/selection/images. Seed from restored owner/first frame only when known; unresolved blocks send instead of silently choosing another folder. |
| Read mark | host + principal + chat + displayed head | Existing core monotone commit ref. Two clients advancing it is safe through core; no local decrement and no new Mark Unread. |
| Divider/up acknowledgement/down baseline | window + transcript role + tab + pane + chat + visit | Memory only. Two readers get separate cursors; they share only the host mark. Leaving a slot ends the visit; focus loss does not. |
| Scroll | window + transcript role + tab + pane + chat | Memory, retain current 64-chat budget. End or message-backed anchor. Adding tab/detail prevents same-primary-pane collisions. No disk migration. |
| Group expansion | window + chat + group | Memory, single owner. Same disclosure preference for tray and full chat; geometry remains per presentation. |
| Measurements | transcript adapter + presentation + layout signature | Keep existing bounded cache/TanStack engine; no new disk cache or virtualizer migration. |
| Split/focused pane | tab only | Persist in the tab layout. Delete redundant per-chat split/focus copies. |
| Sidebar view/fold/reveal | existing machine/user preference fields | Keep A's `nyte.desktop.sidebar.v3` fields. Preference service remains storage writer; shell reads/requests changes. Across windows these are deliberately last-write-wins preferences, not shared editor buffers. |
| Shelf hold | window selection + chat | Memory only. Capture before automatic seen update; release on selection departure. It is not the divider visit boundary. |
| Workbench view | existing per-workspace-path controller | Keep E's ratio migration and current `nyte:desktop:workbench:v7`. Live views are per renderer; persisted layout is a last-saved workspace preference. No cross-window live synchronization is added. |
| Focus, hot/warm caches, copy check, popup state | window/editor, pane-slot, control | Memory only. Delete unused composer.focused persistence field. Hot/warm data never implies exposure. |

No storage key is renamed merely because its implementation moved folders. No backward-compatibility layer beyond reading existing user data once is proposed. If a future shared setting must merge concurrent edits rather than accept last-write-wins, that is a separately justified product change.

## File moves and deletions

| Today's location | Target / action |
| --- | --- |
| `queries.ts:160–170,243–273,306–409`; `session-list.ts:19–26` | Chat directory/location parts → sources/identity. Sidebar grouping remains feature-local over records. Keep unrelated catalog/files/settings queries until their own move is mechanical. |
| `sdk.tsx:460–475,479–490,526–572` | Chat watch adaptation → sources; general transport/watchFamily → platform/connection. Delete visibleTranscripts as a separate truth; pacer reads the resolver's presented output. |
| `session-activity.ts:5–12`; `queries.ts:320–341` | Delete per-reader descendant overrides; aggregate once in status. |
| `conversation/agent-status.ts:6–24`, `subagent-status.ts:14–68`; `chrome/status-glyph.tsx:8–18` | Delete session-to-status mapping. Retain visual glyph components consuming Status. Tool-only fallback retains plugin tool presentation. |
| `session-read-state.ts:3–12` | Delete; attention reads selected head, never heads[0]. |
| `screens/session-conversation.tsx:250–296`; D's `timeline.tsx:164–180` | Delete MarkSeen/SeeTip and component-owned visit capture; runtime captures then emits see. |
| `tabs/use-window-tabs.tsx:113–186`; F's `:162–229` | Delete title/status/unread joins; strip receives projected tabs. |
| `tabs/model.ts:22–43,314–398`; F's preview model | → private/navigation; retain reducer behavior, make pure pane operations internal. |
| `tabs/window-tabs.ts:148–298`; `layout/pane-controller.ts:106–175,227–237,264–335` | Replace with one runtime; delete controller map, bidirectional route/show sync, per-tab focus counters and per-chat split memory. This is the biggest structural deletion. |
| `layout/pane-context.tsx:8–32,103–105` | Read addressed pane state and invoke shell; stop importing mutable WindowTabs/controllers. |
| `chrome/sidebar.tsx:81–93,405–412`; `chrome/use-show-session.ts:6–25`; `tabs/use-window-tabs.tsx:37–111` | Consolidate folder/open policy in runtime/identity; router becomes mirror plus external-route adoption through openChat. |
| `layout/session-dnd.tsx:206`; `chrome/titlebar.tsx:87–102`; `screens/session-conversation.tsx:510–513` | Use explicit split/preview/next-to-parent intents; delete bypasses in the same change. |
| `conversation/draft-start.ts:77–91,104` | Capture draft workspace target; internal landDraft instead of selecting whatever controller is current. Keep send recovery. |
| `screens/pane-host.tsx:27–83`; B's `:29–102`; `router.tsx:166–204` | Focus/key routing → private/focus, retaining shell/focus-owner. PaneHost remains composition/hot cache. |
| `layout/session-view-state.ts:21–44,259–560` | Draft/memory/persistence → private/state. Remove focused boolean, per-chat split and active-pane copies. |
| `screens/session-conversation.tsx:353`; `screens/pane-host.tsx:144–150`; `conversation/composer.tsx:162` | Replace host-current cwd with addressed chat/draft location. |
| E's `components/chat-card-facts.ts:33–68`, `chat-card.tsx:84–110` | Join/metadata → identity/sources; card UI → chrome/chat-card; copy timer → existing C confirmation. |
| `client-plugins.tsx:20–81`; E's `packages/plugin/src/client/notifications.ts:17–28` | App mounting → platform/plugins; replace app's default notification import with private domain hook. Shared plugin package is unchanged by this consolidation. |
| C's step-group/actions/copy files | Move mechanically under transcript/shared after behavior settles. No shell state invention for 2-second copy feedback or group wording. |

## Import direction rules

1. Renderers import chat domain values and operations only from `shell/chat-shell/index.ts`. They cannot import contracts directly, private files, SDK sessions watches, raw session execution helpers or `head.see` to reconstruct these concepts.
2. Enforce resolved file paths, not a list of spelling variants. Extend the repo's oxlint boundary checks so imports outside this concept into any file except index fail with “Use shell/chat-shell/index.ts; chat policy has one owner.” Verify with a temporary violating import during the first cutover. Do not rely on an AGENTS paragraph or a barrel alone.
3. Within the concept, index/runtime may call private files; concept functions do not import UI, React components or each other’s mutable stores. Type-only imports are allowed. A type-only cycle is still worth removing if it obscures ownership.
4. SDK and plugin dependencies point down. Public app contracts do not re-export their wire types. Only sources/status and the plugin boundary see them. No client import of `@nyte-ai/host` is introduced.
5. Transcript content can keep plugin message/tool presentation, SDK paging and parts at its own data boundary. This is not permission to derive session attention or current status there. Other workspace/settings features keep their existing data access.
6. No surface exports a type imported by domain state. Move composer buffer and view-state types to the domain contract; a surface's editor type adapts to EditorBinding, not vice versa.
7. The workbench controller remains below composition and exports layout/coverage facts. It does not import chat-shell internals. Native-browser occlusion stays separate.

## Migration order, with a working app after each step

Do not move builder-owned files while the six branches are in flight. Re-read their final merge before implementation. Each numbered change switches a complete invariant, not half its writers.

1. **Land the snapshot reader and its import boundary.** Feed one all-chat directory, identity and status projection from existing watch infrastructure. Move sidebar, tabs, palette, card, agents and composer current-status readers together. Preserve first-frame seeds and optimistic actions. Delete the old status/read/title helpers whose last callers moved. Existing navigation and seen behavior are still sole writers at this point, connected privately as transitional inputs, not copied into another mutable navigation store. Run existing sidebar/tab/agent/status renderer tests.
2. **Correct location and draft targeting.** Move E's metadata lookup into sources, bind pane references/composer cwd to each chat, and capture new-draft targets. Reuse existing storage keys with an additive local decoder migration. Keep active host workspace following selection for now. Check two folders in a split, an unlisted child, unavailable workspace, restored drafts with images and a worktree card. This change must not erase or silently relocate a draft.
3. **Move visibility/read/visits as one unit.** With D1 merged, create the resolver and explicitly addressed visits. Replace MarkSeen/SeeTip, D's component visit state, tab-active unread suppression, default app notification plugin and the pacing visibility counter together. Seed each visit before the sole `see` effect. Use the current tab store as navigation input until step 4. Replay existing D unread, warm-session, background-shell and E notification cases; run host check:store for D1 if not already proven after the final merge.
4. **Replace the navigation writer, not just its API name.** Move F's model and pure pane reducer into runtime ownership. Convert every opener, route adoption, tab activation, split/drop and draft landing in one cutover; remove WindowTabs/PaneController synchronization and old public pane-selection methods. Keep normal reopen/undo behavior and web `here` semantics. Decide the candidate's move-on-split policy during synthesis. This is the highest-risk change; run navigation/subagents/workbench and draft-recovery journeys before any folder cleanup.
5. **Move focus and state ownership.** Replace per-controller revisions, TypeToCompose/global shortcut duplication, picker finalFocus and bottom-arrow blur with addressed requests. Move draft persistence and memory using the same keys; delete composer.focused and per-chat split/focus memory. Run composer, prompt-history, picker, split-switch, jump and Activity reuse tests. Keep virtualizer/scroll implementation unchanged except the D rules already merged.
6. **Mechanical folder moves and final deletion.** Move strips/sidebar/composer/transcript files to the target folders once policy is stable. Remove forwarding re-exports immediately as callers move. Split only the relevant data areas out of root queries/sdk, rather than rewriting all query code. Enforce the completed import boundary; no old open/see/status path may remain. Run package tests, pnpm check, the cycle check and the plan's desktop chapters twice with retries disabled through the existing isolated QA runners. No dev server.

At each step there is exactly one current writer of an invariant. An adapter may read the old owner before its cutover; it may not update both owners. This distinction is how the migration avoids months of dual state.

## Candidate verification

- Passed `pnpm exec tsc --project /tmp/arch/astra/tsconfig.json`, strict and no-emit, resolving SDK/plugin types from this repository. The first attempt used an ES2023 library target and failed on repository ESNext APIs; correcting this candidate-only config made it pass. No repository code was changed.
- Passed `pnpm exec oxfmt --check /tmp/arch/astra/sketch /tmp/arch/astra/tsconfig.json`.
- TypeScript AST inspection found 11 TS files, 36 function bodies, all throwing `not implemented`, and zero any/cast/enum/namespace/import-type/destructuring violations.
- Logs and the check config live under `/tmp/arch/astra/`. File operations and formatter targets were confined to that directory; repository and builder reads were read-only.
- Not run: app tests, UI journeys, full repo check, runtime performance checks or host check:store. This package is a sketch; its import-boundary enforcement and behavioral claims still need implementation proof. No server was started.
