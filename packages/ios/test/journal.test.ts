import { asId } from "@nyte-ai/schema";
import { createSendJournal, SdkError } from "@nyte-ai/sdk";
import type { JournalEntry } from "@nyte-ai/sdk";
import { describe, expect, it } from "vitest";
import { askToMerge, draftKey, returnRefused, sendAnswer } from "../src/chat/send-answer.ts";
import type { SendOutcome } from "../src/chat/remote-chat.ts";
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

describe("how a send the journal holds ends on the phone", () => {
  it.each<[string, () => Parameters<typeof sendAnswer>[0], string]>([
    [
      "the host has it",
      () => Promise.resolve({ kind: "sent", receipt: { message: asId<"message">("m1") } }),
      "sent",
    ],
    [
      "the link closed while the journal keeps it",
      () => Promise.resolve({ kind: "unsent" }),
      "unsent",
    ],
    ["its unsent row was removed", () => Promise.resolve({ kind: "removed" }), "removed"],
    ["the host refused it", () => Promise.reject(new SdkError("invalid", "Refused.")), "refused"],
  ])(
    "when %s, the answer says so, and only a refusal gives the text back",
    async (_name, delivered, kind) => {
      expect((await sendAnswer(delivered(), () => "Refused.")).kind).toBe(kind);
    },
  );

  it.each<[string, string | undefined, string]>([
    ["an empty draft gets the replayed text", undefined, "Typed offline."],
    ["a draft with text keeps it after the replayed text", "Mine.", "Typed offline.\n\nMine."],
  ])(
    "a replayed send the host refused comes back to its chat's draft: %s",
    (_name, before, after) => {
      const values = new Map<string, string>();
      const key = draftKey("scope", asId<"session">("session-1"));

      if (before !== undefined) values.set(key, before);

      returnRefused(
        {
          getString: (stored) => values.get(stored),
          set: (stored, value) => void values.set(stored, value),
        },
        "scope",
        [
          {
            id: asId<"receipt">("r1"),
            session: asId<"session">("session-1"),
            head: asId<"head">("main"),
            content: [{ kind: "text", text: "Typed offline." }],
            error: new SdkError("invalid", "Refused."),
          },
        ],
      );

      expect(values.get(key)).toBe(after);
    },
  );

  it.each<[string, SendOutcome, string, boolean]>([
    [
      "the journal holds it and the host has not answered",
      { kind: "taken", answer: new Promise(() => undefined) },
      "back",
      false,
    ],
    [
      "the host refuses it after the journal took it",
      { kind: "taken", answer: Promise.resolve({ kind: "refused", error: "Refused." }) },
      "back",
      true,
    ],
    ["the journal never took it", { kind: "failed", error: "Offline." }, "failed", false],
  ])("asking to merge from the review, when %s", async (_name, outcome, kind, givenBack) => {
    let returned = false;

    const asked = await askToMerge(
      () => Promise.resolve(outcome),
      () => {
        returned = true;
      },
    );

    await Promise.resolve();
    expect([asked?.kind, returned]).toEqual([kind, givenBack]);
  });
});
