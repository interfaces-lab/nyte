# Subagents and background/foreground tasks: how a task stays linked to its owner chat

Scope: `packages/app/src` (chats/, window/, conversation/ incl. tray/, screens/session-conversation.tsx, tabs/, chrome/, workbench/terminal-*), `packages/plugin/src/client`, `packages/sdk`, plus the schema and core types they read. I read the code only. In each finding, **Seen** is what the code says and **Inferred** is what follows from it for a user.

---

## 1. How it works today

The app has three kinds of task, and nothing in the app treats them as one thing.

**Subagents.** A subagent is a child session. `SessionInfo.parent` and `SessionInfo.call` link it to its owner (`schema/src/sessions.ts:27-28`), and the delegate tool class carries a second link, `ToolClass.delegate.child` (`schema/src/tools.ts:19-23`).

**Jobs.** A background command or terminal is a workspace job. `JobView.session` names the owner chat and `JobView.foreground` says whether the tool call still holds the job (`schema/src/jobs.ts:30-42`).

**The host's own task list, unused.** The host already folds each session's jobs and pages into `SessionView.background: BackgroundItem[]` = `{kind: child|job|page, id, title, state: working|waiting|done|failed, startedBy: CallId}` (`schema/src/views.ts:141`, `schema/src/runs.ts:73-79`, built in `core/src/engine/jobs.ts:815-831` and `core/src/fold/watch.ts:523`). No app file reads it; a grep for `.background`/`BackgroundItem` under `packages/app/src` finds nothing.

**Run status.** Status comes from the presentation layer: `runStatus(execution, subagentWorking)` → `RunStatus`, plus `runMark` and `runStatusLabel` (`plugin/src/client/presentation.ts:253-376`). The chat directory joins every session list with the open views. For each chat it computes `status = runStatus(head.execution, activeAncestors.has(id))`, where `activeAncestors` marks every ancestor of any non-idle session, including one waiting for approval (`chats/directory.ts:320-333, 369-388`).

**Surfaces that read the directory.** These read `Chat.status` / `runMark`:
- sidebar (`chrome/sidebar-view.ts:93-130`, `chrome/sidebar-rows.tsx:150-170`)
- window tabs (`tabs/use-window-tabs.tsx:136-171`)
- agents tray (`conversation/tray/agents.tsx:50-84`)
- transcript agent rows (`conversation/subagent-call.tsx:176-187`)
- unread exposure (`window/exposure.ts:280-286`)

**The open chat computes status separately.** It recomputes its status without the subagent flag, `runStatus(execution)` (`screens/session-conversation.tsx:313`), and passes that to the composer and the announcer.

**Subagents in the parent transcript** take three components:
- `task`/`create` calls render as `SubagentCallView`, joined to the child by `child.call === message.state.call`.
- `send`/`await`/`read`/`stop` calls render as `SubagentLineView`, joined by `toolClass.child`.
- Reports render as `SubagentReportLine`.

All of these sit in `conversation/subagent-call.tsx` and are routed from `transcript-presentation.ts:31-48`, `tool-call.tsx:24-35`, `timeline.tsx:121-127` and `turn-view.tsx:623-627`. Every link calls `useOpenSubagentTray()` from a context built in `session-conversation.tsx:390`. That context opens the child as a **tab** when the window has a tab strip, and in the **tray detail** otherwise.

**The trays.** Both trays are a per-parent `TrayView` held in the window store (`window/tray.ts:7-54`, `window/index.ts:188-190`):
- The agents tray lists direct children that aren't idle (`tray/agents.tsx:50-84`). Its detail view mounts a nested `SessionConversation presentation="tray"` with no composer (`session-conversation.tsx:490-499`, `467`).
- The terminals tray lists `jobsWatch(workspace)` filtered to `job.session === chat && running && !foreground` (`tray/terminals.tsx:46-63, 292-294`). Opening a row calls `openJobTerminal`, which creates a workbench terminal tab with `owner: {kind: "agent", sessionId, jobId}` (`workbench/terminal-store.ts:683-704`). The terminal panel keeps it in sync through `JobSync` (`workbench/terminal-panel.tsx:293-318`).

