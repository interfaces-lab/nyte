# @nyte-ai/protocol

The HTTP wire between a Nyte host and a client in another process. The host serves it, and `@nyte-ai/sdk` builds its typed client on it.

## Operations

`OPERATIONS` in `@nyte-ai/schema` is the one table the wire comes from. Each row names an operation by its Connection path, such as `head.send`, `git.patches` or `page.click`. A row carries its input and output schemas, its kind, the authority it needs and its recovery. This package derives its types from that table: `Declarations`, `OperationName`, `OperationInput` and `OperationOutput`.

| Kind | Answer |
| --- | --- |
| `query`, `command`, `receipt` | One JSON value |
| `watch` | JSON frames as server-sent events. `connection.watch` sends the host's view each time it changes, so a reconnect starts over from the current view. |
| `stream` | JSON frames as server-sent events, or bytes as `application/octet-stream` |

## Requests

- Each operation is `POST /<name>`.
- The host checks the row's authority before it runs the operation.
- The host decodes input strictly with `decodeInput`. An unknown field is `invalid`.
- The host encodes output with `encodeOutput`, which strips fields the schema doesn't name.
- A byte answer carries the reader's MIME type in `X-Nyte-Mime`. When bytes are the request body, the JSON input travels base64url-encoded in `X-Nyte-Input`.
- `job.output` answers length-prefixed frames. A `0x00` frame carries bytes and a `0x01` frame carries JSON control data.
- Every failure answers the encoded `SdkError` at its status.
- A watch or stream that fails partway ends with an error frame, `event: error` or a `0x01 { kind: "error" }` control frame. The client rethrows it.

## Client

`createTransport` sends requests with `fetch` and `ReadableStream` only, so it runs in browsers and React Native:

```ts
import { createTransport } from "@nyte-ai/protocol";

const transport = createTransport({
  url: "http://127.0.0.1:4000",
  headers: async () => ({ Authorization: "Bearer <token>" }),
});

const operations = await transport.invoke("operations.describe", {});
```

`decodeOutput` decodes an answer leniently. It ignores unknown fields and skips array records of an unknown kind. The sdk then rebuilds `Set`s and `Map`s from their wire forms.

`openHostSocket` opens the host's WebSocket, which carries events and streamed text. The [host protocol](../../docs/host-protocol/README.md) describes it.

## Development

```sh
pnpm --dir packages/protocol test
pnpm --dir packages/protocol typecheck
```
