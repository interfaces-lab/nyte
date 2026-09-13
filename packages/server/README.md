# @nyte-ai/server

A Web `Request -> Response` handler over a `Nyte` SDK, speaking the
`@nyte-ai/protocol` wire: `GET /v1/info` describes the release, wire version,
and available host metadata, JSON calls on `POST /v1/call/{operation}`, and a
server-sent-event stream on `GET /v1/watch`. It listens on nothing itself;
you hand `server.fetch` to whatever serves `Request` objects.

## Composition

```ts
import { createNyteModels } from "@nyte-ai/ai";
import { SqliteStore } from "@nyte-ai/core/store";
import { createHost, resolveModel } from "@nyte-ai/host";
import { createNyteServer } from "@nyte-ai/server";

const models = createNyteModels(); // credentials from `nyte login` or provider env keys
const store = new SqliteStore("/path/to/store.db");
const nyte = await createHost({
  models,
  model: await resolveModel(models, "anthropic/claude-opus-5"),
  store,
  plugins: { kind: "chat" }, // no filesystem tools, no project plugins, no trust
});
const detach = nyte.attach(); // this host runs the sessions; the server never does

const token = process.env.NYTE_TOKEN;
if (token === undefined) throw new Error("NYTE_TOKEN is required");

const server = createNyteServer({
  sdk: nyte,
  version: "0.0.2", // the host's release, answered on /v1/info
  auth: { kind: "token", token }, // 16+ characters
  // browserOrigins: ["https://app.example"],  // only if a browser page calls in
  onError: (failure) => console.error(failure.route, failure.operation, failure.cause),
});

// The handler is a function; the listener is yours. Bind it to loopback:
//   Bun:  Bun.serve({ hostname: "127.0.0.1", port: 8787, fetch: server.fetch });
//   Node: an adapter that builds a Request from the IncomingMessage and writes the Response back.
// The package tests call `server.fetch` directly. Deployment examples own their runtime checks.

// shutdown
server.close();  // ends open watch streams with a `closed` error frame
detach();
await nyte.close();
await store.close();
```

The server owns nothing of the SDK's lifecycle. It does not call `attach`,
so a host that only serves the wire and never attaches will queue messages
that no runner lands. `close()` refuses new calls, info requests, and watches, and ends open streams.
A call still awaiting its body or permission check cannot dispatch after close.
An SDK operation already dispatched may finish; closing the server does not
cancel accepted work, detach runners, or close the store.

## Host discovery

Optional `describe: () => ServerDescription | Promise<ServerDescription>` supplies
public metadata for `/v1/info`. The server invokes it after authentication on
each info read and validates its result. It returns the description as
`host: { kind: "described", ...description }`; without a callback it returns
`host: { kind: "unspecified" }`.

The description says whether workspace tools are supported and whether session
storage is `durable`, `ephemeral`, or `unknown`. It uses `ServerDescription`
from `@nyte-ai/protocol`. Model choices and defaults come from the SDK's existing
`provider.models.list()` and `provider.models.default()`
operations, which share the public `ModelInfo` contract.

Only return public metadata. Extra fields are rejected, including accidental
provider headers or credentials. Do not send a model prompt from discovery.
Info answers whether the host responds and how it is configured; model listing
checks availability. Neither proves that a live upstream request succeeds.

## What it checks

- Every request: browser origin, then credential, then route and method.
- Every call: `content-type: application/json`, body size (`maxBodyBytes`,
  default 1 MiB, enforced while reading), valid UTF-8 and JSON, the
  `{"input": ...}` envelope with no other key, and the operation's input schema
  with `additionalProperties: false`. An own `__proto__` key parsed from JSON
  is an extra key and is refused. Operation names are matched with `Object.hasOwn`.
- `messages.send` and `messages.redeliver`: the lane is in the SDK's landing
  policy, reported as `invalid_input` at `/lane` before the SDK is called.
- Every watch: exactly the query keys `sessionId`, and one of `after` (a
  non-negative safe integer) or `live=1`; no repeats, no unknown keys.

## Errors a client sees

Only errors the SDK defines are named: `UnknownSession` becomes
`unknown_session`, `CursorExpired` becomes `cursor_expired` with its floor,
`NyteClosed` becomes `closed`. Everything else, including a `TypeError` an
adapter or plugin threw, is `internal` with the fixed message
`Internal error`; the cause is delivered to `onError` and nowhere else. A
throwing `onError` does not change the reply.

