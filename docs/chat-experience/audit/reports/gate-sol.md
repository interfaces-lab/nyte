# Run-state gate review

## Verdict

**The main defect is a presentation model that lets descendant activity replace the parent’s own run outcome.** Desktop navigation consequently says the parent is running while its composer already offers Send. A separate transcript defect makes a completed reasoning group stand in for the live “Planning next moves” status.

The core does distinguish an awaited child from a background child. Do not fix this by making every parent waiting on a child look finished: an explicit `task`/`await` is a real dependency of the current turn.

**The reported TUI symptom needs qualification.** In this snapshot, an ended parent with an ordinary running background child has an idle composer, a settled turn, and a separate background count. TUI “Working” is directly explained by an *awaited* child, not by the ordinary ended-parent case. There is, however, another violation in both clients: a background child’s question can take over the ready parent’s composer.

All paths below are relative to `/tmp/review-code`. “Observed” means read in this snapshot or asserted by an existing test. “Consequence” and “Proposed” are review conclusions, not claims of a reproduced screenshot. No documentation was used as product evidence.

## 1. The gate today, end to end

### 1.1 Which child work actually blocks a parent?

| Operation | Observed implementation | Parent’s relationship to child completion |
| --- | --- | --- |
| `task` | Starts a session with `parent: invocation.session.id`, obtains its landed run, then calls `invocation.wait({ kind: "any", targets: [run], untilInput: true })`. `packages/plugin/src/subagents.ts:113-144`. | Awaited. The tool call parks the parent’s current run until the child finishes or user input interrupts the wait. |
| `create` | Starts the child and returns its ID; there is no completion wait. It does await startup and worktree description. `packages/plugin/src/subagents.ts:148-172`. | Background after startup. Merely having this child does not park the parent. |
| `send` | Sends to an existing child and reports its scheduling; no wait for the child’s response. `packages/plugin/src/subagents.ts:175-197`. | Background unless a later operation explicitly awaits it. |
| `await` | Reads the child’s current run and waits on it with `untilInput: true`; an optional timeout supplies a deadline. An already-idle child returns its last result immediately. `packages/plugin/src/subagents.ts:200-248`. | Awaited while this call remains parked. After input/deadline releases it, an unfinished child can continue in the background. |

**Observed:** “background” is a relationship to the parent’s *current dependency*, not an immutable mode of a child session. A child created in the background can later be awaited. The persisted call record can represent `any`/`all`, multiple targets, a deadline and `untilInput` (`packages/core/src/contract/records.ts:194-214`). A run record separately has its own phase, waiting target, retry and parked calls (`packages/core/src/contract/records.ts:108-121`).

### 1.2 Core lifecycle, folding and subsequent input

| Stage | Observed behavior and evidence |
| --- | --- |
| Park an awaited call | Durable execution writes the parked call and updates the parent run’s parked calls/waiting target. `packages/core/src/engine/durable.ts:477-526`. The driver treats parked calls or a non-null waiting target as a held run, rather than starting another run. `packages/core/src/drive/execution.ts:580-643`. |
| Publish waiting | The fold changes both the head’s `Execution` and the turn state to `waiting`. It does not end the turn. `packages/core/src/fold/fold.ts:511-524`. The agent loop returns `parked` after executing a batch containing a parked call (`packages/core/src/agent/agent-loop.ts:281-294`); the driver explicitly avoids `endRun` for that result (`packages/core/src/drive/execution.ts:790-799`). |
| Wake a dependency | Child run completion offers a run outcome to registered waiters. User admission can also wake an input-interruptible wait. `packages/core/src/engine/waits.ts:271-301`; input-stop indexing is explicit in `packages/core/src/store/wait-index.ts:39-57`. Resuming/removing parked calls updates the remaining run wait. `packages/core/src/engine/waits.ts:60-94,568-599`. |
| End the parent’s own run | `endRun` publishes `idle` with `lastRun`, removes the own run/live refs and settles its receipts. It does not join unfinished children. `packages/core/src/engine/runs.ts:112-181`. The fold independently makes the turn `ended` and clears its live calls. `packages/core/src/fold/fold.ts:598-617`. |
| Read session execution | Session info derives execution from that session/head’s own live run. No own run means `idle` plus its last outcome; a run’s waiting target takes precedence over retry/live. Parent and originating call are separate session metadata. `packages/core/src/api/session.ts:191-223,637-673`. |
| Handle a later background result | On child completion, first wake an existing waiter; otherwise deliver an attached child report. `packages/core/src/engine/runs.ts:208-210,273-300`. On an idle parent whose reports are not held, that report can start a **new continuation run**, not prolong the old run. `packages/core/src/engine/admission.ts:206-227`. Reports are held after a non-completed outcome. `packages/core/src/fold/project.ts:104-106`. |
| Schedule a new user message | With no own run, a non-attach message is scheduled for the next turn with reason `idle`, regardless of whether the delivery spelling is `steer` or `queue`. With an own run, queue/stopping means after the current run; otherwise it joins that run. `packages/core/src/engine/send-schedule.ts:5-24`. The next run selects user input before attached reports. `packages/core/src/engine/admission.ts:211-227`. |

**Consequence:** cases “awaited child still running” and “own run ended, background child running” are genuinely different today. Core lifecycle is not the source of the ordinary ended-parent/background-child busy mark. A later child report can legitimately produce a new own “Working” interval; that is distinct from falsely keeping the previous run busy.

**Existing-test confirmation:** `packages/plugin/test/subagents.test.ts:35-98` asserts parent `waiting.on.kind === "run"` and resumption without a duplicate child report. Its input-interruption case proves the parent answers while the child keeps working (`:100-152`). The TUI’s real-host/fake-model journey explicitly reaches parent idle *before* releasing its background child (`packages/tui/test/app/runs.test.ts:265-306`). All were run successfully for this review.

