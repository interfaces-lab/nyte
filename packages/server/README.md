# @nyte-ai/server

A Web `Request -> Response` handler over a `Nyte` SDK, speaking the
`@nyte-ai/protocol` wire: JSON calls on `POST /v1/call/{verb}` and a
server-sent-event stream on `GET /v1/watch`. It listens on nothing itself;
you hand `server.fetch` to whatever serves `Request` objects.

## Composition

```ts
import { createNyte } from "@nyte-ai/core";
import { SqliteStore } from "@nyte-ai/core/store";
import { createNyteServer } from "@nyte-ai/server";

const store = new SqliteStore("/path/to/store.db");
const nyte = await createNyte({ store, streamFn, models, model, plugins, env });
const detach = nyte.attach(); // this host runs the sessions; the server never does

const token = process.env.NYTE_TOKEN;
if (token === undefined) throw new Error("NYTE_TOKEN is required");

const server = createNyteServer({
  sdk: nyte,
  auth: { kind: "token", token }, // 16+ characters
  // browserOrigins: ["https://app.example"],  // only if a browser page calls in
  onError: (failure) => console.error(failure.route, failure.verb, failure.cause),
});

// The handler is a function; the listener is yours. Bind it to loopback:
//   Bun:  Bun.serve({ hostname: "127.0.0.1", port: 8787, fetch: server.fetch });
//   Node: an adapter that builds a Request from the IncomingMessage and writes the Response back.
// This revision is verified in-process on Node (the tests call `server.fetch` directly);
// no listener, edge runtime, or Deno deployment has been exercised.

// shutdown
server.close();  // ends open watch streams with a `closed` error frame
detach();
await nyte.close();
await store.close();
```

The server owns nothing of the SDK's lifecycle. It does not call `attach`,
so a host that only serves the wire and never attaches will queue messages
that no runner lands. `close()` ends the streams the server opened and
nothing else.

## What it checks

- Every request: browser origin, then credential, then route and method.
- Every call: `content-type: application/json`, body size (`maxBodyBytes`,
  default 1 MiB, enforced while reading), valid UTF-8 and JSON, the
  `{"input": ...}` envelope with no other key, and the verb's input schema
  with `additionalProperties: false`. An own `__proto__` key parsed from JSON
  is an extra key and is refused. Verb names are matched with `Object.hasOwn`.
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
does not fill a buffer. When the client disconnects or cancels, the SDK
watch's `AbortSignal` is aborted first and the iterator released after,
which is the order the core generator needs to unwind. Aborting a watch
never aborts a run.

`heartbeatMs` (default 15 s) sends an SSE comment on a quiet stream so a
proxy's idle timeout does not cut it. Set 0 to send none.

## Authentication and browsers

Authentication is required at composition and fails closed. `token` compares
a bearer token in constant time. `custom` calls your function with the raw
request. The server checks its result against the `AuthDecision` schema.
A malformed result gets `forbidden`; a thrown error gets `internal`.

There is no wildcard CORS. A request with no `Origin` header, or an `Origin`
equal to the request URL's own origin, is served. Any other origin must be
listed in `browserOrigins` exactly as the header spells it; listed origins
get `access-control-allow-origin` echoed and a preflight answer; every other
origin gets 403 and no CORS headers. Behind a proxy that changes the scheme
or host, list the public origin.

## Limitations

- One credential, all sessions. Nothing scopes which session ids a caller
  may name; multi-tenant access control is out of scope for this revision.
- The verb set is the desktop's SDK subset plus `landing` (see the protocol
  README). `runs.wait` and `runs.compact` are not served.
- No rate limiting, no request logging beyond `onError`.
- No listener. Bind whatever you attach it to on a loopback address unless
  the deployment has its own edge in front.
- Web `Request`/`Response` is the handler's shape, not a portability claim:
  the server imports `@nyte-ai/core`, which needs Node's SQLite and
  filesystem. It runs where core runs.
