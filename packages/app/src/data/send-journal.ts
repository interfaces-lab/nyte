import { createSendJournal } from "@nyte-ai/sdk";
import type { JournalStorage, RequestJournal } from "@nyte-ai/sdk";
import { guardWrite, localArea } from "../lib/storage.ts";

export type JournalArea = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

const PREFIX = "nyte:journal:v1:";

/**
 * The send journal in `localStorage`, which every window and tab of one origin shares and a reload
 * or a closed tab keeps. Its writes are synchronous, so a message is stored before the window can
 * close. A write the storage refuses reports that storage is full and the message is still sent;
 * it then lasts only as long as this window.
 */
export function localJournal(area: JournalArea | undefined = localArea()): RequestJournal {
  return area === undefined ? createSendJournal() : createSendJournal(journalStorage(area));
}

function journalStorage(area: JournalArea): JournalStorage {
  return {
    read: () =>
      Array.from({ length: area.length }, (_, index) => area.key(index)).flatMap((key) => {
        const text = key?.startsWith(PREFIX) === true ? area.getItem(key) : null;

        return key === null || text === null ? [] : [[key.slice(PREFIX.length), text] as const];
      }),
    write: (key, text) => guardWrite(() => area.setItem(`${PREFIX}${key}`, text)),
    remove: (key) => area.removeItem(`${PREFIX}${key}`),
  };
}
