import { createSendJournal } from "@nyte-ai/sdk";
import type { JournalStorage, RequestJournal } from "@nyte-ai/sdk";
import { Type } from "typebox";
import { guardWrite, localArea, readStored } from "../lib/storage.ts";

export type JournalArea = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

const PREFIX = "nyte:journal:v1:";

const receiptSchema = Type.Object({ id: Type.String() });

export function localJournal(area: JournalArea | undefined = localArea()): RequestJournal {
  return area === undefined ? createSendJournal() : createSendJournal(journalStorage(area));
}

export function journaledReceipts(): ReadonlySet<string> {
  const area = localArea();

  if (area === undefined) return new Set();

  return new Set(
    journalKeys(area).flatMap((key) => {
      const entry = readStored(area, key, receiptSchema, undefined);

      return entry === undefined ? [] : [entry.id];
    }),
  );
}

function journalKeys(area: JournalArea): readonly string[] {
  return Array.from({ length: area.length }, (_, index) => area.key(index)).flatMap((key) =>
    key?.startsWith(PREFIX) === true ? [key] : [],
  );
}

function journalStorage(area: JournalArea): JournalStorage {
  return {
    read: () =>
      journalKeys(area).flatMap((key) => {
        const text = area.getItem(key);

        return text === null ? [] : [[key.slice(PREFIX.length), text] as const];
      }),
    write(key, text) {
      const stored = `${PREFIX}${key}`;

      if (area.getItem(stored) !== null) {
        guardWrite(() => area.setItem(stored, text));

        return;
      }

      try {
        area.setItem(stored, text);
      } catch (cause) {
        throw new Error("Storage is full.", { cause });
      }
    },
    remove: (key) => area.removeItem(`${PREFIX}${key}`),
  };
}
