import type { JournalEntry } from "@nyte-ai/schema";
import type { RequestJournal } from "@nyte-ai/core";

/** Returns the default request journal: entries in memory, in the order they were first written, gone with the process. Enough for a cli or a script; a client that must survive its own restart passes a persistent one. */
export function memoryJournal(): RequestJournal {
  const entries = new Map<string, JournalEntry>();

  return {
    load: async () => [...entries.values()],
    async put(entry) {
      entries.set(entry.id, entry);
    },
    async remove(id) {
      entries.delete(id);
    },
  };
}
