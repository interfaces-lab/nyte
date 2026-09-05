# @nyte-ai/protocol

The wire contract between a Nyte host and a client in another process. It
holds the SDK's plain data types, a TypeBox schema for each, the table of
verbs the wire carries, the JSON and server-sent-event envelopes, and an SSE
codec. `@nyte-ai/server` and `@nyte-ai/client` are both written against it,
and `@nyte-ai/core` re-exports its types so a `SessionInfo` in core and one
decoded from JSON are the same TypeScript type.

Dependencies: `@nyte-ai/schema` and `typebox`. Never core, never Node. It
imports `typebox/value`, not `typebox/compile`, so it runs under a browser
content security policy that forbids `eval`.

## The wire, version 1

```text
POST {base}/v1/call/{verb}
  content-type: application/json
  body:  {"input": <verb input>}      omit "input" when the verb takes none
  reply: {"ok": true, "defined": true, "value": <verb output>}
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

`defined` is explicit because JSON has no `undefined` and `null` is a real
value elsewhere (a head with no tip is `"tip": null`). A `fact` event whose
value was deleted arrives with no `value` key; its type says `value?`.

Several events can share a `seq` (a head move and the commits it landed). A
consumer must not drop an event because its seq equals the last one seen.
A watch from a snapshot's `seq` may also replay a commit the snapshot already
holds; consumers fold by identity (`oid`, `change`), not by count.

A stream that closes without an `ended` or `error` frame was interrupted.
The client reports that as a failure, not as completion.

## Errors

| code                     | status | meaning                                                     |
| ------------------------ | ------ | ----------------------------------------------------------- |
| `invalid_input`          | 400    | input or query failed its schema; `issues` lists the paths  |
| `unauthorized`           | 401    | no credential                                               |
| `forbidden`              | 403    | credential refused, or a browser origin not on the list     |
| `unknown_verb`           | 404    | not in the verb table                                       |
| `unknown_session`        | 404    | the SDK threw `UnknownSession`                              |
| `not_found`              | 404    | no such route                                               |
| `method_not_allowed`     | 405    |                                                             |
| `cursor_expired`         | 409    | `after` is below the event floor; `floor` says where it is  |
| `payload_too_large`      | 413    |                                                             |
| `unsupported_media_type` | 415    | a call body that is not `application/json`                  |
| `internal`               | 500    | anything else; the message is fixed, the cause stays on the host |
| `closed`                 | 503    | the SDK or the server is closed                             |

## Verbs

The set the desktop already carries over Electron IPC, plus `landing`:

```text
landing
sessions.create  sessions.get  sessions.snapshot  sessions.list  sessions.rename
sessions.setPinned  sessions.setArchived  sessions.delete  sessions.configure
messages.send  messages.cancel  messages.redeliver
runs.abort  runs.changes
heads.move
workspace.list  workspace.forget  workspace.vcs.diff
provider.models.default
plugins.catalog  plugins.list  plugins.commands.list  plugins.commands.run
plugins.settings.list  plugins.settings.apply  plugins.resources.list
```

Not carried, on purpose: `runs.wait` and `runs.compact` take an `AbortSignal`
and hold a request open for a model call; `attach`, `setPlugins`, and
`close` are host lifecycle; step execution is never remote in this revision.
The read verbs the desktop does not use (`messages.list`, `heads.list`, and
so on) wait for a later revision. `VERBS` is the authoritative list.

## Using it

```ts
import { Value } from "typebox/value";
import { VERBS, describeIssues, validationIssues } from "@nyte-ai/protocol";

const input: unknown = JSON.parse(body);
const schema = VERBS["messages.send"].input;
if (!Value.Check(schema, input)) {
  throw new Error(describeIssues(validationIssues(Value.Errors(schema, input))));
}
// input now has the verb's input type, including its branded sessionId.
```

Check untrusted values at the HTTP or SSE boundary with `Value.Check`.
Pass the resulting types to SDK code without revalidating them.
`validationIssues` limits schema diagnostics to 20 entries. `parseVerb`
returns a verb from `VERBS`, or `undefined` for an unrecognized route name.

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
- No tenancy: a verb names a session id and nothing scopes which ids a
  credential may name. That is the server's authorizer's job, and this
  revision's authorizer is all-or-nothing.
