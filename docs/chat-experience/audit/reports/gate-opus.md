# Run-state gate review: working, waiting or done

Scope: what tells the user whether a chat is working, waiting, or done and ready for input. I judged from the code at `/tmp/review-code` only. Each claim is marked **Seen** (I read it, or a passing test proves it) or **Inferred** (it follows from what I read, but I didn't execute it).

Tests I ran (all pass, so they pin today's behaviour):
- `packages/app`: `src/chats/directory.test.ts`, `src/conversation/subagent-status.test.ts`, `src/conversation/step-group-presentation.test.ts`, `src/conversation/transcript-rows.test.ts`, `src/window/exposure.test.ts` (5 files, 44 tests).

---

## 1. How the gate works today

### 1.1 Core: how a parent's run is stored while its subagents work

**Subagent tools** (`packages/plugin/src/subagents.ts`), Seen:
- `task` (113–146) starts a child, then `invocation.wait({kind:"any", targets:[{kind:"run", session: child, run}], untilInput: true})` (136–140). The parent's run is **blocked** on the child. Because of `untilInput: true`, any user message also wakes the wait.
- `create` (148–173) and `send` (175–198) return as soon as the child is started or messaged. The child runs in the **background**, and the parent's run carries on and ends normally.
- `await` (200–250) does the same `untilInput` wait as `task`, on a child that was started earlier.
- When a child's run ends, `deliverChildReport` (`core/src/engine/runs.ts:273–301`) sends the parent a message with `source:{kind:"child"}` and `delivery:"attach"`. If the parent is idle and its last run completed, `selectRunStart` (`engine/admission.ts:206–228`) starts a **continuation run** (`origin:{kind:"continuation", from:"child"}`). If the last run did not complete (`holdsReports`, `fold/project.ts:104–106`), the report is held.

**Execution state** (`schema/src/runs.ts:52–71`; fold in `core/src/fold/fold.ts:498–630`), Seen:
- The kinds are `idle{lastRun}`, `live{phase, stopping}`, `waiting{on: WaitTarget}` and `retrying`.
- A parked tool wait becomes a run `waiting` event: `durable.ts:477–527` → `runWait` (`waits.ts:578–603`) → fold `execute(...{kind:"waiting", on})` (`fold.ts:520–524`). The turn becomes `{kind:"waiting", on}`.
- `on` is **one** target. `waitingOn` (`engine/waits.ts:616–623`) keeps only the first unresolved target of an `any`/`all` wait, and `untilInput` is dropped.
- The run record's `waiting` is overwritten by each new parked call: `waiting: on ?? run.waiting` (`durable.ts:516`). **Inferred:** if two calls are parked at once (for example an approval and a `task`), whichever parked last decides what the chat shows.
- When the run ends, the fold sets `idle{lastRun}` (`fold.ts:600–616`). From that point the parent's `Execution` says nothing about its children.

**Is there a foreground/background distinction in the data?**
- **Yes, but only implicitly.** A child the parent awaits appears as `execution.waiting.on = {kind:"run", session: child}`. A background child appears nowhere in the parent's `Execution`.
- **The wire has a slot for background work that nothing fills for children.** Seen:
  - `SessionView.background: BackgroundItem[]` (`schema/views.ts:141`) has `kind: "child" | "job" | "page"` (`schema/runs.ts:73–79`).
  - Core only emits job and page items (`fold/watch.ts:524`, `engine/jobs.ts:69–86`, `env/browser.ts:45`). No producer emits `kind:"child"`.
  - No client reads `view.background` (grep over app, tui, mobile, sdk and plugin finds none).

### 1.2 Presentation (`packages/plugin/src/client/presentation.ts`), Seen

- `RunStatus` (253–261) mixes two different things in one union: the chat's own run (`working`, `waiting-for-approval`, `retrying`, `completed`, `stopped`, `failed`, `idle`) and other sessions' work (`subagent-working`).
- `runStatus(execution, subagentWorking = false)` (273–296):
  - `subagent-working` **outranks the own run's end** (276, 278). A failed or completed run reads as `subagent-working` while any descendant runs.
  - `waiting` on anything other than a part maps to plain `working` (283–286). So "blocked on a subagent" is indistinguishable from "generating".
- `runMark` (324–343) draws `subagent-working` as `"working"` (333). `runStatusLabel` (353–374) labels it `"Working"` (364).
- `executionMark` and `sessionMark` (383–401) cover the own run only, and they are what mobile uses.

### 1.3 Desktop: who calls what (Seen)

| Consumer | Status source | Subagent flag? |
|---|---|---|
| Chat directory `joinChats` (`app/src/chats/directory.ts:92,105`) | `runStatus(head.execution, delegating.has(id))`. `activeAncestors` (141–160) marks **every ancestor of any non-idle session, including descendants waiting on approval** | yes |
| Sidebar row, shelf, sort, archive guard (`chrome/sidebar-view.ts:94–130,137–165,183–201`; `sidebar-rows.tsx:162–170`) | `runMark(chat.status)` | yes, from the directory |
| Tab glyph (`tabs/use-window-tabs.tsx:145`) | `runMark(chat.status)` | yes |
| Unread (`window/exposure.ts:35–41`) | `chat.status.kind === "completed"` | yes. A `subagent-working` chat can never be unread |
| Agents tray (`conversation/tray/agents.tsx:49–82, 258–263`) | children's `chat.status` | yes |
| Transcript subagent rows (`subagent-call.tsx:182–187`) → `subagentStatus` (`subagent-status.ts:34–38`) | `working` **and** `subagent-working` both read "Planning next moves" | yes |
| Conversation status, composer, announcer (`screens/session-conversation.tsx:313`) | `runStatus(view.execution)` | **no**, own run only |
| Transcript rows (`conversation/transcript-rows.ts:94–110`) | `running = execution.kind !== "idle"` | no (its own third derivation) |
| Live planning line (`live-turn.tsx:37`) | `sessionActivity.kind === "idle"` (`session-activity.ts`) | no (a fourth derivation) |

**Composer gate** (Seen):
- `liveRun = "run" in status ? status.run : undefined` (`composer.tsx:145`), and `busy={liveRun !== undefined}` (755). So `working`, `retrying` and `waiting-for-approval` are busy; idle kinds and `subagent-working` are not.
- When busy, `ComposerFrame` picks `{kind:"running"}` (`composer-frame.tsx:177–188`). `enterBehavior` (`composer-keys.ts:63–85`) then makes Enter mean Steer (or Queue, depending on the preference; the default is `steer`, `preferences/index.ts:37–41`), and the Stop button shows (`composer-frame.tsx:581–595`).
- When not busy, Enter means "Send Message".

### 1.4 TUI (Seen)

The TUI **never calls `runStatus`.** It has its own derivations:
- `runModel` (`tui/src/model/table-input.ts:67–90`) drives the composer interactions. The "busy" interaction applies when `run.kind !== "idle"` (`model/interactions.ts:352–360`); the placeholder is chosen at `model/screen.ts:100–101`.
- `busy()` (`model/step.ts:69–71`) is `execution.kind !== "idle"`.
- `turnStatus` (`model/transcript.ts:327–378`) draws the turn status row. `waiting` on a non-part becomes `{kind:"working", activity:null}` (351–354), which `turn-status.tsx:33–37` prints as `" Working"` (`lib/constants.ts:164`). This **throws away even core's "Delegating" activity.**
- `tasksLine` (`model/screen.ts:106–115`) shows `"N running in background"` for every unfinished child or job (`lib/tasks.ts:273`), whether the parent awaits it or not.
- Program status OSC (`lib/program-status.ts:23–35`) is `working` when busy.
- The mini rule (`mini/screen.tsx:56–69`) uses the turn status, or the first held entry when that entry is a running tool or shell.

---

## 2. Five cases × every surface

Cases:
- (a) own run live
- (b) own run waiting on approval
- (c) own run waiting on an awaited subagent (`task`, or `create`+`await`)
- (d) own run ended (completed); background subagents from `create`/`send` still running
- (e) own run ended; nothing running

**What Enter does** is given for each composer row.

| Surface | (a) live | (b) approval | (c) awaited subagent | (d) ended + background | (e) ended, nothing |
|---|---|---|---|---|---|
| **Desktop composer** | busy: Stop; Enter = **steer** ("Steer without stopping") | busy: Stop; Enter = steer | busy: Stop; Enter = **steer**; placeholder "Steer without stopping". Inferred: a steer wakes the `untilInput` wait and lands at the next boundary | idle: Enter = **send** ✅ | idle: send ✅ |
| **Desktop live row / last step header** | thinking-only group: header "Thinking", then "Planning next moves" while running. Group with tools: shimmering summary, plus LiveTurn "Planning next moves" when no tool is running | the group's tool shows "Needs input"; LiveTurn row present but invisible (activity = tool) | `task`: agents row with child spinners; LiveTurn invisible. **`await` after thinking: the thinking group's header reads "Planning next moves", then "Taking longer than expected…" after 15 s** (await is hidden, `transcript-presentation.ts:36`) | ended: "Thought Ns" / "Worked for"; the agents row under `create` shows child spinners reading "Planning next moves" | ended ✅ |
| **Desktop floating status** (workbench) | activity or "Planning next moves" | "Needs attention" | "Delegating" / "Waiting on" | hidden ✅ | hidden ✅ |
| **Desktop sidebar** (mark / shelf / unread) | spinner, Working shelf | waiting dot, "Needs attention", inbox | spinner, Working | ❌ **spinner, Working shelf, never unread; a failed own run is hidden; a child needing approval shows as a spinner** | unread or done ✅ |
| **Desktop tab glyph** | spinner | waiting | spinner | ❌ **spinner** | none ✅ |
| **Desktop run announcer** (screen reader) | "Nyte is responding" | "Nyte needs your answer" | "Nyte is responding" (inaccurate) | "Response finished" ✅ (contradicts the sidebar) | "Response finished" |
| **Desktop agents tray** | n/a | n/a | "Agents, N active" with working dot (awaited agents look like background) | "Agents, N active" ✅ (but no wording that says background) | hidden |
| **Desktop OS notification** (unfocused root) | none | none | none | "Run finished" (while the sidebar still spins) | "Run finished" |
| **TUI turn status row** | "Thinking…", the activity ("Exploring"/"Delegating"), or **" Working"** in the planning moment | "• Waiting for your answer" | ❌ **" Working"** (activity dropped) | "Worked for Ns" or nothing ✅ | same ✅ |
| **TUI mini rule** | spinner + tool heading or turn status | waiting label | spinner + the task/await tool heading | no label ✅ (a spinner only if a user shell job runs) | none ✅ |
| **TUI tasks line** | children if any | children if any | ❌ **"N running in background"** next to "Working": awaited agents called background | "N running in background" ✅ (wording could say "agents") | hidden |
| **TUI composer** | busy: Enter = steer "Steer the run" (or queue); Esc stops | approval dialog; Esc stops | busy: steer; Esc **stops the parent** | idle: Enter = **send** ✅ | send ✅ |
| **TUI program status** (OSC 7501) | working | working (Inferred: approvals are not `question`, so not "blocked") | working | done ✅ | done/idle ✅ |
| **Mobile row** (`sessionMark`) | working | waiting | working | idle ✅ (disagrees with desktop) | idle |

**Addendum: which of the two concepts shows in each case today**

| Case | Thinking group header today | "Planning next moves" today |
|---|---|---|
| (a) | "Thinking" while streaming; **turns into "Planning next moves"** when it is the turn's last group and has no tool calls | in the group header (no tools) or in the LiveTurn row (with tools): two homes |
| (b) | settled summary | not shown (row invisible) |
| (c) | **"Planning next moves" / "Taking longer than expected…" when `await` follows thinking** | LiveTurn row invisible when a delegate tool is "running" |
| (d) | "Thought Ns" ✅ | shown on **child rows** in the transcript ("Planning next moves" = the generic word for a working child, `subagent-status.ts:11`) |
| (e) | "Thought Ns" ✅ | none ✅ |

---

## 3. Findings (by impact; root cause first)

| # | Where | What (Seen unless marked) | Why it hurts | Change |
|---|---|---|---|---|
| 1 | `plugin/src/client/presentation.ts:253–281, 324–374`; `app/src/chats/directory.ts:92–105, 141–160` | **Root cause.** One `RunStatus` union holds two independent things: the chat's own run, and its descendants' work. `subagent-working` outranks the own run's end, and `runMark`/`runStatusLabel` turn it into "working"/"Working". `activeAncestors` feeds it from **every** non-idle descendant, including grandchildren and children waiting on approval. | In case (d) the sidebar spinner, Working shelf and tab spinner all say "busy" after the chat has finished, which is exactly the owner's complaint. Knock-on effects: the unread reply is suppressed (`exposure.ts:38`, pinned by `exposure.test.ts:126–140`), a failed own run is hidden (pinned by `directory.test.ts:73–81`), and a child that needs approval shows as a parent spinner instead of attention. | Delete `subagent-working` and the `subagentWorking` parameter. Give `Chat` an own-run status plus a separate `background` count. Every mark, shelf and unread rule reads the own run only; background work shows as a badge. |
| 2 | `schema/src/runs.ts:52–79`, `views.ts:141`; `core/src/fold/watch.ts:524`; `engine/waits.ts:616–623`; `engine/durable.ts:516` | **Root cause (data).** Core never publishes "this chat's subagents and whether its run awaits them". `view.background` is never fed child items and no client reads it. `Execution.waiting.on` is one target with `untilInput` dropped, and the last parked call overwrites it. | Every client rebuilds the answer differently: desktop chrome scans session lists, desktop conversation looks at the own run only, the TUI uses a task list, mobile uses the own run. They disagree, which breaks "one way to do each task". **Inferred:** a parallel approval can be masked as "working" depending on the order calls parked. | Core emits `BackgroundItem{kind:"child", state, startedBy, awaited}` for each child. `waiting` carries the pending targets and whether input wakes the wait. Approval (part) waits take precedence over other waits in the run's `waiting`. |
| 3 | `presentation.ts:283–286`; `tui/src/model/transcript.ts:351–354`; `session-conversation.tsx:163–172` | Waiting on an awaited child or job is reported as generic `working`. The TUI even prints `" Working"` without the "Delegating" activity, and the screen-reader announcer says "Nyte is responding". | Case (c) looks identical to generation. The user can't tell the model has stopped and is only waiting, even though a message would reach it right away (`untilInput`). | Add an own-run kind `awaiting{agents, jobs}`, labelled "Waiting on 2 agents". |
| 4 | `app/src/conversation/step-group-presentation.ts:39–88`; `transcript-rows.ts:206, 255, 354`; `live-turn.tsx:22–31`; `step-group.tsx:113–124, 263–266`; pinned by `transcript-rows.test.ts:175–196`, `step-group-presentation.test.ts:160–172` | **The thinking group stands in for the planning status.** A running group with no tool calls has its header replaced by a live status: "Thinking", or "Planning next moves" once the thought settles (`showsLiveStatus`). `settledWork` then hides the LiveTurn row. The group's `running` is "last item and `execution !== idle`" (`transcript-rows.ts:98, 206`), so waiting and retrying count as running. | The reasoning disclosure changes job mid-turn. "Planning next moves" lives in two rows depending on whether the group has tools. A chat blocked on `await` (hidden slot, `transcript-presentation.ts:36`) reads "Planning next moves" and then "Taking longer than expected…". | Separate the two concepts (§4.3): the group header follows only its own parts' streaming state, and the live row is the only place planning appears. |
| 5 | `tui/src/lib/constants.ts:164`; `ui/transcript/turn-status.tsx:33–37`; `model/transcript.ts:355–371` | The TUI has no planning state. The gap between tool calls, or before the reply, reads `" Working"`, while desktop says "Planning next moves". | Two surfaces use different words for one state. "Working" is the exact word the owner objects to. | Have `turnStatus` return `planning`, with words from shared presentation. |
| 6 | `tui/src/model/screen.ts:106–115`; `lib/tasks.ts:273` | The tasks line counts awaited children as "running in background". | In case (c) the TUI says "Working" and "2 running in background" at the same time, which contradict each other. | Count only background children and jobs, and word it "2 agents working in the background". |
| 7 | `app/src/conversation/subagent-status.ts:11, 34–38`; `tray/agents.tsx:263` | A child's `working` **and** `subagent-working` both read "Planning next moves". The tray meta says "Working" for an idle child whose grandchild runs. | The planning label becomes the generic word for "busy". A child blocked on its own `await` says "Planning next moves". | Child rows use the same own-run label (`ownRunLabel`) plus a background badge. |
| 8 | `core/src/engine/admission.ts:770–779`; `drive/execution.ts:803–829` | **Inferred.** Every user message wakes `untilInput` waits, whatever its delivery, but only `steer`/`attach` land at the boundary (817). A **queued** message in case (c) ends the wait ("still working") without reaching the model, and then waits for the next turn. | With the Queue preference, case (c) interrupts the subagent wait for nothing. | Wake input waits only for deliveries that land (steer/attach). In case (c) the composer offers Send (steer) only. |
| 9 | `tui/src/model/table-input.ts:67–90`, `model/step.ts:69–71`, `lib/program-status.ts`, `lib/tasks.ts:100–124`; `app/.../transcript-rows.ts:94–99`; `session-activity.ts`; `mobile/src/chat/sessions.ts` | There are five separate run-state derivations, none of them shared. | Drift is guaranteed: desktop chrome and the desktop composer already disagree in case (d). | One `chatStatus()` in `plugin/src/client/presentation.ts`, consumed everywhere. |
| 10 | `session-conversation.tsx:168, 313` | `ANNOUNCEMENTS["subagent-working"]` is dead code, because the conversation never passes the flag. | It shows the union's own consumers disagree about what it means. | Disappears with finding 1. |

---

## 4. Proposed gate

### 4.1 One status model with two independent parts

These types go in `packages/plugin/src/client/presentation.ts`. It is the only layer that turns data into words and marks.

```ts
/** What the chat's own run is doing; decided only by its head's Execution and its live parts. */
export type OwnRun =
  | { readonly kind: "ready"; readonly last: "none" | "completed" | "stopped" }
  | { readonly kind: "failed"; readonly failure: Failure }
  | { readonly kind: "working"; readonly run: RunId; readonly stopping: boolean; readonly doing: Doing }
  | { readonly kind: "needs-you"; readonly run: RunId }
  | { readonly kind: "awaiting"; readonly run: RunId; readonly agents: number; readonly jobs: number }
  | { readonly kind: "retrying"; readonly run: RunId; readonly until: number };

export type Doing =
  | { readonly kind: "thinking" }
  | { readonly kind: "writing" }
  | { readonly kind: "tool"; readonly toolClass: ToolClass }
  | { readonly kind: "planning" };            // live, nothing streaming, no tool running

/** Work the chat started but does not block on. Never changes OwnRun. */
export interface Background { readonly working: number; readonly needsYou: number; readonly jobs: number }

export interface ChatStatus { readonly own: OwnRun; readonly background: Background }

export function chatStatus(execution: Execution | undefined, live: readonly Message[], background: readonly BackgroundItem[]): ChatStatus;
export function ownMark(own: OwnRun): SessionMark;           // sidebar, tab, tray dot
export function ownLabel(own: OwnRun): string;               // "Planning next moves", "Waiting on 2 agents", "Needs your approval", "Completed"
export function backgroundLabel(bg: Background): string | null; // "2 agents working in the background", "An agent needs your answer"
export function composerMode(own: OwnRun): "send" | "steer" | "answer";
```

**Which layer decides what:**
- **Core decides the facts:**
  - `Execution` stays as it is, but `waiting` carries the pending targets and whether input wakes the wait.
  - `view.background` lists children (plus jobs and pages), each with `awaited: boolean`. A child is awaited when a parked call of the live run waits on it.
  - The child list can come from the existing `startedBy` field plus the run's parked waits.
- **Presentation decides words and marks:** `chatStatus` and the functions above.
- **Surfaces only render.**
- The desktop directory keeps its descendant scan **only** to fill `background` for listed rows that have no open view. That scan must never change `own`.

### 4.2 Mapping for each case

| Case | `own` | `background` | Mark (sidebar, tab) | Label | Composer | Background affordance |
|---|---|---|---|---|---|---|
| (a) live | `working{doing}` | any | working spinner | `doing`: "Thinking", "Writing", tool verb, or "Planning next moves" | Enter = steer (or queue, per preference); Stop | badge if background > 0 |
| (b) approval | `needs-you` | any | attention | "Needs your approval" | answer / steer; Stop | badge |
| (c) awaited subagent | `awaiting{agents:2}` | excludes the awaited ones | working, with a distinct "waiting" glyph (no shimmer) | "Waiting on 2 agents" | **Enter = Send** (steer delivery, which reaches the model now because the wait is input-woken); placeholder "Message — the agents keep working"; Stop ends the parent's run; the queue alternate is removed in this state | agents tray lists them as "awaited" |
| (d) ended + background | `ready{completed}` or `failed` | `working: 2` | **own mark only**: unread dot, done or failed. No spinner | "Completed" / failure | **Enter = Send**, no Stop | "2 agents working in the background" as a sidebar badge, tray header, TUI tasks line and small tab count. Shelf, unread and notifications follow `own` |
| (e) ended | `ready` | none | unread or done | "Completed" | Send | none |

When a background child finishes, core attaches its report and starts a continuation run. The chat becomes (a) because its own run really is working again, which is correct.

**What each surface shows under this model:**
- **Desktop composer:** `composerMode(own)` replaces `liveRun !== undefined`.
- **Live row:** `ownLabel(own)` when `own` is not `ready`/`failed`.
- **Sidebar, tab and exposure:** `ownMark(own)`, plus the badge from `backgroundLabel`. Unread uses `own.kind === "ready" && own.last === "completed"`.
- **Announcer:** keyed on `own.kind`. Case (c) announces "Waiting on 2 agents".
- **Agents tray header:** `backgroundLabel`.
- **TUI turn status row and mini rule:** `ownLabel(own)`.
- **TUI tasks line:** `backgroundLabel`.
- **TUI interactions and program status:** `composerMode(own)`; program status is `done` in (d).
- **Mobile:** `ownMark`.

### 4.3 Addendum: separating the thinking group from "Planning next moves"

They are two concepts that come from different data:

| | Thinking group (transcript artifact) | Planning status (live run state) |
|---|---|---|
| **What it is** | A collapsible step row holding the model's reasoning | The one-line "what is the run doing now" when nothing is streaming and no tool runs |
| **Data that decides it** | Its own thinking parts only: live while its newest thinking part is `status.kind === "live"`, otherwise settled. It does **not** use the turn's `running`, `execution` or its position as the last item | `own.kind === "working" && own.doing.kind === "planning"`: `Execution.live` (phase responding or executing), no live thinking or text part, no tool with tense `running`. Move the projector from `app/src/conversation/session-activity.ts` into presentation so the TUI uses it too |
| **Row that renders it** | `StepGroupView` for that group | **Only** the live row (`LiveTurn`; in the TUI, the turn status row and mini rule). Never a group header |
| **Wording** | Live: "Thinking" (shimmer). Settled: reasoning heading title, else "Thought", plus duration ("Thought 8s"). A group with tools keeps its work summary ("Running 2 commands" → "Ran 2 commands"), and its header shimmers only while one of its tools runs | "Planning next moves" after 200 ms; "Taking longer than expected…" after 15 s. Desktop and TUI use the same words (from presentation) |
| **Never** | Never says "Planning next moves" or "Taking longer than expected…" | Never shows while the run is waiting (approval, awaited agents), retrying, or idle |

**Which of the two shows in each case:**

| Case | Thinking group | Planning status |
|---|---|---|
| (a) live | "Thinking" while streaming; "Thought Ns" once settled | yes, in the gap between a settled thought or tool and the next part (after 200 ms) |
| (b) approval | settled ("Thought Ns") | no. The live row reads "Needs your approval" |
| (c) awaited subagent | settled | no. The live row reads "Waiting on 2 agents" |
| (d) ended + background | settled | no. Nothing live; background badge only |
| (e) ended | settled | no |

**Code that changes:**
- Delete `showsLiveStatus`'s status branch and `LiveStatus` from `step-group-presentation.ts:17–80`. `stepGroupLine` returns a summary, or a "Thinking" verb while the group's own thinking part streams.
- Delete `settledWork` (`transcript-rows.ts:77, 255, 315, 333, 354`) and make `LiveTurn` read `ownLabel(chatStatus(...).own)`.
- Replace the step row's `running: ends && place.working` with the group's own streaming state.
- Child rows (`subagent-status.ts:11`) use `ownLabel` instead of always saying "Planning next moves".
- In the TUI, `turnStatus` (`model/transcript.ts:351–371`) returns `planning`, `awaiting` or `thinking` from `chatStatus`. `" Working"` (`constants.ts:164`) is removed. The TUI's separate `Thought` block (`ui/transcript/thought.tsx`) already keeps the two concepts apart and is the model to follow.

---

## 5. The first five changes

1. **Split the union** (`presentation.ts`, `chats/directory.ts`, `sidebar-view.ts`, `use-window-tabs.tsx`, `window/exposure.ts`, `tray/agents.tsx`, `subagent-status.ts`):
   - Delete `subagent-working` and the `subagentWorking` parameter.
   - `Chat` gets `own` and `background`. Marks, shelf and unread read `own`; background renders as a badge "N agents working in the background".
   - Flip the pinning tests (`directory.test.ts:73–81`, `exposure.test.ts:126–140`) to the new behaviour.
   - This fixes case (d) on desktop, the unread reply, masked failures, and children's approvals reading as "working".
2. **Name the awaited wait:**
   - In presentation, `waiting` on a run or job becomes `awaiting`, labelled "Waiting on N agents" and announced that way.
   - In the TUI, `turnStatus` stops dropping it to `" Working"`, and the tasks line excludes awaited children.
   - In the composer, case (c) shows Send (steer delivery) and drops the queue alternate.
3. **Separate thinking from planning:** as in §4.3. Delete `settledWork` and the group-header live status; `LiveTurn` is the only planning row; the TUI gets the same "Planning next moves" words.
4. **One derivation:**
   - Add `chatStatus`, `ownLabel`, `backgroundLabel` and `composerMode` to `plugin/src/client/presentation.ts`, and move the session-activity projector there.
   - Replace the TUI's `runModel`, `busy` and `executionStatus` (for the followed chat), the desktop's `transcript-rows` `runState`, and mobile's `sessionMark`.
5. **Core facts:**
   - Emit `BackgroundItem{kind:"child", awaited}` into `view.background`.
   - Make `waiting` carry all pending targets and whether input wakes it, with approval precedence instead of last-parked-wins (`durable.ts:516`).
   - Wake `untilInput` waits only for deliveries that land (`admission.ts:778`).
   - Each of these changes `packages/schema` wire types, so run `pnpm --dir packages/host check:store` after them.
