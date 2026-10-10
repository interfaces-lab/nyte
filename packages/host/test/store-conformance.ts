import type { Store } from "@nyte-ai/core";

/** Registers the store conformance suite under `name`, each case against a fresh store from `open` (closed after): core's memory-store cases (ids shared with `objectId` whatever the key order, null for an unknown object or blob, a revision per entry, `absent` and revision mismatches answering `stale` with nothing written, deletion by a null target, prefix listing in name order, the log's per-session seq in entry order with `after` and `limit`, blobs round-tripped under their content hash), comparing objects by value rather than identity; repeated names in one batch (every `expect` checked against the refs before the batch, the last entry winning, a revision per entry, every event logged); and two concurrent sets under one `expect`, exactly one of them `set`. */
export function storeConformance(name: string, open: () => Promise<Store>): void {
  throw new Error("not implemented");
}
