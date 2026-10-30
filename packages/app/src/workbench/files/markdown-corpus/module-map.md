# Module map (opus candidate)

Paths are relative to `packages/app/src/` unless they start with `packages/`. Line numbers refer to `chat-experience` at `e9a743dc5`. Builder-branch files are named by branch.

## Target structure

```
packages/app/src/
  ── data (unchanged in this track; root files stay where they are)
  sdk.tsx  queries.ts  nyte.ts  bridge.ts  first-frame.ts  router.tsx …

  ── concepts: one owner per shared concept, each with index.ts as its only public file
  chats/        what is true about a chat, in any window
    index.ts  chat.ts  directory.ts  status.ts  repository.ts  actions.ts
  window/       this window: places, what's on screen, keyboard, memory
    index.ts  tabs.ts  panes.ts  open.ts  chat-commands.ts  screen.ts  trays.ts
    focus.ts  view-state.ts  store.ts (private)  host-folder.ts (private)  route-sync.ts
  attention/    what the user has and hasn't seen
    index.ts  look.ts  read-mark.tsx  notices.ts  visit.ts

  ── surfaces: draw and dispatch, own no shared concept
  chrome/       sidebar*, titlebar, search palette, tab-strip.tsx (from tabs/), settings panels …
  conversation/ transcript, composer, trays, subagent rows, blocks
  screens/      stage composition: session-screen, pane-host, session-conversation, blank-conversation, session-dnd
  workbench/    right panel (its controller.ts stays: window/screen reads its cover predicate)
  components/   shared UI: StatusDot, chat-card
  shell/        app-menu command router (window-commands.ts)
  settings/ preferences/ theme/ web/ account/ break/
```

`tabs/` and `layout/` disappear: the model and store move into `window/`, and the strip becomes a `chrome/` surface. `shell/focus-owner.ts` moves into `window/focus.ts`.

## Import direction

```
surfaces (chrome, conversation, screens, workbench UI, components, shell, settings, web)
   │  import any concept through its index.ts
   ▼
attention/ ──▶ window/ ──▶ chats/ ──▶ data (root) ──▶ @nyte-ai/sdk, @nyte-ai/plugin/client/presentation
                 │
                 └──▶ workbench/controller.ts (read-only: cover predicate; it imports only root)
```

Rules, enforced with oxlint `no-restricted-imports` overrides in `oxlint.config.ts`:

1. Outside `chats/`, `window/` and `attention/`, an import of `**/<concept>/*` must be `**/<concept>/index.ts`.
2. `chats/` imports neither `window/` nor `attention/`. `window/` doesn't import `attention/`. No concept imports a surface folder.
3. The one allow-listed internal edge is `window/chat-commands.ts` → `chats/actions.ts` (`setArchived`, `deleteChat`).
4. `@nyte-ai/sdk` list and view wire types (`SessionInfo`, `HeadInfo`, `WorkspaceInfo`) are imported for chat facts only in `chats/`. Surfaces still use `SessionView` for transcript content.

## What moves where

### chats/

