import type { IncomingMessage, ServerResponse } from "node:http";

export function requestListener(
  fetch: (request: Request) => Promise<Response>,
  options: { readonly onError: (cause: unknown) => void },
): (incoming: IncomingMessage, outgoing: ServerResponse) => void {
  return (incoming, outgoing) => {
    const controller = new AbortController();
    outgoing.once("close", () => {
      if (!outgoing.writableFinished) controller.abort();
    });

    void (async () => {
      const request = readRequest(incoming, "http://localhost", controller.signal);
      await write(await fetch(request), outgoing);
    })().catch((cause: unknown) => {
      options.onError(cause);

      if (outgoing.headersSent) outgoing.destroy();
      else {
        outgoing.writeHead(500, { "content-type": "application/json" });
        outgoing.end(JSON.stringify({ error: "The lab request failed." }));
      }
    });
  };
}

function readRequest(incoming: IncomingMessage, origin: string, signal: AbortSignal): Request {
  const headers = new Headers();

  for (const [name, value] of Object.entries(incoming.headers)) {
    if (name.startsWith(":") || value === undefined) continue;

    if (Array.isArray(value)) for (const each of value) headers.append(name, each);
    else headers.set(name, value);
  }

  const host = incoming.headers.host;
  const url = new URL(incoming.url ?? "/", host === undefined ? origin : `http://${host}`);
  const method = incoming.method ?? "GET";

  const body =
    method === "GET" || method === "HEAD"
      ? {}
      : { body: readBody(incoming), duplex: "half" as const };

  return new Request(url.href, { method, headers, signal, ...body });
}

/** Returns a Node request's body as a stream that pauses the socket while the reader is full. */
function readBody(incoming: IncomingMessage): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      incoming.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));

        if ((controller.desiredSize ?? 0) <= 0) incoming.pause();
      });
      incoming.on("end", () => controller.close());
      incoming.on("error", (error) => controller.error(error));
    },
    pull() {
      incoming.resume();
    },
    cancel() {
      incoming.destroy();
    },
  });
}

/** Writes a `Response` to a Node response: status and headers flushed at once, then each body chunk as it arrives, waiting for the socket to drain; a client gone cancels the body. */
async function write(response: Response, outgoing: ServerResponse): Promise<void> {
  if (outgoing.destroyed || outgoing.writableFinished) {
    await response.body?.cancel();

    return;
  }

  const headers: Record<string, string | string[]> = {};

  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  const cookies = response.headers.getSetCookie();

  if (cookies.length > 0) headers["set-cookie"] = cookies;
  outgoing.writeHead(response.status, headers);
  outgoing.flushHeaders();

  if (response.body === null) {
    outgoing.end();

    return;
  }

  const reader = response.body.getReader();

  const cancel = (): void => {
    reader.cancel().catch(() => undefined);
  };

  outgoing.on("close", cancel);

  try {
    for (;;) {
      const read = await reader.read();

      if (read.done) break;

      if (!outgoing.write(read.value))
        await new Promise<void>((drained) => {
          const done = (): void => {
            outgoing.off("drain", done);
            outgoing.off("close", done);
            drained();
          };

          outgoing.on("drain", done);
          outgoing.on("close", done);
        });

      if (outgoing.destroyed) return;
    }

    outgoing.end();
  } catch {
    outgoing.destroy();
  } finally {
    outgoing.off("close", cancel);
  }
}
