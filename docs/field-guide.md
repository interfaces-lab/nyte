# Field guide: host, core, client

This is the map of how a message travels through Nyte: from a client, over the wire, into the host, through the kernel, and back to every client that watches the chat. Read it before changing anything on that path. It says where each step lives, which clocks run, what is deliberately odd, and what is known to be wrong and not yet fixed.

Three docs go deeper. [core-structure.md](core-structure.md) lists core's layers and where code goes. [host-protocol/README.md](host-protocol/README.md) is the wire's contract. [app-structure.md](app-structure.md) maps the desktop app. [glossary.md](glossary.md) holds the one name each concept has.

## The shape

Seven packages publish as the SDK, and each depends only on the ones to its left: `schema` → `ai` → `core` → `plugin`, `protocol` → `host` → `sdk`. The clients (`app`, `tui`, `mobile`, and `desktop`'s renderer) import `@nyte-ai/sdk/client` and never `@nyte-ai/host`.

| Package | Is | Runs |
| --- | --- | --- |
| `schema` | Every type that crosses a boundary: messages, rows, events, the operations table | Everywhere |
| `ai` | Models, providers, credentials, streaming | Host |
| `core` | The kernel: sessions, runs, the log, the fold, plugins. No `node:*` imports | Host, and the browser as types and stores |
| `plugin` | Plugin contracts and the plugins Nyte ships | Host |
| `protocol` | The codec for the operations table, the wire's framing, and the client's transports | Both sides |
| `host` | A Node host: the stores, the local machine, the listener | Host |
| `sdk` | `sdk.open`, `sdk.connect`, and `openHost` with its live stores | Both sides |
| `service` | The one host process a home has: the lock, `host.json`, retiring an old host | Host |

One home (`~/.nyte`, or `NYTE_HOME`) has one host. Whoever takes `host.lock` serves; everything else is its client.

```
launchd, or the first `nyte` that finds no host
  └─ host process                       service/src/serve-host.ts
       main thread: host.lock, host.json, host-address.json, logs
       host-worker thread               service/src/host-worker.ts → sdk.open
         kernel + store (SQLite reader and checkpoint workers)
         listens on host.sock (owner, no token) and 127.0.0.1:<port> (Bearer)
         children: MCP servers, ptys and commands, the tailnet sidecar

desktop main ── host.sock ──► host      two connections, plus one proxied per window
renderer ── MessagePort ──► desktop main ── host.sock ──► host
nyte (TUI) ── TCP + token ──► host
phone ── tailnet, tunnel or LAN ──► host
```

Sessions run in the host. Quitting the desktop app or the TUI stops neither a run nor a job.

## Who owns what

Every rule on this path comes from five ownerships. When a change feels awkward, it is usually putting something on the wrong side of one of them.

| | Owns | Never |
| --- | --- | --- |
| Store | The only durable truth: refs and the log, changed by one operation, `refs.set` | Decides anything |
| Core | Every decision: admission, order, runs, tools, what a row holds. State is the fold of the log | Touches the machine, or knows a transport |
| Host | The machine and the door: files, git, processes, keys, the listener, who is calling, when to push | Decides what a chat is. It calls core through a `Connection`, as a client would |
| SDK | The link: two connections, the send journal, the live stores, resume, `live.chat` | Derives a fact the host owns |
| Client | What the person sees and has not sent: drafts, scroll, pacing, layout | Keeps a copy of the host's truth that it could not throw away and read again |

What follows from them:

- **The host decides; a client asks and is told.** A client sends an operation and receives whole rows by id. It replaces what it holds. It never replays events and never computes a row, so there is no reducer on the client and no second place for a rule to drift. A client that needs a fact it cannot read from a row is missing a field on the row.
- **A client can vanish at any moment.** Runs, jobs, queued messages and waits live in the host, and nothing a client holds is needed for a run to finish. The one thing that exists only in a client is what the person typed and has not delivered, so the journal writes it before it posts.
- **Written, then shown.** A row a client draws came from the log through the fold. Streamed text is the one exception: it rides beside the rows as appends and is replaced by the stored part when the part settles.
- **A request says how it recovers.** A send carries an id and leaves a receipt, so sending it twice replays the first. A read resumes from a seq. An operation that must not be repeated says `recovery: "never"`. An error says what to do in its `code`, and `retry` when the answer is only "not yet"; no client reads a message to decide.
- **The link's health and the data's freshness are two facts.** `health` says whether the socket is up. Each live store's `freshness` says whether its rows are current. A screen keeps drawing stale rows and says so; it does not blank them.
- **One table is the contract.** `OPERATIONS` in `schema` gives each operation its name, authority, scope, input, output, kind and recovery. The host's binding, the client's codec, the MCP surface and the reference pages are all read from it, and `pnpm operations` fails when a row changes without a revision.
- **Core never imports the machine.** The host hands it providers for files, processes, git and stores, which is what lets the same kernel run in a Node host, a Durable Object and a test.

## Follow one message

Each step names the file to open. Paths are under `packages/`.

**1. The client sends.** A composer calls `session.send`. In the SDK that is the send journal: `journalLoop.send` in `sdk/src/send/journal.ts` writes the message to the client's journal first, queues it behind the previous send on the same head, and posts `head.send`. The journal is why a message typed offline is sent once the host is back, and it retries `unavailable` and `stale` until the link closes. Each client keeps it where a restart finds it, keyed by host and receipt id: the app in `localStorage` (`app/src/data/send-journal.ts`), the TUI in files under the home (`tui/src/send-journal.ts`), mobile in MMKV; the next `connect` to that host resends what is left, and a resend under the same receipt id is a replay, so two windows that load one entry send it once. An entry older than a day is sent only if the host already has its receipt (`receipt.status`); otherwise it stays journaled and drawn as an unsent row whose retry reason says it waited too long, listed by `unsentSends(...).expired()`, until `resend` sends it again or `receipt.stop` removes it. `withUnsent` lays journaled messages over the view until the host's rows show them.

**2. It crosses as an HTTP request.** `createTransport` in `protocol/src/client/transport.ts` encodes the input against the operation's schema and posts it. Every client holds two connections to its host, and this is the first: `sdk.connect` (`sdk/src/connection/`), which carries calls, the host-view watch and the journal over HTTP. The second is `openHost` (`sdk/src/live/host-connection.ts`), one WebSocket that carries what the host pushes.

**3. The host authenticates and decodes.** `host/src/serve/listen.ts` is the Node server; `listen-fetch.ts` decides who is calling (`identify`: a pairing code, the listener's token, a device token, or the local socket's owner); `handler.ts` checks the operation's `local` and `authority`, decodes the body, and calls the closure `binding.ts` built for that operation over a core `Connection`.

**4. Admission writes, and starts nothing.** `send` in `core/src/engine/admission.ts` hashes the request, replays a receipt it has seen, runs the `before_send` hook, and commits one `refs.set`: the head's inbox with the message, and a pending receipt. It then wakes the head. Admission never starts a run.

**5. Every write goes through `commit`.** `core/src/watch/commit.ts` adds the run's fence, calls the store's `refs.set`, and publishes the events the set logged. `refs.set` is the only mutation the store has: fences, expectations, refs and log appends in one transaction (`host/src/store/sqlite.ts`). Reads that modify expect the revision they read and retry on `stale`.

**6. The log becomes state.** `publishSet` hands the logged events to the publisher, which puts them on the session's bus in seq order, filling a gap from the log. The session's fold (`createFoldCache` in `core/src/watch/watch.ts`) applies each with `fold()` from `core/src/fold/fold.ts` and tells its holders. `FoldState` is derived: a checkpoint is a cache of it, and deleting every checkpoint loses nothing.

**7. The driver claims the head and starts the run.** `advance` in `core/src/drive/execution.ts` takes the head's lease, and in one set lands the inbox onto the head and creates the run. It renews the lease every 10 s while `turn` runs. With several processes on one store, presence decides who may write: each process beats its own ref and fences every write on it.

**8. The turn talks to the model.** `core/src/agent/turn.ts` builds the request from the head's path (`transcript.ts`), compacts when the estimate passes the threshold (`compaction.ts`), and streams. Each delta appends to an open part and goes out as a patch on the bus (`publishPatch` in `engine/runs.ts`). Patches are never written to the store; the part's text is, when the part settles.

**9. Tools are durable calls.** When a response ends, one set settles its parts and writes an intent for each tool call, with the id `<run>:<request>:<provider id>`. `executeCall` in `agent/tool-runner.ts` runs each through the `before_tool` hook and `runStep` (`engine/durable.ts`), which records the result so a replay answers from it. The tool itself reaches the machine through the environment the host supplied: `host/src/local/process` for commands and jobs, `local/files`, `local/git`, and a snapshot from `local/snapshots` before and after any tool with effects. After the tools, the next request starts; a steer lands only at that boundary.

**10. The host pushes.** A client that subscribed to `session/<id>` holds a fold attachment (`core/src/api/session-attachment.ts`). `serveSession` in `host/src/serve/socket.ts` gathers what changed, 8 ms after the first unsent change and at most every 33 ms, and sends one `change` with each touched row whole (`changesAfter` in `core/src/watch/window.ts`), then the streamed text as appends on the text channel. The host's list of sessions is its own scope, fed by `core/src/api/sessions-feed.ts`.

**11. The SDK applies rows by id.** `sdk/src/live/head.ts` feeds each change to `openSessionStore` (`protocol/src/client/session-store.ts`), which replaces rows and splices the head's order; there is no diffing on either side. `headView` in `sdk/src/view/head-view.ts` projects the snapshot, and `withStreamedText` lays the live text over a part whose row is older. `live.chat` (`sdk/src/live/chat.ts`) holds the three: the head store, the unsent sends and the streamed text, laid into one snapshot that changes only when what a client draws does.

**12. The client draws.** Each client adapts a `live.chat` store. The app does it in `app/src/data/chat-store.ts`, pages history over it and paces text per frame (`paced-text.ts`); the transcript patches the one row that changed. The TUI does it in `tui/src/live-host.ts` and dispatches a `view` message to its reducer. Mobile does it in `mobile/src/connection/live.ts`.

**13. The run ends in one set.** `endRun` in `core/src/engine/runs.ts` deletes the run, writes the head's last run, settles the receipts of the messages it landed, fails any part still live, and for a child session reserves its answer as a `report` receipt `<run>:report` under the parent. The journal drops its entry once a view contains the message. A wait that takes the end deletes the report in the set that takes it; otherwise `deliverReport` (`engine/reports.ts`) admits it to the parent as an attached message under that receipt id, and `recover` delivers one a crash left reserved. A job's end reserves its report the same way.

A reconnect skips most of this. The SDK keeps its rows and seq, subscribes again, and resumes: `head.read` with `resume: { seq, from }` answers with the rows that changed and the window's order.

## Where things live

Core's layers are in [core-structure.md](core-structure.md); the two that matter most here are `fold/`, which only turns the log into state, and `watch/` above it, which publishes, caches and reads folds.

### host/src

| Folder | Owns |
| --- | --- |
| `open.ts`, `index.ts` | `openHost`, which composes a Node host: the store, models, the builtin plugins, the local provider, the MCP hub, the listener |
| `store/` | The three stores (`sqlite.ts` with its reader and checkpoint workers, `postgres.ts`, `durable-object.ts`), what they share (`rows.ts`, `session-index.ts`) and the cleanup of objects no ref holds (`compaction.ts`) |
| `serve/` | Everything between a socket and a core `Connection`: `listen.ts` (Node HTTP, the unix socket, the upgrade), `listen-fetch.ts` (who is calling), `handler.ts` (one operation over HTTP), `stream-server.ts` (the multiplexed HTTP stream channel), `socket.ts` (the WebSocket's two channels), `binding.ts` (operation name → core call), `clients.ts` (clients as principals), `tailnet.ts`, `media.ts` |
| `local/` | The local environment provider. `process/` runs commands, jobs and ptys; `files/` reads, writes, walks and watches; `git/` is git, GitHub and worktrees; `snapshots/` is the tree before and after a tool; `migrations/` runs once at open |
| `mcp-client/` | The hub that connects to MCP servers, their OAuth and their tools |
| `mcp-server/` | The host as an MCP server and its own authorization server |
| `keys/` | The host's identity and its signature, the key file, secrets, and sealed model credentials |
| `usage/` | Usage reports: Nyte's own from the log (`store.ts`), other agents' history files (`local-history.ts`), and the scanner and its worker |
| `plugins/`, `images/` | The plugin file loader and view compiler; image decoding in a worker |

### protocol/src

| Folder | Owns |
| --- | --- |
| `operations/` | What an operation is and how its values cross: `declarations.ts`, `codec.ts`, `digest.ts` |
| `wire/` | Framing both sides share: errors, SSE and octet frames (`wire.ts`), `json.ts`, the stream channel's envelope and buffer, the socket's frame checks |
| `client/` | The client's transports (`transport.ts` for HTTP, `stream-client.ts`, `socket-client.ts`) and the stores that apply events (`session-store.ts`, `directory-store.ts`) |

### sdk/src

| Folder | Owns |
| --- | --- |
| `index.ts`, `index.web.ts`, `index.client.ts` | The three entries: Node (`sdk.open` and `sdk.connect`), browser and React Native (`open` throws), and the client entry with the socket |
| `connection/` | `sdk.connect`: the `Connection` over HTTP, its link state and retries (`rows.ts`), and the handles for workspaces, parts, receipts and logins |
| `send/` | The send journal and the unsent overlay |
| `live/` | `openHost`: the socket supervisor and its stores for a head, a part, the session list and the connected clients |
| `view/` | Projections a client composes: `headView`, streamed text, history paging, paint tracing |

## Processes and the files between them

| File under the home | Holds | Written by |
| --- | --- | --- |
| `host.lock` | Nothing; a SQLite file held for its lock, which the kernel releases when the process dies | The serving host's main thread |
| `host.json` | `{ url, token, pid, socket }` of the serving host | `publishHost`, by rename, after it listens; removed first on stop and on retire |
| `host-address.json` | The port and token, so they survive a restart and clients resume | Every start |
| `host.sock` | The local socket; the one route that answers `local` operations | The worker; a stale one is replaced only if nothing answers on it |
| `retire/<pid>` | A client's request that an older host retire, with its supervisor kind | `requestRetire`, by a client whose version supersedes the host's; the host checks every 10 s and retires when idle |
| `nyte.db` | The store | The host |
| `secret.key` | The key that seals credentials, mode 0600 | First open |
| `journal/<host and receipt>.json` | One message a `nyte` command sent and the host hasn't shown yet, mode 0600 | `fileJournal`, by rename; removed once a view shows the message |

A client finds the host with `findRunningHost`: read `host.json`, check the pid, and ask the address, which must answer with the host header. A host that finds the lock held stands by (the desktop's) or exits (a TUI's). A `nyte` that finds no host starts one only while nobody holds the lock.

## Interrupts

What happens when something cuts across a run, and the function that decides it. All three clients draw the host's rows, so they agree unless the last column says otherwise.

| Interrupt | What happens | Decided in | Clients differ |
| --- | --- | --- | --- |
| Stop | The client changes nothing until the host's row says stopping. Partial text and settled tool results stay. A running command gets SIGTERM, then SIGKILL after 2 s. A subagent the run awaits (`task`) is stopped; ones it started (`create`) and background jobs go on. Queued messages are kept and the next starts at once. During an approval the run ends in about 25 ms and the approval closes | `stopRun` in `core/src/engine/fence.ts`, then `settleLive` in `drive/execution.ts`, then `endRun` | No |
| A message during a run | It steers or queues, by preference and key. A steer lands at the next tool boundary, and becomes a queue when the model takes no mid-run input or the run is stopping. Editing a queued message holds it; removing withdraws it | `send` and `reviseQueued` in `engine/admission.ts`, `engine/send-schedule.ts`, `boundary` in `drive/execution.ts`, `api/hold.ts` | No |
| The person looks elsewhere | The run goes on. Unread is commits after the principal's `seenThrough`, and a chat is seen only while shown in a focused window | Each client's mark-seen, then `advanceSeen` in `core/src/watch/seen.ts` | No |
| History changes under a run | Editing a landed message rewinds the branch and fences the live run in one set. Moving to another branch and forking refuse while the chat is busy | `engine/admission.ts`, `engine/stop.ts`, `engine/move.ts`, `engine/fork.ts` | No |
| The run waits on a person | An approval parks with no timeout and survives a restart. The first answer wins; a second gets "already answered", one after Stop gets "no longer waiting". A question waits 1 min, then the run goes on and a late answer arrives as a message | `plugin/src/approvals/approvals.ts`, `plugin/src/question/question.ts` | Mobile shows a waiting approval and cannot answer it |
| The link drops | The socket reconnects from 1 s doubling to 30 s and resumes from its seq; a path that dies silently is found in 15 s while a call waits and 40 s when idle. Sends are journaled and sent again; Stop and an approval's answer are not | `protocol/src/client/socket-client.ts`, `sdk/src/live/host-connection.ts`, `sdk/src/send/journal.ts` | No |
| The model fails | A retryable error shows retrying with its reason and a countdown. Otherwise the run ends failed with the message. A context that is too long compacts once, then fails | `core/src/agent/agent-loop.ts`, `endRun` | No |
| The client goes away | The run goes on. On return the client reads the tail and shows unread, and a message it had not delivered is sent from its journal | Nothing decides the first: that is the rule. `sdk/src/send/journal.ts` | No |
| The host stops | Told to stop: the command is killed, its call settles interrupted, and the run resumes in about 100 ms on the next host. Killed: the run looks live for 20 s, then the call settles interrupted and the run resumes | `service/src/outdated-host.ts`, `engine/presence.ts`, `recover` in `drive/execution.ts`, `reapJobs` in `engine/jobs.ts` | No |
| The chat changes elsewhere | Another client's rows arrive like any others. A subagent's report starts a run in its parent only if the parent's last run completed. Delete is refused while a run is live | `core/src/api/session.ts` | The app closes a chat deleted elsewhere. The TUI's store goes stale with `unknown`, and the TUI does not yet act on it |

## Clocks

| Clock | Value | Where |
| --- | --- | --- |
| Presence beat; a peer is dead after | 5 s; 20 s unchanged while this process wrote within 10 s | `core/src/engine/presence.ts` |
| Head lease; renewed every | 30 s; 10 s | `LEASE_MS`, `RENEW_MS` in `engine/durable.ts` |
| Driver sweep for owed work | 5 s | `drive/execution.ts` |
| Store poll for another process's commits | 500 ms, one `PRAGMA data_version` when idle | `host/src/open.ts`, `core/src/watch/watch.ts` |
| A fold nobody holds lingers | 30 s | `watch/watch.ts` |
| Checkpoint after a run ends | 1 s later, once 1,024 events or 1 MiB of log have built up | `fold/checkpoint.ts` |
| Hook budget | 5 s a handler, 300 s for `before_compaction` | `extend/hooks.ts` |
| Idle plugin runtime closed after; sweep | 10 min; 60 s | `core/src/compose.ts` |
| Client hold on a queued message | 20 s, renewed every 5 s | `contract/session.ts`, `api/hold.ts` |
| A journaled message is no longer sent unasked after | 24 h | `EXPIRES_MS` in `sdk/src/send/journal.ts` |
| Push gather; shortest time between pushes | 8 ms; 33 ms | `host/src/serve/socket.ts` |
| Socket ping; closed after | 30 s; 3 missed pongs | `serve/socket.ts` |
| Stream channel ping; the client counts it lost after | 15 s; 45 s without a byte | `serve/stream-server.ts`, `protocol/src/client/stream-client.ts` |
| Socket ticket | 30 s, one socket | `serve/listen-fetch.ts` |
| Frame limit; event backlog | 1 MiB; 8 MiB | `schema/src/socket.ts` |
| Client action timeout | 10 s default, 30 s at most, 16 waiting | `serve/clients.ts` |
| SQLite busy budget for a write | 5 s, retried off the event loop | `store/sqlite.ts` |
| Cleanup of unreferenced objects | 30 s after open, then hourly, objects over 1 h old | `store/compaction.ts` |
| MCP reconnect | 1 s doubling to 30 s; reset after 30 s connected | `mcp-client/hub.ts` |
| Job output kept | 1 MiB ring | `local/process/jobs.ts` |
| Socket reconnect | 1 s doubling to 30 s, with jitter; `retry()` skips the wait | `socketRetryDelay` in `sdk/src/live/store.ts` |
| Socket open; probe after quiet; lost after a probe | 10 s; 30 s idle, 5 s while a call or the welcome is owed; 10 s without a frame, 2 s for `retry()` | `protocol/src/client/socket-client.ts` |
| HTTP call timeout | 30 s for a query or a receipt; none for commands, streams, watches, uploads and waits | `protocol/src/client/transport.ts` |
| HTTP retry | 50 ms, then 250 ms doubling to 10 s, no jitter | `httpRetryDelay` in `sdk/src/connection/rows.ts` |
| Chat tail on open | 40 in the app (240 reopening), 200 in the TUI and on mobile | each client |
| Host stop grace; `nyte host` exit deadline | 10 s; 12 s | `service/src/host-thread.ts`, `tui/src/host-command.ts` |
| Desktop main's redial of `host.sock` | 100 ms, 250 ms, 500 ms, then every 1 s; a wake skips the wait | `HostLink` in `desktop/src/host/host-link.ts` |

## The wire's size

`pnpm --dir packages/bench bench:wire` measures six steps through the real client, and [its README](../packages/bench/README.md#wire-size) holds the table against t3code, the reference we size against. The rules the numbers come from:

- **Loopback is never compressed.** The desktop app and the TUI are on loopback, where bytes are free and compression is CPU. What matters there is how many frames a client has to parse: a streamed reply was 458, and gathering made it 86.
- **Off loopback, everything repeats, so one compression context does the work.** The socket negotiates permessage-deflate with context takeover, and a 141-byte append costs about 20 bytes after the first. A JSON answer over HTTP is gzipped from 1 KiB.
- **Rows go whole, once.** A change carries each touched row in full. Gathering is what keeps a row from going twice when two events touch it a millisecond apart.
- **Streamed text is appends, never the text so far.**
- **History is paged, and the first window is small.** The app opens a chat on 40 messages.

What a new feature should not do: put a field on a row that changes at a different rate from the rest of the row (the head's facts are split into `heads`, `settings` and `usage` for this), send a list where the client could derive it from rows it holds, or add a live event that grows with the number of chats.

## Correct, and surprising

- **Two connections, two retry curves.** `sdk.connect` retries HTTP from 50 ms without jitter (`httpRetryDelay` in `rows.ts`): a retry is one request. `openHost` redials the socket from 1 s with jitter (`socketRetryDelay`): a redial is a resume of every scope, and a host restart drops every client at once. Neither waits on the other's health.
- **The client finds a dead link itself.** The host pings every 30 s, but no WebSocket API shows a ping to the page, so the socket asks the host a call (`events.unsubscribe` with no scopes) after a quiet spell and counts itself lost when nothing comes back. An idle client sends two probes a minute, as often as the host pings.
- **Two things are called `openHost`.** `@nyte-ai/host` exports the one that composes a host in this process; `@nyte-ai/sdk/client` exports the one that opens a socket to a host.
- **An `unavailable` is usually an answer, not an outage.** More than sixty host paths answer it on purpose. Only a transport that failed, or an answer with `retry` set, counts as a lost link (`linkLost`). The host sets `retry` on the answers that mean come back later: a listener that is closed, a host that disconnected its clients, and a host still opening. The client reads the field, never the message.
- **A change can arrive at a seq the client already holds.** A job's, a child's or a page's state, and a session's activation, change without a log event, and ride the seq they joined. Stores drop only a change older than their seq.
- **Seqs skip.** One gathered change covers several log events. No row is missed.
- **A client older than revision 23 gets one change per event.** It takes no fragments, and a gathered frame could pass the frame limit.
- **`FOLD_CODE` is a hash of the files in `fold/`.** Any edit there, a comment included, rebuilds every stored checkpoint once.
- **Session plugins are not durable.** `plugins.replace(..., { session })` lives in memory, and a restart drops it.
- **A chat nobody uses loses its plugin runtime after 10 minutes.** The sweep in `core/src/compose.ts` closes it with its scan, its place on the folder watch, its environment attachment and its MCP subscription. It stays while a run drives, a client has the chat open, a job runs, a part waits for an answer, or the chat has session plugins. A parked run keeps none; whatever wakes it builds a new one. The next use scans again and runs each plugin's `activate` again, so what a plugin keeps in memory per chat is gone, and a workspace whose last chat left reconnects its MCP servers.
- **Context files are read on every model request**, 34 file reads for a shallow folder, so an edit to `AGENTS.md` reaches the next request of a running turn.
- **The local provider does no containment on reads and writes.** A path outside the workspace is used as given and reported as `scope`. Moves, copies, `mkdir` and trash do refuse to leave the folder, by real path.
- **A terminal at its prompt counts as running.** An outdated host with one open does not retire.
- **Only a newer build retires a host.** The dev, production and bench builds share `~/.nyte`. A desktop app asks the host to retire only when its version supersedes the host's by semver (`supersedes` in `service/src/outdated-host.ts`) and its own host takes over: launchd starts its job again, or the job stands by on the lock (`retiresHost` in `desktop/src/main/host-status.ts`). The bench build, whose host no job of its own runs, never asks. A host on the same version with other operations stays until the person restarts it from the host build notice.
- **`nyte host` runs on Bun and cannot open a pty.** Terminals open on the desktop app's host.
- **The Durable Object runs the SQLite migration dialect.** Its table list is SQLite's, and a row is capped at 2 MB.
- **Regenerating `identity.key` makes every pinned client pair again.** The host keeps its id, which lives in the store, but `expect` pins the key, so each client gets `stale` until it saves the new one.
- **A send with `replace` and its own id leaves a second receipt** that points at the first and is never settled. It is not pending work.

## Known gaps

These are real and not fixed. Each names what it would take.

- **A `task` child can reach its parent twice.** A child that ends before its parent's `task` parks the wait has its report delivered and its answer returned by `task`, and a child stopped with its parent reports its stopped end. Holding a child's report until the call that started it settles would cover both.
- **A migration loads the whole store into memory.**
- **Pointer receipts written before the index stopped counting them stay in `pending_work`** until a migration rebuilds the index. They cost a sweep visit each, as before.
- **Search walks the session index when a name is rare.** `sessions.read` with `query` matches a lower-cased name column in activity order until `limit` match, about half a millisecond at 5,000 chats. Pinned chats read from their own index whatever the count. A trigram index would make search independent of the count.
- **A client newer than its host gets `invalid` for a filter the host does not know.** A phone at revision 25 against a Mac at 24 shows no search results and no older pinned chats until the Mac updates.
- **A client cannot tell which session a text frame belongs to.** Every open chat store takes every part streaming on the socket into its text map. A frame for a part its view doesn't hold notifies no one, but its entry stays until the store closes. A session on the frame would let the store drop it.
- **A command outlives a host that was killed.** Its process group is reparented and keeps running while its call reads interrupted and the run resumes, so the model may start it again beside the orphan. Nothing in a client can stop it. Fixing it means storing the pid, group and start time on the job and killing a group whose holder is dead.
- **A killed host's run looks live for 20 s** on the next host, and a Stop in that window shows stopping for as long. The wait is the presence lapse; shortening it for a process on the same machine whose pid is gone means changing the takeover fence.
- **Stop waits for a tool that ignores its abort signal**, and the queue waits behind it. The built-in command and MCP tools honour the signal; a plugin's tool may not.
- **A command over HTTP has no deadline.** A query or a receipt fails after 30 s unanswered, but the host runs some commands for as long as they take, so a Stop sent into a dead path stays pending until the person presses it again.
- **An expired journal entry has no screen.** After a day unsent it is kept and shown as the row a failing send gets, whose text says it is retrying. `unsentSends(...).expired()`, `resend` and the receipt's `stop` are there for a client to offer send and remove.
- **A version mismatch is read from the socket's close reason.** The host closes with 1008 and a sentence, and the client matches its first words. A typed frame before the close needs a revision that both sides can rely on.
- **Mobile cannot answer an approval.** It shows that the run waits.
- **The TUI and mobile keep showing a chat that was deleted elsewhere.** Their head store now goes stale with `unknown`; neither acts on it, and neither reads `archived`.
- **A resume resends the window's order** when nothing moved: 1.6 KB of ids a chat, the largest part of a reconnect.
- **The HTTP stream channel wraps base64 in JSON in SSE.** A frame kind without the inner layers needs a revision bump.
- **A stalled git remote or formatter hangs its call.** `git push`, `blame` and the formatter run have no timeout.
- **A lease's holder notices a lapse up to one renewal late.** With presence the 20 s rule and the process fence cover it; changing it means running the takeover-fence checks.

## Before you change this path

- `pnpm --dir packages/<name> test` for the package; `pnpm check` for format, lint, layers, cycles and types.
- A wire type or a stored record: `pnpm operations`, then `pnpm --dir packages/host check:store`.
- Presence, claims, fences or SQLite's `refs.set`: the verify-takeover-fence skill, both checks.
- Anything a client receives: `pnpm --dir packages/bench bench:wire:gate`, and `--remote` to see what crosses a network.
- Anything in `fold/`: update `FOLD_CODE` to the hash the fold-code test reports.