### 1.3 Wire and SDK: useful distinction, incomplete dependency detail

- `Execution` is `idle(lastRun)` / `live(run, phase, stopping)` / `waiting(run, on)` / `retrying(run, until, reason)`. `WaitTarget` distinguishes `run`, `job`, `part`, and `timer`. There is no “all descendants keep this parent busy” wire state. `packages/schema/src/runs.ts:35-71`.
- Turns independently carry `working(activity)` / `waiting(on)` / `ended(end)`. A session view carries `execution`, `turns`, and `background` separately. `packages/schema/src/views.ts:98-109,129-141`.
- The `BackgroundItem` schema permits `child`, `job`, and `page` (`packages/schema/src/runs.ts:73-81`), but that does **not** establish a complete child roster: the reconstruction inspected populates background from jobs and pages (`packages/core/src/fold/watch.ts:523-524`). Both clients obtain child sessions through separate listings/watchers.
- The rich durable wait is reduced to **one** unresolved target: `waitingOn` returns the first unresolved target of an `any`/`all` wait. `packages/core/src/engine/waits.ts:616-623`. Consequently `Execution.waiting.on` alone cannot enumerate every awaited child, disclose `any` versus `all`, or disclose `untilInput`.
- The SDK decodes operation results and watch frames through the protocol boundary (`packages/sdk/src/rows.ts:154-161,352-362`); protocol decoding validates against the output schema (`packages/protocol/src/codec.ts:112-118`). Its head watcher applies view frames and forwards the resulting view, not a descendant-derived busy state (`packages/sdk/src/watch.ts:53-63,119-128`).

**Consequence:** the wire already suffices to distinguish an ended parent from a waiting parent. It is insufficient by itself for an exact general-purpose “awaited versus background” partition across multiple concurrent waits. Do not invent a complete dependency set from ancestry or tool names.

### 1.4 Shared presentation and desktop: where the parent changes meaning

1. `runStatus(execution, subagentWorking)` replaces an idle parent’s outcome with `subagent-working` when the flag is true. This happens before checking `lastRun`, so completed, stopped, and failed parents all lose their own outcome. The `subagent-working` variant has no own run ID. Non-part waits become `working`; part waits become `waiting-for-approval`. `packages/plugin/src/client/presentation.ts:253-294`.
2. `runMark` renders both `working` and `subagent-working` as `working`; `runStatusLabel` labels both “Working”. `executionMark` instead calls `runStatus` without descendant information. `packages/plugin/src/client/presentation.ts:324-385`.
3. The desktop directory calculates all ancestors of every non-idle descendant, **including waiting descendants**, and supplies that boolean to `runStatus`. It does not inspect whether the parent awaits that child. `packages/app/src/chats/directory.ts:74-105,140-159`.
4. Sidebar grouping and tabs consume that directory status through `runMark`. A falsely busy parent enters the working shelf and gets a spinner; the status dot’s accessible working label is “Running”. `packages/app/src/chrome/sidebar-view.ts:94-121`; `packages/app/src/chrome/sidebar-rows.tsx:150-170`; `packages/app/src/tabs/use-window-tabs.tsx:136-175`; `packages/app/src/components/ui.tsx:60-66,88-106`.
5. The open conversation does **not** supply that descendant flag: its status comes from `runStatus(own execution)`. `packages/app/src/screens/session-conversation.tsx:309-315`. That status feeds the composer (`:525`) and full-conversation announcer (`:454`).
6. The composer’s busy/Stop gate is whether that own status has a run ID, not the directory mark (`packages/app/src/conversation/composer.tsx:145-146,755-759`). Idle Enter is “Send Message”; busy Enter follows steer/queue preference (`packages/app/src/conversation/composer-keys.ts:63-89`). Busy does not disable typing/submission by itself (`packages/app/src/conversation/composer-frame.tsx:155-188`); Stop appears while busy (`:581-605`).

**Observed contradiction:** in the ended-parent/background-child case, desktop sidebar/tab say Running while the normal composer is ready to send. Changing composer busy to follow the directory’s working mark would make the defect worse.

The existing tests deliberately preserve this behavior: shared presentation expects subagent activity to override each ended outcome (`packages/plugin/test/presentation.test.ts:142-217`), and the directory test expects a failed root and idle intermediate ancestor to become `subagent-working`, with the failure reappearing only after the descendant stops (`packages/app/src/chats/directory.test.ts:73-89`).

### 1.5 TUI: a separate gate, not a caller of `runStatus`

**Observed:** no TUI source caller of `runStatus`, `runMark`, `executionMark`, or `sessionMark` was found. It shares lower-level helpers such as `toolStatus`, `showsThinking`, and duration formatting, but owns another status model:

- `RunModel` derives busy/input policy only from the followed session’s own execution; waiting loses the `on` distinction. `packages/tui/src/model/table-input.ts:43-91`.
- Enter follows steer/queue preference while that run is non-idle; idle Enter is “send”, with wire delivery `queue`. Escape stops only an own run. `packages/tui/src/model/interactions.ts:230-269,343-379`.
- `turnStatus` preserves ended turns as settled, but maps a wait on any non-part target to generic `working` with no activity. Part waits are called a question wait. `packages/tui/src/model/transcript.ts:324-371`.
- The status renderer says “Working”, “Thinking…”, “Waiting for your answer”, retry text, or settled “Worked”/failure. `packages/tui/src/ui/transcript/turn-status.tsx:29-66`; wording constants are in `packages/tui/src/lib/constants.ts:164-172`.
- Tasks arrive independently from direct child-session watches and nonforeground jobs (`packages/tui/src/services/task-index.ts:25-56,87-94`). The tasks line counts all unfinished tasks as “N running in background”, even awaited/waiting tasks. `packages/tui/src/model/screen.ts:106-114`; `packages/tui/src/lib/tasks.ts:273-274`.

