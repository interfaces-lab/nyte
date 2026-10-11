import { JournalEntrySchema } from "@nyte-ai/schema";
import type { JournalEntry, RequestJournal } from "@nyte-ai/sdk";

/** The slice of MMKV the journal writes through; tests pass a map. */
export interface JournalStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): boolean;
  getAllKeys(): string[];
}

/**
 * Returns the sdk's request journal for one route, kept in `storage` under
 * `prefix`, one key per send, so an unacknowledged message survives the app
 * being killed and `sdk.connect` resends it with its id. An entry that no
 * longer reads as a `JournalEntry` is removed on load.
 */
export function createJournal(storage: JournalStorage, prefix: string): RequestJournal {
  const keyOf = (id: string) => JSON.stringify([prefix, id]);
  const head = `${JSON.stringify([prefix]).slice(0, -1)},`;

  return {
    async load() {
      const entries: JournalEntry[] = [];

      for (const key of storage.getAllKeys().filter((key) => key.startsWith(head))) {
        const text = storage.getString(key);
        const entry = text === undefined ? null : entryOf(text);

        if (entry === null) storage.remove(key);
        else entries.push(entry);
      }

      return entries.sort((left, right) => left.at - right.at);
    },
    async put(entry) {
      storage.set(keyOf(entry.id), JSON.stringify(entry));
    },
    async remove(id) {
      storage.remove(keyOf(id));
    },
  };
}

/** Returns the entry a stored text holds, or null when it is not JSON or not an entry. */
function entryOf(text: string): JournalEntry | null {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }

  const result = JournalEntrySchema["~standard"].validate(value);

  return result instanceof Promise || result.issues !== undefined ? null : result.value;
}
