# Grounding: how Nyte's chat shell works today

Phase A of the architecture track in [plan.md](../plan.md). This is a traced model of the shell at `chat-experience` (origin/main `5aabfa0cd` plus the spec docs). It proposes no design. Each section ends with the constraints a design has to respect.

Paths are relative to `packages/app/src/` unless they start with `packages/`. Line numbers refer to this commit. Terms follow `docs/glossary.md`: session = chat, workspace = folder, window tab vs workbench tab, pane = one of two chat columns in a tab.

Two data streams feed almost everything below, so they are named once here:

- **The session list.** `sessionsWatch("roots" | "all")` (`sdk.tsx:460-463`) streams `SessionInfo[]`: id, name, parent, workspace, pinned, archived, and per head `execution` and `unread` (`packages/schema/src/sessions.ts:12-36`). The sidebar, tabs, search palette, title bar and agents tray read this stream.
- **The session view.** `sessionWatch(id)` (`sdk.tsx:526-572`) streams one head's `SessionView` (`packages/schema/src/views.ts:129-150`): messages, queue, turns, `execution`, heads, plus an app-side `activity` (`conversation/session-activity.ts:32-57`). The transcript, composer, RunAnnouncer and seen marking read this stream.

Both carry an `execution`. They come from different host reads and can disagree for a frame or more. No module reconciles them.

---

## 1. Chat identity and location

### Source of truth

| Field | Owner | Where |
| --- | --- | --- |
| Session id, name (title), parent, call, workspace id, pinned, archived, activation, createdAt, lastActivityAt | Host, through `SessionInfo` | `packages/schema/src/sessions.ts:24-36` |
| Head (name, tip, stack, execution, unread) | Host, through `HeadInfo` | `packages/schema/src/sessions.ts:12-20` |
| "Main" head | SDK constant `MAIN = "main"`; `session(id)` spreads the main head's handle | `packages/sdk/src/client.ts:43`, `:160` |
| Workspace path, name | `WorkspaceInfo.target`, derived by `workspacePath` / `workspaceName` | `view-helpers.ts:37-49` |
| Worktree (source folder, branch) | `WorkspaceInfo.isolation`, mapped to `RailWorkspace.worktree` | `queries.ts:243-273` (`:261-264`) |
| Live git branch | VCS snapshot of the **host's open workspace** | `screens/workspace-context.tsx:27-44` |
| GitHub `owner/repo` | `useGitHubState`, keyed by the **host's open workspace** path | `chrome/github-account.ts:37-58` |
| Machine / environment | Not modelled. The sidebar passes the literal `"local"` | `chrome/sidebar.tsx:291`, `chrome/sidebar-view.ts:28` |
| "Current folder" of the window | Host state `host.data.workspace`, one per host connection | `queries.ts:199-207`, `chrome/use-show-session.ts:6-25` |

A chat's folder is **not** what a surface reads as the chat's location. Most surfaces read the host's single open workspace (`useHostState().data.workspace`, 16 files). The window keeps that workspace equal to the folder of the active tab's focused chat (`tabs/use-window-tabs.tsx:48-75`).

### Writers

| Writer | File:line | What |
| --- | --- | --- |
| Rename (sidebar row, pane header) | `chrome/sidebar.tsx:256`, `screens/session-conversation.tsx:376-382` via `queries.ts:975` | `name` |
| Pin / archive / delete (optimistic) | `session-actions.ts:99-180`; the projection is applied in `queries.ts:108-116` | `pinned`, `archived`, hides the row |
| Folder activation on chat focus | `tabs/use-window-tabs.tsx:64-74` → `chrome/use-show-session.ts:6-25` | host open workspace |
| Folder activation before a sidebar open | `chrome/sidebar.tsx:81-83` | host open workspace, awaited, cancels the open on failure |
| Folder restore at startup | `tabs/use-window-tabs.tsx:30-35` (`nyte.host.restore`) | host open workspace |

### Readers

| Surface | File:line | What it reads / derives |
| --- | --- | --- |
| Sidebar row label | `chrome/sidebar-rows.tsx:30-32`, `:173` | `name ?? "New chat"` |
| Sidebar row hover card | `chrome/sidebar-rows.tsx:336-364` | Title; `owner/repo` **only when the row's folder is the host's open folder** (`:171`); `place.path`, the **group's** folder path, which for a worktree chat is the source folder (`session-list.ts:19-26`) |
| Sidebar row drag label | `chrome/sidebar-rows.tsx:178` | title |
| Window tab title | `tabs/use-window-tabs.tsx:113-135`, `:176` | `name ?? "New chat"`, but only from **root** sessions (`useWorkspaceSessions` → `sessionsWatch("roots")`, `queries.ts:306-318`, `:343-350`); a subagent tab falls through to `"Chat"` (`:114`) |
| Window tab tooltip | `tabs/use-window-tabs.tsx:177`, `tabs/window-tab-strip.tsx:142-152` | Pane titles joined by `" \| "` plus the ⌘N shortcut. No folder, branch or repo |
| Title bar (web, no strip) | `chrome/titlebar.tsx:42-110`, shown only when `!strip` (`:196-204`) | `useSession` name, folder name, worktree branch, "Back to parent chat" |
| Title bar (desktop, strip) | `chrome/titlebar.tsx:196-197` | The tab strip. No chat location anywhere in the desktop title bar |
| Split pane header | `screens/session-conversation.tsx:374`, `:431-466` | `sessionName ?? "New chat"` |
| New-chat context row | `screens/workspace-context.tsx:23-44`, mounted at `screens/blank-conversation.tsx:169` | Host open workspace: `owner/repo` or folder name, live VCS branch |
| Workbench "chat" tab label | `workbench/tab-strip.tsx:221-225`, `:354` | `useSession` name `?? "New chat"` |
| Search palette | `chrome/search-palette.tsx:51` | `name ?? "New chat"` |
| Agents tray row | `conversation/tray/agents.tsx:48-50` | `name ?? sessionId` |
| Subagent call row | `conversation/subagent-call.tsx:238`, `:266`, `:469`, `:574` | `name ?? "Subagent"` or the tool title |
| Subagent citation folder | `conversation/subagent-call.tsx:551-560` | Worktree branch or folder name of the child's workspace |
| Approval / question origin | `conversation/approval-state.ts:72`, `conversation/tray/questions-state.ts:194` | `name ?? "a subagent"` |
| "Run finished" toast | `packages/plugin/src/client/notifications.ts:17-20` | `info.name ?? undefined`; an unnamed chat shows the message as the title |
| Transcript, composer, references cwd | `screens/session-conversation.tsx:353`, `screens/pane-host.tsx:144-150`, `conversation/composer.tsx:162` | **Host open workspace path**, not the chat's own folder |
| Workbench view | `workbench/controller.ts:122-124`, used by `screens/session-screen.tsx:371`, `chrome/titlebar.tsx:141` | Keyed by the host open workspace path |

