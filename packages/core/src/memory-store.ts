import { asId, asSeq } from "@nyte-ai/schema";
import type {
  BlobId,
  Json,
  ObjectId,
  Ref,
  RefUpdate,
  Seq,
  SessionEvent,
  SessionId,
} from "@nyte-ai/schema";
import { blobId, objectId } from "./content.ts";
import { SdkError } from "./error.ts";
import { sessionOf } from "./refs.ts";
import type { StoreConnection, Store } from "./store.ts";

/** Returns an in-memory `Store` with `kind: "memory"`, for tests and bench. */
export function memoryStore(): Store {
  const objects = new Map<ObjectId, Json>();
  const blobs = new Map<BlobId, Uint8Array>();
  const refs = new Map<string, Ref>();
  const logs = new Map<SessionId, SessionEvent[]>();
  let minted = 0;

  const tail = (session: SessionId): Seq => logs.get(session)?.at(-1)?.seq ?? asSeq(0);

  const connection: StoreConnection = {
    objects: {
      async put(object) {
        const id = await objectId(object);

        if (!objects.has(id)) objects.set(id, object);

        return id;
      },
      get: async (id) => objects.get(id) ?? null,
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
          .sort((left, right) => (left.name < right.name ? -1 : 1)),
      async set(updates) {
        const stale = updates.find((update) => !admits(update, refs.get(update.name)));

        if (stale)
          return {
            kind: "stale",
            name: stale.name,
            revision: refs.get(stale.name)?.revision ?? null,
          };

        const logged = updates.flatMap((update) => {
          if (!update.event) return [];
          const session = sessionOf(update.name);

          if (session === null)
            throw new SdkError(
              "internal",
              `${update.name} is outside a session and cannot carry an event`,
            );

          return [{ session, event: update.event }];
        });

        const at = Date.now();

        const seqs = logged.map(({ session, event }) => {
          const seq = asSeq(tail(session) + 1);
          const log = logs.get(session) ?? [];
          log.push({ seq, at, ...event });
          logs.set(session, log);

          return seq;
        });

        const revisions = updates.map((update) => {
          minted += 1;
          const revision = asId<"revision">(`${minted}`);

          if (update.target === null) refs.delete(update.name);
          else refs.set(update.name, { name: update.name, target: update.target, revision });

          return revision;
        });

        const session = updates.map((update) => sessionOf(update.name)).find((id) => id !== null);

        return { kind: "set", seq: seqs.at(-1) ?? (session ? tail(session) : asSeq(0)), revisions };
      },
      log: async (session, after, limit) =>
        (logs.get(session) ?? []).filter((event) => event.seq > after).slice(0, limit),
      tail: async (session) => tail(session),
    },
    close: async () => {},
  };

  return {
    kind: "memory",
    open: async () => connection,
    close: async () => {},
  };
}

function admits(update: RefUpdate, current: Ref | undefined): boolean {
  if (update.expect === undefined) return true;

  if (update.expect === "absent") return current === undefined;

  return current?.revision === update.expect;
}
