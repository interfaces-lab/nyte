# Kernel

Git's object database with messages in place of files. This directory is the
durable core of `@nyte-ai/core`: it decides what survives, who may write, and
in what order everyone sees it. It imports `@nyte-ai/schema` (the pi-derived
message types), `node:crypto`, and `node:sqlite`. Nothing else.

## Four authorities

| Git                       | Kernel                                                  |
| ------------------------- | ------------------------------------------------------- |
| object database           | `objects`: content-addressed, immutable                 |
| ref, `update-ref` CAS     | `refs`: the only mutable state, multi-ref compare-and-swap |
| lock file                 | `leases`: fenced execution rights, never history        |
| reflog                    | `events`: one ordered stream per session                |

Everything else is a helper over those four. A feature that can be a ref is a
ref. A verb that can be a CAS is a CAS.

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
refs/effects/<run>/<call>      Effect: intent -> waiting -> signal -> result
refs/keys/<key>                idempotency receipt: the Change a key produced
refs/cancelled/<change>        Blob: a submitted change withdrawn before it landed
refs/facts/<key>               Blob: a small session value
refs/deleted                   Blob: the session is being deleted
```

## Files

| File          | Owns                                                                   |
| ------------- | ---------------------------------------------------------------------- |
| `model.ts`    | The types. Objects, ref updates, leases, events.                       |
| `store.ts`    | The store contract a backend implements.                               |
| `names.ts`    | Ref names and their rules.                                             |
| `json.ts`     | Canonical JSON and the JSON boundary (`toJsonValue`).                  |
| `hash.ts`     | `hashObject(object)`.                                                       |
| `sqlite.ts`   | The SQLite backend: five tables, `BEGIN IMMEDIATE`, one seq per session. |
| `graph.ts`    | Walking commits: branch, ancestry, the context cut at a checkpoint.    |
| `context.ts`  | Commits to model messages, and the branch's declared config.           |
| `queue.ts`    | `submit`, `pending`, `cancel`: one change chain per lane, behind a tip and a base ref. |
| `effects.ts`  | The effect sandwich for one tool call, and recovery.                   |
| `stacks.ts`   | Branch create, delete, stale check, fast-forward.                      |
| `step.ts`     | One durable step of a run, and `drive` to loop it under one lease.     |
| `lease.ts`    | Renews ownership during provider and tool calls; aborts work after takeover. |
| `outbox.ts`   | Buffers a runner's deltas and progress into the event stream.          |
| `turn.ts`     | Binds `agent-loop.ts` to `step.ts`: respond, tools, durable tools.     |
| `compaction.ts` | Checkpoints and branch summaries: the cut, the summary, the publish.  |
| `gc.ts`       | Mark from refs and recent ref events; sweep unreachable, aged objects. |
| `views/`      | Projections a client draws: transcript, tree, changes, usage, gauge.   |
| `sdk/`        | The client contract (`types.ts`), event projection, activation, and `createNyte`. |

`runs.compact` writes one manual checkpoint under the head lease using the branch's
model (the host's default when unset). The `before_compaction` hook can provide
native context. TUI and desktop install `@nyte-ai/plugin/openai-compaction` for
OpenAI and OpenAI Codex; successful requests replay the complete provider output
without a local summary request. Unsupported or failed requests use the portable
summarizer, with bounded requests when recovery history exceeds the model window.
Native checkpoints retain portable history for switching models. A live run answers
`busy`; an empty context answers `nothing_to_compact`. Passing an aborted `signal`
returns `aborted` without publishing a checkpoint.

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
  event floor have their own verbs; none of them changes what a ref points at.
- No submission ever fails because a run is live. Submits retry the tip CAS
  internally. Contention exists only on leases, on a runner's publish, and on
  structural verbs that refuse a held head (`deleteHead` answers `busy`).
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

`step(session, turn, head)` reads three refs and does one thing:

| Run phase        | Pending change | Step does                                                          | Publish CAS (all in one)                          |
| ---------------- | -------------- | ------------------------------------------------------------------ | ------------------------------------------------- |
| none / terminal  | none           | nothing: `idle`                                                    |                                                   |
| none / terminal  | some           | land from the first policy lane; start in `respond` with a message, otherwise `done` | head, queue base, run                             |
| `respond`        | some in a boundary lane | land it before the next response; with `drain: "one"` only once the last landed message has its answer | head, queue base |
| `respond`        | none           | `turn.respond` over the branch context                             | head (assistant commit), run -> tools / done / retry / failed / aborted |
| `tools`          | any            | `turn.tools`: effect sandwich per call; commit results             | head (result commits), run -> respond / waiting / failed / aborted |
| `waiting`        | any            | if a signal or abort arrived: `turn.tools` again, else `waiting`   | as `tools`                                        |
| `retry`          | any            | before `at`: `retry`; after: as `respond`                          |                                                   |

Every publish also expects `refs/deleted` absent and carries the lease. A head
moved by a participant, an abort flag, or a deletion makes the publish fail;
the runner re-reads and ends the run instead of forcing its output.

## A submitted message is never lost

The only way a pending change leaves the queue is a landing or an explicit
cancel. Nothing else touches it:

- A run that fails, aborts, or is superseded leaves every pending change where
  it is. The next step lands it as a new run.
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

## Acceptance

The drills every backend and every runner must pass:

- 100 concurrent submitters form one chain per lane with no lost change.
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
- Every verb takes one options object where it has more than two inputs.
- Tests: vitest under `packages/core/test/kernel/*.test.ts`, against the
  SQLite backend on a temp file or `:memory:`. Real store, no mocks.
- Lint and format: `pnpm lint`, `pnpm format` at the repo root (oxlint, oxfmt).
