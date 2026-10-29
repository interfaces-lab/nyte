# Two owners, one-way reads

This candidate separates connection facts from window interaction. It does not put a domain folder between each pair of existing stores.

```text
packages/app/src/
  app.tsx                         composition only
  router.tsx                      route definitions and guards, not chat placement
  runtime/
    connection.ts                 SDK connection lifecycle, extracted from sdk.tsx
    watches.ts                    existing watchFamily/query engine, no UI policy
    chat-shell.ts                 creates chats + one window owner
    completion-plugin.ts          app's run-end adapter to window attention policy
    route-bridge.ts               external URL -> openChat; window destination -> URL
  chats/
    index.ts                      public Chat, ChatRun, Chats; existing opaque IDs
    runtime.ts                    privileged connection/mark capabilities
    internal/
      feed.ts                     source selection, identity/location, run projection, indices
      mutations.ts                existing optimistic SessionActions, rename/pin/archive/delete
  window/
    index.ts                      ChatWindow, intents/actions, public read models
    runtime.ts                    privileged constructor/renderer entry point
    internal/
      model.ts                    one placement tree, one preview value, visits and focus data
      navigation.ts               placement reducer + folder-before-commit operation
      attention.ts                looking, unread, visit transitions, toast eligibility
      runtime.ts                  owns state, subscriptions and effect delivery
      storage.ts                  draft/view memory, existing storage codecs and debounce budgets
  ui/
    chat-bindings.ts               selected external-store hooks and renderer attachment
    chat-card.tsx                 shared visual card; reads Chat, does no SDK work
    copy-confirmation.ts          one 2-second copy behavior, shared by card/code/reply
    status-glyph.tsx               renders RunStatus, never interprets execution
    interaction/
      key-owner.ts                today's single DOM key-owner rule
      shell-keys.ts               one global routing order using existing clientActions
    sidebar/                      today's sidebar components + grouping/filter projection
    conversation/                 transcript, composer, parts and trays
    tabs/                         strip view only
    chrome/                       title bar, palettes, account panels
    workbench/                    existing workbench and its workspace-scoped controller
  screens/                        composition of ui components, no see/status/focus policy
  preferences/
    sidebar.ts                    A's settings schema/defaults; no import from ui
    ...                           existing preference keys and store
  theme/, settings/, account/, web/ ... unchanged responsibilities
```

The TypeScript sketch mirrors the new owners and their boundaries. `sketch/usage.ts` contains real caller rewrites; its exported example functions are documentation, not proposed production helper APIs. Large UI directory moves happen last. Do not rename every file while changing behavior.

## Owners and access patterns

| Question | Owner and key | Dominant read |
| --- | --- | --- |
| Who is this chat? | `chats`, connection + SessionId | `useChat(id)` reads byId; title is never derived by a tab or row |
| Where does it run? | `chats`, SessionId -> WorkspaceId -> workspace metadata | Indexed join, then one shared location object per chat. Worktree cwd stays its actual path |
| What is it doing? | `chats`, selected head per SessionId | One OwnRun and RunStatus per chat; parent index computes descendant work once |
| Is it unread here? | `window/attention`, chosen read facts + looking set | `snapshot.unread.has(id)` for rows, tabs, filters and child links |
| Is the user looking? | `window/attention`, active placement + renderer evidence + environment | `expose` produces visiting, shown and looking sets, never one focused ID |
| What is New? | `window`, ViewId within this window | Visit map; normalized attention messages and row membership supply divider/pills |
| Where does an open land? | `window/navigation`, window placement tree | `openChat(id, intent)`, never a controller or router call |
| What receives keys? | `window` focus intent, `ui/interaction` DOM execution | Window-qualified ViewId plus one serial and existing keyOwner guard |
| Who owns draft/view state? | `window`, keys below | Narrow read hooks/edit ports; no component-owned copy of persisted drafts |

The connection index contains `byId`, `byParent`, `byWorkspace` and chosen head facts. These are computed together from references to the current watch snapshots. They are not four writable caches. Root lists, search candidates and children derive from these indices. A ready subscribed unpaced view wins over the all-session list for execution, tip and unread as a unit. A direct info read only fills an absent list entry. An inactive cached view has no precedence. The directory preserves unchanged Chat object identity so selector subscriptions do not redraw the sidebar for streamed text.

