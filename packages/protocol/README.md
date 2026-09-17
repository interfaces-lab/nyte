# @nyte-ai/protocol

The wire contract between a Nyte host and a client in another process. It
holds the SDK's plain data types, a TypeBox schema for each, the table of
operations the wire carries, the JSON and server-sent-event envelopes, and an SSE
codec. `@nyte-ai/server` and `@nyte-ai/client` are both written against it,
and `@nyte-ai/core` re-exports its types so a `SessionInfo` in core and one
decoded from JSON are the same TypeScript type.

Dependencies: `@nyte-ai/schema` and `typebox`. Never core, never Node. It
imports `typebox/value`, not `typebox/compile`, so it runs under a browser
content security policy that forbids `eval`.

## The wire, version 1

```text
GET {base}/v1/info
  reply: {"ok": true, "defined": true, "value": {"version": "<host release>", "wireVersion": 1, "host": {"kind": "unspecified"}}}
         the prefix is the wire version; another wire answers this route not_found

POST {base}/v1/call/{operation}
  content-type: application/json
  body:  {"input": <operation input>}      omit "input" when the operation takes none
  reply: {"ok": true, "defined": true, "value": <operation output>}
         {"ok": true, "defined": false}                   the SDK returned undefined
         {"ok": false, "error": {"code": "...", "message": "..."}}

GET {base}/v1/watch?sessionId=<id>[&after=<seq>|&live=1]
  content-type: text/event-stream
  event: event   data: <SessionEvent JSON>     id: <seq>
  event: ended   data: {}                      the SDK's watch ended on its own
  event: error   data: <WireError JSON>        the stream is over; the error says why
```

The session id is a query parameter because ids are any non-empty string,
and `.` or `..` in a path segment would be normalized away.

Authenticated info reads also describe the host when its embedding supplies
metadata. `host.kind: "described"` carries `capabilities.workspace` and
`persistence` (`durable`, `ephemeral`, or `unknown`).
An embedding without this information reports `host.kind: "unspecified"`.

Models use the existing SDK operations: `provider.models.list()`
returns currently available choices, and `provider.models.default()` returns the
default. Both use `ModelInfo`, with public identity, context limit, base cost
rates, and supported thinking levels. Credentials, provider URLs, and provider
headers stay on the host. Availability reflects server configuration and
credentials; it does not prove that a live upstream request will succeed.

`defined` is explicit because JSON has no `undefined` and `null` is a real
value elsewhere (a head with no tip is `"tip": null`). A `fact` event whose
value was deleted arrives with no `value` key; its type says `value?`.

Several events can share a `seq` (a head move and the commits it landed). A
consumer must not drop an event because its seq equals the last one seen.
A watch from a snapshot's `seq` may also replay a commit the snapshot already
holds; consumers fold by identity (`oid`, `change`), not by count.

`activation_changed` reports host-local session activation. Every watch replays
the current activation, stamped with the latest durable `seq`; the notice is not
part of that ordered durable stream.

A stream that closes without an `ended` or `error` frame was interrupted.
The client reports that as a failure, not as completion.

## Errors

| code                     | status | meaning                                                     |
| ------------------------ | ------ | ----------------------------------------------------------- |
| `invalid_input`          | 400    | input or query failed its schema; `issues` lists the paths  |
| `unauthorized`           | 401    | no credential                                               |
| `forbidden`              | 403    | credential refused, or a browser origin not on the list     |
| `unknown_operation`           | 404    | not in the operation table                                       |
| `unknown_session`        | 404    | the SDK threw `UnknownSession`                              |
| `not_found`              | 404    | no such route                                               |
| `method_not_allowed`     | 405    |                                                             |
| `cursor_expired`         | 409    | `after` is below the event floor; `floor` says where it is  |
| `payload_too_large`      | 413    |                                                             |
| `unsupported_media_type` | 415    | a call body that is not `application/json`                  |
| `internal`               | 500    | anything else; the message is fixed, the cause stays on the host |
| `closed`                 | 503    | the SDK or the server is closed                             |

## Operations

The set the desktop already carries over Electron IPC, plus `landing` and the
wire-only `workspace.current`/`workspace.select` pair that retargets a mobile
share:

```text
landing
sessions.create  sessions.get  sessions.snapshot  sessions.metadata  sessions.list
sessions.rename  sessions.setPinned  sessions.setArchived  sessions.delete  sessions.configure
messages.send  messages.cancel  messages.redeliver
runs.current  runs.abort  runs.reply  runs.changes
heads.move
workspace.list  workspace.current  workspace.select  workspace.forget  workspace.files  workspace.vcs.diff
provider.models.list  provider.models.default
plugins.catalog  plugins.list  plugins.commands.list  plugins.commands.run
plugins.settings.list  plugins.settings.apply  plugins.resources.list  plugins.status.list
```

Not carried, on purpose: `runs.wait` and `runs.compact` take an `AbortSignal`
and hold a request open for a model call. A remote client waits by watching
`run` events and reading `runs.current`; compaction stays off the wire until
dispatch can carry the request's signal. `attach`, `setPlugins`, and
`close` are host lifecycle; step execution is never remote in this revision.
The read operations the desktop does not use (`messages.list`, `heads.list`, and
so on) wait for a later revision. `OPERATIONS` is the authoritative list.

`provider.models.list()` returns only choices permitted by the host's current
credentials and provider restrictions. Hosts may further limit the list to
enabled, visible models. Raw registry access stays internal to the host through
`models.getModels()`; clients receive the public `ModelInfo` described above.
`sessions.configure` queues a model choice for subsequent work and leaves a
running request on its current configuration.

## Using it

```ts
import { Value } from "typebox/value";
import { OPERATIONS, describeIssues, validationIssues } from "@nyte-ai/protocol";

const input: unknown = JSON.parse(body);
const schema = OPERATIONS["messages.send"].input;
if (!Value.Check(schema, input)) {
  throw new Error(describeIssues(validationIssues(Value.Errors(schema, input))));
}
// input now has the operation's input type, including its branded sessionId.
```

Check untrusted values at the HTTP or SSE boundary with `Value.Check`.
Pass the resulting types to SDK code without revalidating them.
`validationIssues` limits schema diagnostics to 20 entries. `parseOperation`
returns an operation from `OPERATIONS`, or `undefined` for an unrecognized route name.

`createSseParser({ maxFrameChars })` bounds the decoded text of one frame
in UTF-16 code units, not bytes, including field names, comments, line
endings, and the terminating blank line. The default is 4 194 304. The
limit is independent of chunk boundaries and applies to `id:` fields too.
An id may persist across frames, but it must fit in the frame that supplied
it. Overflow releases retained parser state. Past the bound `parser.overflow` is
set, frames completed before the offending one are still returned, and
nothing more is parsed.

Every schema is pinned to its interface with `typed<T>()`, which compiles
only when the schema's static type and the interface agree in both
directions (readonly aside). A schema that drifts from its type fails
`tsc`, not a user.

## Limitations

- No batching, no reconnect protocol beyond "snapshot, then watch from the
  snapshot's `seq`". `after=<last seq seen>` is not a lossless resume across
  an arbitrary disconnect, because several events can share a seq.
- No tenancy: an operation names a session id and nothing scopes which ids a
  credential may name. The server can apply host permission policies to
  validated calls and watches, but the protocol does not filter result pages
  or supply device identities.
