/**
 * File-backed `ModelsStore` (models-store.json, one entry per provider id).
 * Separate from models-store.ts the way auth/store.ts is separate from
 * auth/credential-store.ts: node:fs stays out of modules a browser bundle can
 * reach through models.ts.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ModelSchema } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import type { ModelsStore, ModelsStoreEntry, ModelsStoreOperationOptions } from "./models-store.ts";
import { defaultNyteHome } from "./utils/nyte-home.ts";

const StoredEntriesSchema = Type.Record(Type.String(), Type.Unknown());

const StoredEntrySchema = Type.Object(
  {
    models: Type.Array(ModelSchema),
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
 * refresh replaces it.
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

  private save(all: Static<typeof StoredEntriesSchema>): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(this.path, `${JSON.stringify(all, null, 2)}\n`);
  }

  async read(
    providerId: string,
    options?: ModelsStoreOperationOptions,
  ): Promise<ModelsStoreEntry | undefined> {
    options?.signal?.throwIfAborted();

    const entry = this.load()[providerId];

    return Value.Check(StoredEntrySchema, entry) ? entry : undefined;
  }

  async write(
    providerId: string,
    entry: ModelsStoreEntry,
    options?: ModelsStoreOperationOptions,
  ): Promise<void> {
    options?.signal?.throwIfAborted();
    const all = this.load();
    all[providerId] = entry;
    this.save(all);
  }

  async delete(providerId: string, options?: ModelsStoreOperationOptions): Promise<void> {
    options?.signal?.throwIfAborted();
    const all = this.load();
    delete all[providerId];
    this.save(all);
  }
}