Only opaque SDK identifiers cross the ordinary public boundary. `SessionInfo`, `SessionView`, `Execution`, `GitStatus`, query keys and storage schemas do not. The SDK already validated those records. Parsing them a second time would add work without creating a boundary.

### Run mapping and read semantics

`projectOwnRun` starts with plugin `executionMark`, retaining the cross-client working/waiting/retry/failed classification. It refines idle into never-run, completed, stopped or failed. `projectRun` gives own approval priority, then own running/waiting/retry, then descendant work over an idle own run, then its terminal outcome. A failed own outcome is retained even when a descendant keeps the headline working. Retrying has working treatment with a retry detail. A child waiting on its own child still keeps its ancestors working.

Every visual run label/glyph comes from `ChatRun.status`. Stop/run controls use `ChatRun.self`, not the headline. A pending delivery may render its own pending row, but cannot turn into another run-status derivation. Turn outcomes still determine historical failure rows and work-group folding. They are historical content, not current chat status.

Automatic `see` uses the presented selected head's tip only. Explicit Mark as Read uses all current head tips, preserving A's behavior. Core remains the per-principal/per-head forward-only owner. `window/attention` alone derives Nyte's successful unread-completion rule. Failed remains failed until a new run; stopped never produces an unread-completion mark. There is no Mark as Unread operation and no additional wire change.

D1's observed addition is `SessionView.seenThrough: number | null`, including view deltas, not a new seen field on `SessionInfo`. That is sufficient for this release's timestamp boundary. Reuse it. Do not add another read representation, logical clock or read-reset operation.

### Visits, presentation and focus

There are three related sets, all from one function, not three definitions authored by separate components.

- `visitingViews` are pane/detail placements in the active chat tab. A page replaces them. It defines visit lifetime even while the window is blurred or the transcript is temporarily covered.
- `shownViews` require actual presented content and no full transcript cover. It feeds pacing and render scheduling, including when the window is unfocused.
- `lookingViews` are shown views in a visible, focused window. It controls see, unread suppression, boundary freezing and completion-toast suppression. Both split panes count. Tray detail counts independently. The inactive pane is not an invisible pane.

The workbench reports full transcript covers from its layout; a blocking modal reports its affected chat views. Partial overlays do not require pixel intersection machinery. Native browser-view occlusion stays in `workbench/browser-occlusion.ts`; it is a different question. Hidden Activity effects, warm subscriptions and prefetch never enter the looking set.

At observation, initialize each newly eligible visit from its pre-see `seenThrough`, publish that visit, then issue see. Waiting for a baseline is not a null read mark. A blurred or covered visit keeps its fixed boundary; leaving the tab/chat/detail destroys it. Shelf hold reads frozen entry status/unread facts, never another current-status copy.

The initial watch is only a 40-message tail. After opening/restore has settled, a fixed baseline older than that tail uses the existing pager to load through the baseline, or to the start, before publishing an exact first-unread row/up count. Keep its opening/in-flight gates: no history loads during opening and only one load at a time. The baseline is captured before see and survives this load; history prepends still use the transcript's anchor compensation. This is a necessary normal read path, not a new history cache.

The existing transcript projector normalizes eligible assistant/system-user messages. It reports newly eligible live message IDs separately from history prepends. An assistant message whose first text appears after leaving the end counts once, even when its start time is old. Your own prompts and display-only parts never count. Divider comparisons still use assistant start time against the D1 boundary. Down-pill identity cursors are visit-local. This corrects D's time-only down count without inventing a wire sequence.

The transcript remains the sole writer of scroll offsets over TanStack Virtual. Its existing 4 px follow threshold, 60 px jump/pill threshold, 2 px save threshold and 250 ms input attribution remain local scroll policy. The window receives geometry, sends end/reveal commands and owns attention/focus decisions. Revealing unread enters reading at one-third height and only acknowledges the up pill. A down-pill body click goes to the end and follows without focus. The separate jump-end arrow follows and focuses the composer. Neither removes the divider. Up-dismiss marks read/fixes the boundary without scrolling; down-dismiss only resets arrivals.

Window focus requests name ViewId and a single window serial. Tab switches cannot collide with another controller's revision. Open captures the interaction counter before its async folder activation. Later deliberate input cancels delayed focus. Model-picker close, submit, edit and detail release target the originating view. The renderer binds Base UI finalFocus to this same target rather than racing it with another imperative focus effect. Type-to-compose, paste, model picker and global shortcuts share the existing keyOwner rule. Widget-local suggestion/edit/tray Escape precedence stays intact.