**Consequence:** TUI generic Working during an explicit child wait is a real labeling problem, but the code does not support attributing its normal idle-parent behavior to the desktop directory’s descendant override.

### 1.6 Important exception: background requests can seize ready input

**Desktop observed:** `useQuestionDock` watches child part-waits, combines own and child questions, and selects an active request without requiring a parent run (`packages/app/src/conversation/tray/questions-state.ts:139-164,186-208`). The composer then substitutes the question document and routes submission to `questions.advance`, instead of `send` (`packages/app/src/conversation/composer.tsx:716-757`). Thus an idle parent with a questioning background child is not in ordinary new-message mode.

**TUI observed:** `currentQuestion` falls back from the parent to child questions (`packages/tui/src/model/question.ts:102-145`), and question Enter precedes busy/idle Enter (`packages/tui/src/model/interactions.ts:343-379`). Even with the picker put away, the placeholder asks for an answer to the subagent (`packages/tui/src/model/screen.ts:81-103`). Child approvals also become automatic keyboard dialogs (`packages/tui/src/model/approval.ts:18-35`; `packages/tui/src/model/screen.ts:117-129`). Any dialog makes the composer nonfocusable (`packages/tui/src/ui/composer/composer.tsx:220-228`).

**Consequence:** a nonblocking child can prevent the ready parent’s next Enter from sending a new message, or remove composer focus entirely. This is a separate, concrete input-gate violation, not merely misleading wording. Background attention should be visible, but answering it must be an explicit, child-scoped action.

## 2. Thinking/reasoning and planning are separate concepts

### 2.1 Collapsible transcript reasoning

**Its data is actual reasoning content and part lifetime.** `transcriptSlot` assigns thinking parts to step groups, while task/create delegation becomes agent rows and delegate-await is omitted from display (`packages/app/src/conversation/transcript-presentation.ts:31-49,73-96`).

The desktop step group contains the reasoning body, disclosure state, preview/open behavior and a summary. When settled, a reasoning-only summary uses an extracted heading or “Thought”, plus a duration at 500 ms or longer (`packages/app/src/conversation/step-group-presentation.ts:90-108`). `StepGroupView` renders that disclosure and body (`packages/app/src/conversation/step-group.tsx:176-197,264-272,308-354`). `ThinkingLine` also labels actual reasoning “Thinking” while streaming, otherwise its heading or “Thought”; its collapse/open behavior depends on actual streaming (`packages/app/src/conversation/thinking-line.tsx:20-61`).

This is historical transcript evidence. “Thought 8s” means reasoning happened, with content the user can inspect. It does not mean the run is currently choosing another action.

### 2.2 Live “Planning next moves”

**Its intended data is the current own run’s activity between visible work.** The current implementation approximates this with a message-only activity projector: active tool, live thinking, live writing, or `idle` meaning *no active part*, not “chat ready” (`packages/app/src/conversation/session-activity.ts:4-28,32-55`).

`LiveTurn` renders only when `working && !settledWork`. Its planning line becomes visible when that activity is `idle`, after 200 ms; after 15 seconds the wording changes to “Taking longer than expected…”. `packages/app/src/conversation/live-turn.tsx:22-51`; `packages/app/src/conversation/step-group-presentation.ts:11-17,82-87`. The floating composer independently falls back to “Planning next moves” for any own run that is not a part-wait and has no formatted activity (`packages/app/src/conversation/composer.tsx:689-695`).

### 2.3 Exactly where one stands in for the other

| Observed coupling | Evidence | Consequence |
| --- | --- | --- |
| A step group with no tools gets a *live phase* label: actual live reasoning means `thinking`; otherwise it means `planning`. | `packages/app/src/conversation/step-group-presentation.ts:39-64`. | A **settled reasoning part** can have its historical disclosure labeled “Planning next moves”. Absence of tools in this group is not proof the run is planning. |
| The group receives `running` from the conversation’s coarse `working`, which includes every non-idle execution and some pending prompts, not the actual reasoning part’s lifetime. | `packages/app/src/conversation/transcript-rows.ts:94-109,198-206`; renderer connection at `packages/app/src/conversation/timeline.tsx:100-112` and `packages/app/src/conversation/turn-view.tsx:791-805`. | Approval/dependency waits can keep a completed reasoning group visually active. A hidden await can leave a thought-only group as the last displayed step. |
| A final no-tools step group sets `settledWork`, suppressing the dedicated live row. | `packages/app/src/conversation/transcript-rows.ts:253-255`; `packages/app/src/conversation/live-turn.tsx:29-31`. | The reasoning disclosure becomes the designated owner of the live planning status. This is intentional coupling, not just two similar strings. |
| `LiveStepVerb` feeds the planning timer into a stateful label throttle initialized with the planning label. Undefined labels do not clear it. The group also uses whole-group `running` for `aria-busy` and open/preview behavior. | `packages/app/src/conversation/step-group.tsx:74-117,191-197,291-313`. | The group can display the planning fallback during the nominal initial delay and remain busy-looking when its reasoning content has settled. |
| The same generic status reaches agent cards: `working` and `subagent-working` both default to “Planning next moves”; a formatted child activity can override it. | `packages/app/src/conversation/subagent-status.ts:11,34-50,59-77`; `packages/app/src/conversation/subagent-call.tsx:133-156,174-219`. | A child that is awaiting another dependency, or is itself idle with an active descendant, can be described as planning without evidence that its model is deciding anything. |