**Moving work between foreground and background.**
- Shell → background: the `MoveToBackground` button calls `part.act("background")` (`conversation/shell-call.tsx:318-355`, `shell-background.ts`).
- Child → full chat: `expandChild` uses `windowTabs.openChat(..., "next-to-parent")` or `openSessionInPane` (`session-conversation.tsx:385-388`).
- Back to the parent: only the title bar's `SessionTitle` offers it, through `panes.openSession(parent)` (`chrome/titlebar.tsx:76-106`).

**Child approvals and questions** reach the parent composer one level up only, through `useApprovalRequest` and `useQuestionDock` (`conversation/approval-state.ts:37-77`, `tray/questions-state.ts:139-196`).

**Toasts.** The `notifications` client plugin raises toasts for root runs only, and the notify contract carries no session (`plugin/src/client/notifications.ts:15-31`, `core/src/contract/plugin.ts:218-225`).

---

## 2. Findings (most impact first)

| # | Where | What | Why it hurts | Change |
|---|---|---|---|---|
| 1 | `chats/directory.ts:369-385`, `presentation.ts:273-280, 324-334`, `chrome/sidebar-view.ts:101-130` | **Seen:** `activeAncestors` adds every ancestor of any non-idle child, including `execution.kind === "waiting"` on a part (approval or question). The ancestor gets `subagent-working`, and `runMark` turns that into `"working"`. Meanwhile the parent composer *does* show that child's approval (`approval-state.ts:39-75`). | **Inferred:** while a subagent waits on you, the parent shows a spinner ("Working") in the sidebar and tabs. It is missing from the sidebar's "Needs attention" group and its inbox shelf (`deriveSessionStatus` maps only `waiting`/`failed` there). The agents tray pill shows a yellow attention dot at the same moment. The one state that needs the user is the one that doesn't travel up. | Propagate the most urgent state up the tree: needs-you > working. Carry it as a separate `tasks` summary on `Chat`, not a `RunStatus` kind (see §3). |
| 2 | `presentation.ts:253-261, 273-280`; `session-conversation.tsx:313` vs `directory.ts:333`; `window/exposure.ts:282`; `notifications.ts:18-29`; `tray/agents.tsx:292` | **Seen:** `RunStatus` folds "a descendant is busy" into the chat's own run status (`subagent-working`). Then: (a) the open chat recomputes `runStatus(execution)` without that flag, so it computes status a second way. (b) `expose()` counts unread only while `status.kind === "completed"`, so a finished reply goes unmarked while a subagent runs. (c) The notifications plugin toasts "Run finished" for the parent's run while the sidebar still spins. (d) The tray's **Stop Agent** shows for a child whose mark is `working` only because of `subagent-working`. That calls `session.stop` on a chat that has no run, and core's stop only cascades to children the run is *waiting on* (`core/src/api/session.ts:585-613`, `core/src/engine/fence.ts:70`). | **Inferred:** surfaces disagree about one chat at the same moment: the tab spins, the composer is idle, the toast says finished, and the unread mark is missing. The Stop button can be a no-op. | Delete `subagent-working`. `Chat.status` = own run only. `Chat.tasks` = `{working, needsYou, failed}` counts over descendants and owned jobs. Marks combine the two in one function. Stop shows only for a chat with its own run. |
| 3 | `tabs/model.ts:59, 291-294`; `chrome/titlebar.tsx:194-200, 84-104`; `tabs/use-window-tabs.tsx:136-171`; `screens/pane-header.tsx` | **Seen:** with a tab strip, a subagent opens as a `next-to-parent` preview tab. The only "Back to parent chat" control is in `SessionTitle`, which renders only when `!strip`. Tab items carry no parent, and the pane header has no back link. Without a strip, the back control uses `panes.openSession` (the pane controller) and not `windowTabs.openChat`, which is the API the forward step used. | **Inferred:** in tab-strip mode the child chat is a dead end. You can get there from the parent, but no control takes you back. Forward and back use two different "open" APIs, so they can't stay symmetric. | One `openOwner(task)` / `openTask(task, intent)` in an app `tasks/open.ts`, used by the title bar, a parent crumb on tabs and the pane header, the tray's "Open as full chat", and transcript links. |
| 4 | `session-conversation.tsx:390`; `subagent-sessions.ts:145-147`; `tray/agents.tsx:247-252, 301-306` | **Seen:** the same click on an agent row, report line or `agent:` citation opens a **tab** when `windowTabs.strip` is set (`expandChild`) and the **tray detail** otherwise. The hook is named `useOpenSubagentTray` in both cases. The agents tray always opens its detail view and offers expand as a separate button. | **Inferred:** where a subagent opens depends on a window preference, not on the user's intent. Tray detail ("peek") is unreachable from the transcript in tab-strip mode. | Two explicit intents everywhere: click = peek (tray detail), ⌘/expand = full chat. Rename the hook to `useOpenTask`. |
| 5 | `schema/src/runs.ts:73-79`, `views.ts:141` (unused in app); `tray/terminals.tsx:46-63, 253-263, 292-294`; `shell-call.tsx:424-566`; `subagent-call.tsx:484-500` | **Seen:** the host sends a per-chat task list with `startedBy` (the call id), but the app re-derives live jobs from the workspace job list, twice, in the same file (`useLiveTerminals` and `BackgroundWork`). A shell call moved to the background keeps no link to its job: `ToolClass.shell` has no job id and the app doesn't look up `startedBy`. A job's report line (`source.kind === "job"`, which carries `source.job`) renders the first line of text with **no** open action, while a child's report opens it. | **Inferred:** after "Move to background", the row the user clicked loses its job. The job surfaces only in the terminals pill and disappears from it once it ends. Its later report can't reopen its output. Foreground jobs can't open in a terminal at all, since `runsInBackground` excludes them. | Read `SessionView.background` (or one task store, §3) as the per-chat task list. Link call rows and report lines through `startedBy` / `source.job`. "Open terminal" goes on any job row, foreground or background. |
| 6 | Status words: `presentation.ts:353-376` ("Working", "Completed"), `components/ui.tsx:60-66` (aria "Running"), `subagent-status.ts:11, 16, 37-38` ("Starting up", "Planning next moves", also used for `subagent-working`), `subagent-call.tsx:466-470` ("Finished"), `:338` ("agents completed"/"finished"), `notifications.ts:27` ("Run finished"), `terminals.tsx:300, 226-229, 401` ("Terminal", "task", "background work"), `terminal-panel.tsx:106-131` ("Agent command", "Command completed/cancelled/interrupted") | **Seen:** one run end, `completed`, is shown as Completed, Finished and Run finished. One mark is labeled Working (`runStatusLabel`) and Running (StatusDot aria). One job is called terminal, task, background work and command. A child that is idle but has working grandchildren reads "Planning next moves". | **Inferred:** a user can't tell whether "finished", "completed" and "done" are different states. Screen readers hear different words than sighted users see. | One vocabulary: `taskState` and `taskLabel` in `plugin/src/client/presentation.ts`, for agents and jobs alike. Delete `REPORT_VERBS`, `STATUS_MARK_LABEL` and the inline job copy. |
| 7 | Glyphs: `components/ui.tsx:88-123` (StatusDot: bubble-question / warning icon / moon), `chrome/status-glyph.tsx:13-15` (eye for unread), `tabs/window-tab-strip.tsx:157` (plain dot for unread), `tray/agents.tsx:33-39, 173, 255-256` (yellow 6px dot for waiting), `subagent-call.stylex.ts:30-33` + `subagent-call.tsx:191-205` (red dot for failed, grey dot for done, moon for unread) | **Seen:** "needs you" has two glyphs: a bubble-question icon in the sidebar and tabs, a yellow dot in the tray and rows. "Failed" has two: a warning icon and a red dot. "Unread" has three: the moon (which `StatusDot` supports but `StatusGlyph` never passes), an eye, and a plain dot. | **Inferred:** the same child shows different marks in the transcript, the tray and the tab. | One `TaskMark` component fed by `taskState` + unread. Delete `StatusGlyph`, `attentionDot`, and the dot styles in `subagent-call.stylex.ts`. |
| 8 | Child title fallbacks: `presentation.ts:411` ("Subagent"), `chats/index.ts:46-48` ("Chat"), `subagent-call.tsx:283, 365` (`child.name ?? toolClass.title ?? "Subagent"`), `:390` (`?? "agent"`), `:493` ("Subagent"), `:599` (raw session id), `presentation.ts:637` ("subagent"), `approval-state.ts:72` / `questions-state.ts:194` ("a subagent"), `tray/agents.tsx:125` | **Seen:** nine separate fallbacks. Transcript rows read `child.name` (raw `SessionInfo`), while the tray and tabs read `chat.title` (projected through pending renames). | **Inferred:** when a child has no name, its transcript card shows the delegate's title ("Explore auth") but the tray and tab say "Subagent". A citation can show a raw session id. A pending rename shows in the tray but not the row. | Title comes only from `Chat.title`. Have the directory fold the delegate call's title into `sessionTitle` when `name === null`. |
| 9 | `subagent-call.tsx:141-143` vs `:386-387`; `queries.ts:416-420` vs `subagent-sessions.ts:106-139`; `session-conversation.tsx:282-292` + `tray/agents.tsx:104-119` | **Seen:** call → child is joined two ways (`child.call === call` vs `toolClass.child`). The children list is read through two hooks over the same `childrenWatch` (`useChildSessions` and the context's `useSubagentChildren`), plus the directory already has `parent` for every chat. `listSubagents` runs twice per render, once to decide whether the tray is open and once inside the tray. | **Inferred:** the card shows "Starting up" with no link until the child shows up in the children watch, even though `toolClass.child` already names it. Three sources of "who are my children" can briefly disagree. | One join, `toolClass.child ?? lookup(call)`, and one roster selector over the directory. Compute the roster once in `session-conversation` and pass it to the tray. |
| 10 | `approval-state.ts:16-35, 39-50` ≡ `tray/questions-state.ts:117-135, 141-152` | **Seen:** byte-identical `watchChildViews`/`observeQuestionViews` and the same "children waiting on a part" scan, both using `child.heads[0]` where everything else uses `mainHead`. Both bubble up **one** level only. The tray detail has no composer (`session-conversation.tsx:467`). | **Inferred:** a grandchild's approval is invisible from the root and from the tray detail, while finding 1 makes the root spin. You have to open the intermediate child as a full chat to answer it. | One `useWaitingDescendants(session)` (all levels, `mainHead`) feeding both trays. Delete the copy. |
| 11 | `tray/agents.tsx:70-83` vs `tray/terminals.tsx:246-248, 292-309` | **Seen:** failed agents stay in the agents tray and pill indefinitely, because `mark === "failed"` persists and there is no dismiss. A failed or ended job drops out of the terminals tray at once. | **Inferred:** the same outcome, a failed task, is sticky for one kind and vanishes for the other. | One retention rule per task state. A "dismiss"/"clear finished" action in the one tray. |
| 12 | Job end mapping: `core/src/engine/jobs.ts:815-831` (`terminated`/`lost` → `failed`), `tui/src/lib/tasks.ts:66-71` (→ `stopped`), `workbench/terminal-panel.tsx:111-131` (cancelled/interrupted, not failed) | **Seen:** three mappings of `JobState` to a status, and the host's `BackgroundItem` calls a job the user cancelled "failed". | **Inferred:** once `background[]` is consumed (finding 5), a cancelled job will show red. | One `jobTaskState(JobState)` in presentation. Core's `createJobBackgroundItem` and the TUI both call it. |
| 13 | `workbench/controller.ts:38-40` (`jobId: string`), `terminal-store.ts:48-55, 479-493`, `session-conversation.tsx:506-512`, `terminal-panel.tsx:196-205` | **Seen:** the job → owner link is stored twice: in the workbench tab `owner` and in `JobTerminalTab.sessionId`. Both are passed in from the parent chat rather than read from `JobView.session`. `followJob` re-derives the workspace through `session(sessionId).info()` even though the caller had it. Agent terminal tabs offer no "open owner chat". | **Inferred:** a terminal opened from a job can't take you back to the chat that started it. The owner can drift if a child's job is ever opened from the parent. | Key agent terminals by `{workspace, jobId: JobId}`, read the owner from `JobView.session`, and add "Open chat" through `openOwner`. |
| 14 | `plugin/src/client/notifications.ts:15-31`, `core/src/contract/plugin.ts:218-225`, `client-plugins.tsx:36-41` | **Seen:** `ui.notify` has no session, so a run-ended toast can't link to the chat. Child sessions never notify, and there is no notification for "needs you". | **Inferred:** a toast is a dead end: you have to find the chat yourself. A subagent blocked on approval in an unwatched chat is silent. | Add an optional `session` to `notify`; the app adds an "Open" action through `openTask`. Notify on "needs you", propagated to the root. |

---

## 3. Target shape

### One model

```ts
// packages/plugin/src/client/tasks.ts  (presentation; the app and the TUI share it)
export type TaskRef =
  | { readonly kind: "agent"; readonly session: SessionId }
  | { readonly kind: "job"; readonly workspace: WorkspaceId; readonly job: JobId };

export type TaskState = "starting" | "working" | "needs-you" | "retrying" | "done" | "failed" | "stopped";

export interface Task {
  readonly ref: TaskRef;
  readonly owner: SessionId;            // SessionInfo.parent | JobView.session — the only owner link
  readonly startedBy: CallId | null;    // BackgroundItem.startedBy | SessionInfo.call
  readonly title: string;
  readonly state: TaskState;
  readonly placement: "foreground" | "background"; // JobView.foreground; agents: delegate awaited or not
}

export function agentTaskState(execution: Execution | undefined): TaskState;
export function jobTaskState(state: JobState): TaskState;      // core's BackgroundItem uses it too
export function taskLabel(state: TaskState): string;           // the only status words
export function rollUp(states: readonly TaskState[]): TaskState | null; // needs-you > failed > working
```

`RunStatus` loses `subagent-working`. `runStatus()` loses its second parameter. `Chat` becomes `{…, status: RunStatus /* own */, tasks: TaskState | null /* rolled up from descendants and owned jobs */}`, and marks are `mark(chat) = max(runMark(status), tasks)`.

### Surfaces → one source each

| Surface | Reads | Opens |
|---|---|---|
| Sidebar row, window tab, workbench tab | `Chat` (status + rolled-up tasks) → `TaskMark` | `openTask(ref, "chat")`; tab and pane header show the parent crumb through `openOwner` |
| Transcript call / line / report / citation | `tasksOf(owner)` by `startedBy` / `source.job` / `toolClass.child` | click = `"peek"`, expand = `"chat"`; job rows = `"terminal"` |
| Tray above composer | `tasksOf(owner)`: agents and jobs, one list in sections, one retention rule | same intents |
| Composer | `Chat.status` (own run) + `useWaitingDescendants` | none |
| Toasts | `notify({ session })` | `openTask` |

### File map

| Today | Becomes |
|---|---|
| `plugin/src/client/presentation.ts` `runStatus` (2nd param), `runMark`, `runStatusLabel`; `conversation/subagent-status.ts` (`callStatus`, `subagentStatus`); `REPORT_VERBS` in `subagent-call.tsx:466-470`; `STATUS_MARK_LABEL` in `components/ui.tsx:60-66`; `core/src/engine/jobs.ts:815-831` state mapping; `tui/src/lib/tasks.ts` `taskStatus`/`toneStatus` | **`plugin/src/client/tasks.ts`** (new). Delete `subagent-status.ts`. |
| `chats/directory.ts` `activeAncestors` | `chats/directory.ts` `rollUpTasks` (needs-you aware); `Chat.tasks` |
| `conversation/subagent-sessions.ts`, `queries.ts:416-420 useChildSessions`, `tray/terminals.tsx` `runsInBackground`/`useLiveTerminals`, `listSubagents` in `tray/agents.tsx` | **`app/src/tasks/index.ts`**: `useTasks(owner)`, `useTask(ref)`, built from the directory + `SessionView.background` |
| `session-conversation.tsx:375-390` (`openSubagentTray`, `expandChild`), `titlebar.tsx:84-104` back link, `terminal-store.ts:683-704 openJobTerminal`, `tray/terminals.tsx:357-360` | **`app/src/tasks/open.ts`**: `openTask(ref, "peek" \| "chat" \| "terminal")`, `openOwner(ref)`; uses `windowTabs.openChat` only |
| `conversation/shell-background.ts`; stop mutations in `tray/agents.tsx:110-117`, `tray/terminals.tsx:280-290`, `terminal-panel.tsx:199-205` | **`app/src/tasks/actions.ts`**: `moveToBackground`, `stopTask`, `stopTasks` |
| `approval-state.ts:16-50` + `tray/questions-state.ts:117-152` | **`app/src/tasks/waiting.ts`**: `useWaitingDescendants` (one copy, all levels, `mainHead`) |
| `components/ui.tsx StatusDot`/`UnreadMark`, `chrome/status-glyph.tsx`, `tray/agents.tsx` `attentionDot`, `subagent-call.stylex.ts` dot styles | **`app/src/tasks/task-mark.tsx`**: `TaskMark { state, unread }`. Delete `status-glyph.tsx`. |
| `conversation/tray/agents.tsx` + `conversation/tray/terminals.tsx` | **`conversation/tray/tasks.tsx`**: one tray, one pill, sections by kind; detail keeps the nested conversation |
| `window/tray.ts` `TrayView` (`list` / `terminals` / `detail`, two `openedOver` id types) | `{closed} \| {list, openedOver: TaskRef[]} \| {detail, session}` |
| `conversation/subagent-call.tsx` (640 lines, 5 components) | `conversation/task-row.tsx` (card + nested rows), `task-line.tsx` (delegate line), `task-report.tsx` (child **and** job report, both linkable), `task-citation.tsx` |
| `workbench/controller.ts` `TerminalOwner.agent {sessionId, jobId: string}` + `JobTerminalTab.sessionId` | `{kind: "job", workspace, job: JobId}`; owner read from `JobView.session` |
| `core/src/contract/plugin.ts:219` `notify` | adds `session?: SessionId` |

---

## 4. First changes

1. **Split own status from descendant status and roll up "needs you".** Delete `subagent-working` and add `Chat.tasks` with needs-you > failed > working (fixes findings 1 and 2). This fixes the sidebar and tab spinner during approvals, the missing unread mark, the "Run finished" toast that contradicts the spinner, and the no-op Stop Agent. The change is contained: `presentation.ts`, `chats/directory.ts`, `window/exposure.ts`, `sidebar-view.ts`, `tray/agents.tsx:292`.
2. **One `openTask`/`openOwner` and a parent link on every surface** (findings 3, 4 and 13). Route the title bar, a parent crumb on tabs and the pane header, the tray's expand, transcript links and agent terminal tabs through `windowTabs.openChat`. Separate peek from full chat by intent rather than by `windowTabs.strip`.
3. **One vocabulary and one glyph** (findings 6, 7, 8 and 12): `taskState`/`taskLabel` in `plugin/src/client/tasks.ts`, `TaskMark` in the app, child titles from `Chat.title` only. Mostly deletion: `REPORT_VERBS`, `STATUS_MARK_LABEL`, `StatusGlyph`, three dot styles, and nine title fallbacks.
4. **Consume `SessionView.background` for jobs** (findings 5 and 11). Link a backgrounded shell row and a job report to the job's terminal through `startedBy`/`source.job`, allow opening a foreground job, and delete the duplicated `runsInBackground` filters.
5. **Merge the twin child watchers** (findings 9 and 10): one `useWaitingDescendants`, one join from a call to its child, one roster selector computed once.
