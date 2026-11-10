# Host protocol

This is how a Nyte host and its clients share state. The desktop app, the TUI, mobile, the CLI and agents over MCP all use this one contract. The host folds its event log into tables. A client attaches to a window of rows, applies changes by id, and resumes from the last seq it saw. Neither side diffs state. The host sends whole rows, and the client replaces them by id.

[rationale.md](rationale.md) holds the measurements this design rests on, the audit of the code it replaces, and the shapes it rejected. [model/](model) holds the TLA+ model of attach and resume. To check the model, run this from the repository root. It fetches `tla-ts` with `pnpm dlx`.

```sh
node docs/host-protocol/model/check.mjs
```

The check runs the model once as designed, then once with each of `SubscribeBeforeRead`, `ApplyEarlyEvents` and `ResumeSendsUnheld` turned off. Each of those three runs must produce a counterexample.

## Scopes and seqs

Every fact lives in one scope, and every scope has one seq.

| Scope | Holds | Seq |
| --- | --- | --- |
| `host` | Sessions and the host's own status | Advances once per change to a host-scope row |
| `session/<id>` | One session's heads, messages, turns, parts, background items, file changes and catalog id | The session's log seq, which starts at 1 and has no gaps |
| `client/<id>` | The queue of actions asked of one client | Advances once per request the host delivers to the client |

A session's seq counts durable changes only. It is the position in the log the host folds, so it never goes backwards, never skips, and survives a host restart.

Live facts have no seq. These are which process is driving a session, which clients are connected, the text a model is streaming, a tool's progress and the tailnet's status. The host sends them whole on every attach and resume, so a client never has to reconcile them.

## Tables and rows

A scope's state is a set of tables. A row has an id, the fields its table defines, and `seq`, the seq of the change that last wrote it. A row the host drops is gone, and the drop is itself a change at a seq.

Host scope:

| Table | Row | Keyed by |
| --- | --- | --- |
| `sessions` | `SessionInfo`: id, name, parent, call, workspace, pinned, archived, activation, `heads: HeadInfo[]`, createdAt, lastActivityAt, and optional `mcp` and `side` | Session id |

`HeadInfo` holds a head's name, tip, stack, execution, unread flag and background counts. It lives only in the `sessions` table. A head's window carries no `HeadInfo`, because the `sessions` table is the one owner of that fact.

Connected clients are not a table. A client exists only while its connection is open, so its rows would carry seqs that no log holds and no resume could replay. The connected clients are a live fact of the host scope instead. A `ClientRow` holds id, principal, kind, name, version, `actions: ActionDeclaration[]` and since. The host sends the whole list as `{ kind: "live", scope: "host", seq: null, clients }` on subscribe and on every join or leave. `clients.read` returns the same list.

Session scope, shared by the session's heads:

| Table | Row | Keyed by |
| --- | --- | --- |
| `messages` | `Message` | Message id |
| `turns` | `TurnInfo` | Turn id |
| `parts` | `PartView` | Part id |
| `changes` | `FileChange` | Path |
| `catalog` | `{ id }`, the id of the session's catalog of commands, settings, skills, agents and tools, whose content `catalogs.read` returns | Catalog id |

Session scope, per head:

| Table | Row | Keyed by |
| --- | --- | --- |
| `heads` | `HeadRow`: name, revision, execution, reportsHeld, seenThrough, `queue: MessageId[]` | Head name |
| `settings` | `HeadSettingsRow`: name, configuration, context | Head name |
| `usage` | `HeadUsageRow`: name, the usage of the head's completed runs | Head name |
| `background` | `{ head, item }` | `<head>/<kind>/<id>` |

The host splits a head's facts by how often they change:

- `heads` moves with every run phase.
- `usage` moves once per completed run.
- `settings` moves only when the configuration or the context window changes.

So a phase change resends only the execution, and the end of a run doesn't resend the configuration.

The host sends a turn row once a message on a head's path belongs to that turn. A pending message holds a turn until the message lands, and that turn is never a row.

Branches share history, so a message or turn can sit on several heads' paths. Each head's path is an order over the session's message rows.

A part's message row may carry a cut view of the part's state, such as an excerpt of a long tool result, and marks it `elided: true`; `part.read` returns the whole part.

