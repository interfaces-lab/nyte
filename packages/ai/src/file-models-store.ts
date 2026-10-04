/**
 * File-backed `ModelsStore` (models-store.json, one entry per provider id).
 * Separate from models-store.ts the way auth/store.ts is separate from
 * auth/credential-store.ts: node:fs stays out of modules a browser bundle can
 * reach through models.ts.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import type { ModelsStore, ModelsStoreEntry, ModelsStoreOperationOptions } from "./models-store.ts";
import { defaultNyteHome } from "./utils/nyte-home.ts";

const StoredEntriesSchema = Type.Record(Type.String(), Type.Unknown());

/**
 * Raw catalogs live under their own top-level key. Clients through 0.0.10
 * read and write pre-filtered entries keyed by provider id, ignore this key,
 * and preserve it when they save.
 */
const RAW_CATALOGS_KEY = "rawCatalogs";

const StoredEntrySchema = Type.Object(
  {
    models: Type.Array(Type.Unknown()),
    lastModified: Type.Optional(Type.Number()),
    checkedAt: Type.Optional(Type.Number()),
    etag: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export function defaultModelsStorePath(): string {
  return join(defaultNyteHome(), "models-store.json");
}

/**
 * A catalog cache, not secrets: unreadable content reads as empty and heals
 * on the next write. A malformed provider entry is ignored until a hosted
 * refresh replaces it. A legacy pre-filtered entry serves its models without
 * validators, so the next refresh fetches the full catalog.
 */
export class FileModelsStore implements ModelsStore {
  private readonly path: string;

  constructor(path: string = defaultModelsStorePath()) {
    this.path = path;
  }

  private load(): Static<typeof StoredEntriesSchema> {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path, "utf8"));

      return Value.Check(StoredEntriesSchema, parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private rawCatalogs(all: Static<typeof StoredEntriesSchema>): Static<typeof StoredEntriesSchema> {
    const catalogs = all[RAW_CATALOGS_KEY];

    return Value.Check(StoredEntriesSchema, catalogs) ? catalogs : {};
  }

  private save(all: Static<typeof StoredEntriesSchema>): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(this.path, `${JSON.stringify(all, null, 2)}\n`);
  }

  async read(
    providerId: string,
    options?: ModelsStoreOperationOptions,
  ): Promise<ModelsStoreEntry | undefined> {
    options?.signal?.throwIfAborted();

    const all = this.load();
    const entry = this.rawCatalogs(all)[providerId];

    if (Value.Check(StoredEntrySchema, entry)) return entry;

    const legacy = all[providerId];

    return Value.Check(StoredEntrySchema, legacy) ? { models: legacy.models } : undefined;
  }

  async write(
    providerId: string,
    entry: ModelsStoreEntry,
    options?: ModelsStoreOperationOptions,
  ): Promise<void> {
    options?.signal?.throwIfAborted();
    const all = this.load();
    all[RAW_CATALOGS_KEY] = { ...this.rawCatalogs(all), [providerId]: entry };
    this.save(all);
  }

  async delete(providerId: string, options?: ModelsStoreOperationOptions): Promise<void> {
    options?.signal?.throwIfAborted();
    const all = this.load();
    const catalogs = this.rawCatalogs(all);
    delete catalogs[providerId];
    delete all[providerId];
    all[RAW_CATALOGS_KEY] = catalogs;
    this.save(all);
  }
}
