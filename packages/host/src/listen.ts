import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { SdkError } from "@nyte-ai/core";
import type { Host, Kernel, ListenOptions, Listener } from "@nyte-ai/core";
import { encodeError, errorStatus } from "@nyte-ai/protocol";
import { listenFetch } from "./listen-fetch.ts";

/** Serves a composed host, the `Host.listen` `openHost` attaches: everything but the socket is `listenFetch`'s, and the `fetch` transport answers with it directly. The `http` transport binds `node:http` on `hostname` (default 127.0.0.1) and `port` (default 0), streaming each request body in and each response body out chunk by chunk, with a client gone aborting its request; a failed bind throws `SdkError("unavailable")` after releasing the execution. `disconnectClients()` also destroys every open Node response, and `close()` closes the socket once. */
export async function listen(
  host: Omit<Host, "listen"> & { readonly kernel: Kernel },
  options: ListenOptions,
): Promise<Listener> {
  const inner = await listenFetch(host, { ...options, transport: { kind: "fetch" } });

  if (options.transport.kind === "fetch") return inner;
  const responses = new Set<ServerResponse>();

  const bound = await bind(options.transport, (request) => inner.fetch(request), responses).catch(
    async (error: unknown) => {
      await inner.close();

      throw new SdkError(
        "unavailable",
        `Cannot listen: ${error instanceof Error ? error.message : String(error)}`,
      );
    },
  );

  const disconnectClients = (): void => {
    inner.disconnectClients();

    for (const response of responses) response.destroy();
  };

  let closing: Promise<void> | null = null;

  const close = (): Promise<void> => {
    closing ??= (async () => {
      disconnectClients();
      await inner.close();
      await new Promise<void>((done) => {
        bound.server.close(() => done());
        bound.server.closeAllConnections();
      });
    })();

    return closing;
  };

  return {
    address: bound.address,
    fetch: (request) => inner.fetch(request),
    disconnectClients,
    close,
    [Symbol.asyncDispose]: close,
  };
}

async function bind(
  transport: { readonly hostname?: string; readonly port?: number },
  fetch: (request: Request) => Promise<Response>,
  responses: Set<ServerResponse>,
): Promise<{ readonly server: Server; readonly address: string }> {
  let origin = "http://127.0.0.1";

  const server = createServer({ noDelay: true }, (incoming, outgoing) => {
    void respond(incoming, outgoing, origin, fetch, responses);
  });

  await new Promise<void>((listening, failed) => {
    server.once("error", failed);
    server.listen(transport.port ?? 0, transport.hostname ?? "127.0.0.1", () => {
      server.off("error", failed);
      listening();
    });
  });

  const info = server.address();

  if (info === null || typeof info === "string") {
    server.close();

    throw new Error("the socket has no address");
  }

  const hostname = info.address.includes(":") ? `[${info.address}]` : info.address;
  origin = `http://${hostname}:${info.port}`;

  return { server, address: origin };
}

async function respond(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  origin: string,
  fetch: (request: Request) => Promise<Response>,
  responses: Set<ServerResponse>,
): Promise<void> {
  const controller = new AbortController();
  responses.add(outgoing);
  outgoing.on("close", () => {
    responses.delete(outgoing);

    if (!outgoing.writableFinished) controller.abort();
  });

  let request: Request;

  try {
    request = requestOf(incoming, origin, controller.signal);
  } catch (error) {
    await write(
      failure(new SdkError("invalid", error instanceof Error ? error.message : String(error))),
      outgoing,
    );

    return;
  }

  await write(await fetch(request), outgoing);
}

function requestOf(incoming: IncomingMessage, origin: string, signal: AbortSignal): Request {
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
      : { body: bodyOf(incoming), duplex: "half" as const };

  return new Request(url.href, { method, headers, signal, ...body });
}

function bodyOf(incoming: IncomingMessage): ReadableStream<Uint8Array> {
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

async function write(response: Response, outgoing: ServerResponse): Promise<void> {
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

function failure(error: SdkError): Response {
  return new Response(JSON.stringify(encodeError(error)), {
    status: errorStatus[error.code],
    headers: { "Content-Type": "application/json" },
  });
}