Existing tests explicitly assert both the settled-thought-to-planning substitution and delegation of the live row to the reasoning group (`packages/app/src/conversation/step-group-presentation.test.ts:160-171`; `packages/app/src/conversation/transcript-rows.test.ts:175-196`). They passed; they currently protect the coupling that needs to change.

### 2.4 TUI equivalents

- Full TUI renders actual reasoning with `Thought`: a live reasoning body streams; settled reasoning is labeled “Thought” and uses the global output expansion setting to show a preview/full body. It is **not** the desktop’s per-step “Thought 8s” disclosure. `packages/tui/src/ui/transcript/thought.tsx:15-46`.
- Current live reasoning status is separately “Thinking…” based on the last actual live thinking part (`packages/tui/src/model/transcript.ts:366-371`). There is no “Planning next moves” string in the TUI source. The between-parts fallback is Working, not a thinking group renamed to planning.
- TUI hides delegate-await transcript messages (`packages/tui/src/model/transcript.ts:158,218-230`), then falls back to Working for that turn’s non-part wait (`:351-354`). Hiding the wait removes useful context even though the reasoning body remains separate.
- Mini omits reasoning entries from its compact transcript (`packages/tui/src/mini/transcript.ts:86-117`). Its activity rule uses the same TUI turn status, preferring a held tool heading over generic Working (`packages/tui/src/mini/screen.tsx:56-68,149-174`). Expanded output can reveal the full transcript (`:86-98`). Thus mini has an activity indicator, not a compact reasoning disclosure masquerading as planning.

## 3. Five-case matrices: current behavior

These tables describe the **parent chat**, with a loaded, coherent view and no pending new user message. Cases D/E use a completed own run as the default; stopped/failed differences are noted. In A/B/C other nonblocking children are optional; in D there is at least one active background child; E has none. Historical reasoning is shown only if reasoning content exists. The five execution cases alone cannot determine transcript content, so conditional cells are intentional.

### 3.1 Input gate shared by the surfaces of each client

Every display-only surface in the following matrices inherits the parent composer behavior in this table. Full and floating desktop composers use the same frame; full and mini TUI use the same input model/composer.

| Case | Desktop composer: Enter / Stop | TUI composer: Enter / Escape | What this means |
| --- | --- | --- | --- |
| **A. Own run live** | Steer or queue according to setting/model capability. Stop shown. | Steer or queue according to setting/model capability. Escape stops own run. | A follow-up to an existing turn, not an immediate independent new turn. |
| **B. Own run waiting on approval** | Still busy with Stop; ordinary text uses steer/queue. If the part is a question and a question dock is active, Enter answers instead. Approval itself is handled by its tray. | Automatic approval/question dialog gets keys. After dialog handling, ordinary own-wait input remains busy steer/queue; an active question gives Enter to answering. Escape can stop the own run when not consumed by the dialog. | Waiting for input is not “done”. Do not present it as planning. |
| **C. Own run waiting on awaited subagent** | Still busy with Stop; steer/queue follow-up. | Still busy; steer/queue follow-up and own-run stop. | A real current dependency. The built-in wait is input-interruptible, so a steer can release it; queued delivery still has after-current-turn semantics. |
| **D. Own run ended; background child active** | **Send Message immediately; no own Stop.** Exception: a child question replaces submission with an answer. | **Send immediately; no own-run stop.** Exception: child question answers instead; child approval/question dialog can take focus. | Normal D is already ready in both input gates. The child-interaction exception violates that promise. |
| **E. Own run ended; no active work** | **Send Message immediately; no own Stop.** | **Send immediately; no own-run stop.** | Ready, including after own failure/stop. |

Input evidence: `packages/app/src/conversation/composer.tsx:145-146,716-759`; `packages/app/src/conversation/composer-frame.tsx:155-188,581-605`; `packages/app/src/conversation/composer-keys.ts:63-112`; `packages/tui/src/model/table-input.ts:66-91,114-123`; `packages/tui/src/model/interactions.ts:230-269,343-379`.

**Wire spelling is not user-facing behavior.** Idle desktop sends delivery `steer`; idle TUI sends delivery `queue`. Neither waits behind a nonexistent run: core assigns reason `idle` and admits a new turn (`packages/core/src/engine/send-schedule.ts:16-24`; `packages/schema/src/messages.ts:6-8`). There is no literal `send` delivery variant. Renaming that enum is not necessary to fix the gate.

### 3.2 Desktop display matrix

