import { asId } from "@nyte-ai/schema";
import type { JournalEntry } from "@nyte-ai/sdk";
import { describe, expect, it } from "vitest";
import { createJournal } from "../src/connection/journal.ts";

function memory() {
  const values = new Map<string, string>();

  return {
    values,
    storage: {
      getString: (key: string) => values.get(key),
      set: (key: string, value: string) => void values.set(key, value),
      remove: (key: string) => values.delete(key),
      getAllKeys: () => [...values.keys()],
    },
  };
}

function entry(id: string, at: number): JournalEntry {
  return {
    id: asId<"receipt">(id),
    session: asId<"session">("session-1"),
    head: asId<"head">("main"),
    content: [{ kind: "text", text: `message ${id}` }],
    options: { delivery: "queue" },
    at,
  };
}

describe("createJournal", () => {
  it("loads what it put, oldest first, until each is removed", async () => {
    const { storage } = memory();
    const journal = createJournal(storage, "route-a");

    await journal.put(entry("second", 2));
    await journal.put(entry("first", 1));
    expect((await journal.load()).map((item) => item.id)).toEqual(["first", "second"]);

    await journal.remove(asId<"receipt">("first"));
    expect(await journal.load()).toEqual([entry("second", 2)]);
  });

  it("survives a new journal over the same storage, as after a restart", async () => {
    const { storage } = memory();
    await createJournal(storage, "route-a").put(entry("kept", 1));

    expect(await createJournal(storage, "route-a").load()).toEqual([entry("kept", 1)]);
  });

  it("keeps routes apart, and leaves keys it does not own alone", async () => {
    const { storage, values } = memory();
    values.set("nyte.other", "untouched");
    await createJournal(storage, "route-a").put(entry("a", 1));
    await createJournal(storage, "route-ab").put(entry("ab", 1));

    expect((await createJournal(storage, "route-a").load()).map((item) => item.id)).toEqual(["a"]);
    expect(values.get("nyte.other")).toBe("untouched");
  });

  it("drops an entry that no longer reads as one", async () => {
    const { storage, values } = memory();
    const journal = createJournal(storage, "route-a");
    await journal.put(entry("good", 1));
    values.set(JSON.stringify(["route-a", "bad"]), JSON.stringify({ id: "bad" }));
    values.set(JSON.stringify(["route-a", "torn"]), "{");

    expect((await journal.load()).map((item) => item.id)).toEqual(["good"]);
    expect([...values.keys()]).toEqual([JSON.stringify(["route-a", "good"])]);
  });
});