### Placement rules

| Intent | Result |
| --- | --- |
| preview | Reveal an existing chat unchanged; else use blank active tab, else replace the one preview in place, else insert after active |
| permanent | Reveal existing unchanged; else absorb blank or insert lasting foreground tab |
| background | Existing is a no-op; else insert lasting tab, without folder activation/focus/see/URL change |
| next-to-parent | Parent ViewId is explicit. Keep parent if previewed; reuse existing preview slot, or insert new preview after the parent's actual tab |
| split | Explicit target and edge; move an existing placement rather than duplicate its draft; promote affected preview tabs |
| replace | Centre-drop target; same dedupe/move and folder rules, with no split |
| started-draft | Transfer residual draft to the new chat; replace its own visible draft only, never a pane chosen since the send started |

The route bridge awaits an external session adoption. On missing, unavailable or cancelled adoption, it restores the URL from the unchanged window destination. There is no second route-driven chat stage.

No strip means one chat tab plus the existing pages. Callers do not branch on strip mode; the owner chooses replace-plus-parent-back behavior. Replaced previews never enter closed history. An explicitly closed preview enters history as permanent. Previews are structurally excluded from saved tabs and cannot contain splits. User reorder, split, Keep Open and submit promote. Typing and activation do not.

Foreground opens, existing-tab activation and pane focus all use one folder-activation path. Unknown waits; rejected trust/open/unavailable outcomes abort placement. The host still owns one current folder, now just the default target of window-scoped commands. File/reference/tool operations use explicit chat workspace capabilities and never recover cwd from that default.

Fast browsing is a normal case, not a speculative race. Retain the existing serialized activation plus one latest pending foreground choice. Do not let an earlier successful folder call commit an obsolete tab choice. No distributed lock, persisted transaction, cross-window placement synchronization or new protocol revision is proposed.

### Persisted and ephemeral state

| State | Key | Persistence/owner |
| --- | --- | --- |
| Lasting tabs/layout/focused pane/recent/closed | `nyte.window.v1:<windowId>:tabs` | Window storage, existing codec, 250 ms debounce + pagehide; desktop only |
| Chat text, selection, image attachments | Existing `...:drafts:session:<sessionId>` and attachment keys | Window storage, 200 ms per owner + pagehide; no per-pane draft copies |
| New-chat text/model/attachments, active/parked draft index | Existing `...:drafts:draft:<id>` plus index | Window storage; keep IDs and ownership even when send resolves off-screen |
| Scroll position | Window + chat + primary/secondary/detail role | Window memory, 64-chat bound; no restart restore |
| Step/work disclosures | Window + chat + group/turn key | Window memory; preserve current fold behavior |
| Divider/up acknowledgement/down identities | Window + ViewId, one visit | Window memory only; neither tab persistence nor draft records may contain these |
| Focus request, interaction counter, bindings | Window + ViewId | Memory only; delete ComposerViewState.focused |
| Split/focused pane | Owning tab's layout | Only tab persistence; delete per-chat split/focusedPane mirror |
| Sidebar grouping/sort/filter/show/folds/revealed counts | A's existing preference keys | `preferences/sidebar`; user preferences, keep across restart and preserve current cross-window semantics |
| Sidebar selected shelf hold | Entry facts of the active visit | Derived by sidebar projection, no component-maintained status copy |
| Queue editing target, recall cursor, picker open, suggestion state | Mounted composer | Local ephemeral interaction state; not shell state |
| Virtualizer heights/measurements, hot/warm retention | Existing transcript/SDK cache keys and bounds | Performance caches only, no read/focus authority |
| Workbench layout/tabs | Existing `nyte:desktop:workbench:v7`, workspace path | Existing workbench controller. Supply path from focused ChatLocation, not host state |

Two windows never write the same draft, placement or visit record. Concurrent see calls merge in core by forward advancement and need no client arbitration. Shared preferences retain last explicit write semantics, which is appropriate for a user choosing a setting. No custom multi-window preferences merge is added. Existing keys and codecs are retained, not abandoned or shadow-written under a v2 namespace. Internal representation changes adapt at the storage boundary.

## Moves and deletions

References without a branch label are from `chat-experience` at `e9a743dc5`, using Phase A's line numbering. Builder labels refer to the working files inspected during this run.

