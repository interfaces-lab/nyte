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

desktop main ── host.sock ──► host      three connections, plus one proxied per window
renderer ── MessagePort ──► desktop main ── host.sock ──► host
nyte (TUI) ── TCP + token ──► host
phone ── tailnet, tunnel or LAN ──► host
```

Sessions run in the host. Quitting the desktop app or the TUI stops neither a run nor a job.

## Follow one message

Each step names the file to open. Paths are under `packages/`.

**1. The client sends.** A composer calls `session.send`. In the SDK that is the send journal: `journalLoop.send` in `sdk/src/send/journal.ts` writes the message to the client's journal first, queues it behind the previous send on the same head, and posts `head.send`. The journal is why a message typed offline is sent once the host is back, and it retries `unavailable` and `stale` until the link closes. `withUnsent` lays journaled messages over the view until the host's rows show them.

**2. It crosses as an HTTP request.** `createTransport` in `protocol/src/client/transport.ts` encodes the input against the operation's schema and posts it. Every client holds two connections to its host, and this is the first: `sdk.connect` (`sdk/src/connection/`), which carries calls, the host-view watch and the journal over HTTP. The second is `openHost` (`sdk/src/live/host-connection.ts`), one WebSocket that carries what the host pushes.

**3. The host authenticates and decodes.** `host/src/serve/listen.ts` is the Node server; `listen-fetch.ts` decides who is calling (`identify`: a pairing code, the listener's token, a device token, or the local socket's owner); `handler.ts` checks the operation's `local` and `authority`, decodes the body, and calls the closure `binding.ts` built for that operation over a core `Connection`.

**4. Admission writes, and starts nothing.** `send` in `core/src/engine/admission.ts` hashes the request, replays a receipt it has seen, runs the `before_send` hook, and commits one `refs.set`: the head's inbox with the message, and a pending receipt. It then wakes the head. Admission never starts a run.

**5. Every write goes through `commit`.** `core/src/watch/commit.ts` adds the run's fence, calls the store's `refs.set`, and publishes the events the set logged. `refs.set` is the only mutation the store has: fences, expectations, refs and log appends in one transaction (`host/src/store/sqlite.ts`). Reads that modify expect the revision they read and retry on `stale`.

**6. The log becomes state.** `publishSet` hands the logged events to the publisher, which puts them on the session's bus in seq order, filling a gap from the log. The session's fold (`createFoldCache` in `core/src/watch/watch.ts`) applies each with `fold()` from `core/src/fold/fold.ts` and tells its holders. `FoldState` is derived: a checkpoint is a cache of it, and deleting every checkpoint loses nothing.

**7. The driver claims the head and starts the run.** `advance` in `core/src/drive/execution.ts` takes the head's lease, and in one set lands the inbox onto the head and creates the run. It renews the lease every 10 s while `turn` runs. With several processes on one store, presence decides who may write: each process beats its own ref and fences every write on it.

**8. The turn talks to the model.** `core/src/agent/turn.ts` builds the request from the head's path (`transcript.ts`), compacts when the estimate passes the threshold (`compaction.ts`), and streams. Each delta appends to an open part and goes out as a patch on the bus (`publishPatch` in `engine/runs.ts`). Patches are never written to the store; the part's text is, when the part settles.

**9. Tools are durable calls.** When a response ends, one set settles its parts and writes an intent for each tool call, with the id `<run>:<request>:<provider id>`. `executeCall` in `agent/tool-runner.ts` runs each through the `before_tool` hook and `runStep` (`engine/durable.ts`), which records the result so a replay answers from it. The tool itself reaches the machine through the environment the host supplied: `host/src/local/process` for commands and jobs, `local/files`, `local/git`, and a snapshot from `local/snapshots` before and after any tool with effects. After the tools, the next request starts; a steer lands only at that boundary.

**10. The host pushes.** A client that subscribed to `session/<id>` holds a fold attachment (`core/src/api/session-attachment.ts`). `serveSession` in `host/src/serve/socket.ts` gathers what changed, 8 ms after the first unsent change and at most every 33 ms, and sends one `change` with each touched row whole (`changesAfter` in `core/src/watch/window.ts`), then the streamed text as appends on the text channel. The host's list of sessions is its own scope, fed by `core/src/api/sessions-feed.ts`.

**11. The SDK applies rows by id.** `sdk/src/live/head.ts` feeds each change to `openSessionStore` (`protocol/src/client/session-store.ts`), which replaces rows and splices the head's order; there is no diffing on either side. `headView` in `sdk/src/view/head-view.ts` projects the snapshot, and `withStreamedText` lays the live text over a part whose row is older.

**12. The client draws.** The app composes those in `app/src/data/chat-store.ts` and paces text per frame (`paced-text.ts`); the transcript patches the one row that changed. The TUI does the same composition in `tui/src/live-host.ts` and dispatches a `view` message to its reducer. Mobile does it in `mobile/src/connection/live.ts`.

**13. The run ends in one set.** `endRun` in `core/src/engine/runs.ts` deletes the run, writes the head's last run, settles the receipts of the messages it landed, and fails any part still live. The journal drops its entry once a view contains the message. A child session's answer is then sent to its parent as an attached message.

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
| `retire/<pid>` | A client's request that an older host retire, with its supervisor kind | `requestRetire`; the host checks every 10 s and retires when idle |
| `nyte.db` | The store | The host |
| `secret.key` | The key that seals credentials, mode 0600 | First open |

A client finds the host with `findRunningHost`: read `host.json`, check the pid, and ask the address, which must answer with the host header. A host that finds the lock held stands by (the desktop's) or exits (a TUI's). A `nyte` that finds no host starts one only while nobody holds the lock.

## Clocks

| Clock | Value | Where |
| --- | --- | --- |
| Presence beat; a peer is dead after | 5 s; 20 s unchanged while this process wrote within 10 s | `core/src/engine/presence.ts` |
| Head lease; renewed every | 30 s; 10 s | `engine/durable.ts`, `drive/execution.ts` |
| Driver sweep for owed work | 5 s | `drive/execution.ts` |
| Store poll for another process's commits | 500 ms, one `PRAGMA data_version` when idle | `host/src/open.ts`, `core/src/watch/watch.ts` |
| A fold nobody holds lingers | 30 s | `watch/watch.ts` |
| Checkpoint after a run ends | 1 s later, once 1,024 events or 1 MiB of log have built up | `fold/checkpoint.ts` |
| Hook budget | 5 s a handler, 300 s for `before_compaction` | `extend/hooks.ts` |
| Idle plugin runtime closed after; sweep | 10 min; 60 s | `core/src/compose.ts` |
| Client hold on a queued message | 20 s, renewed every 5 s | `contract/session.ts`, `api/hold.ts` |
| Push gather; shortest time between pushes | 8 ms; 33 ms | `host/src/serve/socket.ts` |
| Socket ping; closed after | 30 s; 3 missed pongs | `serve/socket.ts` |
| Stream channel ping | 15 s | `serve/stream-server.ts` |
| Socket ticket | 30 s, one socket | `serve/listen-fetch.ts` |
| Frame limit; event backlog | 1 MiB; 8 MiB | `schema/src/socket.ts` |
| Client action timeout | 10 s default, 30 s at most, 16 waiting | `serve/clients.ts` |
| SQLite busy budget for a write | 5 s, retried off the event loop | `store/sqlite.ts` |
| Cleanup of unreferenced objects | 30 s after open, then hourly, objects over 1 h old | `store/compaction.ts` |
| MCP reconnect | 1 s doubling to 30 s; reset after 30 s connected | `mcp-client/hub.ts` |
| Job output kept | 1 MiB ring | `local/process/jobs.ts` |
| Socket reconnect | 1 s doubling to 30 s, with jitter | `sdk/src/live/store.ts` |
| HTTP retry | 50 ms, then 250 ms doubling to 10 s, no jitter | `sdk/src/connection/rows.ts` |
| Chat tail on open | 40 in the app (240 reopening), 200 in the TUI and on mobile | each client |
| Host stop grace; `nyte host` exit deadline | 10 s; 12 s | `service/src/host-thread.ts`, `tui/src/host-command.ts` |

## The wire's size

`pnpm --dir packages/bench bench:wire` measures six steps through the real client, and [its README](../packages/bench/README.md#wire-size) holds the table against t3code, the reference we size against. The rules the numbers come from:

- **Loopback is never compressed.** The desktop app and the TUI are on loopback, where bytes are free and compression is CPU. What matters there is how many frames a client has to parse: a streamed reply was 458, and gathering made it 86.
- **Off loopback, everything repeats, so one compression context does the work.** The socket negotiates permessage-deflate with context takeover, and a 141-byte append costs about 20 bytes after the first. A JSON answer over HTTP is gzipped from 1 KiB.
- **Rows go whole, once.** A change carries each touched row in full. Gathering is what keeps a row from going twice when two events touch it a millisecond apart.
- **Streamed text is appends, never the text so far.**
- **History is paged, and the first window is small.** The app opens a chat on 40 messages.

What a new feature should not do: put a field on a row that changes at a different rate from the rest of the row (the head's facts are split into `heads`, `settings` and `usage` for this), send a list where the client could derive it from rows it holds, or add a live event that grows with the number of chats.

## Correct, and surprising

- **Two connections, two retry curves.** `sdk.connect` retries HTTP from 50 ms without jitter; `openHost` reconnects the socket from 1 s with jitter. Both functions are named `retryDelay`.
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
- **`nyte host` runs on Bun and cannot open a pty.** Terminals open on the desktop app's host.
- **The Durable Object runs the SQLite migration dialect.** Its table list is SQLite's, and a row is capped at 2 MB.
- **Regenerating `identity.key` makes every pinned client pair again.** The host keeps its id, which lives in the store, but `expect` pins the key, so each client gets `stale` until it saves the new one.
- **A send with `replace` and its own id leaves a second receipt** that points at the first and is never settled. It is not pending work.

## Known gaps

These are real and not fixed. Each names what it would take.

- **A child's or a job's report is not durable.** It is a second write after the run ends, with a random receipt id and no recovery. A crash between the two loses it. It needs a deterministic id and a step in `recover`.
- **A migration reads outside the transaction that commits it.** An older Nyte still writing to the same file during an upgrade can leave rows in the old shape. Holding the write lock for the whole migration fixes it and blocks every peer for its length.
- **A migration loads the whole store into memory.**
- **Pointer receipts written before the index stopped counting them stay in `pending_work`** until a migration rebuilds the index. They cost a sweep visit each, as before.
- **The sidebar's pinned list and search cover the 50 most recent chats.** `sessions.read` defaults to 50 and the app never pages or filters.
- **A client cannot tell which session a text frame belongs to.** Every open chat's listener sees every part streaming on the socket.
- **The three clients each build a chat view** from `headView`, the unsent overlay and streamed text. One `live.chat` in the SDK would hold it once.
- **Desktop main keeps two host-view streams**, one in `HostLink` and one in `DesktopHost`, each with its own retry loop.
- **Two desktop builds on one home can retire each other's host.** The dev, production and bench builds share `~/.nyte`, and each files a retire request when the serving host's version or operations differ from its own.
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