| Surface and evidence | A: own live | B: own approval wait | C: own awaited-child wait | D: own ended + background | E: own ended, no work |
| --- | --- | --- | --- | --- | --- |
| **Floating composer activity**. `conversation/composer.tsx:689-695` | Actual formatted tool/Thinking/Writing activity, otherwise **Planning next moves**. | Needs attention. | Tool activity if available; otherwise **Planning next moves**, not an explicit dependency label. | No own activity line. Input is D above. | No own activity line. Input is E above. |
| **Dedicated live transcript row**. `conversation/live-turn.tsx:22-51`; `conversation/transcript-rows.ts:94-109,253-255` | Planning after delay only with no active part and no final thought-only group owning it. Otherwise hidden/absent. | Coarse working remains true. Usually no visible planning while a waiting tool supplies activity; no distinct approval status in this row. With no active part, planning is still eligible. | Same coarse working. Usually hidden for an active await/task tool; otherwise planning is eligible. No “Waiting for agent” branch. | Absent in the stable ended case, regardless of children. | Absent. |
| **Collapsible reasoning/step group**. `conversation/step-group-presentation.ts:39-108`; `conversation/step-group.tsx:181-197,264-313` | If final thought-only group: Thinking for an actual live reasoning part, otherwise Planning next moves. Nonfinal groups summarize content. | A final thought-only group can still be treated as running and say Planning, instead of a settled Thought summary. | Same; especially possible when an await is omitted from display. | Settled Thought/heading + duration; no parent-driven planning in this stable case. | Same settled content. |
| **Sidebar row and working shelf**. `chats/directory.ts:100-105,140-159`; `chrome/sidebar-view.ts:94-121`; `chrome/sidebar-rows.tsx:150-170` | Working spinner/shelf. | Needs-attention mark/shelf. | Working spinner/shelf. | **Working spinner/shelf**, despite ready composer. Own failure/stop is masked. | Idle/no spinner; failed own outcome goes to attention. Unread remains separate. |
| **Window tab glyph**. `tabs/use-window-tabs.tsx:136-175`; `components/ui.tsx:60-66,88-106` | Spinner, accessible Running. | Attention glyph. | Spinner, Running. | **Spinner, Running**; own ended outcome does not win. | No busy glyph; failure glyph if failed, unread treatment separately. |
| **Full conversation run announcer**. `screens/session-conversation.tsx:163-188,309-315,454` | Nyte is responding. | Nyte needs your answer. | Nyte is responding, not waiting for an agent. | Response finished on own transition; Response stopped/failed for those outcomes. Does not wait for children. | Same completion announcement. Initial mounting is silent. |
| **Agents tray pill/list**. `conversation/tray/agents.tsx:50-83,151-181,242-263` | Optional Agents count; list child Working/Needs attention/etc. | Same, independently of own wait. | Awaited child appears as an active agent, with no explicit awaited/background relation. | Agents count and child Working rows remain; wording does **not** explicitly say background. | Normally absent if nothing active/failed/retained; retained results or failures can remain. |
| **Transcript agent cards/group**. `conversation/subagent-call.tsx:174-219,314-347`; `conversation/subagent-status.ts:34-77` | Child activity, or child Planning fallback; group Running N agents… while any card is active/attention. | Same child-driven cards. | Same; awaited/background distinction is absent. | Child cards/group can still animate and say Running N agents…; this is child activity, but not explicitly labeled background. | Historical completed/failed/stopped cards; group completion wording. |

Paths in this matrix are under `packages/app/src/`. Tool/reasoning rendering, child cards and the live parent row are separate surfaces: an animated **child card** in D is valid background activity, unlike an animated **parent tab**.

### 3.3 TUI display matrix, including mini

| Surface and evidence | A: own live | B: own approval wait | C: own awaited-child wait | D: own ended + background | E: own ended, no work |
| --- | --- | --- | --- | --- | --- |
| **Full turn status line**. `model/transcript.ts:324-371`; `ui/transcript/turn-status.tsx:29-66` | Activity such as Exploring/Editing/Running, **Thinking…** for a live reasoning tail, otherwise **Working**. | **Waiting for your answer** for a part wait, even though the part can be an approval rather than a question. | **Working** with spinner and no activity detail. | Settled **Worked**/duration, or stopped/failure notice. **Not Working because of the child.** | Same settled status. Empty ended turns can be omitted. |
| **Reasoning body/preview**. `ui/transcript/thought.tsx:15-46` | Actual live reasoning streams; older reasoning says Thought and previews/expands via output setting. | Settled reasoning remains content; not relabeled Planning. | Same. | Historical Thought content remains inspectable. | Same. |
| **Mini activity rule**. `mini/screen.tsx:56-68,149-174,190-228` | Held tool heading can replace generic Working; otherwise same turn status, including Thinking…. | Waiting for your answer, or the automatic dialog occupies mini. | Working, or a held tool heading. No explicit awaited-agent label. | Settled status is removed from the live rule; plain rule/session information remains. Background line is separate. | Same plain rule. There is no explicit Ready label. |
| **Mini reasoning history**. `mini/transcript.ts:86-117`; `mini/screen.tsx:86-98` | Omitted from compact entries; actual thinking may still be reflected in activity rule. | Omitted. | Omitted. | Omitted. Full transcript available through expanded output. | Same. |
| **Tasks/background line, full and mini**. `model/screen.ts:106-114`; `ui/chrome/tasks-line.tsx:9-46` | Optional N running in background. | Same for unfinished child/job tasks. | **Counts the awaited child as background too.** | **N running in background**, correctly separate from parent readiness. Child question changes it to “a background task needs your answer”. | Absent when no unfinished tasks. |
| **Agent cards/group and task inspection**. `lib/tasks.ts:58-115`; `lib/tool-card.ts:257-327`; `ui/transcript/turn.tsx:86-125` | Individual child status/activity; group Running N agents… where applicable. | Same independent child status. | Awaited child is an unfinished agent like any other. Child waiting is represented as waiting in task status, unlike parent generic Working. | Child cards/tasks remain active; parent turn itself is settled. | Completed/failed/stopped historical cards/tasks. |
| **Program/terminal status (OSC)**. `lib/program-status.ts:23-35`; `model/screen.ts:211-217` | working. | working for an approval without a question; blocked for a selected question. | working. | done for an observed completed own run, error for failed, otherwise idle. **Child question can override to blocked.** | Same own completion/idle policy. Completion clears when its watched-run notice is dismissed. |
| **Resume/session picker**. `model/choices.ts:263-274` | Name, date and ID only. | Same. | Same. | Same; no ready/background glyph. | Same. |

Paths in this matrix are under `packages/tui/src/`. There is no TUI planning phrase to trace into a thinking disclosure: the current TUI substitute for between-parts activity is generic Working. Mini’s held-tool branch can also render when no unsettled turn status remains (`mini/screen.tsx:59-65`); gating it by the own run is safer than treating a leftover held entry as proof of work. A stale-held-entry incident was not reproduced.

