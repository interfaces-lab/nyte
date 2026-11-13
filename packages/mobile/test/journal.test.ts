import { asId } from "@nyte-ai/schema";
import { createSendJournal } from "@nyte-ai/sdk";
import type { JournalEntry } from "@nyte-ai/sdk";
import { describe, expect, it } from "vitest";
import { journalStorage } from "../src/connection/journal.ts";

function memory() {
  const values = new Map<string, string>();

  return {
    values,
    storage: journalStorage({
      getString: (key: string) => values.get(key),
      set: (key: string, value: string) => void values.set(key, value),
      remove: (key: string) => values.delete(key),
      getAllKeys: () => [...values.keys()],
    }),
  };
}

function entry(id: string, at: number): JournalEntry {
  return {
    id: asId<"receipt">(id),
    host: asId<"host">("host-1"),
    session: asId<"session">("session-1"),
    head: asId<"head">("main"),
    content: [{ kind: "text", text: `message ${id}` }],
    options: { delivery: "queue" },
    at,
  };
}

describe("the MMKV send journal", () => {
  it("loads what it put, oldest first, until each is removed", async () => {
    const { storage } = memory();
    const journal = createSendJournal(storage);

    await journal.put(entry("second", 2));
    await journal.put(entry("first", 1));
    expect((await journal.load()).map((item) => item.id)).toEqual(["first", "second"]);

    await journal.remove(asId<"receipt">("first"));
    expect(await journal.load()).toEqual([entry("second", 2)]);
  });

  it("survives a new journal over the same storage, as after a restart", async () => {
    const { storage } = memory();
    await createSendJournal(storage).put(entry("kept", 1));

    expect(await createSendJournal(storage).load()).toEqual([entry("kept", 1)]);
  });

  it("drops an entry that no longer reads as one", async () => {
    const { storage, values } = memory();
    const journal = createSendJournal(storage);
    await journal.put(entry("good", 1));
    values.set("bad", JSON.stringify({ id: "bad" }));
    values.set("torn", "{");

    expect((await journal.load()).map((item) => item.id)).toEqual(["good"]);
    expect([...values.keys()]).toEqual([JSON.stringify(["host-1", "good"])]);
  });
});
