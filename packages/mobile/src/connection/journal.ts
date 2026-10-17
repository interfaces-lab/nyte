import { JournalEntrySchema } from "@nyte-ai/schema";
import type { JournalEntry, RequestJournal } from "@nyte-ai/sdk";

export interface JournalStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): boolean;
  getAllKeys(): string[];
}

export function createJournal(storage: JournalStorage, prefix: string): RequestJournal {
  const encodeKey = (id: string) => JSON.stringify([prefix, id]);
  const head = `${JSON.stringify([prefix]).slice(0, -1)},`;

  return {
    async load() {
      const entries: JournalEntry[] = [];

      for (const key of storage.getAllKeys().filter((key) => key.startsWith(head))) {
        const text = storage.getString(key);
        const entry = text === undefined ? null : parseEntry(text);

        if (entry === null) storage.remove(key);
        else entries.push(entry);
      }

      return entries.sort((left, right) => left.at - right.at);
    },
    async put(entry) {
      storage.set(encodeKey(entry.id), JSON.stringify(entry));
    },
    async remove(id) {
      storage.remove(encodeKey(id));
    },
  };
}

function parseEntry(text: string): JournalEntry | null {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }

  const result = JournalEntrySchema["~standard"].validate(value);

  return result instanceof Promise || result.issues !== undefined ? null : result.value;
}