### Duplicates and divergences

- **Six title fallbacks**: `"New chat"` (sidebar row, tab, title bar, pane header, palette, workbench tab), `"Chat"` (tab, unlisted session), `sessionId` (tray), `"Subagent"` (call row), `"a subagent"` (approvals), `undefined` (toast). No shared function.
- **Tab titles drop subagents.** A tab can hold a child (subagent "open as full chat", `screens/session-conversation.tsx:510-513`), but the tab reads only root sessions, so it shows "Chat" with no glyph and no unread mark (`tabs/use-window-tabs.tsx:138-151`). The title bar uses `useSession`, which falls back from roots to all to a direct read (`queries.ts:376-409`).
- **Three branch sources**: the worktree branch from `WorkspaceInfo.isolation` (title bar `chrome/titlebar.tsx:65-73`, citation `conversation/subagent-call.tsx:553`), the live VCS branch of the open folder (`screens/workspace-context.tsx:40-44`), and none in the sidebar hover card.
- **Three path choices for one chat**: the sidebar card shows the group folder, which is the worktree's source (`session-list.ts:19-26`). The title bar shows the folder name with the worktree path in a tooltip (`chrome/titlebar.tsx:59`, `:67`). The citation shows the worktree path (`conversation/subagent-call.tsx:556`).
- **Repository is known only for the open folder.** The hover card hides `owner/repo` for every other folder (`chrome/sidebar-rows.tsx:171`), so the spec's E1 card has no per-chat source today.
- **cwd is per window, not per pane.** In a split with chats from two folders, focusing a pane switches the host folder (`tabs/use-window-tabs.tsx:54-74`). Both panes then resolve paths and tool details against that one folder.

### Rationale from history