Some rows are per principal, such as `unread` and `seenThrough`. The host projects them for the principal the connection holds. The seq that stamps them is the seq of the `seen` event, which is in the log like any other event.

### The window

A head's messages are ordered along its commit path, and a client holds a window of them. The window is either the last `tail` messages, or the messages from a given one onward. The order is a fact of its own that the rows can't produce, so the host sends it as `order: MessageId[]`. With it comes `leadingPrompt`, the prompt of the earliest turn in the window when that prompt is before the window.

The turns of a window are the turns its messages belong to. The host sends those turn rows and no others. Older messages come through `head.history`, one page at a time, and are never part of the window.

## Attach

A client attaches to a scope in two steps, in this order:

1. Subscribe. The client asks for the scope's events. From then on, every change in the scope reaches the client in seq order on the connection's event channel.
2. Read. The client reads the rows it wants, such as a head's window or the `sessions` table. The answer carries the `seq` the rows are current through.

A client may pipeline the two and send the read right behind the subscribe, without waiting for the subscribe's answer. The host handles a connection's frames in arrival order, and a read waits for any subscribe to its scope sent earlier on the same connection.

Events can arrive before the read's answer. The client holds them and applies the answer. Then it applies every held and later event whose seq is above the answer's. The answer already contains any event at or below its seq, so the client skips that event. Applying an event twice would do no harm anyway, because an event carries whole rows, not patches.

If a client reads first and subscribes second, it loses every change between the two. The model shows the trace with `SubscribeBeforeRead` turned off.

## Resume

When a connection drops, the client misses the events the host logs while it is gone. The client keeps its rows and its seq, reconnects, subscribes to the scope again, and then resumes. The resume sends:

- `seq`, the seq the client's rows are current through
- `from`, the first message id the client holds, so the host knows the window it had
- the window the client wants now

The host answers with a `HeadWindow`. It carries the window's `order`, `leadingPrompt`, `complete`, the session's activation, and rows. The rows are every row of the window with `seq` above the client's, plus every row of the window the client didn't hold. A row is unheld when it was before `from`, or in a table the client hadn't read.

The head's `background` rows always come whole. A child's, job's or page's state joins a seq the client may already hold, so the client replaces the head's `background` rows with the answer's. A live part's streamed text comes whole on the text channel when the client opens it again.

The session's `catalog` row is logged like any other, so a resume carries it only when the catalog changed since the client's seq, and then only its id. The client reads an id it hasn't seen with `catalogs.read`. A catalog never changes under its id, so the client keeps what it read for as long as it stays connected.

After it applies the answer, the client drops every message that isn't in the answer's `order`, its `leadingPrompt` or the head's queue. It also drops every turn that no remaining message belongs to.

The host answers with a whole window, as for a first read, in two cases:

- The host can't place `from` on the path any more, because the head was rewound or moved.
- `seq` is older than the log the host still holds, as when the host restored a fold checkpoint newer than the client.

A whole window carries `complete: true`. It holds every row the window needs, so the client replaces its tables with it instead of merging. That removes a row the host dropped while the client was away, when no drop the host still knows names it. A first read is complete too.

The `sessions` table resumes the same way, with `seq` alone. The host answers with the ids that the read's `parents` filter and `limit` select, and every row with `seq` above the client's. Between reads, a host-scope subscriber receives every session row that changes, inside its window or not. The client derives a list's order from its rows. It filters by `parent`, sorts by `lastActivityAt` descending and then by id, and takes the limit.

With `ResumeSendsUnheld` turned off, the model shows what happens when the host sends only rows changed since the client's seq. A row written before the client first attached, which its old window didn't cover, never arrives.

## Events

Everything the host pushes has one shape:

```
{ c: "e", type: "event", scope, seq, kind, ... }
```

`scope` is `host`, `session/<id>` or `client/<id>`. `seq` is the scope's seq for a durable change, and null for a live fact. A client ignores a `kind` it doesn't know, and a table it doesn't know inside a `change`. That way a newer host keeps an older client working.

