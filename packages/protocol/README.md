# @nyte-ai/protocol

The wire between a Nyte host and a client in another process, generated from one
table. `declarations` names every served operation by its Connection path
(`head.send`, `git.patches`, `page.click`) with its input and output schemas
from `@nyte-ai/schema`, its kind (`query`, `command`, `receipt`, `watch`,
`stream`), the authority it needs and its recovery; `Signatures` types each row
as core's signatures do, and a test checks the two agree both ways. The host
(`@nyte-ai/host`'s `createHandler`) serves the table: exactly `POST /<name>` (a
prefix is the host's mount), gated by the row's authority, input decoded strictly (an unknown
field is `invalid`), output encoded leniently, a watch as server-sent events
(`head.watch` sends the head's view from the host's fold whole, then each later
view as what changed, so a reconnect simply starts over from the current view),
bytes as `application/octet-stream` (the reader's mime in `X-Nyte-Mime`, the
JSON input in `X-Nyte-Input` when bytes are the body), `job.output` as
length-prefixed frames, and every failure as the encoded `SdkError` at its
status; a watch or stream that fails mid-stream ends with an error frame
carrying it (`event: error`, or a `0x01 { kind: "error" }` control frame on
framed bytes), which the client rethrows. The sdk binds its typed client to the
same table through `createTransport` (`fetch` and `ReadableStream` only, so it
runs in browsers and React Native), decodes outputs with `decodeOutput` (an
unknown field ignored, an array record of an unknown kind skipped) and rebuilds
`Set`s and `Map`s from their wire forms.
