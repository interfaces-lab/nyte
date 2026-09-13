# @nyte-ai/core

Core owns durable session state and execution. Hosts compose it with models and plugins; clients consume its SDK and shared client state.

The [kernel guide](src/kernel/README.md) explains persistence and execution. The [design record](../docs/content/docs/design.mdx) describes the wider architecture, and [host](../host/README.md) shows how to compose a runtime.

Public entrypoints are declared in [package.json](package.json): the SDK, plugin contracts, stores, views, and client state. Keep runtime behavior here when terminal, desktop, and remote clients must agree.

`@nyte-ai/core/client` contains the shared session observer and event fold without Node runtime imports. Native and browser clients can pass an `@nyte-ai/client` instance to `SessionObserver`; they must not import the root core entrypoint, which loads host code.

## Session observer

`SessionObserver` keeps one head's `SessionState` current and publishes each change to its subscribers. `subscribe(listener)` returns the function that removes the listener; `state` is the same object until an update replaces it, so a renderer can compare by identity. `start()` resolves with the first snapshot and keeps watching until `close()`; failed reads and watches are reported through `onError` and retried by the observer itself.

Ordinary events fold locally: text, reasoning, tool progress, commits, queue moves, run phases. A full snapshot is taken only for structural change or recovery: a commit the transcript cannot append, a head that moved where no commit followed, a parked call that asks something (the snapshot orders concurrent asks), or a failed watch. Session metadata (the session row, selected and effective inputs, and context status) is core's projection, so after commits, run changes, head moves, facts, and a queued (`config_queued`) or cancelled configuration choice the observer re-reads it through `sessions.metadata`, which carries no transcript, coalescing a batch of events into one read that never delays a fold. `refresh()` asks for that read explicitly, for example after core acknowledges a configuration choice; `selectionVersion` and each update's `selectedVersion` let a client apply selected inputs only for the choice it is still showing.

`state.parked` lists the run's parked calls as the snapshot does, complete records in call order, so a client can show a `SessionSnapshot` from it; `waitingCall(state)` picks the newest ask, the one a composer answers. Background waits park and settle from their events; an ask takes a snapshot, which orders concurrent asks.

## Execution rule

Only user input starts model work. A live run continues on its own authority (tools, retries, checkpoints, boundary landings) until it ends; after that, background results, recovery, reconnects, and ref events can wake a runner but never start a run. Completed background work is stored and joins the next user message once. The rule lives in [`src/kernel/admission.ts`](src/kernel/admission.ts) and is described in the kernel guide under "Who starts model work".

## Delegated work

`task` waits for its report by default. Use `background: true` only for work the parent can continue without. When that report becomes necessary, `wait_task({ jobId })` waits for the existing job and resumes the same parent run. It does not spawn a replacement task or require polling. `stop_task({ jobId })` cancels the task; cancelling a wait alone only stops the observation. Aborting a run still cancels every job that run owns.

## Image reads

The built-in `read` tool keeps small supported images unchanged. Larger images are resized to at most 2,000 pixels per side and a 4.5 MiB base64 payload, following Pi's limits. BMP files are converted to PNG or JPEG. Re-encoding applies EXIF orientation first. Images that cannot be processed are omitted with a text explanation. Processing uses Photon's self-contained WASM build through `@cf-wasm/photon/node`.

## Verification

From the repository root:

```sh
pnpm --dir packages/core test
pnpm --dir packages/core typecheck
```

The test script runs Vitest, then repeats kernel tests with the worker store. Read [AGENTS.md](AGENTS.md) before changing persistence or execution.

## Hosted PostgreSQL storage

`@nyte-ai/core/postgres` provides the same Store contract over shared PostgreSQL. Separate host instances can create, read, and continue the same session. Importing the local SDK or SQLite store does not load the PostgreSQL driver.

```ts
import { openPostgresStore } from "@nyte-ai/core/postgres";

const store = await openPostgresStore({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  watchPollIntervalMs: 250,
});
```