| Kind | Scope | Carries |
| --- | --- | --- |
| `change` | `session/<id>`, `host` | `tables: { [table]: { upsert: Row[], drop: Id[] } }`, holding only the tables the change touched. A session change also carries `paths: { head, after, ids }[]`, where each moved head's order is unchanged through `after` and then continues with `ids`. `after: null` replaces the whole order. |
| `live` | `session/<id>`, `host` | In a session scope, the session's activation. In the host scope, either the connected clients or every session's activation, as two separate events. |
| `status` | `host` | The host's version, `startedAt`, listeners, and the tailnet's status for an owner |
| `perform` | `client/<id>` | `call`, `requester` with the requesting client's id and principal, `action`, `input` |
| `performed` | `host` | `call`, the target, and the outcome: performed, refused, failed or timeout |

One log event produces one `change` event at that seq, carrying every row it touched across tables. Some bus events never reach the log: a child's, job's or page's state. Each produces a `change` at the seq it joined, carrying only the rows it touched and never the rows that seq already sent.

A client applies a `change` by replacing each upserted row and deleting each dropped id. There is no field-level patching and no splicing by position.

## Two channels

A connection has an event channel and a text channel.

The event channel carries requests, their answers and every event above. The seqs apply to this channel. On one connection, the events of one scope arrive in seq order with no gaps, or the connection closes.

The text channel carries what a model is streaming:

- `{ part, run, version, text }` with a part's whole text
- `{ part, run, version, append }` for what the part streams next
- `{ part, run, progress }` for a tool's progress

None of it is durable, so none of it has a seq. When a client opens the text channel, the host sends the whole live suffix of every part streaming in the sessions the client subscribes to, then sends appends as they come. The host may merge queued appends for one part into a longer append, and it never reorders them. A part's row in `parts` holds its text as of the last durable write, and its `version` tells the client where the live suffix starts.

Because streamed text has its own channel, it can't use up the event channel's byte budget, and a slow consumer of a fast model never loses a durable change.

Both channels share one WebSocket per connection, at `/.nyte/ws`. Every message is a JSON text frame tagged `{ "c": "e" }` for the event channel or `{ "c": "t" }` for the text channel. The host keeps one send queue per channel and always drains the event queue first. Queued text for one part merges.

An event-channel frame larger than `maxFrameBytes` goes out as fragments, `{ c: "e", type: "fragment", text, last }`, to a client whose hello names revision 23 or later. The client joins the `text` of each fragment through the one marked `last` and reads the result as the frame. The fragments of one frame are never interleaved with another event-channel frame.

A Node, React Native or Electron client sends its credential on the upgrade request. A browser can't set headers on an upgrade, so it first trades its credential for a one-time ticket with `POST /.nyte/ws/ticket` and passes the ticket as `?ticket=`.

Request and response operations also stay on plain HTTP, so a script can call one with `curl`. The event and text channels have no SSE form, because a one-way stream can't carry `client.reply`.

## Slow consumers

The host never skips an event it has queued for a connection. When a connection's queued event bytes pass the host's `backlogBytes`, the host closes the connection with the reason `backlog`. The client reconnects and resumes. An event larger than `maxFrameBytes` also closes the connection of a client older than revision 23, with the reason `oversize`, because skipping the event would leave a gap. A newer client gets it as fragments. After repeated closes for size, the client waits longer before each reconnect, though its welcomes reset the delay for an ordinary drop.

The text channel works differently. The host merges its appends. When they still pass the budget, the host drops the queued text, closes the text channel alone and sends `{ c: "t", type: "closed" }`. The client calls `text.open` again and receives the live suffix again.

The host advertises both limits in its welcome.

## Versions

The host speaks a range of API revisions. A revision is an integer. Every change to an operation, a row or an event kind that an older client couldn't ignore bumps the revision.

The client's hello carries:

- `api_min_revision`, the oldest revision the client can use
- optionally `api_revision`, the newest revision the client speaks, so the host can tell when a client is too old for it

The host's welcome carries:

- `api_revision`, the newest revision the two share
- `api_min_revision`, the oldest revision the host serves
- `api_server_revision`, the host's own revision
- `host_id`, so a client keys its connection by the host rather than by the address it dialed

When a host and a client share no revision, they close the connection, and the close reason names the side to update.

`pnpm operations` hashes each row of the operations table, schemas included, and checks the hashes against the operations lock, which records them with `API_REVISION`. It fails when a row changes without a revision bump, or when an operation's reference page is missing or out of date. CI runs it. After you bump the revision, run `pnpm operations --update`.

## Authority

Every operation declares who may call it and from where:

