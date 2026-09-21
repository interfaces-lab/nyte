# @nyte-ai/client

Everything a client needs at any runtime, with no Node: the fetch transport, the session fold and observer, and the projections, typed against `@nyte-ai/protocol`.

The transport is the SDK namespaces over `fetch`.
Every operation is one `POST /v1/call/{operation}`; `watch` reads `GET /v1/watch` as
server-sent events and yields an `AsyncIterable<SessionEvent>`; `info()` reads
`GET /v1/info` for the host's release and optional capability and storage
description. An embedding that cannot describe itself returns `host.kind: "unspecified"`.
Available model choices use `provider.models.list()`, and
`provider.models.default()` reads the host default. Both return the SDK's
`ModelInfo`, including pricing and thinking levels. Availability is configuration
metadata, not a live provider test.
The wire version is the route prefix, so a
server on another wire answers `info()` with a `not_found` wire error.

Dependencies: `@nyte-ai/protocol` and `typebox`. No core, no Node. It runs wherever
`fetch`, `Headers`, `ReadableStream`, and `TextDecoder` exist, and it never
compiles code, so a browser page under a strict content security policy can
use it.

## Use

A Node script (a browser page does the same with a token it was handed and
its own event consumer; the package itself has no Node dependency):

```ts
import { createNyteClient, NyteWireError, NyteTransportError } from "@nyte-ai/client";

const nyte = createNyteClient({
  baseUrl: "http://127.0.0.1:8787",
  token: process.env.NYTE_TOKEN, // undefined sends no Authorization header
  // headers: { "x-trace": id },    extra headers on every request
  // fetch: myFetch,                 a test can pass a server handler here
  // maxFrameChars: 4_194_304,       the most one watch frame may hold (UTF-16 code units)
});

const session = await nyte.sessions.create({ name: "wire" });
const receipt = await nyte.messages.send({
  sessionId: session.sessionId,
  content: "hello",
  key: crypto.randomUUID(), // the same key twice answers `duplicate` with the same change
});

const snapshot = await nyte.sessions.snapshot({ sessionId: session.sessionId });
if (snapshot === undefined) throw new Error("the session vanished");
render(snapshot);
for await (const event of nyte.watch({ sessionId: session.sessionId, afterSeq: snapshot.seq })) {
  fold(event); // must tolerate a commit the snapshot already holds; see below
  if (event.kind === "run" && event.run.phase.kind === "done") break;
}
```

A watch from a snapshot's `seq` can replay a commit the snapshot already
includes: the snapshot reads its cursor first and its transcript after, and
a commit can land between the two. Fold events idempotently (a commit by its
`oid`, a pending item by its `change`) rather than assuming each arrives
once.

Breaking out of the loop, calling `return()` on the iterator, or aborting
the `signal` passed to `watch` cancels the response body and the request at
once, even while a read is pending; that pending read resolves done. The
server sees the disconnect and stops its SDK watch. The run keeps going.

## What a reply must be

The client trusts nothing it did not check. A call's reply must be
`application/json`, must be the protocol's envelope, and its value must
match the operation's output schema; otherwise the call throws
`NyteTransportError` with `failure.kind` of `bad_content_type`, `bad_body`,
`bad_status`, or `network`. A reply that is the envelope with `ok: false`
throws `NyteWireError`, whose `code` is the stable protocol code and whose
`status` is the HTTP status that carried it.

A watch event is decoded against the `SessionEvent` schema before it is
yielded. A frame that outgrows `maxFrameChars` ends the watch with `bad_body`
and cancels the body. The limit counts UTF-16 code units of decoded text,
including field names and line endings, and defaults to 4 194 304. It does
not depend on chunk boundaries. An `error` frame throws `NyteWireError` (with `status` undefined:
the stream was already open). End of stream without an `ended` frame throws
`NyteTransportError` with `failure.kind === "disconnected"`; a finished
watch is only one the server finished.

Redirects are refused (`redirect: "error"`): an authenticated `POST` must not
be replayed elsewhere as a `GET`. Nothing is retried.

## Recovering

When a watch throws, take a new snapshot and watch from its `seq`:

```ts
try {
  for await (const event of nyte.watch({ sessionId, afterSeq })) fold(event);
} catch (error) {
  if (error instanceof NyteWireError && error.code === "cursor_expired") {
    // the events between afterSeq and error.error.floor are gone; refold from a snapshot
  }
  const fresh = await nyte.sessions.snapshot({ sessionId });
  if (fresh) {
    reset(fresh);
    // then watch again from fresh.seq
  }
}
```

Watching again from the last seq you saw is not a lossless resume after an
arbitrary disconnect, because several events can share one seq. The
snapshot's seq is the cursor the SDK guarantees.

## Sending

`createOutbox` closes the gap between Enter and a receipt (kernel README, "A
submitted message is never lost"). `submit` mints one idempotency key, draws
the message as a row, and retries the same key with backoff until the store
answers or `withdraw` takes it back. A receipt makes the row durable rather
than dropping it: feed every `SessionObserver` update to `observe`, and the row
leaves once the fold draws the same key or withdraws the same change, so a
message is never drawn twice and never blinks out between the two channels.
Pass a `storage` to survive a reload; `activate` reloads it.

```ts
const outbox = createOutbox({ send: (input) => nyte.messages.send(input) });
observer.subscribe((update) => outbox.observe(update));
await outbox.submit({ sessionId, content: "hello", delivery: "next" });
render([...state.pending, ...outbox.rows()]);
```

## Limitations

- The operation set is the desktop's SDK subset plus `landing`, `runs.current`,
  `runs.reply`, `plugins.status.list`, `jobs.*`, and the workspace share pair;
  see the protocol README. `runs.wait` and `runs.compact` are not available
  remotely.
- The transport itself never retries and has no reconnect logic; only the
  outbox retries, and only sends.
- One token for everything; the client has no notion of which sessions the
  token may name.
