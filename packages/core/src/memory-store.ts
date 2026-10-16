import { asId, asSeq } from "@nyte-ai/schema";
import type { BlobId, ObjectId, Ref, Revision, Seq, SessionId } from "@nyte-ai/schema";
import { blobId, objectId } from "./content.ts";
import { admits, decodeObject, collectSessionEvents, loggedEvent, setSeq } from "./store.ts";
import type { StoreConnection, Store } from "./store.ts";
import { projectSessionIndex, sessionIndexRef } from "./session-index.ts";
import type { SessionIndexEntry } from "./session-index.ts";
import { parseSessionRef } from "./refs.ts";

export function memoryStore(): Store {
  const objects = new Map<ObjectId, string>();
  const blobs = new Map<BlobId, Uint8Array>();
  const refs = new Map<string, Ref>();
  const indexed = new Map<string, SessionIndexEntry>();
  const versions = new Map<SessionId, Revision>();
  const logs = new Map<
    SessionId,
    { readonly seq: Seq; readonly at: number; readonly text: string }[]
  >();
  let minted = 0;

  const tail = (session: SessionId): Seq => logs.get(session)?.at(-1)?.seq ?? asSeq(0);

  const connection: StoreConnection = {
    sessions: {
      async list({ parents, after, limit }) {
        return [...indexed.entries()]
          .filter(
            (entry): entry is [string, Extract<SessionIndexEntry, { kind: "session" }>] =>
              entry[1].kind === "session" &&
              (parents.kind === "all" ||
                entry[1].parent === (parents.kind === "roots" ? null : parents.session)) &&
              (after === undefined ||
                entry[1].at < after.at ||
                (entry[1].at === after.at && byCodePoint(entry[1].session, after.id) > 0)),
          )
          .sort(
            (left, right) =>
              right[1].at - left[1].at || byCodePoint(left[1].session, right[1].session),
          )
          .slice(0, limit)
          .flatMap(([name, entry]) => {
            const ref = refs.get(name);

            return ref === undefined
              ? []
              : [{ ref, version: versions.get(entry.session) ?? ref.revision }];
          });
      },
      async work({ after, limit }) {
        const sessions = new Set(
          [...indexed.values()].flatMap((entry) =>
            entry.kind === "session" ? [] : [entry.session],
          ),
        );

        return [...sessions]
          .filter((session) => after === undefined || byCodePoint(session, after) > 0)
          .sort(byCodePoint)
          .flatMap((session) => {
            const ref = refs.get(`sessions/${session}`);

            return ref === undefined ? [] : [ref];
          })
          .slice(0, limit);
      },
      async pending({ kind, sessions }) {
        const selected = sessions === undefined ? null : new Set(sessions);

        return [...indexed.entries()]
          .filter(
            ([, entry]) =>
              entry.kind === kind && (selected === null || selected.has(entry.session)),
          )
          .flatMap(([name]) => {
            const ref = refs.get(name);

            return ref === undefined ? [] : [ref];
          })
          .sort((left, right) => byCodePoint(left.name, right.name));
      },
    },
    objects: {
      async put(object) {
        const id = await objectId(object);

        if (!objects.has(id)) objects.set(id, JSON.stringify(object));

        return id;
      },
      async get(id) {
        const text = objects.get(id);

        return text === undefined ? null : decodeObject(text);
      },
      async putBlob(bytes) {
        const chunks: Uint8Array[] = [];

        for await (const chunk of bytes) chunks.push(chunk);
        const joined = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
        let offset = 0;

        for (const chunk of chunks) {
          joined.set(chunk, offset);
          offset += chunk.byteLength;
        }

        const id = await blobId(joined);

        if (!blobs.has(id)) blobs.set(id, joined);

        return id;
      },
      async blob(id) {
        const bytes = blobs.get(id);

        if (!bytes) return null;

        return {
          size: bytes.byteLength,
          mime: null,
          async *chunks() {
            yield bytes;
          },
          close: async () => {},
          [Symbol.asyncDispose]: async () => {},
        };
      },
    },
    refs: {
      get: async (name) => refs.get(name) ?? null,
      list: async (prefix) =>
        [...refs.values()]
          .filter((ref) => ref.name.startsWith(prefix))
          .sort((left, right) => byCodePoint(left.name, right.name)),
      async set(updates) {
        const logged = collectSessionEvents(updates);
        const stale = updates.find((update) => !admits(update, refs.get(update.name)));

        if (stale)
          return {
            kind: "stale",
            name: stale.name,
            revision: refs.get(stale.name)?.revision ?? null,
          };

        const at = Date.now();

        const appended = logged.map(({ session, event }) => {
          const seq = asSeq(tail(session) + 1);
          const log = logs.get(session) ?? [];
          log.push({ seq, at, text: JSON.stringify(event) });
          logs.set(session, log);

          return seq;
        });

        const revisions = updates.map((update) => {
          minted += 1;
          const revision = asId<"revision">(`${minted}`);
          const session = parseSessionRef(update.name);

          if (session !== null) versions.set(session, revision);

          if (update.target === null) refs.delete(update.name);
          else refs.set(update.name, { name: update.name, target: update.target, revision });

          if (sessionIndexRef(update.name) !== null) {
            const body = update.target === null ? undefined : objects.get(update.target);
            const entry = projectSessionIndex(
              update.name,
              body === undefined ? null : decodeObject(body),
            );

            if (entry === null) indexed.delete(update.name);
            else indexed.set(update.name, entry);
          }

          return revision;
        });

        return { kind: "set", seq: setSeq(updates, appended, tail), revisions };
      },
      log: async (session, after, limit) =>
        (logs.get(session) ?? [])
          .filter((row) => row.seq > after)
          .slice(0, limit)
          .map((row) => loggedEvent(row.seq, row.at, JSON.parse(row.text))),
      tail: async (session) => tail(session),
    },
  };

  return {
    open: async () => connection,
    close: async () => {},
  };
}

function byCodePoint(left: string, right: string): number {
  for (let index = 0; index < left.length && index < right.length;) {
    const point = left.codePointAt(index) ?? 0;
    const difference = point - (right.codePointAt(index) ?? 0);

    if (difference !== 0) return difference;
    index += point > 0xffff ? 2 : 1;
  }

  return left.length - right.length;
}
