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
refs/heads/<head>              branch tip (absent = unborn)
refs/stacks/<head>             Stack { parent, base }: where the branch sits
refs/queues/<head>/<lane>/tip  newest submitted Change in that lane
refs/queues/<head>/<lane>/base last landed Change; pending = (base, tip]
                               a lane is a name the submitter chooses; the
                               runner's landing policy says when each lands
refs/runs/<head>               Run: the branch's current run and phase
refs/compactions/<head>        Blob: active checkpoint work fenced by the head lease
refs/effects/<run>/<call>      Effect: intent -> waiting -> signal/expired -> result
refs/jobs/<job>                Blob: command or subagent job, output, result, delivery receipt
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
| `queue.ts`    | `submit`, `pending`, `cancel`: one change chain per lane, behind a tip and a base ref. |
| `admission.ts` | What the head's latest run lets the queue land: live, settling a stop, or idle. Only user input starts model work. `step.ts` lands by it; `sdk/wait.ts` and `sdk/relocate.ts` read it. |
| `effects.ts`  | The effect sandwich for one tool call, and recovery.                   |
| `stacks.ts`   | Branch create, delete, stale check, fast-forward.                      |
| `step.ts`     | One durable step of a run, and `drive` to loop it under one lease.     |
| `lease.ts`    | Renews ownership during provider and tool calls; aborts work after takeover. |
| `outbox.ts`   | Buffers a runner's deltas and progress into the event stream.          |
| `turn.ts`     | Binds `agent-loop.ts` to `step.ts`: respond, tools, durable tools.     |
| `telemetry.ts` | The span vocabulary `step.ts` and `turn.ts` emit, and its typed starter. |
| `compaction.ts` | Checkpoints and branch summaries: the cut, the summary, the publish.  |
| `gc.ts`       | Mark from refs and recent ref events; sweep unreachable, aged objects. |
| `sdk/`        | The client contract (`types.ts`), event projection, activation, and `createNyte` (`nyte.ts`), composed from `session-pool.ts` (one handle per session: facts, heads, activation, notices), `runner.ts` (drive loops and aborts), `subagent-host.ts` (child sessions and the jobs wrapper), `relocate.ts`, `summaries.ts` (`runs.compact`, the summary a move carries), and `reads.ts` (session page, snapshot, context, changes). |

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
- The kernel knows no head and no lane by name. A runner hands `step` its
  landing policy (`Landing`): the lanes it serves, in priority order, each
  landing at every response boundary or only when the head is idle, and how
  much of a lane lands at once. The SDK's defaults are the lanes `steer` and
  `queue` and the head `main`; a host may declare others.
- Every event a client may need is in the stream; deltas name `(runId,
  attempt, index)`, never an entry id, because a commit's id is its hash and
  does not exist until the message is whole.

## The step

`step(session, turn, options)` settles any live compaction, reads the head, run, and deletion refs, and does one thing:

| Run phase        | Pending change | Step does                                                          | Publish CAS (all in one)                          |
| ---------------- | -------------- | ------------------------------------------------------------------ | ------------------------------------------------- |
| none / terminal  | none admitted  | nothing: `idle`                                                    |                                                   |
| none / terminal  | some admitted  | land the first policy lane whose batch the head admits; a batch with user input starts a new run in `respond`; configuration and notes land under the terminal run, or start a run already `done` when there is none | head, queue base, run                             |
| `respond`, flagged | any          | end the run `aborted`; nothing lands into a stopping run           | run                                               |
| `respond`        | some in a boundary lane | land it before the next response; with `drain: "one"` only completed work while the last landed input still awaits its answer | head, queue base, run (asserted) |
| `respond`        | none           | `turn.respond` over the branch context                             | head (assistant commit), run -> tools / done / retry / failed / aborted |
| `tools`          | any            | `turn.tools`: effect sandwich per call; commit results             | head (result commits), run -> respond / waiting / failed |
| `waiting`        | any            | after a signal, expiry, completed result batch, or abort: `turn.tools` again; otherwise `waiting` | as `tools`                                        |
| `retry`          | any            | before `at`: `retry`; after, or once an abort is flagged: as `respond` |                                                   |

Every publish also expects `refs/deleted` absent and carries the lease. A head
moved by a participant or a deletion makes the publish fail; the runner re-reads
and ends the run instead of forcing its output. An abort flag set during a step
also fails its publish; the runner keeps the step's output and carries the flag
to the next response boundary (through the tool batch when one is due), where
the run ends `aborted`.

## Who starts model work

Only user input does. Model execution starts from a batch that carries a user
message and from nothing else; once live, the run continues through tool batches,
parked calls, provider retries, checkpoints, and the
boundary landings of its lanes, until it ends `done`, `failed`, or `aborted`.
Background results, job recovery, reconnects, ref events, and runner restarts
can only wake a runner to read the refs; what the runner may land is decided by
`admission.ts` from the latest run alone:

| Latest run                        | Admission | What lands                                                                     |
| --------------------------------- | --------- | ------------------------------------------------------------------------------ |
| live                              | live      | the next boundary-lane batch, into that run                                    |
| live with `abortRequested`        | settling  | nothing, until the run is `aborted`                                            |
| none, `done`, `failed`, `aborted` | idle      | a batch with a user message, as a new run; or a batch with nothing to answer (configuration, notes), under the terminal run |

The three terminal phases are one case. A completion that arrives after a run
ended, however it ended, or on a head that never ran, stays queued, survives
reopen, and cannot wake the model. It joins the context of the next user
message, ahead of that message's answer, and lands once. While a run is live, a
completion lands at its next response boundary and is answered there, as work
that run authorized. A checkpoint continues the run that asked for it; it does
not reopen admission, and a stop flagged during it still ends that run before
any response.