Hosts must validate their connection settings before opening the store. Pool options follow [node-postgres](https://node-postgres.com/apis/pool). The factory initializes the `nyte_*` tables and owns the connection pool. `store.close()` closes its connections and watches; sessions remain in PostgreSQL. Idle connection errors produce a Node warning, or go to the host's `onPoolError` callback when provided.

For platform pool management, create a `pg.Pool`, attach the platform's lifecycle handler, then pass `postgresDatabase(pool)` to `new PostgresStore(...)` and await `store.initialize()`. The host owns idle pool error reporting in this form; closing the store still ends the pool.

Ref CAS, lease checks, and their events commit together under a session row lock. Lease expiry uses the database clock. Event watches page from the durable cursor and poll every 250 ms by default, so writes from other instances appear without sticky routing or a dedicated PostgreSQL notification connection. Polling occurs only while a watch is active. A trimmed cursor requires a snapshot, just as with SQLite.

Storage does not keep a serverless runner alive. A hosted deployment must schedule execution and recovery separately. The [Vercel example](../demo/server/vercel/README.md) composes those concerns.

Schedulers call the host-only `sdk.advance({ sessionId, head?, signal? })` method. Each call performs one leased kernel step without attaching a runner or sleeping through a retry. It returns `continue`, `idle`, `finished`, `fenced`, `waiting` with an optional `until`, `retry` with `at`, or `busy` with the lease expiry in `until`. The scheduler owns subsequent calls and durable wakeups. The result contains no provider response or kernel Run object. The method uses the same activation, workspace, model, and tool guards as the local runner, and watches for remote run cancellation while the step is active. Closing the SDK aborts and drains active steps.

`test/postgres-store.test.ts` uses real embedded PostgreSQL through PGlite to verify shared handles, CAS, rollback, fencing, event replay, corruption checks, and closing and reopening the database. PGlite serializes transactions; a deployment test against PostgreSQL is still needed to verify concurrent network connections and platform lifecycle behavior.

Set `NYTE_TEST_POSTGRES_URL` to a test database and run `pnpm --dir packages/core exec vitest run test/postgres-network.test.ts` to check competing writes through separate network pools and reconnect persistence. This test creates and deletes its own session. It also initializes Nyte's schema if the database is new.

## Workspace search

Core owns ripgrep discovery and execution through `@nyte-ai/core/ripgrep`. It uses system `rg` 12 or later, then the Nyte cache, otherwise downloads ripgrep 15.1.0 for the current platform. Downloads are checked against pinned SHA-256 digests before extraction. The cache lives at `$NYTE_HOME/bin`, or `~/.nyte/bin` by default. Cancelling one search does not cancel a shared installation; a failed installation can be retried.

`findRipgrepFiles` enumerates eligible files. `grepRipgrep` streams validated JSON matches with UTF-8 byte offsets and takes exactly one source, a directory or text on stdin. Calls disable user ripgrep configuration, use the default non-backtracking regex engine, and bound output. Partial read failures, such as unreadable directories, keep the records ripgrep already produced. No Electron API is required.

The search design follows [OpenCode v2](https://github.com/anomalyco/opencode/tree/0643a5638e0cd02234e73f176771527d7600faf7/packages/core/src/ripgrep). See the [shared third-party notices](../../THIRD-PARTY-NOTICES.md#opencode-anomalycoopencode).

`@nyte-ai/core/files` owns workspace reads, version-checked saves, and `searchWorkspaceFiles`, as well as filename discovery. Content search owns draft precedence, confinement, strict UTF-8/binary/2 MB file checks, skipped counts, UTF-16 selections, and bounded snippets. Hosts validate requests with `WorkspaceSearchSchema` and add their own cancellation IDs. Desktop only dispatches the parsed request and maps core errors to IPC errors.

Content search keeps Nyte's validated-byte behavior: disk batches use private temporary snapshots, removed after the subprocess closes; drafts use stdin. This differs from OpenCode's direct workspace grep. Removing the snapshots would also require changing validation and skipped-count behavior. Searches are bounded by matches, 50 MB of scanned text, subprocess output, and five seconds, excluding binary installation. Regex validation runs even when filters select no files; literal searches need no validation subprocess.

`searchFiles` and `discoverMentionFiles` provide filename discovery. Both Desktop and TUI use ripgrep for file discovery and `fuzzysort` for filename ranking. There is no native filename index or platform-specific search binding. Home-directory scans exclude hidden files and protected macOS and Windows folders, including when the home path is a symlink. Enumeration is bounded at 100,000 files; mention lists return at most 5,000 entries.

Ripgrep owns ignore-file behavior. Linked ignore files are read but not offered as mention candidates. Directory results are derived from discovered files, so empty directories are not guaranteed.