| Today's file:line | Destination and change |
| --- | --- |
| `queries.ts:306-409`, `sdk.tsx:460-475` | `chats/runtime.ts` uses all-list + direct-info fallback. Delete root-first session selection and root-only tab lookup |
| `queries.ts:238-273`, `view-helpers.ts:37-49`, `session-list.ts:19-26` | `chats/internal/feed.ts` owns workspace resolution; sidebar grouping may use source metadata but cannot substitute it for cwd |
| `chrome/github-account.ts:37-58`, `screens/workspace-context.tsx:27-44` | Chat metadata uses workspace-scoped lookups. Account/auth UI stays account-scoped |
| `queries.ts:160-170`, `:172-191`, `:199-207` | Delete sessionFolderPath and chat reads of selectedWorkspaceId. Make file/git operations accept the actual workspace. Host state remains only runtime/default-folder state |
| `screens/pane-host.tsx:144-150`, `screens/session-conversation.tsx:301,353`, `conversation/composer.tsx:162` | Per-view location/cwd/reference opener uses ChatLocation. Never read host.data.workspace to describe an existing chat |
| `queries.ts:320-341`, `session-activity.ts:5-12` | Derive descendant activity in chats index from chosen runs. Delete useWorkingSessionIds/sessionActivityMark |
| `conversation/agent-status.ts:6-24`, `conversation/subagent-status.ts:34-68`, `chrome/status-glyph.tsx:8-18` | Shared ChatRun; delete wrappers and stopped-as-failed branch. Tool-only callStatus remains tool content until child identity exists |
| `chrome/sidebar-view.ts:70-161`, `chrome/sidebar-rows.tsx:113-128` | Keep grouping/filter presentation in ui/sidebar, but consume RunStatus and window unread set, no execution interpretation |
| `tabs/use-window-tabs.tsx:113-189`, `chrome/sidebar-rows.tsx:30-32`, `conversation/tray/agents.tsx:48-77` | Use shared Chat title/status and window tab summaries. Delete local fallback and unread/head selection logic |
| `conversation/transcript-rows.ts:74-110,280-282`, `screens/session-conversation.tsx:170-184` | Current live/announcer treatment uses shared run status; historic turn outcomes remain transcript content |
| `session-read-state.ts:3-12`, `screens/session-conversation.tsx:250-296` | Delete heads[0] unread helper, MarkSeen and SeeTip. Window attention alone requests auto-see |
| `layout/pane-layout.ts:97-105`, `sdk.tsx:479-490` | Delete unused visibleSessionIds and mounted-visible counter; pacing receives the one shown-chat projection |
| `tabs/window-tabs.ts:148-298`, `tabs/model.ts:314-398`, `layout/pane-controller.ts:106-335` | Reuse reducers/storage in window; delete PaneController class, controller map, layout callback/show round trip, per-chat split memory and local focus revisions |
| `layout/pane-context.tsx:12-105` | Remove session-selection/new-chat/drop mutation APIs. Keep a thin pane address/context for render composition |
| `tabs/use-window-tabs.tsx:30-111`, `chrome/use-show-session.ts:6-25` | Folder-before-commit inside window navigation; route bridge only mirrors/adopts. Delete folder-follow React subscription and sidebar preactivation |
| `router.tsx:272-441`, `tabs/places.ts` | Keep route decoding/guards. Adopting a session calls openChat; pages use open-page action |
| `layout/session-dnd.tsx:206`, `chrome/titlebar.tsx:87-102` | Explicit split/replace/permanent intents. No pane-level bypass for drop or parent back |
| `conversation/draft-start.ts:91,104`, `layout/pane-controller.ts:227-237` | `openChat(..., started-draft)` owns conversion of the original draft only |
| `shell/focus-owner.ts:1-21`, `router.tsx:166-204`, `screens/pane-host.tsx:27-83` | Keep one keyOwner in ui/interaction. Consolidate the three global key listeners and remove FocusComposer revision-mount behavior |
| `conversation/composer.tsx:178-187,462,566,580`, `screens/session-conversation.tsx:514`, `conversation/transcript.tsx:755-758` | Use semantic focus actions/binding. Remove competing portal/refocus effects; transcript end remains its scroll operation |
| `layout/session-view-state.ts:21-44,259-560` | Window storage owns drafts/view memory. Delete focused, per-chat split and focusedPane mirror; keep stored draft and image codec |
| `workbench/controller.ts:91-93,367-384,611-620`, `screens/session-screen.tsx:371-382` | Workbench retains its layout/storage. Reports full covers and accepts focused chat's explicit workspace key |
| `client-plugins.tsx:25-41`, `packages/plugin/src/client/mount.ts:374-393` | Replace app's imported notifications completion plugin with app adapter. Reuse mount's event seeding/dedupe; do not create a second run-end detector |
| chat-sidebar `sidebar-view.ts:42-75`, `preferences/index.ts:131-147`, `sidebar-lists.tsx:59-65` | Keep builder schemas/keys, move schema/defaults to preferences/sidebar. This removes preferences -> chrome import. Calendar buckets, pins, navigation and row interactions remain sidebar UI |
| chat-sidebar `sidebar.tsx:102-118` | Replace direct all-head see loop with window.markRead; existing failure feedback stays at command boundary |
| chat-composer `composer-keys.ts:36-110`, `composer-history.ts:9-34`, `composer.tsx:148,215-241` | Preserve enterBehavior, prompt history and transient composer state. ComposerSituation is an input-mode concept, not a competing run mapping |
| chat-composer `pane-host.tsx:26-73`, `composer.tsx:793-799`, `model-picker.tsx:180` | Keep paste/model shortcut behavior and focus target, move ownership into shared renderer/key binding |
| chat-blocks `copy-confirmation.ts:5-23`, `code-block.tsx:137-180`, `turn-view.tsx` actions row | Move one copy hook to shared ui and reuse for E's card. Keep aggregate verbs, worked duration and final-reply copy semantics in transcript presentation |
| chat-unread `views.ts:150-154`, core `fold/project.ts:94,108-112`, protocol `view-frames.ts:66,141` | Keep D1 wire addition and delta handling unchanged; no new schema/sdk work proposed |
| chat-unread `transcript-unread.ts:19-137`, `timeline.tsx:164-181`, `window-active.ts:3-21` | Reuse pure visit rules in window attention; delete component visit state/window listeners. Replace timestamp-only arrival cursor with live identity accounting |
| chat-unread `transcript-mode.ts`, `transcript-scroll.ts`, `transcript.tsx` | Keep 4 px/upward-only follow, geometry and actual scroll engine. Only semantic attention/focus moves out |
| chat-shell `components/chat-card.tsx:84-110`, `chat-card-facts.ts:33-68` | Card consumes Chat; remove its useSession/useWorkspaces/git/GitHub queries and renderer-surface machine guess. Actual folder path is copied |
| chat-shell `conversation/agent-status.ts:4-29`, plugin `notifications.ts:17-28` | Keep failed/completed visual distinction through RunStatus. App no longer uses api.session as its toast visibility test; generic plugin remains for other clients |
| chat-tabs `tabs/model.ts:24-61,261-294,309-333,352-410`, `window-tabs.ts:202-205` | Preserve F's behaviors, strengthen to one preview value and one placement reducer. openChat gains folder ordering and explicit parent/split/draft targets, not another forwarding layer |
| chat-tabs `screens/session-conversation.tsx:419-425`, `chrome/sidebar.tsx:81-93` | Child/sidebar calls become the usage examples. Delete strip branches and beside/controller bypass |

