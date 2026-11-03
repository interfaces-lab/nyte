# Host protocol

How a Nyte host and its clients share state. One contract for the desktop, the TUI, mobile, the CLI, and agents over MCP. The host folds its event log into tables; a client attaches to a window of rows, applies changes by id, and resumes from the last seq it saw. Nothing is re-projected and nothing is diffed by identity.

`rationale.md` holds the measurements this rests on, the audit of the code it replaces, and the shapes rejected. `model/` holds the TLA+ model of attach and resume; `node docs/host-protocol/model/check.mjs` runs it.

## Scopes and seqs

Every fact lives in one scope, and every scope has one seq.

| Scope | Holds | Seq |
| --- | --- | --- |
| `host` | sessions, clients, the host's own status | advances once per change to a host-scope row |
| `session/<id>` | one session's heads, messages, turns, parts, background items, file changes, catalog | the session's log seq, which already starts at 1 with no gaps |
| `client/<id>` | the queue of actions asked of one client | advances once per request queued |

A seq counts durable changes only. It never goes backwards, never skips, and survives the host's restart, because it is the position in the log the host folds. Two hosts never share a scope.

Live facts have no seq: which process is driving a session, the text a model is streaming, a tool's progress, the tailnet's status. The host sends them whole on every attach and resume, so a client never has to reconcile them.

## Tables and rows

A scope's state is a set of tables. A row has an id, the fields its table defines, and `seq`, the seq of the change that last wrote it. A row the host drops is gone; the drop is itself a change at a seq.

Host scope:

| Table | Row | Keyed by |
| --- | --- | --- |
| `sessions` | `SessionRow`: name, parent, call, workspace, pinned, archived, createdAt, lastActivityAt, `heads: HeadRow[]` | session id |
| `clients` | `ClientRow`: principal, kind, name, version, `actions: ActionDeclaration[]`, since | client id |

`HeadRow` is name, tip, stack, execution, unread, background counts. It lives only here. A head view carries no heads; the sessions table is the one owner of that fact.

Session scope, shared by the session's heads:

| Table | Row | Keyed by |
| --- | --- | --- |
| `messages` | `Message` | message id |
| `turns` | `TurnInfo` | turn id |
| `parts` | `PartView` | part id |
| `changes` | `FileChange` | path |
| `catalog` | `{ kind, entry }`, one command, setting, skill, agent or tool | `<kind>/<name>` |

Session scope, per head:

| Table | Row | Keyed by |
| --- | --- | --- |
| `heads` | `HeadRow`: name, revision, execution, reportsHeld, seenThrough, `queue: MessageId[]` | head name |
| `settings` | `HeadSettingsRow`: name, configuration, context | head name |
| `usage` | `HeadUsageRow`: name, the usage of the head's completed runs | head name |
| `background` | `{ head, item }` | `<head>/<kind>/<id>` |

A head's facts are split by how often they change: `heads` moves with every run phase, `usage` once per completed run, `settings` only when the configuration or the context window moves, so a phase change resends the execution alone and a run's end does not resend the configuration.

A turn row is sent once a message on a head's path belongs to it. The turn a pending message holds until it lands is never a row, as `head.watch` never showed it either.

Branches share history, so a message or turn can sit on several heads' paths; each head's path is an order over the session's message rows.

Rows that are per principal, such as `unread` and `seenThrough`, are projected for the principal the connection holds. The seq that stamps them is the seq of the `seen` event, which is in the log like any other.

### The window

A head's messages are ordered along its commit path, and a client holds a window of them: the last `tail` messages, or the messages from a given one. The order is a fact of its own, not derivable from the rows, so the host sends it: `order: MessageId[]`, with `leadingPrompt`, the prompt of the earliest turn in the window when it is before the window. The turns of a window are the turns its messages belong to; the host sends those turn rows and no others. Older messages come through `head.history`, one page at a time, and are never part of the window.

## Attach

A client attaches to a scope in two steps, in this order:

1. **Subscribe.** The client asks for the scope's events. From here on, every change in the scope reaches the client, in seq order, on the connection's event channel.
2. **Read.** The client reads the rows it wants: a head's window, or the sessions table. The answer carries the `seq` the rows are current through.

Events can arrive before the read's answer. The client holds them, applies the answer, then applies every held and later event whose seq is above the answer's. An event at or below the answer's seq is already in the answer and is skipped. Applying an event twice would be harmless anyway, because an event carries whole rows, not patches to them.

Reading first and subscribing second loses every change between the two. The model's `SubscribeBeforeRead` mutant shows the trace.

## Resume

A connection that drops loses the events the host logged while it was gone. The client keeps its rows and its seq, reconnects, subscribes to the scope again, and then resumes:

- it sends `seq`, the seq its rows are current through;
- it sends `from`, the first message id it holds, so the host knows the window it had;
- it sends the window it wants now.

The host answers with the window's `order`, `leadingPrompt`, the turn ids the window spans, and rows: every row of the window with `seq` above the client's, and every row of the window the client did not hold, because it was before `from` or in a table the client had not read. Live parts come whole. Rows that are in the client's store but not in the answer's order or turn list are rows the client drops.

A `from` the host cannot place on the path any more, because the head was rewound or moved, answers a whole window as a first read does. So does a `seq` older than the log the host still holds, as when the host restored a fold checkpoint newer than the client.

A whole window says so with `complete: true`. It holds every row the window needs, so the client replaces its tables with it instead of merging: a row the host dropped while the client was away, which no drop the host still knows of names, goes with them. A first read is complete too.

The sessions table resumes the same way with `seq` alone: the host answers the ids of every session the client may read, and every row with `seq` above the client's.

The model's `ResumeSendsUnheld` mutant shows what happens when the host sends only rows changed since the client's seq: a row that was written before the client first attached and that its old window did not cover never arrives.

## Events

One shape for everything the host pushes:

```
{ scope, seq, kind, ... }
```

`scope` is `host`, `session/<id>` or `client/<id>`. `seq` is the scope's seq for a durable change and null for a live fact. A client ignores a `kind` it does not know, and within a `change`, a table it does not know. That is how a newer host keeps an older client working.

| Kind | Scope | Carries |
| --- | --- | --- |
| `change` | any | `tables: { [table]: { upsert: Row[], drop: Id[] } }`, holding only the tables the change touched, and `paths: { head, after, ids }[]`: each moved head's order is unchanged through `after`, then continues with `ids` (`after: null` replaces it) |
| `live` | `session/<id>` | activation; the parts streaming, with the run each belongs to |
| `status` | `host` | the host's version, uptime, listeners, tailnet state |
| `perform` | `client/<id>` | `call`, the requesting client's id and principal, `action`, `input` |
| `performed` | `host` | `call`, target, outcome: performed, refused, failed or timeout |

One log event produces one `change` event at that seq, carrying every row it touched across tables. A client applies a `change` by replacing each upserted row and deleting each dropped id. No field-level patching, no splicing by position.

## Two channels

A connection has an event channel and a text channel.

The **event channel** carries requests, their answers, and every event above. It is the channel the seqs are about: on one connection, events of one scope arrive in seq order with no gaps, or the connection closes.

The **text channel** carries what a model is streaming: `{ part, run, version, append }` for text and `{ part, progress }` for a tool. None of it is durable, so none of it has a seq. When a client opens the text channel, the host sends the whole live suffix of every part streaming in the sessions the client subscribes to, then appends as they come. The host may merge queued appends for one part into a longer append; it never reorders them. A part's row in `parts` holds its text as of the last durable write, and its `version` tells the client where the live suffix starts.

Keeping text off the event channel keeps the byte budget and the seqs honest: a slow consumer of a fast model does not lose a durable change.

Both channels ride one WebSocket per connection, at `/.nyte/ws`. Every message is a JSON text frame tagged `{ "c": "e" }` or `{ "c": "t" }`. The host keeps one send queue per channel and always drains the event queue first; queued text for one part merges. A Node, React Native or Electron client sends its credential on the upgrade request; a browser, which cannot set headers on an upgrade, first trades its credential for a one-time ticket with `POST /.nyte/ws/ticket` and passes it as `?ticket=`. Request and response operations stay on plain HTTP as well, so a script can call one with `curl`. The new channel has no SSE form: every client Nyte ships can open a WebSocket, and a one-way stream cannot carry `client.reply`.