- `86a05de23` (refactor(app)!: run every window on window tabs): "the route and the active tab agree in one place … a route reached on its own becomes the tab's place". The same commit made `sessionFolderPath` answer `undefined` until both the session list and the folder list load, because answering `null` (Home) early closed the open folder (`queries.ts:160-170`).
- `57b3dd19c` (fix(app): seed a restored window's folder from the first-frame snapshot): the startup folder restore in `restoreChatFolder`.
- The single host folder predates the tabs. The host API opens one workspace per connection (`chrome/use-show-session.ts:18`); the app follows it rather than owning a per-chat folder.

### Constraints for the design

- The host exposes one open workspace per connection. A per-chat location has to be derived from `SessionInfo.workspace` plus the workspace list on the client. It cannot ask the host for several current folders.
- `SessionInfo` has no repository or machine fields. A hover card that shows `owner/repo` for any chat needs either a client lookup keyed by workspace or an additive wire field (`check:store`).
- Folder lookups must keep "unknown until both lists load" (`undefined`) apart from "Home" (`null`). See `86a05de23`.
- Child sessions are listed only under `sessionsWatch("all")` and `childrenWatch`. A reader that has to cover tabs holding children cannot read roots only.

---

## 2. Run status

### Source of truth

`Execution` on each head (`packages/schema/src/runs.ts:49-69`): `idle { lastRun: { end: completed | stopped | failed } | null }`, `live { phase, stopping }`, `waiting { on: run | job | part | timer }`, `retrying { until, reason }`. Turn-level outcomes live in `TurnInfo` state on the view (`conversation/transcript-rows.ts:208`).

There is one shared mapping, `executionMark`, in the client presentation module (`packages/plugin/src/client/presentation.ts:241-284`), which every client imports:

| Execution | `executionMark` |
| --- | --- |
| live | `working` |
| waiting on `part` (approval or question) | `waiting` |
| waiting on run / job / timer | `working` |
| retrying | `retry` |
| idle, last run failed | `failed` |
| idle, completed / stopped / none | `idle` |

`sessionMark` applies it to `mainHead` (main, else the first head) (`presentation.ts:273-284`). The app wraps it in `sessionActivityMark` (`session-activity.ts:5-12`): when any descendant is non-idle, an `idle` or `failed` parent becomes `working`. The descendant set is `useWorkingSessionIds` (`queries.ts:320-341`), computed on the client from `sessionsWatch("all")`.

### Every mapping site

| Surface | File:line | Input | Mapping |
| --- | --- | --- | --- |
| Sidebar row icon | `chrome/sidebar-rows.tsx:172`, `chrome/status-glyph.tsx:8-18`, `components/ui.tsx:88-109` | List + descendant set | Spinner (working, retry), bubble (waiting), warning (failed); idle + unread completion → eye icon |
| Sidebar ask line | `chrome/sidebar-rows.tsx:113-128`, `:174` | List, **all heads** | "Needs your answer" or the failure notice text |
| Sidebar status filter, group, shelf, sort | `chrome/sidebar-view.ts:70-91`, `:98-125`, `:143-161` | List + descendant set | waiting, failed → needs-attention / Inbox; working, retry → Working; idle → unread / Inbox or Done |
| Sidebar fold count | `chrome/sidebar-lists.tsx:292-294` | List + descendant set | non-idle rows stay above the fold |
| Search palette | `chrome/search-palette.tsx:205-209` | List + descendant set | Same as the sidebar row |
| Window tab icon | `tabs/use-window-tabs.tsx:153-172` | **Roots** list + descendant set | `StatusDot` for non-idle; nothing for idle |
| Agents tray | `conversation/agent-status.ts:6-24`, `conversation/tray/agents.tsx:52-77`, `:114` | Children list, **no descendant set** | waiting → attention; working, retry → working; failed, idle → inactive, and inactive agents leave the list |
| Subagent call row (session known) | `conversation/subagent-status.ts:34-68`, `conversation/subagent-call.tsx:166-170` | Child `SessionInfo` | live → "Planning next moves"; waiting on part → "Needs attention"; retrying → "Retrying"; completed → unread or done "Completed"; failed → failed "Stopped with error"; **stopped → failed "Stopped"** |
| Subagent call row (tool only) | `conversation/subagent-status.ts:14-32` | Tool status | **stopped → done** |
| Subagent group indicators | `conversation/subagent-call.tsx:289-297` | Child `SessionInfo` | `sessionStatus(child, false)`: never "unread" |
| Composer | `conversation/composer.tsx:140-141`, `:656-662`, `:722` | View `execution` | Any non-idle → busy (Stop) and the floating "working" dot; `stopping` from live only |
| Transcript live row | `conversation/transcript-rows.ts:74-110`, `:280-282`; `conversation/live-turn.tsx:22-32`; `conversation/timeline.tsx:135` | View `execution` + prompts outside turns | `working` = non-idle, or a sent prompt not yet in a turn; retry row shows the reason |
| Transcript failure row | `conversation/transcript-rows.ts:208-215` | Turn state | Failed turn → failure row; stopped → nothing |
| RunAnnouncer (screen reader) | `screens/session-conversation.tsx:170-184`, `:352`, `:481` | Transcript `working` or editing | "Nyte is responding" / "Response finished" for every end kind |
| "Run finished" toast | `packages/plugin/src/client/notifications.ts:16-27`, `packages/plugin/src/client/mount.ts:374-393` | List `lastRun` per head, **every head** | completed → "Run finished"; failed → "Run failed: …"; stopped → silent; child sessions → silent |

### Do they agree?

| State | Sidebar / palette / tab | Agents tray | Subagent row | Composer | Transcript | Announcer | Toast |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Working (live) | spinner | working | running | busy | working | responding | – |
| Waiting for approval | bubble, "Needs your answer" | attention | attention | **busy, "working" dot** | working | responding | – |
| Waiting on child, job or timer | spinner | working | running | busy | working | responding | – |
| Retrying | spinner | working | "Retrying" | busy | retry row | responding | – |
| Failed | warning, Inbox, stays until the next run | **hidden** | failed | idle | failure row | "Response finished" | error toast |
| Completed | eye if unread, else nothing | hidden | unread / done | idle | – | "Response finished" | info toast |
| Stopped | nothing, Done | hidden | **failed "Stopped"** (session) / **done** (tool) | idle | – | "Response finished" | silent |
| Child still working, parent idle | **spinner (override)** | n/a | n/a | idle | idle | finished | – |

They disagree on: stopped (failed in one subagent path, done in the other); failed (prominent in the sidebar, invisible in the tray, which is plan item E3); waiting for approval (the composer shows a working dot); and the descendant override (sidebar, tab and palette only). The status label vocabulary also differs: `StatusDot` says "Running" (`components/ui.tsx:60-66`), shelves say "Working", the subagent row says "Planning next moves".

### Rationale from history

- `278303529` (fix: show tool status and failures from one presentation module in every client): moved marks, tool status and failure notices into `@nyte-ai/plugin/client/presentation`, because desktop, TUI and mobile had drifted ("Stopped" vs "Failed"). The tray and subagent mappings above were left as app-side wrappers.
- `573c06797` (fix(desktop): shelve a chat as Working while its subagent runs): "every status consumer reads one 'treat as working' set". The host originally sent a `delegating` set. Today the app computes it from `sessionsWatch("all")` (`queries.ts:320-341`, last reshaped in `ac6c0c418`). The transcript, composer and tray never adopted it.
- The toast's doc comment gives its rules: stopped stays quiet "because someone asked for it", and children stay quiet "so a delegation does not ring once per child" (`notifications.ts:4-9`).

### Constraints for the design

- `executionMark` / `sessionMark` live in `packages/plugin` and are used by the TUI and mobile. An app-only status owner has to build on them, not fork them, or the clients drift again (`278303529`).
- The plugin layer cannot import the app (`schema → ai → core → plugin`). The notification plugin sees only `SessionInfo` and run-end events through `mountClientPlugins`.
- List status and view status come from two streams with no ordering guarantee. Any owner either picks one per question or states which one wins.
- "Working" for the sidebar means "this chat or a descendant is running" (`573c06797`). That meaning has to stay available under a clear name.

---

## 3. Read state and attention

### Source of truth

- **Seen mark, per session, principal and head**, stored in core as a ref holding a commit (`packages/core/src/fold/seen.ts:18-68`). `advanceSeen` moves the mark only forward along the head's path. It is a no-op when the new commit is not past the old mark (`:36-48`), and it logs a `seen` event (`:55-62`).
- **`unread` on the wire** is a boolean per head: "tip ≠ seen commit". Core computes it in two places: `headsFor` on the fold path (`packages/core/src/fold/project.ts:107-127`) and `headInfo` on the store path that serves `session.info` (`packages/core/src/api/session.ts:637-659`). The mark itself never leaves core. Plan item D1 is about this.

### Writers

| Writer | File:line | When |
| --- | --- | --- |
| `head.see` RPC | `packages/core/src/api/head.ts:107`, `packages/host/src/serve/binding.ts:289` | Client call |
| SDK dedupe | `packages/sdk/src/client.ts:237-243` | Skips repeating the last commit it sent for a head |
| Desktop / web | `screens/session-conversation.tsx:250-296` (`MarkSeen`, `SeeTip`), mounted at `:476` | Main-head tip of the view, while the window is visible and focused and no maximized workbench tab covers the chat. Mounted for full panes **and** for the tray detail view (`:516-526`) |
| TUI | `packages/tui/src/effects/runner.ts:173`, `packages/tui/src/effects/host-port.ts:296` | Followed chat while the terminal has focus |
| Mobile | `packages/mobile/src/chat/chat-container.tsx:38`, `packages/mobile/src/chat/seen.ts` | Focused screen, app active |

No other app code writes a read mark. There is no "Mark as Read" or "Mark as Unread" (plan A7).

### Readers

| Surface | File:line | What it reads / derives |
| --- | --- | --- |
| `sessionHasUnreadCompletion` | `session-read-state.ts:3-12` | `heads[0].unread && idle && lastRun completed`. Reads **`heads[0]`**, not `mainHead` |
| Sidebar row eye icon | `chrome/status-glyph.tsx:15-17` | `sessionHasUnreadCompletion` when the mark is idle |
| Sidebar status / shelf | `chrome/sidebar-view.ts:83-84`, `:112-114` | unread → Inbox |
| Sidebar "hold" | `chrome/sidebar.tsx:206-220` | Keeps the open chat on the shelf it had when opened, so marking it read doesn't move it |
| Window tab unread dot | `tabs/use-window-tabs.tsx:179-186`, `tabs/window-tab-strip.tsx:128`, `:140` | Any pane's session has an unread completion **and the tab is not active** |
| Subagent call row | `conversation/subagent-call.tsx:169` | `unread` indicator for a completed child |
| `StatusDot` unread variant | `components/ui.tsx:88-103` | An `unread` prop that no caller passes (`grep "<StatusDot"`: 8 call sites, none with `unread`) |
| Toasts | `packages/plugin/src/client/notifications.ts` | Do not read unread or the mark |

### Duplicates and divergences

- **Failed runs are never unread.** A failure shows as `failed` until the next run starts, whether or not someone has looked at it (`chrome/sidebar-view.ts:77-79`, `presentation.ts:253`). Reading a failed chat doesn't clear it.
- **Head choice differs**: seen marks the main head (SDK `session(id)` = main, `client.ts:160`; tip from `mainHead(view)`, `session-conversation.tsx:260`). The unread check reads `heads[0]`. The toast fires for every head.
- **"Unread" on a tab ignores focus**: the active tab never shows a dot, even when the window is unfocused and the mark isn't moving (`tabs/use-window-tabs.tsx:180`). The sidebar row for the same chat does show it unread.
- **Two core derivations** of the same boolean (`project.ts:117`, `api/session.ts:658`) have to stay equal.

### Rationale from history

- `faebe7391` (feat!: mark a chat read only when someone looks at it, #20): watching used to mark heads seen, so warming a sidebar row, the hot set and the TUI's subagent watches all cleared unread. Now only an explicit `head.see(tip)` from "a person looking" moves the mark. The app rule is quoted there: "on screen in a visible, focused window and not behind a maximized workbench".
- `sessionHasUnreadCompletion` dates to the iOS-era renderer (`7f4aa14f0`, moved in `db7970b4c`). No commit explains `heads[0]`.

### Constraints for the design

- The mark moves forward only, and only on an explicit call. Warming, hot sets and background watches must never call `see` (`faebe7391`).
- Exposing the mark (D1) is a wire change that every client (TUI, mobile, web) receives. It must be additive, and `check:store` must pass.
- The spec's "New" divider needs the mark as it was **before** this visit advanced it (03-transcript.md §5.3). Today the client only gets a boolean, and `SeeTip` advances the mark on mount.

---

## 4. Visibility: "is this chat being looked at?"

There is no single definition. Each place below decides on its own.

| # | Decision | File:line | Rule |
| --- | --- | --- | --- |
| 1 | Mark seen | `screens/session-conversation.tsx:265-276` | `document.visibilityState === "visible" && document.hasFocus()` and not (`workbench expanded && maximized && !showing chat`). Implicitly also: the conversation's effects are mounted, meaning its `<Activity>` is visible (`screens/pane-host.tsx:179-193`), its tab is the pane tab (`layout/pane-context.tsx:12-28`), and no page or settings route replaced the stage (`router.tsx:247-263`). The tray detail view counts as looking at the child |
| 2 | Tab unread dot hidden | `tabs/use-window-tabs.tsx:180` | `tab.id !== activeTabId`. No focus, pane or workbench check |
| 3 | Sidebar "selected" row | `chrome/sidebar.tsx:185-187` | The active pane's session, unless a page is open |
| 4 | Which pane is "active" | `layout/pane-layout.ts` (`activePane`), `screens/pane-host.tsx:155`, `:163-164` | Last pointer-down or focus-in |
| 5 | Mounted, hidden-but-kept chats | `screens/pane-host.tsx:91`, `:117-135`, `:179-193` | 3 most recent sessions **per pane slot**, shared across tabs, under `<Activity mode="hidden">` |
| 6 | Text pacing "visible" | `sdk.tsx:479-490`, `:535-538` | Count of mounted `showTranscript` effects. Hidden Activity unmounts effects, so this tracks #5's visible member, plus the tray detail |
| 7 | Chat covered by workbench | `screens/session-screen.tsx:373-382`, `shell/window-commands.ts:83`, `workbench/controller.ts:91-93` | `expanded && maximized && showing !== "chat"`. Also moves the composer to the floating mount |
| 8 | Plugin "focused session" | `app.tsx:25-29`, `client-plugins.tsx:29-33`, `:55-71` | Active selection of the pane tab (the chat tab used last, even under a page). Ignores window focus |
| 9 | `visibleSessionIds` | `layout/pane-layout.ts:97-105` | Sessions in either pane of a layout. **No readers** |
| 10 | Run toast | `packages/plugin/src/client/notifications.ts:16-27` | No visibility check at all (plan E2) |
| 11 | Browser occlusion | `workbench/browser-occlusion.ts:1-60` | Overlays covering the native browser view. A different concept: "is the native view covered", not "is a chat seen" |

### Duplicates and divergences

- #1 and #2 disagree whenever the window is unfocused, or the chat is in the inactive pane of the active tab, or a maximized workbench covers it: the tab hides the dot while the mark doesn't move.
- #1 depends on React `Activity` effect semantics. Nothing names that dependency, and a refactor that kept hidden chats' effects running would start marking hidden chats read.
- #8 is the only "focused chat" the plugin layer gets. It is one session per window, so a toast filter (E2) built on it would miss the other pane of a split.
- #9 exists and is unused, a leftover of an earlier attempt at the same question.

### Rationale from history

- `faebe7391` defined #1.
- `4f5674d55` (perf: … warm sessions …): "panes keep their 3 most recent sessions mounted under Activity" (#5). `1671a6f8d` drops a deleted session from that set.
- `d4a1170d6` put "who owns keys" in one rule (`shell/focus-owner.ts`). The visibility questions never got the same treatment.

### Constraints for the design

- Visibility for seen marking must stay strictly narrower than "mounted": hot, warmed and hidden chats must not count (`faebe7391`).
- The plugin package can only learn visibility through what `mountClientPlugins` passes it (`client-plugins.tsx:25-41`). A shared visibility owner has to be exposed across that boundary, or the app has to filter `notify`.
- A window can show two chats (split) plus the tray detail child. Any "visible chats" answer is a set, not one id.

---

## 5. Opening and placing a chat

### Model

- **Window tabs** (`tabs/model.ts`). `WindowState { tabs, activeTabId, recent, closed }` (`:37-43`). A `Tab` holds either a page or a `PaneLayout` (`:22-30`). `reduce` (`:314-398`) is the only writer. Opening a place: an existing tab showing it is revealed (`:235-241`, `showing` `:169-176`); `"here"` (a window without a strip) reuses the chat tab (`:243`, `:199-215`); blank goes to a waiting new-chat tab (`:218-227`); a foreground open replaces a blank active tab (`:249-250`); otherwise a new tab goes after the active one (`:251-254`).
- **WindowTabs store** (`tabs/window-tabs.ts:148-298`). Holds one `PaneController` per tab (`:222-239`). Turns `open` into `here` without a strip (`:187-192`). Routes each controller's layout changes back into the tab (`:251-260`). Pushes tab changes into controllers with `show` (`:262-284`).
- **Panes** (`layout/pane-layout.ts`, `layout/pane-controller.ts`). One or two panes per tab. `select` dedupes a session within the tab (`pane-layout.ts:162-185`).
- **Routes** (`router.tsx:272-441`, `tabs/places.ts`). The URL mirrors the active tab's place. `/session/$sessionId` has no component (`router.tsx:376-384`). The stage reads the tabs (`:247-263`). `useWindowTabsSync` (`tabs/use-window-tabs.tsx:37-111`) moves the route when the tab changes (`:53`) and adopts a route reached on its own as a foreground open (`:77-92`).

### Every call site that opens or places a chat

| Trigger | File:line | Path | Tab dedupe | Folder activation |
| --- | --- | --- | --- | --- |
| Sidebar click | `chrome/sidebar-rows.tsx:278`, `chrome/sidebar.tsx:81-87` | `windowTabs.dispatch(open, foreground)` | yes | awaited first, aborts on failure |
| Sidebar ⌘/Ctrl-click, middle-click | `chrome/sidebar-rows.tsx:41-45`, `:285-287` | `open, background` | yes (no-op if open) | skipped |
| Sidebar "Open Chat to the Side" | `chrome/sidebar.tsx:91-93` | `leave-page`, then `controller.drop(…, "right")` | within tab only | awaited |
| Search palette | `chrome/sidebar.tsx:405-411` | `open, foreground` | yes | via `follow()` afterwards |
| Draft row | `chrome/sidebar.tsx:263`, `tabs/window-tabs.ts:201-217` | `showDraft` → activate or new tab → `selectDraft` | by draft owner | none |
| New chat (row, ⌘N, menu, palette, workspace "+") | `chrome/sidebar.tsx:129`, `:241`, `:412`; `shell/window-commands.ts:94-98`; `layout/pane-context.tsx:103-105` | `windowTabs.newChat()` → `new-tab` + `controller.newChat()` | reuses a blank tab | workspace "+" awaits it (`chrome/sidebar.tsx:238-242`) |
| Draft becomes a chat on send | `conversation/draft-start.ts:91`, `:104` → `layout/pane-controller.ts:227-237` | `selectSessionInPane` in the draft's pane, **only if that draft is visible** | within tab only | none |
| Subagent "open as full chat" (tray expand) | `screens/session-conversation.tsx:510-513` | `paneActions.openSessionInPane(paneId, child)`: **replaces the parent in its pane** | **no** | none |
| Subagent call row / citation / tray row | `conversation/subagent-call.tsx:227-241`, `:261`, `:365`, `:573-585`; `conversation/subagent-sessions.ts:61-63` | Opens the in-chat tray detail, not a tab | n/a | n/a |
| "Back to parent chat" (web title bar) | `chrome/titlebar.tsx:87-102` | Plain click: `panes.openSession` → `controller.selectSession` in the current tab, **no dedupe**. Modified click: router `Link` → `adopt` → `open, foreground` | depends on modifier | via `follow()` |
| Drag a row onto a pane | `layout/session-dnd.tsx:206` | `panes.drop` | within tab only | none |
| Startup last chat | `router.tsx:289-322`, `:328-348` | redirect → `adopt` → `open, foreground` | yes | `restoreChatFolder` + `follow()` |
| Missing session | `router.tsx:386-402` | navigate `/` → `adopt` → blank | – | – |
| Customize / Environments | `chrome/shell-state.ts:81-93` | `open, foreground` (page) | one page per kind | – |
| Toast click | `client-plugins.tsx:34-39` | Not clickable. No path | – | – |
| Archive / delete hides the chat | `layout/pane-context.tsx:30-32`, `session-actions.ts:99-180` | `windowTabs.controller().removeSessionWithUndo`, **only the pane tab** | – | – |

So window-level opens go through `windowTabs.dispatch` and get dedupe, the blank-tab rule and router sync. Pane-level opens (`openSession`, `openSessionInPane`, `drop`, `openDraftChat`) go straight to one tab's controller. They can put a chat that already has a tab into a second tab, and they skip `follow`'s folder ordering. Folder activation happens in three ways: awaited before the open (sidebar), after it via `follow()` (palette, routes, tab switches), or not at all (background).

### Rationale from history

- `86a05de23`: one navigation model for desktop and web. It retired a click-capture, per-folder controllers and a route-driven stage, which the commit counts as three copies of "the current page".
- `b27b0a350` (feat(app): open each chat in its own tab, keep drafts and tabs per window): the current `open` rules and per-window persistence. The commit has no body.
- 04-shell.md §2 already flags that "open as full chat" replaces the parent and that "Back to parent" exists only without a strip (`04-shell.md:146`).

### Constraints for the design

- The router and the tabs must keep one direction of truth: the tabs own the place, and the route is adopted (`86a05de23`). Web runs with `strip = false` and `target: "here"`.
- Pane-level actions take a `PaneId` and are scoped to one tab's controller. A tab-aware open has to reach `windowTabs`, which `layout/` already imports (`layout/pane-context.tsx:8`, a tabs↔layout cycle).
- Folder activation is async and can fail (`handleOpenOutcome`). An open that has to land in the right folder must keep the "abort on failure" behaviour of `showSession`.
- F1–F4 (preview slot) change `tabs/model.ts` `open`. Every bypass in the table above would skip preview rules too.

---

## 6. Focus

| Mechanism | File:line | Behaviour |
| --- | --- | --- |
| Key owner rule | `shell/focus-owner.ts:1-21` | A focused field, editor, menu, listbox or dialog (or its container) owns keys |
| Type-to-compose | `screens/pane-host.tsx:27-54`, mounted only in the active pane (`:169-174`) | A printable key with no modifiers and no key owner focuses the composer. Space only when `body` is focused |
| Focus request | `layout/pane-controller.ts:133-139`, `:152-164`, `:308-315` | Every layout dispatch except `resize` and `remove-session`, every `show`, and `newChat`/`selectDraft`/`removeDraft` when the layout is unchanged bump `{ paneId, revision }` |
| FocusComposer | `screens/pane-host.tsx:72-83`, `:166-168` | Keyed by revision. Focuses the composer unless a key owner outside the panes holds focus |
| Pane focus | `screens/pane-host.tsx:163-164` | Pointer-down or focus-in sets the active pane, which in turn switches the host folder (§1) |
| After tab switch | `tabs/window-tabs.ts:276-278`, `layout/pane-context.tsx:12-28` | The provider swaps to the other tab's controller. `PaneHost` stays mounted (keyed by pane id, `screens/session-screen.tsx:330-339`), so FocusComposer remounts only if the two controllers' `focusRequest.revision` differ |
| After send (blank → chat) | `layout/pane-controller.ts:235` | `select-in-pane` bumps the request; the new conversation's composer takes focus |
| Composer moves to or from the floating mount | `conversation/composer.tsx:178-187` | Refocuses after the portal moves |
| After editing a message or queued item | `conversation/composer.tsx:462`, `:566`, `:580`; `conversation/turn-view.tsx:216-221` | Back to the composer or the edit button |
| Agents tray release | `screens/session-conversation.tsx:514` | Composer |
| Popups | `conversation/composer-frame.tsx:551` (`finalFocus` to the editor area), `screens/session-conversation.tsx:576`, `chrome/sidebar.tsx:588`, `:603` | Base UI `finalFocus` per dialog or menu |
| Scroll-to-bottom | `conversation/transcript.tsx:755-758` | Blurs itself; does **not** focus the composer (plan D5) |
| PageUp / PageDown from the composer | `screens/session-conversation.tsx:186-230` | Pages the transcript through `useTranscriptControls().page` |
| Transcript controls | `conversation/transcript.tsx:108-113`, `:154-156` | `end`, `hold`, `keep`, `page`; read by the composer (`composer.tsx:133`), turn view (`turn-view.tsx:178`) and column (`session-conversation.tsx:195`) |
| Global shortcuts | `router.tsx:166-204` | Tab shortcuts, then client actions |
| Held modifier keys for the tab strip | `tabs/window-tab-strip.tsx:51-77` | Its own window listeners |
| Focus modality | `theme/focus-modality.ts` | Pointer vs keyboard ring |

### Divergences

- Three independent `window` keydown listeners (router, type-to-compose, tab strip) each apply their own guard.
- `ComposerViewState.focused` is written on every focus change (`conversation/composer.tsx:760`, `screens/blank-conversation.tsx:218-222`), dropped from storage (`layout/session-view-state.ts:185`), and never read to restore focus.
- Focus after a tab switch depends on two unrelated revision counters (`pane-controller.ts:89`).

### Rationale from history

- `d4a1170d6`: "whether a pane may take focus and whether a typed key starts a message were two DOM probes over one selector … a pane focus request could pull focus off a button inside a dialog". That became `keyOwner`.

### Constraints for the design

- Keep the single key-owner rule (`d4a1170d6`). Any new routing (B4 Cmd+/, B5 paste, F6 Delete) should go through it, not add another probe.
- Focus requests are per tab controller. A window-level "focus the chat" has to name the tab as well as the pane.

---

## 7. Per-chat and per-window view state

| State | Owner | Key | Persistence | Survives reload |
| --- | --- | --- | --- | --- |
| Window tabs, active, recent, closed | `tabs/window-tabs.ts:148-298` | `nyte.window.v1:<windowId>:tabs` (`:13`, `:294`) | localStorage, 250 ms debounce + `pagehide` flush (`:20`, `:175`, `:286-295`). Desktop only: `#save` returns without a strip (`:287`) | Desktop yes; web no |
| Composer draft per chat | `layout/session-view-state.ts:486-536` (`writeSession`) via `WindowDrafts` | `…:drafts:session:<sessionId>`; **window-wide by session id**, not per pane or tab | localStorage, 200 ms debounce (`:9`); only draft text and selection (`:129-136`), attachments separately | yes |
| New-chat drafts | `WindowDrafts` (`layout/session-view-state.ts:259-484`), `SessionViewStateStore.readBlank` / `writeBlank` (`:539-560`) | `…:drafts:draft:<id>` plus an index of tab → pane → active/parked | localStorage | yes |
| Transcript scroll | `conversation/transcript.tsx:172-174`, `:505-517` | Session id, then pane id inside | Memory, LRU 64 sessions (`session-view-state.ts:11`, `:503-526`) | no |
| Step group open/closed | `conversation/step-group-open.ts:14-29` | Session id + group key | Memory | no |
| Split direction and ratio, focused pane per chat | `layout/pane-controller.ts:113-121`, `:317-335` | Session id | Memory | no (the tab layout itself persists) |
| Virtualizer measurements | `conversation/transcript.tsx:53-55`, `:232` | Session + pane | Memory, 16 entries | no |
| Sidebar grouping, sort, filters, show fields, folded workspaces, revealed counts, shelf hold | `chrome/sidebar.tsx:170-179`, `chrome/sidebar-lists.tsx:66-67` | Component state | None. Lost on reload and when the sidebar unmounts (plan A1) | no |
| Sidebar visible, width, Home row | `preferences/index.ts:123-129` | `nyte.desktop.sidebar.v3` | localStorage | yes |
| Other preferences (startup destination, running message, appearance…) | `preferences/index.ts:31-122` | `nyte:*:v1` | localStorage, some mirrored to host settings (`preferences/host.ts`) | yes |
| Workbench views | `workbench/controller.ts:286`, `:367-384`, `:611-620` | `nyte:desktop:workbench:v7`, one view per **workspace path** | localStorage | yes |
| Overlays (search, about) | `chrome/shell-state.ts:28` | Module variable | None | no |
| Hot sessions per pane slot | `screens/pane-host.tsx:118` | React state | None | no |
| Warm set | `sdk.tsx:585-610` | Module map, 3 sessions, 5 s | None | no |

### Divergences

- "Per-chat view state" is keyed by session id for the whole window. The scroll map then splits it by pane id, and focus/split per chat lives in the same record. A chat open in two tabs (possible through the pane-level opens in §5) shares one composer draft.
- The sidebar keeps its view state in component state while every other surface's state lives in a store. It is the only surface that forgets on reload.
- The workbench is per folder while the chat state is per session, so switching chats within a folder keeps the right panel and switching folders swaps it.

### Rationale from history

- `b27b0a350`: tabs and drafts per window.
- `4f5674d55`: "drafts persist per owner on a debounce, off the keystroke path"; "tab state … written on a budget".
- `86a05de23`: web drafts moved from a per-folder pane store to the window tab's. Sidebar visibility, width and Home moved into preferences "under the key they always used".

### Constraints for the design

- Writes stay off the keystroke path (debounced, per owner). See `4f5674d55`.
- Storage keys are user data. Changing them needs a migration or an accepted reset, as `86a05de23` noted for web drafts.
- Previews must not survive restart (F4), so tab persistence has to tell preview and permanent tabs apart.

---

## 8. Module structure

### Folders

| Folder | Files / lines (non-test) | Holds | Owns a concept or a surface |
| --- | --- | --- | --- |
| `(root)` | 36 / 5,029 | `sdk.tsx` (connection, watch engine, session watches, warm set, pacing visibility), `queries.ts` (query client, host state, workspaces, session lists, working set, VCS, files, search, catalog, usage, plugin settings, rename), `router.tsx`, `session-*.ts` (read state, activity mark, list grouping, actions, route checks), `client-actions.ts`, `client-plugins.tsx`, `bridge.ts` | Concepts, mostly data access; a catch-all |
| `chrome/` | 51 / 10,988 | Sidebar (`sidebar*.tsx`, `sidebar-view.ts`), title bar, search palette, shell overlays (`shell-state.ts`), folder activation (`use-show-session.ts`, `open-workspace.tsx`), GitHub, settings and account panels, customize, usage | Mostly surfaces; also hosts `sidebar-view.ts` (status derivation) and `use-show-session.ts` (folder activation) |
| `conversation/` | 89 / 17,930 | Transcript, rows, turns, step groups, composer, trays, subagent rows, prose, diffs, canvas, `session-activity.ts`, `agent-status.ts`, `subagent-status.ts`, `approval-state.ts` | Surfaces plus several status concepts |
| `screens/` | 13 / 2,086 | `pane-host.tsx` (hot set, type-to-compose, focus), `session-conversation.tsx` (seen, announcer, rename, delete, trays, edit), `blank-conversation.tsx`, `session-screen.tsx` | Composition, plus the seen and focus rules |
| `tabs/` | 6 / 1,339 | `model.ts` (reducer), `window-tabs.ts` (store, persistence), `places.ts` (routes), `use-window-tabs.tsx` (router sync, folder follow, tab titles, glyphs and unread), `window-tab-strip.tsx` | Concept and surface in one folder |
| `layout/` | 6 / 1,923 | Pane layout, controller, context and actions, per-chat view state and drafts, drag and drop | Concepts |
| `workbench/` | 52 / 15,157 | Right panel: controller, files, changes, terminal, browser, canvas | Surface plus its own controller |
| `shell/` | 3 / 200 | `focus-owner.ts`, `window-commands.ts`, search type | Concepts |
| `components/` | 6 / 790 | `StatusDot`, time-ago, sortable strip, file icons | Shared UI |
| `theme/`, `preferences/`, `settings/`, `web/`, `account/`, `break/` | 8, 4, 21, 15, 1, 2 files | Tokens, preferences store, settings pages, web entry, account | Supporting |

### Cross-folder imports (import statements, non-test)

| From → To | Count |
| --- | --- |
| chrome → (root) | 89 |
| workbench → (root) | 75 |
| conversation → (root) | 64 |
| screens → conversation | 25 |
| screens → (root) | 21 |
| screens → layout | 20 |
| conversation → theme | 20 |
| workbench → conversation | 18 |
| web → (root) | 17 |
| chrome → theme | 17 |
| conversation → preferences | 15 |
| settings → (root) | 13 |
| (root) → chrome | 12 |
| (root) → conversation | 12 |
| chrome → tabs | 12 |
| settings → preferences | 10 |
| conversation → components, workbench → components | 10 each |
| (root) → tabs, chrome → layout | 9 each |
| conversation → layout, conversation → workbench, screens → workbench, workbench → preferences, preferences → (root) | 8 each |
| tabs → layout, tabs → (root) | 7 each |
| (root) → workbench, workbench → theme, chrome → settings, chrome → components, settings → theme | 6–7 each |
| everything else | ≤ 5 each |

Cycles between folders: `tabs ↔ layout` (`layout/pane-context.tsx:8` imports `windowTabs`), `tabs ↔ chrome` (`tabs/use-window-tabs.tsx:5` imports `activateWorkspace`), `conversation ↔ screens` (`conversation/timeline.tsx:13`), `conversation ↔ workbench` (8 and 18), `layout → conversation` (`layout/session-view-state.ts:6`, a type), `layout → workbench` (`layout/session-dnd.tsx:30`), and `(root) ↔ chrome/conversation` (`queries.ts:69-74`, `sdk.tsx:24-26`).

### Files over ~600 lines that mix several concepts

| File | Lines | Concepts mixed |
| --- | --- | --- |
| `queries.ts` | 981 | Host state, folders, session lists, working set, session read, VCS, files, search, catalog, usage, plugin settings, rename |
| `workbench/controller.ts` | 970 | Workbench layout, tabs, persistence, chat-covered rule |
| `sdk.tsx` | 633 | Connection lifecycle, watch store engine, session and part watches, warm set, transcript visibility for pacing |
| `chrome/sidebar.tsx` | 620 | Sidebar view state, shelf hold, open and placement (`showSession`), folder activation, confirmations, new-chat row, search palette wiring |
| `layout/session-view-state.ts` | 681 | New-chat drafts, draft send status, per-chat composer, scroll, step groups, split memory, persistence |
| `conversation/composer.tsx` | 800 | Composer targets (new, edit, queued), running mode, queue actions, floating mount, focus |
| `conversation/transcript.tsx` | 768 | Virtualizer, scroll mode, scroll persistence, measurement cache, controls context, jump button |
| `screens/session-conversation.tsx` | 591 | Seen marking, run announcer, rename, delete, message edit, tray state, composer wiring, nested tray conversation |

Others over 600 lines (`workbench/changes-panel.tsx` 944, `workbench/browser-panel.tsx` 898, `conversation/composer-suggestions.tsx` 881, `workbench/workbench.tsx` 805, `conversation/turn-view.tsx` 734, `workbench/files-panel.tsx` 729, `workbench/terminal-store.ts` 706, `workbench/changes-commit-bar.tsx` 682, `chrome/usage-view.ts` 655, `chrome/customize.tsx` 654, `chrome/usage-settings.tsx` 637, `workbench/file-editor.tsx` 624, `conversation/composer-frame.tsx` 611, `conversation/subagent-call.tsx` 611, `web/account-screen.tsx` 610) are large but mostly hold one surface each.

### Constraints for the design

- Client code never imports `@nyte-ai/host` (AGENTS.md). Shared presentation goes through `@nyte-ai/plugin/client/presentation` so the TUI and mobile stay aligned (`278303529`).
- The plan's work packages A–F are split by folder and file (plan.md "Map"). The consolidation runs after they merge, so it must not depend on moving files while they are in flight.

---

## Cross-cutting findings

Ranked by how much each hurts the chat experience.

1. **"Is the user looking at this chat?" has about ten answers** (§4). Seen marking, the tab unread dot, the run toast, plugin focus and text pacing each decide on their own. Some rules are only implied by React `Activity` (`screens/pane-host.tsx:179-193`), and one helper has no readers (`layout/pane-layout.ts:97`). This is why the toast rings for the chat on screen (E2) and why the active tab hides a dot the sidebar still shows.
2. **Run status is mapped about nine times with different results** (§2). Stopped reads as failed in one subagent path and done in the other (`conversation/subagent-status.ts:24-25` vs `:57-59`). Failed agents vanish from the tray (`conversation/agent-status.ts:15-17`). Waiting for approval shows a working dot in the composer (`conversation/composer.tsx:656-662`). The descendant override reaches only the sidebar, tabs and palette (`session-activity.ts:5-12`).
3. **A chat's location is the window's open folder, not the chat's** (§1). cwd, workbench, repository and branch all follow `host.data.workspace` (16 files). Focusing a pane switches it (`tabs/use-window-tabs.tsx:54-74`), split panes from two folders share one cwd, and the hover card has no per-chat repo or branch source.
4. **Opening a chat has two layers with different rules** (§5). Window-level `dispatch(open)` dedupes and syncs the router. Pane-level `openSession`, `openSessionInPane`, `drop` and `openDraftChat` skip both, can duplicate a chat across tabs, and are what subagent expand and "Back to parent" use. Folder activation happens before, after or never, depending on the caller.
5. **Read state reaches clients as one boolean, read inconsistently** (§3). Core never sends the mark (D1). `sessionHasUnreadCompletion` reads `heads[0]` (`session-read-state.ts:4`) while seen marks `main`. Failures never become unread and don't clear on viewing. The toast covers every head.
6. **Chat title and identity have no owner** (§1). Six fallbacks; tabs read roots only, so a subagent tab shows "Chat" with no status (`tabs/use-window-tabs.tsx:113-117`, `queries.ts:306-318`). The desktop title bar shows no location at all (`chrome/titlebar.tsx:196-204`).
7. **Per-chat view state is keyed for the window and split oddly** (§7). Composer drafts are per session for the whole window, scroll is per session and pane, the sidebar's settings sit in component state, and `ComposerViewState.focused` is written but never read.
8. **Two streams carry `execution`** (list vs view). The sidebar or tab can show working while the composer and transcript show idle, or the reverse, with no rule for which wins.
9. **The root folder and `tabs/` mix concept and surface.** `chrome/`, `workbench/` and `conversation/` import root files 228 times, mostly `queries.ts` and `sdk.tsx`, and those two import back into `chrome/` and `conversation/` (`queries.ts:69-74`, `sdk.tsx:24-26`). `tabs/use-window-tabs.tsx` holds router sync, folder follow and tab presentation in one file. The folder cycles (`tabs ↔ layout`, `tabs ↔ chrome`) follow from that.

## Module map today

```
(root)  sdk.tsx · queries.ts · router.tsx · session-*.ts · client-*.ts
  ▲ 89 chrome   ▲ 75 workbench   ▲ 64 conversation   ▲ 21 screens   ▲ 17 web   ▲ 13 settings
  │ (root) → chrome 12, → conversation 12, → tabs 9, → workbench 6, → layout 3

screens ──25──▶ conversation ──8──▶ workbench ──18──▶ conversation
   │  └──20──▶ layout ◀──7── tabs ◀──12── chrome
   │                 └──1──▶ tabs           tabs ──1──▶ chrome
   └──8──▶ workbench
conversation ──20──▶ theme, ──15──▶ preferences, ──10──▶ components
```

The chat concepts are spread like this: status in `(root)/session-activity.ts`, `chrome/sidebar-view.ts`, `conversation/agent-status.ts` and `conversation/subagent-status.ts`; read state in `(root)/session-read-state.ts` and `screens/session-conversation.tsx`; visibility in `screens/`, `tabs/`, `sdk.tsx` and `layout/`; opening in `tabs/`, `layout/`, `chrome/` and `screens/`; identity in each surface.
