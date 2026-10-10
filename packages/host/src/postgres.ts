import type { Store } from "@nyte-ai/core";
import type { Pool } from "pg";

/** Returns a `Store` (`kind: "postgres"`) over `pg`: a `Pool` of its own from `connectionString`, ended by `close()`, or the caller's `pool`, left open. The first `open()` creates the sqlite store's three tables if absent, `bytes` as `BYTEA` and `seq`/`at` as `BIGINT`. Semantics are the sqlite store's; each `refs.set` is one transaction on one pooled client that first takes `pg_advisory_xact_lock` on every ref name and session it touches, in sorted order (a row lock cannot hold an absent ref or a session's next seq), then reads those refs, checks every `expect` against them, and applies and appends as the sqlite store does. Every `open()` returns a connection whose reads go through the pool, its `close` a no-op. */
export function postgresStore(
  input: { readonly connectionString: string } | { readonly pool: Pool },
): Store {
  throw new Error("not implemented");
}