| Field | Values | Meaning |
| --- | --- | --- |
| `authority` | `participant`, `owner`, `maintenance` | What the principal needs |
| `local` | Absent or `true` | The host answers only on the local socket, never over the network or the tailnet. The tailnet controls, pausing and resuming execution, and MCP approvals and grants are local. |
| `mcp` | Absent, `read` or `write` | The operation is an MCP tool. A read-only grant may call only `read` tools. |

MCP sessions are a separate audience. An MCP session calls only operations with `mcp` set, through `/mcp`, and every other route refuses its token. The host builds MCP tools from those rows of the operations table, and nobody declares them by hand, so a tool and its operation can't drift apart.

### Outside agents

The host serves MCP at `/mcp` at protocol revision 2026-07-28. It also answers 2025-era clients per request through the same endpoint.

The host is an OAuth 2.1 resource server and its own authorization server. It supports:

- protected resource metadata (RFC 9728)
- authorization server metadata (RFC 8414) that advertises `client_id_metadata_document_supported` and `authorization_response_iss_parameter_supported`
- PKCE S256
- `resource` on authorize and token requests (RFC 8707)
- `iss` on the authorization response (RFC 9207)

A client registers by metadata document, an https `client_id` that the host fetches and checks. Dynamic registration (RFC 7591) remains as a deprecated fallback and requires `application_type`. The scopes are `nyte:read` and `nyte:write`.

The owner consents on the local socket, never through the browser page. The authorize page shows a code and waits until `mcp.approve` or `mcp.deny` answers it. A grant is read-only or carries a ceiling, which is one of the host's approval modes.

A session that a grant starts records the grant and its ceiling. Its runs ask for approval under the stricter of the host's setting and that ceiling. The grant's write tools reach only the sessions the grant started. `mcp.grants.list` and `mcp.grants.revoke` are local and owner-only.

Principals come from the transport, never from what the client claims. The host takes them from the local socket's peer credentials, a paired device's key, or the tailnet's `WhoIs`. A tagged tailnet node is a machine, not a person.

## Clients as principals

A client is in the host's live list of clients from its hello until its connection ends. The hello declares the client's kind, one of `app`, `tui`, `cli`, `agent` or `other`. It also declares the client's name and version, and the actions it offers as `{ name, summary, input }`.

Another client asks it to act with `client.perform { client, action, input, timeoutMs }`. The host checks that the target declared the action and queues the request on the target's `client/<id>` scope. The host delivers the request as a `perform` event and fills in the requester's id and principal itself. The target answers with exactly one of `client.reply { call, result }` or `client.reply { call, error }`.

Each client has one queue. Requests wait in line, and the client answers them one at a time, in order.

- `timeoutMs` counts from when a request reaches the front of the queue. It defaults to 10 s and tops out at 30 s.
- A client with 16 requests waiting refuses the next one with `unavailable`.
- A request that times out fails for the requester with `timeout`. The host doesn't tell the target, which may still act.
- Observers of the host scope see a `performed` event with the outcome.

A client can't be asked to perform an action it never declared. The host answers `not_supported`.

## Operations

Each row of the operations table has a name, summary, kind, authority, scope, capability, and input and output schemas. Every operation declares `local` and `mcp` where they apply. These operations carry the protocol above:

| Operation | Input | What it does |
| --- | --- | --- |
| `events.subscribe` | `{ scopes: Scope[] }` | Subscribes the connection to scopes on the event channel |
| `events.unsubscribe` | `{ scopes: Scope[] }` | Ends those subscriptions |
| `head.read` | `{ session, head, window: { tail } \| { from }, resume?: { seq, from: MessageId \| null } }` | Returns a head's window at a seq. `change` events carry what moves after that. |
| `sessions.read` | `{ parents?, limit?, resume?: { seq } }` | Returns the `sessions` table. `change` events on the host scope carry what moves after that. |
| `text.open` | | Opens the text channel for the connection's subscribed sessions |
| `client.perform`, `client.reply` | See [Clients as principals](#clients-as-principals) | Ask another client to act, and answer such a request |
| `clients.read` | | Returns the connected clients, the same list the host scope's `live` event carries |

There are no watch operations for heads, sessions or parts. Parts are rows, and the text channel carries what streams.

The hello is not an operation. It is the socket's first frame, the handshake described under [Versions](#versions) and [Clients as principals](#clients-as-principals).
