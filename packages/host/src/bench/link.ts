/** Returns a cuttable TCP link in front of an `http` listener at `target` (`http://<host>:<port>`): a `node:net` server on 127.0.0.1, port 0, whose `url` a client dials, each accepted socket piped to a fresh socket to `target`. `drop()` destroys every piped pair at once (the client's open streams reset instead of ending) and, until `restore()`, destroys each socket as it is accepted (a connection reset, so reconnect attempts fail fast rather than hang); `restore()` pipes again; both are idempotent. `close()` drops everything and closes the server, once. */
export async function cuttableLink(target: string): Promise<{
  readonly url: string;
  drop(): void;
  restore(): void;
  close(): Promise<void>;
}> {
  throw new Error("not implemented");
}
