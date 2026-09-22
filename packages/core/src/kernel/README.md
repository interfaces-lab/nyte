# Kernel

Git's object database with messages in place of files. This directory is the
durable core of `@nyte-ai/core`: it decides what survives, who may write, and
in what order everyone sees it. It imports `@nyte-ai/protocol` (the SDK data
types and the ref-name rules), `@nyte-ai/schema` (the pi-derived
message types), `@nyte-ai/ai` (the provider stream), `@nyte-ai/telemetry` (the
span contract), `typebox`, `node:crypto`, and
`node:sqlite` for local storage. The separate `@nyte-ai/core/postgres` entrypoint
loads the `pg` driver for hosted PostgreSQL storage.

## Four authorities

| Git                       | Kernel                                                  |
| ------------------------- | ------------------------------------------------------- |
| object database           | `objects`: content-addressed, immutable                 |
| ref, `update-ref` CAS     | `refs`: the only mutable state, multi-ref compare-and-swap |
| lock file                 | `leases`: fenced execution rights, never history        |
| reflog                    | `events`: one ordered stream per session                |

Everything else is a helper over those four. A feature that can be a ref is a
ref. An operation that can be a CAS is a CAS.

## Where git does not fit

- A commit has exactly one context parent. Model context is linear. Cross-branch
  provenance rides in `imports` and is never context.
- No worktree. A client reads at any commit without a checkout.
- A stale branch is not rebased. The SDK carries it forward with a summary
  commit whose parent is the navigation target; generated text is never
  replayed mechanically.
- The reflog is not kept forever. Objects are protected by refs and by ref
  events above the floor; older unreachable objects are collected.

## Ref layout

```
refs/heads/<head>                 branch tip (absent = unborn)
refs/stacks/<head>                Stack { parent, base }: where the branch sits
refs/inbox/<head>/steer/tip       newest Change delivered at a response boundary
refs/inbox/<head>/steer/base      last landed steer Change; pending = (base, tip]
refs/inbox/<head>/next/tip        newest Change delivered when the head is idle
refs/inbox/<head>/next/base       last landed next Change; pending = (base, tip]
refs/runs/<head>                  Run: the branch's current run and phase
refs/chains/<root>             Blob { attempts }: aggregate response budget for one delegated chain
refs/compactions/<head>        Blob: active checkpoint work fenced by the head lease
refs/effects/<run>/<call>      Effect: intent -> waiting -> signal/expired -> result
refs/jobs/<job>                Blob: command job, output, result, what it still owes its head
refs/delegations/<child>/<change> Blob: a request sent to a child, and whether its answer landed here
refs/keys/<key>                idempotency receipt: the Change a key produced; the change
                               and the commit that lands it also carry the key, so the
                               sender can recognize its message by identity
refs/cancelled/<change>        Blob: a submitted change withdrawn before it landed
refs/facts/<key>               Blob: a small session value
refs/deleted                   Blob: the session is being deleted
```

## Files

| File          | Owns                                                                   |
| ------------- | ---------------------------------------------------------------------- |
| `model.ts`    | The types. Objects, ref updates, leases, events.                       |
| `store.ts`    | The store contract a backend implements. `objects.chain` reads a parent chain in one query, git's commit-graph. |
| `names.ts`    | Ref names and their rules.                                             |
| `hash.ts`     | `hashObject(object)`.                                                       |
| `sqlite.ts`   | The SQLite backend: five tables, `BEGIN IMMEDIATE`, one seq per session. |
| `sql.ts`      | The shared statement text both backends build on.                      |
| `store-worker.ts`, `worker-store.ts`, `store-rpc.ts`, `store-schemas.ts` | The same store behind a worker thread, for hosts that also render. |
| `result.ts`   | The outcome helpers the kernel returns instead of throwing.            |
| `postgres/`  | Shared PostgreSQL storage: session row locks, atomic CAS and events, database-clock leases, cursor polling across hosts. |
| `graph.ts`    | Walking commits: branch, ancestry, the context cut at a checkpoint. Pages `objects.chain`, never one read per commit. |
| `queue.ts`    | `submit`, `pending`, `cancel`: the `steer` and `next` inbox chains behind tip and base refs. |
| `admission.ts` | What the head's latest run and the first non-passive change let the queue land: live, settling a stop, fresh, or idle after a terminal run. User input starts model work; an authorized delegate answer may also start it once. `step.ts` lands by it; `sdk/wait.ts` and `sdk/relocate.ts` read it. |
| `effects.ts`  | The effect sandwich for one tool call, and recovery.                   |
| `stacks.ts`   | Branch create, delete, stale check, fast-forward.                      |
| `step.ts`     | One durable step of a run, and `drive` to loop it under one lease.     |
| `lease.ts`    | Renews ownership during provider and tool calls; aborts work after takeover. |
| `outbox.ts`   | Buffers a runner's deltas and progress into the event stream.          |
| `turn.ts`     | Binds `agent-loop.ts` to `step.ts`: respond, tools, durable tools.     |
| `telemetry.ts` | The span vocabulary `step.ts` and `turn.ts` emit, and its typed starter. |
| `compaction.ts` | Checkpoints and branch summaries: the cut, the summary, the publish.  |
| `gc.ts`       | Mark from refs and recent ref events; sweep unreachable, aged objects. |
| `sdk/`        | The client contract (`types.ts`), event projection, activation, and `createNyte` (`nyte.ts`), composed from `session-pool.ts` (one handle per session: facts, heads, activation, notices), `runner.ts` (drive loops and aborts), `delegation.ts` (child sessions, the requests sent to them, their completions, and the jobs wrapper), `relocate.ts`, `summaries.ts` (`runs.compact`, the summary a move carries), and `reads.ts` (session page, snapshot, context, `runs.diff`, `runs.revert`). |

