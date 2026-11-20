# Core

- Own session state and execution here; clients consume this behavior through `@nyte-ai/sdk`.
- Keep core free of `node:*` imports so the sdk's browser and React Native entry can load it. Node code belongs in `@nyte-ai/host`.
- Keep shared code compatible with Node and Bun; do not introduce Bun-only APIs.
- Core's folders are layered: a folder imports only its own layer or lower ones, type-only imports included, and `pnpm layers` enforces it. Lower code reaches higher code through a `Kernel` member. Code goes with its owner, or at the lowest layer its imports allow when none fits.
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
- **Durable versus derived.** Events ride only on refs under `sessions/<id>`. `FoldState` is derived from the log; checkpoints are a disposable cache. States share their maps, so a held `FoldState` is not a snapshot. Streaming `PatchEvent`s are never durable.
- **Admission never starts a run.** `send` writes the inbox and a pending receipt. A run starts under the head lease, in the same `set` that lands its prompt. Wakes are hints; `repair`, `cover` and the presence sweep find owed work.
- **Landing** moves inbox messages onto the head in one `set` expecting inbox and tip. A `deciding` first message blocks run starts.
- **Steer only at boundaries:** run start and after a response's tool calls finish. `queue` never lands in a live run. `steer` becomes `queue` when the model can't take mid-run input.
- **Continuations.** `attach` never starts a run, except a child or job report, or a late answer to a part, on an idle head whose last run completed.
- **Idempotent IDs.** A reused receipt or session id with the same digest replays; a different digest throws. Ids created inside a durable call are recorded in `CallRecord.acquisitions`. Tool call ids are `${run}:${requests}:${providerId}`.
- **Replace.** An inbox target is revised in place. A landed target rewinds the head, fences the live run and admits the new message in one `set`.
- **Run fence.** Writes for a run fence on `live/<id>`. A stop sets `stopping`, deletes `live/<id>` and fails open parts in one `set`. A run's call settles only while `runs/<id>` exists.
- **Bounded stop.** A stopped run ends 3 s after its signal aborts whether or not its turn or a resumed call returned; its open calls settle stopped first. Whatever still runs is left running and can no longer write to the run.
- **Only `endRun` retires a run**, in one `set`: deletes `runs/<id>` and `live/<id>`, writes `lastRun`, settles receipts, fails live parts unless completed, and reserves a child's report.
- **Reports are reserved, not sent.** A child's run or a job reserves its report as a `report` receipt in the set that ends it. A wait that takes the end deletes it in the same set; admission adopts it under its own id, so a second delivery replays; `recover` delivers what a crash left.
- **Store version.** `STORE_VERSION` counts migration steps; hosts run `migrateStore`, core never does. Every bump, even a schema-only step, discards all fold checkpoints.
- **Streaming writes.** Opening a part is the only store write while a response streams. Tool calls then run one after another, which keeps replay safe.
- **Pause** aborts only model streams, never tools or leases. A stream aborted without the run's signal retries without spending the retry budget.
- **Head lease.** One process advances a head, holding `leases/<head>` (30 s, renewed every 10 s). Claims compare `holder` and `instance`.
- **Presence.** Each process beats `processes/<instance>` by CAS and fences every write on it. A lost beat or a fenced write revokes the process.
- **Takeover.** A peer is dead after 20 s unchanged while this process wrote within 10 s, or at once when its record names an OS process that this machine says is gone; one the machine cannot tell about waits out the 20 s. The takeover deletes its process ref in the same `set` as the lease write, so the dead process can't write again. When changing this, run the verify-takeover-fence skill.
- **Restart recovery.** A run survives its process. A takeover without progress counts an interruption; at 5 the run fails. A graceful close releases its leases.
- **Durable calls.** A `CallRecord` with a result answers every replay. A `replay: "never"` call found from before this process settles `interrupted`.
- **Jobs** belong to the instance that started them and are reaped only when it is dead. The reaper signals a job's process group only through `Machine.end`, which acts only on this boot and only while the group's leader runs with its recorded start.
- **Session plugins are durable by name.** `plugins.replace(..., { session })` writes `SessionRecord.plugins`: a file by its path, a plugin object by its id. Activation resolves an id from the objects this process was handed for the session, then from the host's plugins. An id or file it cannot load fails the activation and never falls back to the default plugins. `advance` reloads a runtime whose `assigned()` differs from the record, so a takeover runs the stored plugins.
- **Plugins add through data.** A plugin adds items and hooks through its `contribute` and `hooks` fields and through what `activate` returns. `activate` always returns an `Additions` object, `{}` for nothing; one that returns anything else fails the activation. `PluginApi.registries` only reads: there is no `add` and no `hook`, so nothing is added after an activation settles. `PluginInstance.add` installs on every host the instance has joined and on each it joins later.
- **`when`.** A tool, setting, command or prompt section with `when` is in a chat only while `when(chat)` returns `true`. A registry asks it at the end of every pass, after derivations, and a throw becomes a plugin issue and leaves the item out. `Chat` is a snapshot the runtime reads before a pass: the session's parent and each drafted setting's value. A setting change reads it again and reruns the pass. `when` never awaits.
- **Plugin activation.** `activationSession` never awaits the runtime's `ready`; awaiting it during activation deadlocks. Until `ready` settles, hooks go to the previous runtime's handlers.
- **Hook failures.** An observe hook's failure becomes a plugin issue; a transform hook's fails the caller; a decide hook's throw or timeout is recorded as its call result and replays.
- **Authority.** `ServerHost` and `WireHost` check none; the listener in front gates `wire.move`, `hold` and `batch`. `gated()` denies only async members, so a sync or iterable member (`models.login`, `mcp.watch`) calls `gate()` itself.
