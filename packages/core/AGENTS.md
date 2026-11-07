# Core

- Own session state and execution here; clients consume this behavior through `@nyte-ai/sdk`.
- Keep core free of `node:*` imports so the sdk's browser and React Native entry can load it. Node code belongs in `@nyte-ai/host`.
- Keep shared code compatible with Node and Bun; do not introduce Bun-only APIs.
- Core's folders are layered: a folder imports only its own layer or lower ones, and `pnpm layers` enforces it. Lower code reaches higher code through a `Kernel` member.
- Test against the memory store with scripted providers. Assert persisted
  state and observable views, including cancellation and recovery when affected.

## Vocabulary

- *Session* `sessions/<id>`: a workspace, *heads* (branches, `main` by default), optional `parent`. A *child* has a parent.
- *Head*: tip `heads/<head>`, inbox `inbox/<head>`, lease `leases/<head>`.
- *Message*: an admitted inbox input; its id is its receipt id.
- *Run*: one execution on one head, from `run started` to `completed`, `failed` or `stopped`. It spans requests, calls, parks and takeovers.
- *Request*: one model call. Say "request", not "turn" or "step"; both are overloaded in the code.
- *Call*: a durable `CallRecord` (`tool`, `action`, `hook`, `intent`).
- *Park*: a live run waiting with no runnable call. *Stop*: setting a run's stop fence.
- *Steer*, *queue*, *attach*: the three deliveries.
- *Process*: one composed kernel. Every process on a store shares the *host* id.

## Invariants

- **One write path.** `refs.set(updates)` is the only mutation and commits fences, expectations, refs and log appends atomically. Never split one change across two `set` calls.
- **CAS everywhere.** Read-modify-write expects the revision it read and retries on `STALE`. Only a delete that must win, like `live/<run>`, skips `expect`.
- **`changeRun` relies on CAS, not the run fence.** A late write after a stop retries on the stopping record; after an end it throws and never recreates `runs/<id>`. Keep its `expect`.
- **Durable versus derived.** Events ride only on refs under `sessions/<id>`. `FoldState` is derived from the log; checkpoints are a disposable cache. Streaming `PatchEvent`s are never durable.
- **Admission never starts a run.** `send` writes the inbox and a pending receipt. A run starts under the head lease, in the same `set` that lands its prompt. Wakes are hints; `repair`, `cover` and the presence sweep find owed work.
- **Landing** moves inbox messages onto the head in one `set` expecting inbox and tip. A `deciding` first message blocks run starts.
- **Steer only at boundaries:** run start and after a response's tool calls finish. `queue` never lands in a live run. `steer` becomes `queue` when the model can't take mid-run input.
- **Continuations.** `attach` never starts a run, except a child or job report, or a late answer to a part, on an idle head whose last run completed.
- **Idempotent IDs.** A reused receipt or session id with the same digest replays; a different digest throws. Ids created inside a durable call are recorded in `CallRecord.acquisitions`. Tool call ids are `${run}:${requests}:${providerId}`.
- **Replace.** An inbox target is revised in place. A landed target rewinds the head, fences the live run and admits the new message in one `set`.
- **Run fence.** Writes for a run fence on `live/<id>`. A stop sets `stopping`, deletes `live/<id>` and fails open parts in one `set`.
- **Only `endRun` retires a run**, in one `set`: deletes `runs/<id>` and `live/<id>`, writes `lastRun`, settles receipts, fails live parts unless completed.
- **Head lease.** One process advances a head, holding `leases/<head>` (30 s, renewed every 10 s). Claims compare `holder` and `instance`.
- **Presence.** Each process beats `processes/<instance>` by CAS and fences every write on it. A lost beat or a fenced write revokes the process.
- **Takeover.** A peer is dead only after 20 s unchanged while this process wrote within 10 s. The takeover deletes its process ref in the same `set` as the lease write, so the dead process can't write again. When changing this, run the verify-takeover-fence skill.
- **Restart recovery.** A run survives its process. A takeover without progress counts an interruption; at 5 the run fails. A graceful close releases its leases.
- **Durable calls.** A `CallRecord` with a result answers every replay. A `replay: "never"` call found from before this process settles `interrupted`.
- **Jobs** belong to the instance that started them and are reaped only when it is dead.
- **Session plugins aren't durable.** `plugins.replace(..., { session })` lives in process memory; a restart or takeover drops it.