## Slow consumers

The host never skips an event it has queued for a connection. A connection whose queued event bytes pass the host's `backlogBytes` closes with the reason `backlog`. The client reconnects and resumes. An event larger than `maxFrameBytes` closes the connection too, with `oversize`, because skipping it would leave a gap.

The text channel is different. The host merges its appends, and when they still pass the budget it closes the text channel alone; the client reopens it and receives the live suffix again.

The host advertises both limits in its welcome.

## Versions

The host speaks a range of API revisions. A revision is an integer; every change to an operation, a row, or an event kind that an older client could not ignore bumps it.

The client's hello carries `api_min_revision`, the oldest revision it can use. The welcome carries `api_revision`, the newest the two share, `api_min_revision`, the oldest the host serves, and `api_server_revision`, the host's own. A host and a client with no revision in common close the connection, and the close reason names the side to update.

The operations table and the row and event schemas have a digest. CI records the digest next to the revision and fails when the digest moves without the revision, or an operation changes without its docs page.

## Authority

Every operation declares who may call it and from where:

| Field | Values | Meaning |
| --- | --- | --- |
| `authority` | `participant`, `owner`, `maintenance` | what the principal needs |
| `local` | absent or `true` | answered only on the local socket, never over the network or the tailnet: lifecycle, listeners, credentials, the tailnet's own controls |
| `mcp` | absent, `read` or `write` | the operation is an MCP tool; `read` ones are what a read-only grant may call |

MCP sessions are a separate audience. An MCP session calls only operations with `mcp` set, through `/mcp`, and every other route refuses its token. MCP tools are built from those rows of the operations table, never declared by hand, so a tool and its operation cannot drift.

Principals come from the transport, never from what the client claims: the local socket's peer credentials, a paired device's key, or the tailnet's `WhoIs`. A tagged tailnet node is a machine, not a person.

## Clients as principals

A client is a row in the host's `clients` table from its hello until its connection ends. The hello declares what it is (`app`, `tui`, `cli`, `agent`, `other`), its name and version, and the actions it offers: `{ name, summary, input }`.

Another client asks it to act with `client.perform { client, action, input, timeoutMs }`. The host checks the action is declared, queues the request on the target's `client/<id>` scope, and delivers it as a `perform` event with the requester's id and principal filled in by the host. The target answers with `client.reply { call, result }` or `client.reply { call, error }`, exactly one of the two.

Each client has one queue. Requests wait in line and the client answers them one at a time in order. `timeoutMs` counts from when a request reaches the front; it defaults to 10 s and tops out at 30 s. A client with 16 requests waiting refuses the next with `unavailable`. A request that times out fails for the requester with `timeout`; the target is not told and may still act. Observers of the host scope see a `performed` event with the outcome.

A client that never declared an action cannot be asked to perform it: `not_supported`.

## Operations

The operations table keeps its shape: name, summary, kind, authority, scope, capability, input and output schemas. These change:

| Operation | Change |
| --- | --- |
| `head.watch` | removed; `head.read` returns a window at a seq, and `change` events carry what moves |
| `head.read` | new: `{ session, head, window: { tail } \| { from }, resume?: { seq, from } }` |
| `sessions.watch` | removed; `sessions.read { resume?: { seq } }` plus `change` events on the host scope |
| `part.watch` | removed; parts are rows, and the text channel carries what streams |
| `events.subscribe` | new: `{ scopes: Scope[] }`, on the event channel |
| `text.open` | new: opens the text channel for the connection's subscribed sessions |
| `client.perform`, `client.reply` | new |
| `clients.read` | new: the clients table |
| `host.hello` | new: the handshake described under Versions and Clients as principals |

Every other operation keeps its declaration and gains `local` and `mcp` where they apply.
