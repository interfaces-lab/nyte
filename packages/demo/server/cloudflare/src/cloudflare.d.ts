/**
 * The slice of the Workers runtime this host touches, typed against the same
 * global `Request` and `Response` every `@nyte-ai/*` package is checked with.
 * `@cloudflare/workers-types` declares its own globals, and the two worlds do
 * not unify under one `tsc`, so the demo names what it uses.
 */
interface SqlStorageCursor {
  toArray(): Record<string, unknown>[];
}

interface SqlStorage {
  exec(query: string, ...bindings: unknown[]): SqlStorageCursor;
}

interface DurableObjectStorage {
  readonly sql: SqlStorage;
  transactionSync<T>(closure: () => T): T;
}

interface DurableObjectState {
  readonly storage: DurableObjectStorage;
}

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

interface DurableObjectNamespace {
  getByName(name: string): DurableObjectStub;
}