| From | To | Notes |
| --- | --- | --- |
| `queries.ts:320-341` `useWorkingSessionIds` | `chats/directory.ts` descendant pass | `delegating` on each `Chat` |
| `queries.ts:306-318` `useRootSessions`, `:343-350` `useWorkspaceSessions` | `chats/directory.ts` `useChats` | first-frame roots seed kept |
| `queries.ts:376-409` `useSession` (roots → all → read fallback) | `chats/directory.ts` `useChat` | callers that only want facts move. `useSession` stays for raw `SessionInfo` until the last caller goes |
| `queries.ts:160-170` `sessionFolderPath` | `Chat.folder` + `readChat` | `undefined` vs `null` now structural |
| `queries.ts:243-273` worktree mapping | `chats/directory.ts` folder resolution | |
| `queries.ts:108-116` session projection | `chats/directory.ts` (reader), `chats/actions.ts` (writer) | private to chats/ |
| `session-activity.ts:5-12` | deleted → `ChatStatus.delegating` + `statusLook` | |
| `session-read-state.ts:3-12` (`heads[0]`) | deleted → `ChatStatus.unread` (main head) | |
| `conversation/agent-status.ts` (and chat-shell's version) | deleted → `statusLook(...).active` / `.glyph` | E3 falls out |
| `conversation/subagent-status.ts:34-68` `sessionStatus` | deleted → `useChatLook` | `callStatus` (tool-only, `:14-32`) maps `ToolStatus.tone` onto the same `StatusGlyph`; `subagentActivity` stays (view activity) |
| `chrome/sidebar-view.ts:70-91` `deriveSessionStatus`, chat-sidebar's `sessionIsRunning` | read `Chat.status` / `statusLook(status, false)` | shelf hold (`sidebar.tsx:206-220`) stays in the sidebar |
| `chrome/sidebar-rows.tsx:113-128` `sessionAsk` | `ChatStatus.notice` | |
| Title fallbacks: `sidebar-rows.tsx:30-32`, `use-window-tabs.tsx:113-117`, `titlebar.tsx:84`, `session-conversation.tsx:374`, `search-palette.tsx:51`, `workbench/tab-strip.tsx:221-225`, `tray/agents.tsx:48-50`, `subagent-call.tsx:238`, `approval-state.ts:72`, `questions-state.ts:194` | `Chat.title` | origin lines ("a subagent") keep their sentence and read `chat.title` |
| `chrome/sidebar.tsx:291`, `sidebar-view.ts:28` literal `"local"` | `ChatFolder.machine` | |
| chat-shell `components/chat-card.tsx:84-100` (git + GitHub reads) | `chats/repository.ts` `useFolderRepository` | `chat-card-facts.ts` becomes pure over `Chat` + `FolderRepository` |
| `screens/workspace-context.tsx:23-44` open-folder repo/branch | `useFolderRepository(hostFolder)` | |
| `session-actions.ts:99-180` rename/pin | `chats/actions.ts` | |
| `session-actions.ts` archive/delete + `layout/pane-context.tsx:30-32` `hideFromPanes` | `window/chat-commands.ts` + store `chats-gone` reaction | |
| `packages/plugin/src/client/presentation.ts:241-284` | adds `runState`; `executionMark` collapses it | TUI and mobile unchanged |

### window/

| From | To | Notes |
| --- | --- | --- |
| `tabs/model.ts` (all) | `window/tabs.ts` | adds `preview`, `open-chat` with `parent` + intent, `start-chat`, `keep`, `pane`, `chats-gone`; `reopen-tab` takes `skip` |
| `tabs/window-tabs.ts:148-298` `WindowTabs` | `window/store.ts` | the `#controllers` map, `#route` and `show()` go; `#flush` writes `savedState` (no preview) |
| `tabs/window-tabs.ts:194-217` `newChat`, `showDraft` | `window/open.ts` | |
| `tabs/places.ts`, `tabs/use-window-tabs.tsx:37-111` (adopt + navigate) | `window/route-sync.ts` | |
| `tabs/use-window-tabs.tsx:30-35`, `:54-74` (restore + folder follow), `chrome/use-show-session.ts:6-25` | `window/host-folder.ts` | the only chat-focus caller of `openWorkspace` |
| `tabs/use-window-tabs.tsx:113-190` (titles, glyphs, unread) | `chrome/tab-strip.tsx` over `useChat` + `useChatLook` | |
| `tabs/window-tab-strip.tsx` | `chrome/tab-strip.tsx` | surface |
| `layout/pane-layout.ts` | `window/panes.ts` | `visibleSessionIds` (`:97-105`, no readers) deleted |
| `layout/pane-controller.ts` (336 lines) | deleted | layout → store; selection → `open.ts`; `focusRequest` (`:133-139`, `:152-164`, `:308-315`) → `focus.ts`; `#rememberLayout` split memory (`:317-335`) deleted |
| `layout/pane-context.tsx:85-137` `usePaneActions` | `window/panes.ts` `usePanes` | without `openSession`, `openSessionInPane`, `drop`, `openDraftChat` |
| `layout/session-view-state.ts:20-110`, `:486-560` | `window/view-state.ts` | per-pane `scroll`, `split`, `focusedPaneId`, `focused` deleted; storage keys unchanged |
| `layout/session-view-state.ts:259-484` `WindowDrafts` | `window/view-state.ts` | unchanged |
| `layout/session-dnd.tsx` | `screens/session-dnd.tsx` | drop calls `openChat(id, { beside, pane })` |
| `shell/focus-owner.ts` | `window/focus.ts` `keyOwner` | |
| `screens/pane-host.tsx:72-83` `FocusComposer` | stays; keyed by `useFocusRequest(spot)` | |
| `screens/session-conversation.tsx:312-329` tray `useState` | `window/trays.ts` `useTray(chat)` | |
| `screens/session-screen.tsx:373-382`, `session-conversation.tsx:269-273` cover rule | `window/screen.ts` `covered` | reads `workbench/controller.ts:91-93` |
| chat-unread `window-active.ts` | `window/screen.ts` input | private |
| `app.tsx:25-29` `focusedSession` | `screen.get().focused` | the plugin `session()` callback |
| `sdk.tsx:479-490` `showTranscript` counter | store pushes `screen.shown` into pacing | the counter and its effect callers go |

### attention/

| From | To | Notes |
| --- | --- | --- |
| `screens/session-conversation.tsx:236-296` `subscribeAttention`, `MarkSeen`, `SeeTip` | `attention/read-mark.tsx` `ReadMark` | `useLooking` replaces focus + cover reads |
| — (A7) | `attention/read-mark.tsx` `markRead`, `markAllRead` | |
| `client-plugins.tsx:34-39` `notify` | `attention/notices.ts` `deliverNotice` | |
| chat-shell `notifications.ts` guard `api.session?.id === event.session` | deleted; the plugin passes `session` | `packages/plugin` notify input gains `session?` |
| chat-unread `conversation/transcript-unread.ts` | `attention/visit.ts` | `TranscriptPlace` mapped to `VisitPlace` by the transcript |
| chat-unread `conversation/timeline.tsx:164-181` visit wiring | `attention/visit.ts` `useUnread` | keyed on `useVisit`, fed `useAttended` |
| `tabs/use-window-tabs.tsx:179-186` "not the active tab" unread rule | `statusLook(status, looking)` | |

## Every open call site, with its intent

| Trigger | Today | After |
| --- | --- | --- |
| Sidebar plain click | `sidebar.tsx:81-87` foreground | `openChat(id, "preview")` |
| Sidebar ⌘-click / middle-click | `sidebar-rows.tsx:41-45`, `:285-287` | `openChat(id, "background")` |
| Sidebar "Open Chat to the Side" | `sidebar.tsx:91-93` | `openChat(id, { beside: "right" })` |
| Search palette | `sidebar.tsx:405-411` | `openChat(id, "permanent")` (open question 1) |
| Draft row | `sidebar.tsx:263` → `showDraft` | `showDraft(draftId)` |
| New chat (row, ⌘N, menu, palette, workspace "+") | `windowTabs.newChat()`; "+" awaits `activateWorkspace` first (`sidebar.tsx:238-242`) | `newChat()`; "+" calls `newChat(workspaceId)`, which switches the host folder first |
| Draft sent | `draft-start.ts:91`, `:104` → `openDraftChat` | `startChat(draftId, id)`, which also keeps the tab |
| Tray "open as full chat" | `session-conversation.tsx:510-513` | `openChat(child, "preview")` |
| Subagent call row / citation (strip present) | tray detail (`subagent-call.tsx:227-241`) | unchanged by default; F decides whether a citation uses `openChat(child, "preview")` |
| Back to parent | `titlebar.tsx:87-102` | `openChat(parent, "permanent")` |
| Drag onto a pane | `session-dnd.tsx:206` | `openChat(id, { beside: placement, pane })` |
| Startup / route reached | `router.tsx:289-348` → adopt | route-sync → `openChat(id, "permanent")` |
| Missing session | `router.tsx:386-402` | route-sync → `newChat()` |
| Customize / Environments | `shell-state.ts:81-93` | `openPage(page)` |
| Toast click | none | `deliverNotice` → `openChat(id, "permanent")` |
| Archive / delete | `pane-context.tsx:30-32` (pane tab only) | `archiveChat` / `deleteChatCommand`; any-client archive → `chats-gone` |
| Composer submit in a preview | none | `keepOpen(id)` |

## Migration order

Each step ships on its own with `pnpm check` and the app tests green. New code lands in its target folder from the start. Only existing files move, and they move last (step 9), after the six builder branches have merged, so no step moves a file a builder still edits.

1. **Run vocabulary.** Add `runState` to `packages/plugin/src/client/presentation.ts` and reimplement `executionMark` over it. No behaviour change. Plugin tests.
2. **The chat directory.** Add `chats/` beside `queries.ts`; it reads the same watches. Move readers one surface at a time:
   - tab items: subagent tabs get a title and glyph;
   - sidebar row glyph and notice, palette;
   - agents tray and subagent rows: stopped and failed agree, E3;
   - chat card: absorbs chat-shell's inline reads;
   - title bar, approval and question origins.

   Delete `session-activity.ts`, `session-read-state.ts`, `agent-status.ts`, `sessionStatus`, `status-glyph.tsx` and `useWorkingSessionIds` as their last readers go. Until step 3 the tab keeps its "not active" unread rule, passed as `looking`.
3. **Visibility.**
   - Move the tray view into `window/trays.ts`.
   - Add `window/screen.ts` over the current `windowTabs` snapshot, workbench cover and window focus.
   - Switch `MarkSeen` to `ReadMark`, the tab and row glyphs to `useChatLook`, and the plugin `session()` to `screen.focused`.
   - Make text pacing read `screen.shown`.
   - Add `session` to the plugin notify input, switch `notify` to `deliverNotice`, and delete chat-shell's guard.
   - Delete `visibleSessionIds` and the `showTranscript` counter.
4. **Unread visit.** Move chat-unread's reducer to `attention/visit.ts`, key it on `useVisit` and feed it `useAttended`. The divider no longer depends on `Activity` effect cleanup.
5. **One open path.**
   - Add `open-chat` with `parent`, intents and the preview slot to the tab reducer. This is F1–F4; chat-tabs should build it here rather than beside `windowTabs.dispatch`.
   - Add `openChat` and the host-folder ordering.
   - Move every call site in the table above.
   - Delete `showSession`, `PaneActions.openSession`, `openSessionInPane` and `drop`, and the folder activation in `sidebar.tsx:81-83`.
6. **One focus serial.** The store issues `FocusRequest`, `PaneHost` reads `useFocusRequest(spot)`, and the transcript jump calls `focusComposer` (D5). Delete chat-unread's `focusComposer` prop.
7. **Delete PaneController** *(riskiest)*.
   - Layout ops dispatch window `pane` actions.
   - Drafts become `startChat` / `showDraft` in the store.
   - `SessionViewStateStore` becomes `window/view-state.ts` keyed by chat, with storage keys unchanged.
   - Drop split memory, per-pane scroll and `focused`.

   Run the navigation, composer, chat and transcript e2e chapters twice with `--retries=0`.
8. **Per-chat cwd.** The transcript, composer, references and subagent activity read `chat.folder.path` instead of `useHostState().data.workspace` (`session-conversation.tsx:353`, `pane-host.tsx:144-150`, `composer.tsx:162`). The workbench keeps the host folder. Verify a split across two folders.
9. **Folder moves and the boundary lint.**
   - Move `tabs/model.ts`, `window-tabs.ts`, `places.ts` and `layout/*` into `window/`; the tab strip into `chrome/`; `focus-owner.ts` into `window/`.
   - Add the `no-restricted-imports` overrides, and prove they fail on a deliberate `../chats/directory.ts` import from a surface.
   - This step is mechanical; do it with `git mv` so blame survives.

## Size estimate

**Deleted:**

| What | Lines |
| --- | --- |
| `pane-controller.ts` | ~336 |
| Status and read helpers: `session-activity`, `session-read-state`, `agent-status`, `sessionStatus`, `status-glyph` | ~110 |
| Tab title, glyph and unread derivation | ~75 |
| `MarkSeen`/`SeeTip`/`subscribeAttention` | ~55 |
| `useWorkingSessionIds` + `useRootSessions` + `useWorkspaceSessions` | ~45 |
| Split memory and per-pane scroll in view state | ~40 |
| `showSession` + pane-level open methods | ~35 |
| Pacing counter | ~12 |
| `visibleSessionIds` | ~9 |
| Inline card reads | ~17 |
| Ten title fallbacks | scattered |
| **Total** | **~730** |

**Added:**

| What | Lines |
| --- | --- |
| `chats/` | ~260 |
| `window/` open, screen, focus, trays, chat-commands (beyond moved code) | ~300 |
| `attention/` (beyond the moved reducer) | ~80 |
| **Total** | **~640** |

The net reduction is small. The gain is in readers: each concept has one owner instead of three to ten.