## Import direction and enforcement

```text
UI -> chats/index + window/index, through ui/chat-bindings
screens -> UI + the same public entries
window internal -> chats/index + chats/runtime
chats internal -> SDK/client + plugin presentation
runtime/chat-shell -> chats/runtime + window/runtime + bridge/connection/preferences
preferences -> its schemas/store, never UI/chats/window/runtime
```

`chats` never imports `window`. Neither imports React, UI components, router objects, `@nyte-ai/host` or workbench internals. Window receives folder/route/notification/key-owner ports. These ports adapt real external capabilities; there is no generic command bus or container. The only DOM-bearing port is in the privileged renderer entry point. Ordinary public types contain no HTMLElement/React/virtualizer types.

Enforce boundaries when introducing the directories. Extend the existing oxlint restricted-import checks with resolved-file checks for these two owners. Deny external access to their `internal/` trees, including type-only imports. Permit `chats/runtime.ts` only to window internals and the two named runtime composition/notification files. Permit `window/runtime.ts` only to `runtime/chat-shell.ts`, `runtime/completion-plugin.ts` and `ui/chat-bindings.ts`. Ordinary UI can use only the public index/hooks for these shell concepts. Transcript/part rendering may still consume its existing content pipeline; it cannot interpret raw execution or read marks as shell status. This is one small path-boundary rule in the existing lint system, not a new build tool.

