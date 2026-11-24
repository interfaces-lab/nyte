# Core

- Session state and execution live here. Clients use them through `@nyte-ai/sdk`.
- Keep core free of `node:*` imports, so the sdk's browser and React Native entry can load it. Node code belongs in `@nyte-ai/host`.
- Keep shared code compatible with Node and Bun. No Bun-only APIs.
- Core's folders are layered. A folder imports only its own layer or lower ones, type-only imports included. `pnpm layers` enforces it.
- Lower code reaches higher code through a `Kernel` member.
- Code goes with its owner. When no owner fits, it goes at the lowest layer its imports allow.
- Test against the memory store with scripted providers. Assert persisted state and observable views. Cover cancellation and recovery when the change touches them.

## Vocabulary

- *Session* `sessions/<id>`: a workspace, its *heads* (branches, `main` by default) and an optional `parent`. A *child* has a parent.
- *Head*: a tip `heads/<head>`, an inbox `inbox/<head>` and a lease `leases/<head>`.
- *Message*: an admitted inbox input. Its id is its receipt id.
- *Run*: one execution on one head, from `run started` to `completed`, `failed` or `stopped`. It spans requests, calls, parks and takeovers.
- *Request*: one model call. Say "request", never "turn" or "step". The code overloads both.
- *Call*: a durable `CallRecord` (`tool`, `action`, `hook`, `intent`).
- *Park*: a live run waiting with no runnable call.
- *Stop*: setting a run's stop fence.
- *Steer*, *queue*, *attach*: the three deliveries.
- *Process*: one composed kernel. Every process on a store shares the *host* id.

## Writes

- **One write path.** `refs.set(updates)` is the only mutation. It commits fences, expectations, refs and log appends atomically. Never split one change across two `set` calls.
- **CAS everywhere.** A read-modify-write expects the revision it read and retries on `STALE`. Only a delete that must win, like `live/<run>`, skips `expect`.
- **`changeRun` relies on CAS, not the run fence.** Keep its `expect`. A late write after a stop retries on the stopping record. After an end it throws and never recreates `runs/<id>`.
- **Durable versus derived.** Events ride only on refs under `sessions/<id>`. `FoldState` is derived from the log, and checkpoints are a disposable cache. Streaming `PatchEvent`s are never durable.
- **A held `FoldState` is not a snapshot.** States share their maps.
- **Idempotent ids.** A reused receipt or session id with the same digest replays. A different digest throws. Ids created inside a durable call are recorded in `CallRecord.acquisitions`. Tool call ids are `${run}:${requests}:${providerId}`.
- **Store version.** `STORE_VERSION` counts migration steps. Hosts run `migrateStore`, and core never does. Every bump discards all fold checkpoints, even a schema-only step.
- **Streaming writes.** Opening a part is the only store write while a response streams. Tool calls then run one after another, which keeps replay safe.

## Messages

- **Admission never starts a run.** `send` writes the inbox and a pending receipt. A run starts under the head lease, in the same `set` that lands its prompt.
- **Wakes are hints.** `repair`, `cover` and the presence sweep find owed work.
- **Landing** moves inbox messages onto the head in one `set` that expects inbox and tip. A `deciding` first message blocks run starts.
- **Steer only at boundaries.** The boundaries are run start, and after a response's tool calls finish. `steer` becomes `queue` when the model can't take mid-run input.
- **`queue` never lands in a live run.**
- **`attach` never starts a run.** Three exceptions start one on an idle head whose last run completed: a child's report, a job's report and a late answer to a part.
- **Replace.** An inbox target is revised in place. A landed target rewinds the head, fences the live run and admits the new message, all in one `set`.

## Runs

- **Run fence.** Writes for a run fence on `live/<id>`. A stop sets `stopping`, deletes `live/<id>` and fails open parts in one `set`. A run's call settles only while `runs/<id>` exists.
- **Bounded stop.** A stopped run ends 3 s after its signal aborts, whether or not its turn or a resumed call returned. Its open calls settle stopped first. Whatever still runs keeps running and can no longer write to the run.
- **Only `endRun` retires a run.** In one `set` it deletes `runs/<id>` and `live/<id>`, writes `lastRun`, settles receipts, fails live parts unless completed, and reserves a child's report.
- **Reports are reserved, not sent.** A child's run or a job reserves its report as a `report` receipt in the set that ends it. A wait that takes the end deletes it in the same set. Admission adopts it under its own id, so a second delivery replays. `recover` delivers what a crash left.
- **Pause** aborts only model streams, never tools or leases. A stream aborted without the run's signal retries without spending the retry budget.
- **Durable calls.** A `CallRecord` with a result answers every replay. A `replay: "never"` call found from before this process settles `interrupted`.
- **Restart recovery.** A run survives its process. A takeover without progress counts as an interruption. At 5 the run fails. A graceful close releases its leases.

## Processes

- **Head lease.** One process advances a head. It holds `leases/<head>` for 30 s and renews every 10 s. Claims compare `holder` and `instance`.
- **Presence.** Each process beats `processes/<instance>` by CAS and fences every write on it. A lost beat or a fenced write revokes the process.
- **Takeover.** A peer is dead after 20 s unchanged, while this process wrote within 10 s. It is dead at once when its record names an OS process that this machine says is gone. A process the machine cannot tell about waits out the 20 s.
- **The takeover deletes the dead process's ref in the same `set` as the lease write.** The dead process can't write again. When you change this, run the verify-takeover-fence skill.
- **Jobs** belong to the instance that started them. They are reaped only when it is dead.
- **The reaper signals a job's process group only through `Machine.end`.** That acts only on this boot, and only while the group's leader runs with its recorded start.

## Plugins

- **Session plugins are durable by name.** `plugins.replace(..., { session })` writes `SessionRecord.plugins`: a file by its path, a plugin object by its id.
- **Activation resolves an id** from the objects this process was handed for the session, then from the host's plugins. An id or file it cannot load fails the activation. It never falls back to the default plugins.
- **`advance` reloads a runtime** whose `assigned()` differs from the record, so a takeover runs the stored plugins.
- **Plugins add through data.** A plugin adds items and hooks through its `contribute` and `hooks` fields and through what `activate` returns.
- **`activate` always returns an `Additions` object,** `{}` for nothing. Anything else fails the activation.
- **`PluginApi.registries` only reads.** It has no `add` and no `hook`, so nothing is added after an activation settles. `PluginInstance.add` installs on every host the instance has joined, and on each it joins later.
- **`when`.** A tool, setting, command or prompt section with `when` is in a chat only while `when(chat)` returns `true`. A registry asks at the end of every pass, after derivations. A throw becomes a plugin issue and leaves the item out. `when` never awaits.
- **`Chat` is a snapshot** the runtime reads before a pass: the session's parent and each drafted setting's value. A setting change reads it again and reruns the pass.
- **Never await the runtime's `ready` during activation.** `activationSession` doesn't, because awaiting it deadlocks.
- **A reload swaps in once it loads.** Until then, `runtime` returns the previous one, so commands, parts, approvals and hooks keep working. Build a model request on `newest`, so it waits for what the user last changed.
- **Hook failures.** An observe hook's failure becomes a plugin issue. A transform hook's failure fails the caller. A decide hook's throw or timeout is recorded as its call result and replays.

## Authority

- `ServerHost` and `WireHost` check no authority. The listener in front gates `wire.move`, `hold` and `batch`.
- `gated()` denies only async members. A sync or iterable member, such as `models.login` or `mcp.watch`, calls `gate()` itself.