## Watch streams

The first event is pulled before any header is written, so an unknown
session or an expired cursor is a JSON error with a status, not a stream
that fails on its first frame. After that the stream is pulled one event at
a time as the consumer reads: a slow client holds back the SDK watch, it
does not fill a buffer. Closing the server terminates the HTTP response even if an SDK read is still
waiting on host I/O. Iterator cleanup continues separately; a late result is not
forwarded. When the client disconnects or cancels, the SDK
watch's `AbortSignal` is aborted first and the iterator released after,
which is the order the core generator needs to unwind. Aborting a watch
never aborts a run.

`heartbeatMs` (default 15 s) sends an SSE comment on a quiet stream so a
proxy's idle timeout does not cut it. Set 0 to send none.

## Authentication and browsers

Authentication is required at composition and fails closed. `token` hashes both
values with SHA-256 and compares the fixed-length digests with Node's
`timingSafeEqual`. `custom` calls your function with the raw request and awaits
its result. The result enters as `unknown` and is checked against the schema-derived
`AuthDecision` type; hosts can use that exported type to check their own callbacks.
A malformed result gets `forbidden`; a thrown error gets `internal`.

There is no wildcard CORS. A request with no `Origin` header, or an `Origin`
equal to the request URL's own origin, is served. Any other origin must be
listed in `browserOrigins` exactly as the header spells it; listed origins
get `access-control-allow-origin` echoed and a preflight answer; every other
origin gets 403 and no CORS headers. Behind a proxy that changes the scheme
or host, list the public origin.

## Permissions for remote clients

Authentication establishes whether a request may enter. Optional `permissions`
then decides whether its parsed operation or watch may reach the SDK. Each call
handler receives the exact input type from `OPERATIONS`, plus the authenticated
request. Call bodies are read and validated once, before policy runs. Watch policy
receives a validated session id before the SDK checks existence or opens a watch.
Only `true` grants access; a missing handler or any other result returns 403.
A thrown policy error is redacted to `internal` and reported through `onError`.

For example, a host can grant a phone read access to selected sessions:

```ts
const readableSessions = new Set([session.sessionId]);
const server = createNyteServer({
  sdk: nyte,
  version: "0.0.2",
  auth: { kind: "token", token },
  permissions: {
    calls: {
      "sessions.snapshot": ({ sessionId }) => readableSessions.has(sessionId),
      "runs.changes": ({ sessionId }) => readableSessions.has(sessionId),
    },
    watch: (sessionId) => readableSessions.has(sessionId),
  },
});
```

This denies sending, creating, listing, and plugin commands. Omit `permissions`
only when the credential should have full SDK access. An empty `calls` table
forbids every call. `/v1/info` stays available to authenticated clients for version
negotiation; browser preflight still needs no credential.

The server does not filter operation results. Granting `sessions.list` reveals
its entire matching page; granting `workspace.list` reveals the host's workspace
list. A session-specific grant does not implicitly grant either. Policies for
creation must also check any caller-supplied session id and parent. The host owns
device identities, workspace trust, and permission storage; participant `Actor`
fields are attribution, never credentials.

Policies run on each new request, not each event. Revoking a credential or changing
a policy does not terminate an already-open watch. A host requiring immediate
revocation must also close the affected server instance and its connections.
Pairing, per-device connection management, TLS, and relays belong to host
composition, not the conversation protocol. This handler alone is not a remotely
accessible Mac service.

## Limitations

- Token auth uses one credential. Custom auth can verify host-managed device
  credentials; permissions can constrain calls and watches. The package supplies
  no identity store, tenant-specific result filtering, or pairing endpoints.
- The operation set is the desktop's SDK subset plus `landing` (see the protocol
  README). `runs.wait` and `runs.compact` are not served.
- No rate limiting, no request logging beyond `onError`.
- No listener. Bind whatever you attach it to on a loopback address unless
  the deployment has its own edge in front.
- Web `Request`/`Response` is the handler's shape, not a portability claim:
  the server imports `@nyte-ai/core`, which needs Node's SQLite and
  filesystem. It runs where core runs.