Also reject imports of the retired chat-specific selectors/mutators after cutover. Delete them in the same commit that migrates their last call sites; do not leave deprecated forwarding exports. The intended negative proof is a sidebar import of `window/internal/navigation.ts` failing lint even though TypeScript can resolve it. That proof belongs to implementation; it was not run for this read-only sketch.

## Migration order

Consolidation starts after all six builders merge. Preserve their behavior before moving their files.

1. Add the normalized chat directory beside existing watches and install the import boundary. Move only sidebar preference schema/default ownership so preferences no longer imports chrome. Switch title/card/tab/tray lookup to the all-session projection. Existing navigation and see behavior still work. Check child tabs, worktree metadata, Home vs loading and unnamed chat titles through the current renderer journeys.
2. Move current-run classification and descendant calculation into the directory. Migrate sidebar, tabs, palette, tray, child rows, composer controls and current transcript/announcer status in one pass. Delete the app mappings when their last consumer moves. Keep plugin executionMark and tool/historical-turn presentation. Check approval, retry, failure, stop and parent-idle/child-working via existing app tests and subagent journeys.
3. Replace chat cwd/reference/workbench inputs with per-chat workspace capabilities. Update file/git helpers and all their consumers together; no optional current-workspace fallback. Retain the host's default folder for new-chat/window commands. Check split chats in different folders, worktree copy values and capability-unavailable paths. This can land before changing the placement engine.
4. Replace WindowTabs plus PaneController with the single window state. Move the existing pure tab/pane reducers and storage codecs, then atomically migrate every open/drop/draft/parent/route/tab/pane action to the one API. Reuse the existing draft store logic inside the window owner and preserve its storage format. Add window-qualified focus delivery now so navigation still focuses correctly when controllers disappear. Remove old controller APIs and folder-follow logic in this same change. This is the riskiest commit, but an app that has two placement engines is harder to verify than this cutover. Replay desktop and no-strip web navigation, trust cancellation, preview promotion/reopen/reload and hidden-draft completion.
5. Transfer visit/read/visibility ownership together. Bind presented views, derive exposure, initialize baselines, then replace MarkSeen, D's component-local visit state, tab unread suppression and mounted pacing counters. Switch the app completion plugin adapter in the same change. There must never be a frame where the old see effect advances before the new visit captures its baseline. Replay the exact divider/up/down/blur/return journeys, both split panes, page replacement, covered workbench and tray detail.
6. Replace remaining manual focus effects and popup returns with window actions and one renderer binding. Preserve composer-local edit, prompt recall, suggestion and Escape semantics. Remove ComposerViewState.focused and local revision keys. Reuse the shared copy-confirmation hook for E's hover card. Replay send, jump-end, picker-close, tab switch, paste/type-to-compose and dialog focus retention.
7. Move the now-thin views into ui folders, update imports and delete root chat helpers. Keep non-chat queries/workbench functionality where it is until a later focused change. This final move is mechanical and must add no behavior.

At each step use the existing package/renderer/e2e suites; this candidate adds no tests or servers. After D's existing wire changes merge, run host check:store. Final verification remains `pnpm check`, app tests and the specified desktop journeys twice without retries, as plan.md requires. The sketch does not claim those results.

## Input snapshot and sketch checks

Observed base `chat-experience` HEAD was `e9a743dc5`. Requested `git diff chat-experience...HEAD --stat` was run for all six worktrees. A and B had uncommitted edits; F's openChat/preview work appeared as uncommitted edits during the run, so its branch diff was initially empty. Both working diffs and the relevant files were read. C was `8ea0ea0d9`, D `19149f9fd`, E `435cc0e24`; A/B/F reported `e9a743dc5` during capture. These are moving inputs, not constraints on the final synthesized API.

`pnpm --dir /Users/workgyver/.nyte/worktrees/nyte/chat-experience exec tsc --project /tmp/arch/sol/tsconfig.json --pretty false` passed against installed TypeScript 6.0.3 and real SDK/plugin types, with no emit/incremental output. All generated artifacts are under `/tmp/arch/sol/`. Runtime behavior, application tests, lint boundary enforcement and host store checks were not run because this is an unimplemented, read-only design candidate. No server was started.