Host schedulers can call `sdk.advance` for one kernel `step`, using the same turn
preparation as the attached runner. `sdk/advance.ts` observes remote cancellation
for the current run and returns scheduling data without exposing kernel objects.
Waiting deadlines come from stored effects; retry and busy deadlines come from
the run and lease. The caller owns durable wakeups and further steps. Execution
authority still follows the admission rule below.

`runs.compact` writes one manual checkpoint under the head lease using the branch's
model (the host's default when unset). While manual or automatic checkpoint work is
live, `refs/compactions/<head>` points at the active compaction. Snapshots expose it
only while the matching head lease is still held. SDK `compaction` events carry
that activity or `null` when it ends. Successful publication clears the activity
in the same update as the checkpoint; failure and cancellation clear it without
a checkpoint. A successor clears abandoned activity before resuming work.
The `before_compaction` hook can provide native context. `@nyte-ai/host` installs `@nyte-ai/plugin/openai-compaction` for every composition, so TUI and desktop both get it for
OpenAI and OpenAI Codex. Codex uses streaming compaction V2 on the Responses
endpoint and stores an encrypted checkpoint with bounded retained user input;
OpenAI API compaction stores the complete returned window. Neither successful
path requests a local summary. Unsupported or failed requests use the portable
summarizer, with bounded requests when recovery history exceeds the model window.
A failed native attempt reports a fallback warning, not an unresolved hook error.
Reported usage from rejected native checkpoints is included in fallback totals,
or retained without publishing a checkpoint if fallback fails or is cancelled.
Native checkpoints retain portable history for switching models. A live run answers
`busy`; an empty context answers `nothing_to_compact`. Passing an aborted `signal`
returns `aborted` without publishing a checkpoint.

Summarization usage includes every provider-reported attempt, including retries
and rejected chunks. Successful operations carry it on the checkpoint or summary.
Failed or cancelled operations keep it on a loose, empty summary commit without
moving a head or emitting a checkpoint event. The publishing caller owns this
write; summarization itself remains store-independent. These objects follow the
normal garbage-collection rules, so retained-history totals can decrease after
collection. Missing provider usage cannot be reconstructed.

`heads.move({ summary })` summarizes only the commits the
move abandons into one `summary` commit whose parent is the navigation target,
names the abandoned oids in `imports`, and moves the head to it in the same CAS
a plain move uses. Nothing abandoned, or an empty summary, is a plain move; a
model failure answers `failed` and leaves the head where it was.

## Rules every file keeps

- Objects are written before the ref update that names them. A failed update
  leaves loose objects; the collector removes them later.
- A ref moves only through `refs.update`. Its options carry the lease for
  runner writes and the reflog `reason`. An update with `to === from` is an
  assertion: checked, never written, never logged. Objects, leases, and the
  event floor have their own operations; none of them changes what a ref points at.
- No submission ever fails because a run is live. Submits retry the tip CAS
  internally. Contention exists only on leases, on a runner's publish, and on
  structural operations that refuse a held head (`deleteHead` answers `busy`).
- A runner keeps nothing in memory across a step. The next step reads refs.
- The kernel knows no head by name. Every head has two inbox deliveries:
  `steer` lands at each response boundary and when idle; `next` lands only
  when idle. A runner gives `step` only `drain`, which chooses one message or
  the whole selected delivery. The SDK's default head is `main`.
- Every event a client may need is in the stream; deltas name `(runId,
  attempt, index)`, never an entry id, because a commit's id is its hash and
  does not exist until the message is whole.

## The inbox

Every head has two FIFO change chains. `steer` is considered at each response
boundary and while idle. `next` is considered only while idle, after `steer`.
The submitter stamps both when and what the change is: `delivery` is `steer` or
`next`; `kind` is `user`, `answer`, `passive`, or `report`. Admission never
reclassifies a body after submission.

Each chain has a `tip` and `base`. Pending is the half-open interval
`(base, tip]`, walked through `Change.previous` and presented oldest first.
`drain: "one"` takes through the first user change; `drain: "all"` takes the
whole selected delivery. When a live run still owes an answer, a boundary drain
takes only leading answer and report changes.

## The step

`step(session, turn, options)` settles any live compaction, reads the head, run, and deletion refs, and does one thing:

| Head / phase | Lead | Decision and step | Publish CAS |
| --- | --- | --- | --- |
| fresh | none, passive, report, or unauthorized answer | `wait`: return `idle`; keep the batch pending | none |
| fresh | user | `start`: land the batch and start a new user run and chain | head, inbox base, run, chain |
| fresh | authorized answer | `start`: land the batch, inherit its root, consume its authorization, and start a continuation | head, inbox base, run, authorization |
| idle after a terminal run | none, report, or unauthorized answer | `wait`: return `idle`; keep the batch pending | none |
| idle after a terminal run | user | `start`: land the batch and start a new user run and chain | head, inbox base, run, chain |
| idle after a terminal run | authorized answer | `start`: land the batch, inherit its root, consume its authorization, and start a continuation | head, inbox base, run, authorization |
| idle after a terminal run | passive | `settle` under the terminal run | head, inbox base, run assertion |
| live `respond` | none | `wait`, then call `turn.respond` | assistant commit, run phase |
| live `respond` | user, passive, report, or answer | `join` the batch at the boundary; if its agent changed, `handoff` ends the run and keeps the batch pending | head and inbox base for `join`; run only for `handoff` |
| settling `respond` | any | `wait`, then end the run `aborted`; keep every batch pending | run |
| `tools` | any | call `turn.tools`; commit results or park | result commits, effects, run phase |
| `waiting` | any | wake for a signal, expiry, completed results, deadline, or abort; otherwise remain waiting | as `tools` when it wakes |
| `retry` | any | return `retry` before `at`; afterwards act as `respond` | none until responding |

Assistant `calls` and `outcome`, tool-result `call` and `tree`, and run-start `start` are
provenance, not context. The runner stamps them once from the tool's typed arguments, the
classifier's closed union, and the host's VCS backend. `start.tree` and each tool-result `tree`
let `runs.diff` and `runs.revert` answer from a tree pair. The model never sees them. A tool without
`present`, an unknown tool, or arguments its parse refuses is `custom` under the tool's label; a
failed call keeps its call class. A `failed` phase the run itself produced (a tool batch, a step
ceiling) carries `class: "runner"`.

A run records its `origin` and `root`. A user run is its own root. A delegate
continuation names the child and request that started it and inherits the
requesting run's root. Before `turn.respond`, the step compares
`refs/chains/<root>` with the run's ceiling. It then reserves the response by
moving that counter in its own CAS before calling the provider. A lost
reservation ends that run at the ceiling instead of retrying, so concurrent
continuations cannot both spend the last attempt.

Every publish also expects `refs/deleted` absent and carries the lease. A head
moved by a participant or a deletion makes the publish fail; the runner re-reads
and ends the run instead of forcing its output. An abort flag set during a step
also fails its publish; the runner keeps the step's output and ends the run
`aborted` in the retried publish, or after the tool batch when one is due.

## Who starts model work

User input starts model work. So does a delegate's answer to a request an
un-stopped run authorized. The landing CAS consumes that request's authorization
once; Stop and a failed requesting run revoke it. Once live, a run continues
through tool batches, parked calls, provider retries, checkpoints, and boundary
landings until it ends `done`, `failed`, or `aborted`. Background results, job
recovery, reconnects, ref events, and runner restarts can wake a runner to read
the refs, but they grant no permission themselves. `admission.ts` reads the
latest run and the selected batch's stamped lead:

| Head \ Lead | `none` | `user` | `passive` | `report` | `answer` |
| --- | --- | --- | --- | --- | --- |
| `fresh` | `wait` | `start` a user run and new chain | `wait` | `wait` | `start` a continuation and inherit its chain when authorized; otherwise `wait` |
| `idle` | `wait` | `start` a user run and new chain | `settle` under the terminal run | `wait` | `start` a continuation and inherit its chain when authorized; otherwise `wait` |
| `live` | `wait` | `join` | `join` | `join` | `join` |
| `settling` | `wait` | `wait` | `wait` | `wait` | `wait` |

For every non-empty live cell, an agent change returns `handoff` instead of
`join`: the run ends and the batch stays pending. The three terminal phases are one case. An authorized delegate completion starts
a continuation run with the requesting chain's `root`; its `origin` names the
child session and request. A command completion, a participant's child request,
and a delegate request whose authorization was revoked or consumed stay queued.
They join the context of the next user message, ahead of that message's answer,
and land once. While a run is live, a completion lands at its next response
boundary and is answered there. A checkpoint continues the run that asked for
it; it grants no new admission, and a stop flagged during it still ends that run
before any response.

`runs.wait` and `relocate` read the same admission, on the batch the runner's
`drain` would take from each delivery. An idle head with an authorized delegate
answer is runnable. One with only command completions or unauthorized delegate
answers is `idle` and quiet enough to move.

### Stopping

`abortRequested` is one-way. Once a participant sets it, the run can only end
`aborted`: no landing clears the flag, no queued change joins that run, and a
second abort is a no-op. Every phase a step publishes passes one guard, so a
flagged run whose tool batch fails, or whose branch no longer carries the
assistant message its batch needs, still ends `aborted`; the batch's results
stay on the branch, and the failure it would have reported is appended as a
runner notice instead. The flag stays on the terminal run object, and the run
is then as idle as one that finished on its own.

A user message queued during or after the stop starts a new run id in the same
conversation; the stopped run is history. Aborting a run cancels every command
job it owns. It suppresses a terminal completion only while delivery is still
`owed`; a delivery that already changed `owed` to `claimed` finishes exactly
once. User jobs have no run and are untouched. Children the run created are
untouched too: a child is a session, not the run's work. Its parked
`await` (or `task`, or `send` with `waitMs`) wakes with the abort flag and
settles `cancelled`; the child keeps working. In the same CAS that flags the
run, Stop rewrites every outstanding delegate authorization owned by that run
to `input`. A model send writes its authorization in a CAS that also asserts
`refs/runs/<head>` still points to the exact run object it read. If Stop moves
that ref first, the send abandons the prepared request and publishes no child
change. A later child answer therefore waits for the next user message.
Only `stop` ends a child. The runner cancels its local drive from the run ref, never from an event's payload,
because a stopped run's final event still carries the flag after the next run
has started; a read of that ref taken for one drive is dropped if the drive
ended while the read was in flight.

### Configuration on an idle head

Configuration settles without user input under an existing terminal run, so the
head stays idle. With no prior run, it waits for response-starting input and
lands in that batch. The next user run folds configuration that precedes it in
the same delivery.

## A submitted message is never lost

The only way a pending change leaves the queue is a landing or an explicit
cancel. Nothing else touches it:

- A run that fails, aborts, or is superseded leaves every pending change where
  it is. Explicit user input can start a new run; completions alone stay queued.
- A client that reconnects reads `pending` and sees the same rows every other
  client sees. Pending is a store query, never client memory.
- A store that throws (disk full, connection lost) has written at most a loose
  object that no ref names; the submit is retried by the client, not repaired
  by the core.

The gap the core cannot cover is the request between Enter and the receipt. A
client closes it with an outbox (`createOutbox` in `@nyte-ai/client`):

1. On Enter, mint a key (a uuid), keep the message locally as `sending`, and
   draw it in the pending gutter at once.
2. Submit with that key. A network failure keeps the message in the outbox and
   retries with backoff, same key, forever or until the user cancels it.
3. `queued` and `duplicate` both mean the message is durable: replace the local
   row with the change id. A retry after a lost response is a `duplicate`, so
   nothing is sent twice.

The key is `refs/keys/<key>`, written in the same CAS as the inbox tip, so the
guarantee is the store's, not the client's.

`redeliver` can replace a queued user message's `content` or place it `before`
another pending change. It appends the changed suffix and cancels the old suffix
in one CAS, asserting the source and destination bases and the destination tip.
An edit racing a landing cannot re-admit the landed message. Copies retain their
original times; `pending` merges deliveries chronologically while preserving
order within each delivery. The queue event projection publishes every appended copy.

## Background jobs

The SDK wraps `bash` as a job. Each `refs/jobs/<job>` points to an immutable
blob containing `JobInfo`, an optional tool result, and what the job still owes
its head: nothing, a completion, or one already delivered. Job IDs derive from
the originating run and call IDs. Updates use the same object-before-ref CAS as
other durable state; there is no separate jobs table. The `job` event projects
the ref's `JobInfo`, and `jobs.list` reads these refs. Output in `JobInfo`
retains the last 50,000 characters. Children are not jobs: see Delegation.

```text
bash -> job ref + job lease -> work
           |
           +-> parked tool effect
                 foreground: settle with the result when work ends
                 background: settle with a receipt; work keeps its lease
```

Both modes park the originating tool effect first. The runner rechecks jobs after
parking so fast completion cannot lose its wake. `jobs.background` switches
running foreground work to background without restarting it. `jobs.cancel`
cancels that job, not the whole parent run. Aborting the parent cancels every
command job that run owns, foreground or background; a run that ends on its own
leaves its background work running, and that work's result then waits for the
next user message.

Execution holds a renewable, fenced lease on the job ref, independently of the
head lease. Closing a UI panel or switching chats does not cancel the job.
Closing the owning host interrupts its live jobs and stops their work. Recovery
acquires an abandoned job's lease before marking it `interrupted`; it waits while
another owner still holds the lease. Commands and child work are never rerun by
job recovery. The wrapper uses `replay: "never"`. Durable output remains readable,
but durable job metadata is not a promise that a process survives host shutdown.

A terminal background job submits a typed `completion` containing its state and
output to the originating head with `kind: "report"` and `delivery: "steer"`.
It therefore lands at response boundaries, including before an unanswered user
input's response, without interrupting streaming or tool execution. Completions join model context but do
not become transcript user messages or editable pending items; in the transcript
a completion opens its own empty turn, so the response that follows it attaches
there instead of an earlier request's turn. A command completion never starts a
run: on an idle head it waits for the next user message (see Who starts model
work). Delivery first changes `owed` to `claimed`, submits with
`background-<jobId>` as the admission
key, then stores `delivered { change }`. Recovery retries `claimed` delivery
with the same key after a crash, so it cannot admit a second completion. A quiet
run abort changes only `owed` to `none`; it does not suppress work already
claimed. Completion includes failed, cancelled, and interrupted
jobs, not just successful work; undelivered results survive host close.
Foreground work returns its normal tool result and does not submit a completion.
A job `jobs.start` runs for the user (`origin.kind === "user"`) has no run: it
owes no completion, signals no effect, survives `runs.abort`, and only
`jobs.cancel` or host close ends it early; clients read it from `job` events.

## Delegation

A child is a session the parent addresses by `SessionId`, created by `create`
or `task` at `childIdOf(parent, runId, callId)` with a `parent` fact, the
parent's directory, the title as its `name` fact, and a config commit naming
its model. It persists until `stop`: `send` enqueues a user message on its
`main` head as the parent (`{ clientId: parent, device: "delegate" }`), with
`delivery: "next"` when the child is idle and `delivery: "steer"` when it is
live. Each send writes
`refs/delegations/<child>/<change>` in the parent session: the owning run and
call, the head to answer on, a per-request `continuation`, and `delivery` as
`owed` or `delivered { change }`. A model send writes `authorized { root }` from
the live parent run in a CAS that asserts the exact parent run ref with
`to === from`. If that assertion loses to Stop, the child change is not
published. A participant send writes `input`. That record is internal:
not a `JobInfo`, not in `jobs.list`, never a `job` event.

When the child run that landed a request ends (`done`, `failed`, `aborted`),
the child's runner (or its next reconcile, after a crash) delivers one
`completion` commit to the parent head with `JobReport.delegate`: the child,
its title, `request` (the child commit the send landed as), how the run ended,
and the child's last assistant commit of that run as `report`, or `none`.
The record captures the terminal child run object's oid. Delivery reads the end
from that object rather than from the trimmable event stream, and the delegation
record keeps it reachable during garbage collection. Delivery first submits
under `delegate-<child>-<request>`, then records the submitted change as
delivered. Recovery can repeat submission after a crash between those writes
without admitting a second completion. A request the child
was stopped before landing is delivered `cancelled`, named by
`{ kind: "change", oid }`; a landed request is named by
`{ kind: "commit", oid }`. On an idle parent head, an authorized request may
start one continuation run. Its landing CAS rewrites the request authorization
to `consumed` beside the head, inbox base, and run refs. Other delegate
completions wait for user input.

`await` (and `task`, which is create, send, and await in one call; and `send`
with `waitMs`) parks its effect with `until = now + timeoutMs`. Delegation
signals the parked call when the agents it names satisfy its mode (`any` or
`all`) or when user input arrives with `delivery: "steer"` on that head; the runner
expires it at the deadline. The wake handler always settles: reports for the
agents whose request ended, `{ phase }` for the rest, and a note when the wait
ended for input or on the deadline. A report is heard again as its completion.
`read` answers from the child's transcript projection and never parks. `stop`
flags the child cancelled, aborts its run, cancels its queue, and interrupts
its jobs; it answers no further `send`.

Child sessions inherit workspace trust. A child is not offered tools marked
`availability: "foreground"`, regardless of tool name: it works unattended.
This is a host-placement filter in core, not knowledge of what a tool does or a
client-side approval prompt.

## Session location

Host-only `sessionCwd({ sessionId })` reads `refs/facts/cwd`, falling back to
that session's activation environment. `relocate({ sessionId, workspace, plugins })`
accepts a trusted workspace and its resolved plugin set. It replaces only that
session's activation and saves the directory in the original store. IDs, heads,
queues, and conversation history do not move. Global `setPlugins` skips these
session-scoped plugin sets; hosts reload one with `setPlugins(plugins, { sessionId })`.
Scoped reload keeps the activation environment and supports hot reload during a run.

Relocation returns `busy` while the session or a child has an active drive, run,
head lease, queued input the runner would land, running job, or job lease. A
completion waiting for user input is not work and does not hold the move. Work
is never cancelled to change directories. Restoring an inactive session to its already-saved directory
allows persisted unfinished work, but still refuses live drives and leases.

A saved path is not a trust decision. Reopening through a host composed for a
different directory reports `requires/workspace_trust` and does not instantiate
plugins or run tools. The host reads `sessionCwd`, validates trust, resolves that
directory's plugins and skills, then calls `relocate` before attaching a runner.

## Acceptance

The drills every backend and every runner must pass:

- 100 concurrent submitters form one chain per delivery with no lost change.
- An authorized delegate completion on an idle parent starts one continuation run, consumes its request authorization in the landing CAS, and carries the requesting root. The same completion after Stop or requester failure stays queued for user input.
- A model send asserts the exact parent run ref while writing its authorization. An abort that wins that CAS leaves the child with no request.
- Command completions, participant child requests, and already-consumed delegate requests never start a run on an idle head.
- Two runners racing to consume one delegation authorization publish exactly one continuation.
- A submit during a streaming response is still pending after that publish.
- A head move during a run makes the run's publish fail; the run ends, the
  head stays where the participant put it, and the queue is untouched.
- A lease takeover fences every event and ref write from the former runner.
- A crash between effect intent and result follows `safe` or `never` replay.
- The first signal to a waiting effect wins.
- Two clients with independent cursors reconstruct the same event stream.
- A cursor older than the floor is refused and takes a snapshot.
- A branch is stale exactly when its stack base differs from its parent's tip.
- A fast-forward merge is one atomic update.
- Loose objects from a failed publish survive the grace period, then go.
- A cancel racing a landing ends cancelled or landed, never both.

## Code conventions

- TypeScript 7, `erasableSyntaxOnly`, `verbatimModuleSyntax`: no enums, no
  parameter properties, `import type`, `.ts` extensions on relative imports.
- Discriminated unions over optional-field bags. No `as` casts; narrow instead.
  `const _exhaustive: never = x` in default arms.
- Every operation takes one options object where it has more than two inputs.
- Tests: vitest under `packages/core/test/kernel/*.test.ts`, against the
  SQLite backend on a temp file or `:memory:`. Real store, no mocks.
- Lint and format: `pnpm lint`, `pnpm format` at the repo root (oxlint, oxfmt).