### 3.4 Which concept should show in each case?

This is the **required/proposed** behavior, not another description of the current implementation.

| Case | Thinking/reasoning group | Live Planning next moves | Parent activity / background / input |
| --- | --- | --- | --- |
| A | Show actual reasoning if present. Only an actually live reasoning part says Thinking…. Settled reasoning already says Thought + its own duration, even while the run continues. | Show only while the **own live run** has no current live reasoning/text or executing tool: between calls, after tool completion, or before the reply. Never derive it from the presence of a thought group. | Working/activity; own Stop and deliberate steer/queue policy. Nonblocking children get a separate background summary. |
| B | Preserve settled reasoning as inspectable history. No active thinking animation caused by the wait. | **Never.** | Waiting for approval (or your answer for a question). Approval/answer action; own Stop remains available. |
| C | Preserve settled reasoning as history. Child reasoning belongs to the child, not the parent’s live thinking group. | **Never while dependency wait is active.** | Waiting for agent [name]. Own turn is still open, with follow-up/interrupt policy. Other nonblocking children are background. |
| D | Preserve historical Thought + duration. Do not reopen or shimmer it because children run. | **Never.** | **Ready for input**, plus **N agents working in the background**. New message sends immediately; no parent Stop. Child attention does not capture parent input. |
| E | Same historical reasoning behavior. | **Never.** | **Ready for input**, no background summary, immediate Send, no parent Stop. Preserve own failure/stopped outcome separately. |

## 4. Findings, ordered by impact

Each Where entry was checked in source. What describes observations; Why describes their product consequence.

| Where | What | Why it hurts | Change |
| --- | --- | --- | --- |
| **1. Root: parent lifecycle replaced by descendant liveness.** `packages/plugin/src/client/presentation.ts:273-294,324-375`; `packages/app/src/chats/directory.ts:100-105,140-159`; consumers at `packages/app/src/chrome/sidebar-view.ts:94-121` and `packages/app/src/tabs/use-window-tabs.tsx:136-175`. | Observed: any non-idle descendant turns an ended parent into `subagent-working`, rendered identically to own working. The boolean discards counts and the ended outcome; waiting descendants qualify too. | Consequence: case D looks busy in navigation even though Send is ready. Failure/stop can disappear until descendants finish. An idle intermediate ancestor can look like it has a running model. | Remove descendant override from **own** status. Return own lifecycle and background summary as independent fields. Main glyph/shelf/input/announcement use own lifecycle; background gets its own non-parent-busy indicator and wording. |
| **2. Background requests capture the ready parent’s composer.** `packages/app/src/conversation/tray/questions-state.ts:139-164,186-208`; `packages/app/src/conversation/composer.tsx:716-757`; `packages/tui/src/model/question.ts:102-145`; `packages/tui/src/model/interactions.ts:343-379`; `packages/tui/src/model/screen.ts:117-129`; `packages/tui/src/ui/composer/composer.tsx:220-228`. | Observed: both clients select child questions for the parent’s answer mode without requiring an own run; TUI child approvals can also automatically take the keyboard dialog. | Consequence: even when the parent is ready, ordinary Enter can answer a background agent instead of sending a new parent message, or the composer cannot focus. This directly breaks “type a new message instantly”. | Keep background attention in the child/tray/task surface. Enter stays parent Send in case D unless the user explicitly selects “Answer agent”. Scope answer mode and focus capture to that explicit target. |
| **3. Historical reasoning is used as the live planning indicator.** `packages/app/src/conversation/step-group-presentation.ts:39-64`; `packages/app/src/conversation/transcript-rows.ts:94-109,198-206,253-255`; `packages/app/src/conversation/step-group.tsx:74-117,191-197,264-313`; `packages/app/src/conversation/live-turn.tsx:22-40`. | Observed: final thought-only group + coarse working means Thinking or Planning; its presence suppresses the dedicated live row. Waiting states count as working. | Consequence: a settled, expandable thought changes meaning from “what was reasoned” to “what the run is doing now”; waits can look like planning, and disclosure/busy behavior follows the run instead of the reasoning part. | Make reasoning groups content-only with part-derived lifetime. Put planning and dependency/input waits in one dedicated current-run activity row. Delete `showsLiveStatus`/`settledWork` as ownership of planning; do not merely rename those flags. |
| **4. Genuine dependency waits are called Working/Planning.** `packages/plugin/src/client/presentation.ts:286-294`; `packages/tui/src/model/transcript.ts:351-354`; `packages/tui/src/model/table-input.ts:76-84`; `packages/app/src/conversation/composer.tsx:689-695`; `packages/app/src/conversation/subagent-status.ts:34-50`. | Observed: non-part waits lose their wait kind in the high-level status; TUI independently duplicates this mapping. Desktop activity fallbacks can call a dependency wait planning. | Consequence: users cannot distinguish a model deciding from a parent parked on a child/job/timer. It also explains TUI Working while only an **awaited** child computes, without proving a core background leak. | Preserve waiting reason in the shared model: waiting for agent/job/timer versus input. Keep C open, not ready; release only when core actually releases/ends it. Both clients consume the same classification. |
| **5. Child surfaces do not identify the relationship reliably.** `packages/app/src/conversation/tray/agents.tsx:50-83,151-181,242-263`; `packages/app/src/conversation/subagent-call.tsx:329-344`; `packages/tui/src/model/screen.ts:106-114`; `packages/tui/src/services/task-index.ts:25-56`; `packages/core/src/engine/waits.ts:616-623`. | Observed: desktop says Agents/active/Running N agents without background or awaited meaning. TUI calls every unfinished task background, including awaited children and jobs. The projected wait carries only one target. | Consequence: the user cannot tell whether an agent prevents the parent’s reply or is independent. A full awaited/background count cannot safely be reconstructed from the current singular wait alone. | In D, label all active child work explicitly as background. In C, identify the blocker separately; do not count it as background. For exact multiwait partitioning, derive and expose the complete current dependency set from durable waits at the core boundary rather than tracking a client-side mode flag. Keep job/agent counts distinct. |

