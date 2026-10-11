import { createConnection, createServer } from "node:net";
import type { Socket } from "node:net";

/** Returns a cuttable TCP link in front of an `http` listener at `target` (`http://<host>:<port>`): a `node:net` server on 127.0.0.1, port 0, whose `url` a client dials, each accepted socket piped to a fresh socket to `target`. `drop()` destroys every piped pair at once (the client's open streams reset instead of ending) and, until `restore()`, destroys each socket as it is accepted (a connection reset, so reconnect attempts fail fast rather than hang); `restore()` pipes again; both are idempotent. `close()` drops everything and closes the server, once. */
export async function cuttableLink(target: string): Promise<{
  readonly url: string;
  drop(): void;
  restore(): void;
  close(): Promise<void>;
}> {
  const { hostname, port } = new URL(target);
  const sockets = new Set<Socket>();
  let dropped = false;

  const reset = (socket: Socket): void => {
    sockets.delete(socket);

    if (!socket.destroyed) socket.resetAndDestroy();
  };

  const server = createServer((client) => {
    client.on("error", () => undefined);

    if (dropped) {
      reset(client);

      return;
    }

    const upstream = createConnection({ host: hostname, port: Number(port) });
    upstream.on("error", () => undefined);
    sockets.add(client);
    sockets.add(upstream);

    const end = (): void => {
      sockets.delete(client);
      sockets.delete(upstream);
      client.destroy();
      upstream.destroy();
    };

    client.on("close", end);
    upstream.on("close", end);
    client.pipe(upstream);
    upstream.pipe(client);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();

  if (address === null || typeof address === "string")
    throw new Error("The link has no TCP address.");

  const drop = (): void => {
    dropped = true;

    for (const socket of sockets) reset(socket);
  };

  let closing: Promise<void> | null = null;

  return {
    url: `http://127.0.0.1:${address.port}`,
    drop,
    restore() {
      dropped = false;
    },
    close() {
      closing ??= new Promise<void>((resolve) => {
        drop();
        server.close(() => resolve());
      });

      return closing;
    },
  };
}