`runs.wait` and `relocate` read the same admission, on the batch the runner's
`drain` would take from each lane: a head with no active run and only completions
queued is `idle`, and quiet enough to move.

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
conversation; the stopped run is history. Aborting the parent cancels every job
its run owns; their records are marked delivered as they are cancelled, so no
completion is submitted for them. User jobs have no run and are untouched. The
runner cancels its local drive from the run ref, never from an event's payload,
because a stopped run's final event still carries the flag after the next run
has started; a read of that ref taken for one drive is dropped if the drive
ended while the read was in flight.

### Configuration on an idle head

Configuration and notes land without user input, committed under the terminal
run's id with the run ref only asserted, so the head stays idle and no run is
created that completed work could then answer into. The next user message reads
its config from the branch, whichever lane either landed in. In a lane that
mixes completed work ahead of configuration, the configuration waits for the
user input with the completion.

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
client closes it with an outbox:

1. On Enter, mint a key (a uuid), keep the message locally as `sending`, and
   draw it in the pending gutter at once.
2. Submit with that key. A network failure keeps the message in the outbox and
   retries with backoff, same key, forever or until the user cancels it.
3. `queued` and `duplicate` both mean the message is durable: replace the local
   row with the change id. A retry after a lost response is a `duplicate`, so
   nothing is sent twice.

The key is `refs/keys/<key>`, written in the same CAS as the queue tip, so the
guarantee is the store's, not the client's.

`redeliver` can replace a queued user message's `content` or place it `before`
another pending change. It appends the changed suffix and cancels the old suffix
in one CAS, asserting the source and destination bases and the destination tip.
An edit racing a landing cannot re-admit the landed message. Copies retain their
original times; `pending` merges lanes chronologically while preserving each
lane's delivery order. The queue event projection publishes every appended copy.

## Background jobs

The SDK wraps `bash` and `task` as jobs. Each `refs/jobs/<job>` points to an
immutable blob containing `JobInfo`, an optional tool result, and a `delivered`
flag. Job IDs derive from the originating run and call IDs. Updates use the same
object-before-ref CAS as other durable state; there is no separate jobs table.
The `job` event projects the ref's `JobInfo`, and `jobs.list` reads these refs.
Output in `JobInfo` retains the last 50,000 characters.

```text
bash / task -> job ref + job lease -> work
                  |
                  +-> parked tool effect
                        foreground: settle with the result when work ends
                        background: settle with a receipt; work keeps its lease
```

Both modes park the originating tool effect first. The runner rechecks jobs after
parking so fast completion cannot lose its wake. `jobs.background` switches
running foreground work to background without restarting it. `jobs.cancel`
cancels that job, not the whole parent run. `wait_task` parks a new job that
observes an owned subagent job until it ends, then settles with the stored
report; it never re-runs the task, and cancelling the wait leaves the observed
job running. A wait holds back the completion message while it carries a report
and claims it on the way out, so an awaited report is heard once. Aborting the
parent cancels every job that run owns, foreground or background, command or
subagent; a run that ends on its own leaves its background work running, and
that work's result then waits for the next user message.

A parked call gives the head no response boundary, so user input queued for this
run would wait for the child. Both parked shapes yield instead: `wait_task`
settles with the task still running, and a foreground subagent job moves to
background, which settles its call with the receipt. Only input in a lane that
lands at a boundary counts; input queued for an idle head waits for the run
either way. Yielding never touches the child: it keeps working, and its report
arrives as a completion.

Execution holds a renewable, fenced lease on the job ref, independently of the
head lease. Closing a UI panel or switching chats does not cancel the job.
Closing the owning host interrupts its live jobs and stops their work. Recovery
acquires an abandoned job's lease before marking it `interrupted`; it waits while
another owner still holds the lease. Commands and child work are never rerun by
job recovery. The wrapper uses `replay: "never"`. Durable output remains readable,
but durable job metadata is not a promise that a process survives host shutdown.

A terminal background job submits a typed `completion` containing its state and
output to the originating head. The SDK's private `background` lane lands at
response boundaries, including before an unanswered user input's response, without
interrupting streaming or tool execution. Completions join model context but do
not become transcript user messages or editable pending items; in the transcript
a completion opens its own empty turn, so the response that follows it attaches
there instead of an earlier request's turn. A completion never starts a run: on
an idle head it waits for the next user message (see Who starts model work). The lane is not
part of `DEFAULT_LANDING` or the public `nyte.landing` policy. Delivery uses
`background-<jobId>` as the admission key, then marks the job delivered.
Recovery can repeat delivery after a crash between those writes without admitting
a second completion. Completion includes failed, cancelled, and interrupted
jobs, not just successful work; undelivered results survive host close.
Foreground work returns its normal tool result and does not submit a completion.
A job `jobs.start` runs for the user (`runId: "user"`, `isUserJob`) has no run:
it is born delivered, signals no effect, survives `runs.abort`, and only
`jobs.cancel` or host close ends it early; clients read it from `job` events.

Child sessions inherit workspace trust. A background child is not offered tools marked `availability: "foreground"`, regardless of tool
name. This is a host-placement filter in core, not knowledge of what a tool does or a client-side
approval prompt.

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

- 100 concurrent submitters form one chain per lane with no lost change.
- A completion that arrives while a run is being stopped, or after any run
  ended, or on a head that never ran, stays queued and leaves the head idle;
  the next user message starts a new run and hears it once.
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