**Not a finding against core:** keeping an explicit task/await turn parked is correct. Making C idle, stopping all children when the parent ends, or delaying D until the background count reaches zero would each change execution semantics and fail the requested experience.

## 5. Proposed gate: one shared model, independent own and background axes

### 5.1 Ownership and data

**Core decides execution and dependencies.** Its existing own `Execution` remains authoritative for whether a parent run exists. Folded turn/part records decide what content belongs to that run. Child ancestry discovers work; ancestry does not decide whether the own run is open. Preserve the existing boundary validation and pass schema-derived types inward.

**One pure client-presentation projection decides presentation and input intent.** Put it alongside the current shared presentation functions in `packages/plugin/src/client/presentation.ts`, usable by desktop and TUI without renderer/host dependencies. Feed it the own execution, matching own-turn parts, child execution snapshots, and dependency information. Do not maintain another busy boolean with effects or mutate parent state when a child changes.

The result has two independent axes:

- **Own:** unavailable/loading; ready with last outcome; running with run ID, actual activity and stopping state; waiting for input with part/request identity; waiting for work with the actual target; retrying with run/retry information.
- **Background:** typed child/job items with their own execution/attention/outcome, separate from Own. Counts and labels are derived from those items. There is no `subagent-working` alternative in Own.

Readiness is derived solely from `Own = ready`, not from background count. Stop targets only an own run; child Stop is a child-scoped action. Input intent is derived from Own plus an **explicitly selected** answer target: new message when ready; configured follow-up while a turn exists; answer only in a selected answer interaction. Do not store `ready`, `busy`, `canSend`, and `mode` as independently synchronized state.

The current single `on` target is sufficient for the immediate D/E readiness fix. Do not block that fix on a wire redesign. For a complete multiwait roster later, project active durable wait targets, `any`/`all` and input-interruption capability at the core/fold boundary. There is one source of that relationship, not a static “background child” flag inferred from `create`. Until that data is available, do not claim an exact awaited/background partition during arbitrary multiwaits; D is exact because an ended own run has no current blockers.

### 5.2 Exact mapping and wording

| Case | Shared own classification | Parent glyph/status on desktop and TUI | Input and Stop | Separate work summary |
| --- | --- | --- | --- | --- |
| A | Running, with actual thinking/writing/tool activity or planning gap. | Own running marker; tool/activity wording where available. “Planning next moves” only in a genuine own live gap. | Follow-up preference, visibly steer/queue; own Stop available. | Only nonblocking work: “N agents working in the background”; jobs separately. |
| B | Waiting for input. Resolve part type to approval versus question, rather than treating every part as approval. | Attention marker; “Waiting for approval” or “Waiting for your answer”. No thinking/planning animation. | Approval/answer controls; deliberate follow-up/interrupt policy; own Stop available. | Independent nonblocking work and any child attention, without relabeling the parent. |
| C | Waiting for work, target = child run. | Waiting marker; “Waiting for agent [name]” (plural for a complete multiwait). No own working/planning animation. | Own turn remains open. Steer can interrupt input-interruptible built-in waits; queue remains explicitly a follow-up. Own Stop available. | The awaited child appears under the dependency, not the background count. Other nonblocking children remain background. |
| D | Ready, with completed/stopped/failed last outcome. | **Ready for input** near composer. Parent sidebar/tab has no running glyph; preserve failure/unread/outcome treatment. | **Send new message immediately. No parent Stop.** No automatic child answer target or focus capture. | **N agents working in the background**. A child needing input says so in its own badge/tray; it does not make the parent busy/blocked. |
| E | Ready, same outcome policy. | **Ready for input**; no running glyph; preserve failure/unread/outcome treatment. | **Send new message immediately. No parent Stop.** | None. |

Retain retrying and stopping as own-run states beyond these five cases. Retrying says Retrying with reason/countdown, not Planning; stopping says Stopping and remains non-ready until core ends the run. An unloaded own execution is loading/unavailable, not evidence of an active parent inferred from a child.

A user-facing new-message intent need not add a new wire enum: translate it once at the send boundary using the current idle scheduling behavior. Do not display Queue or Steer for D/E merely because those internal delivery spellings are used.

### 5.3 Which row renders which concept?

| Concept | Deciding data | Renderer and wording | Must not depend on |
| --- | --- | --- | --- |
| **Reasoning content/history** | Actual thinking parts belonging to a turn, their live/settled status, text and timestamps. | Desktop reasoning disclosure/step content: live actual reasoning “Thinking…”; settled “Thought 8s” or extracted heading plus duration. TUI Thought body/preview remains actual content, expandable through its existing mechanism. Duration freezes at reasoning completion, not parent completion. | Background count; whole-chat `working`; absence of tool calls; whether another row can carry status. |
| **Live planning phase** | Own execution is genuinely live, not waiting/retrying/stopping; current own-run parts contain no active reasoning/text/tool work. Match via the current run’s turn, not all historical messages. | A dedicated desktop live-status row renders “Planning next moves” after the short delay. TUI full turn-status row and mini rule use the same projected planning activity instead of generic Working during this gap. Mini need not render reasoning history to do this. | Presence of a settled reasoning group or child activity. No reasoning group takes ownership of this label. |
| **Live actual thinking** | An actual current-own-run live reasoning part. | Desktop reasoning renderer labels it Thinking…; the separate planning row is absent. TUI can retain Thinking… in its status row/mini rule while its reasoning body streams. | A model’s reasoning configuration or a no-tools heuristic. |
| **Dependency/input wait** | Own execution wait and its typed target/request. | The dedicated current-run status row, full TUI status and mini rule say Waiting for agent / approval / your answer. | A tool’s omission from transcript layout. Hiding an await call must not hide the reason the parent is waiting. |
| **Ready and background work** | Own execution idle; independently discovered child/job execution. | Ready beside the composer; a separate agents/tasks line says N agents working in the background. History keeps its Thought/Worked/outcome summaries. | Finished reasoning disappearing or every background item finishing. |

