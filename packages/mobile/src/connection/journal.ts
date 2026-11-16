import type { JournalStorage } from "@nyte-ai/sdk";

export interface KeyValues {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): boolean;
  getAllKeys(): string[];
}

export function journalStorage(values: KeyValues): JournalStorage {
  return {
    read: () =>
      values.getAllKeys().flatMap((key) => {
        const text = values.getString(key);

        return text === undefined ? [] : [[key, text] as const];
      }),
    write: (key, text) => values.set(key, text),
    remove: (key) => void values.remove(key),
  };
}