For desktop, remove the planning decision from `stepGroupLine` and remove `settledWork` as a switch that hides the live status row. Keep disclosure state local to the reasoning content. The dedicated row can suppress its own duplicate activity while actual text/tool/reasoning renderers already communicate it; that decision comes from projected current activity, not transcript-group shape.

### 5.4 Surface contract

- **Desktop composer, inline or floating:** use the same own/input projection. D/E show Send with an editable parent draft immediately. Floating status uses the explicit own label, never a generic planning fallback for every extant run.
- **Desktop sidebar and tabs:** main glyph/shelf reflect Own only. Optional separate background badge/count may animate to identify the child work, but must not replace the ready/failure/unread parent mark.
- **Announcer:** announce the own completion promptly, regardless of children. Announce dependency/input waits truthfully. Background starts/attention are separate, child-scoped information; do not announce them as “Nyte is responding”.
- **Desktop agents tray and transcript cards:** label background versus awaited relation explicitly. A child’s own status is still real activity, but an idle child with active descendants is not itself planning. Individual cards may show actual child activity without implying parent work.
- **TUI full status and mini rule:** consume the same own classification and planning/wait labels; keep their compact/full layouts. Mini should not derive parent activity solely from a held tool entry after Own is ready. Preserve settled transcript history, and expose readiness beside input rather than requiring the user to infer it from a disappearing spinner.
- **TUI tasks line/cards:** keep the already-correct separation in D. Exclude blockers from background wording when dependencies are known; distinguish agent counts from jobs. Background answer dialogs open by user choice.
- **TUI terminal/program status:** own ready remains ready/done/error as appropriate even when a background child needs input. That child’s attention should not automatically change the parent’s program state to blocked.

## 6. First five changes

1. **Fix the shared model and desktop descendant override first.** Separate own lifecycle/outcome from background work; remove `subagent-working` as a replacement own status. Migrate the directory, sidebar and tabs together. Preserve the existing own-only composer behavior in D/E. Update the existing presentation/directory assertions that currently require masking failures and completion.
2. **Stop background attention from retargeting parent input.** Require explicit child-answer selection in desktop question dock and TUI question/approval dialogs. A ready parent keeps its draft, focus and Send action while child attention remains visible.
3. **Separate reasoning from planning.** Keep thought summaries tied to part lifetimes; remove no-tools-group ownership of live planning and the `settledWork` suppression. Make the dedicated own-run row handle planning, waiting and readiness. Update the existing step-group/transcript-row tests that currently conflate the concepts.
4. **Give both clients one wait/activity mapping.** Preserve target kind and request kind; render Waiting for agent instead of Working/Planning for C. Replace TUI’s independent coarse turn/input classification and desktop’s floating/agent planning fallbacks with the shared projection, retaining current queue/steer behavior for real own runs.
5. **Make background work explicitly legible, then verify the five-case contract.** Add the background summary to navigation/conversation surfaces without changing parent busy; retain TUI’s separate line. Identify awaited work separately using authoritative dependency data, extending the projection for complete multiwaits where needed. Cover completed, stopped and failed D, hidden-await + settled-thought C, and D with child attention. Do not add a client-maintained background-mode flag.

## 7. Checks performed and limits

Source was read only; this report is the sole authored file. No dev server, Electron app or browser was started. Existing tests were run with pnpm; Vitest result/module caches were disabled and the runner config loader was used.

| Existing suites run | Result | What they establish |
| --- | --- | --- |
| Plugin `test/presentation.test.ts`, `test/subagents.test.ts` | **18 passed**, 2 files | Current outcome override expectations; awaited-child lifecycle, input-interruptible wait, child operations/report behavior. |
| App unit `src/chats/directory.test.ts`, `src/conversation/composer-keys.test.ts`, `src/conversation/step-group-presentation.test.ts`, `src/conversation/transcript-rows.test.ts` | **23 passed**, 4 files | Current directory busy propagation, input intent, reasoning/planning substitution and live-row delegation. |
| TUI `test/model/transcript.test.ts`, `test/model/screen.test.ts`, `test/model/interactions.test.ts` | **96 passed**, 3 files | Own-run status/input gates, background task line, program status, and child-question answer routing. |
| TUI `test/app/runs.test.ts`, name filter `a background subagent's report` | **1 passed**, 10 tests filtered out | Real session engine plus fake model/test renderer reaches parent idle before background child release, then starts the report continuation. |

**Total: 138 passed, 0 failed.** Passing here does not mean the requested experience is satisfied: several assertions explicitly protect the behavior identified as wrong. No tests or source were changed.

Not verified: desktop rendered appearance/focus timing, mini rendered journeys, live accessibility announcements, or the product owner’s exact TUI incident. The normal TUI D busy symptom was not reproduced by the existing background-child journey; diagnosing that incident needs its actual own `Execution`/turn state to distinguish an awaited child, a genuine new report continuation, and stale presentation. The matrices above are code-derived where no rendered journey was run.
