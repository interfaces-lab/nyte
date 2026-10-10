import { asId } from "@nyte-ai/schema";
import type {
  CommitId,
  DecodedObjectView,
  IntegrityReport,
  Json,
  ObjectId,
  Ref,
  SessionEvent,
  SessionId,
} from "@nyte-ai/schema";
import type { Host } from "./host.ts";
import type { Kernel } from "./kernel.ts";
import type { CommitRecord } from "./records.ts";
import { sessionRef } from "./refs.ts";
import { isJsonObject, objectOf, readCommit } from "./session-state.ts";

const PAGE = 100;

const LOG_PAGE = 256;

const RECORDS: ReadonlyMap<string, string> = new Map([
  ["heads", "commit"],
  ["inbox", "inbox"],
  ["runs", "run"],
  ["parts", "part"],
  ["receipts", "receipt"],
  ["seen", "seen"],
  ["leases", "lease"],
]);

type Issue = IntegrityReport["issues"][number];

/** Returns raw store reads for one session: its refs, its reachable objects decoded 100 to a page, its log after a seq, and an integrity check. */
export function inspect(kernel: Kernel, session: SessionId): ReturnType<Host["inspect"]> {
  return {
    refs: () => refsOf(kernel, session),
    async objects(input) {
      const cursor: string | undefined = input?.cursor;

      const objects = [...(await reachable(kernel, session)).values()].sort((left, right) =>
        left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
      );

      const found = cursor === undefined ? 0 : objects.findIndex((object) => object.id > cursor);
      const start = found < 0 ? objects.length : found;
      const items = objects.slice(start, start + PAGE);
      const last = items.at(-1);

      return {
        items,
        next: last !== undefined && start + PAGE < objects.length ? asId<"cursor">(last.id) : null,
      };
    },
    events: (input) => ({
      async *[Symbol.asyncIterator](): AsyncGenerator<SessionEvent> {
        let after = input.after;

        for (;;) {
          const events = await kernel.store.refs.log(session, after, LOG_PAGE);

          for (const event of events) {
            after = event.seq;
            yield event;
          }

          if (events.length < LOG_PAGE) return;
        }
      },
    }),
    verify: () => verify(kernel, session),
  };
}

async function refsOf(kernel: Kernel, session: SessionId): Promise<readonly Ref[]> {
  const [root, rest] = await Promise.all([
    kernel.store.refs.get(sessionRef(session)),
    kernel.store.refs.list(`${sessionRef(session)}/`),
  ]);

  return root === null ? rest : [root, ...rest];
}

async function reachable(
  kernel: Kernel,
  session: SessionId,
): Promise<ReadonlyMap<ObjectId, DecodedObjectView>> {
  const refs = await refsOf(kernel, session);
  const ids = new Set(refs.flatMap((ref) => (ref.target === null ? [] : [ref.target])));

  for (const [commit, record] of await ancestry(kernel, session, refs)) {
    if (record !== null) ids.add(objectOf(commit));
  }

  const views = new Map<ObjectId, DecodedObjectView>();

  for (const id of ids) {
    const view = decodeView(id, await kernel.store.objects.get(id));

    if (view !== null) views.set(id, view);
  }

  return views;
}

async function verify(kernel: Kernel, session: SessionId): Promise<IntegrityReport> {
  const issues: Issue[] = [];
  const refs = await refsOf(kernel, session);

  for (const ref of refs) {
    if (ref.target === null) continue;
    const object = await kernel.store.objects.get(ref.target);

    if (object === null) {
      issues.push({
        ref: ref.name,
        object: null,
        message: `${ref.name} points at a missing object.`,
      });
      continue;
    }

    const expected = recordOf(session, ref.name);
    const view = decodeView(ref.target, object);

    if (view === null || (expected !== null && view.kind !== expected))
      issues.push({
        ref: ref.name,
        object: null,
        message: `${ref.name} does not hold a ${expected ?? "stored"} record.`,
      });
  }

  const commits = await ancestry(kernel, session, refs);

  for (const [commit, record] of commits) {
    const parent = record?.parent ?? null;

    if (parent !== null && commits.get(parent) === null)
      issues.push({
        ref: null,
        object: commit,
        message: `Commit ${commit} names a parent that does not exist.`,
      });
  }

  return { ok: issues.length === 0, issues };
}

async function ancestry(
  kernel: Kernel,
  session: SessionId,
  refs: readonly Ref[],
): Promise<ReadonlyMap<CommitId, CommitRecord | null>> {
  const found = new Map<CommitId, CommitRecord | null>();

  const pending = refs.flatMap((ref) =>
    ref.target === null || recordOf(session, ref.name) !== "commit"
      ? []
      : [asId<"commit">(ref.target)],
  );

  for (let commit = pending.pop(); commit !== undefined; commit = pending.pop()) {
    if (found.has(commit)) continue;
    const record = await readCommit(kernel, commit);
    const parent = record?.parent ?? null;
    found.set(commit, record);

    if (parent !== null) pending.push(parent);
  }

  return found;
}

function recordOf(session: SessionId, name: string): string | null {
  const root = sessionRef(session);

  if (name === root) return "session";

  return RECORDS.get(name.slice(root.length + 1).split("/")[0] ?? "") ?? null;
}

function decodeView(id: ObjectId, object: Json | null): DecodedObjectView | null {
  if (!isJsonObject(object) || typeof object.kind !== "string" || typeof object.at !== "number")
    return null;
  const parent = object.parent;

  return {
    id,
    kind: object.kind,
    parent: typeof parent === "string" ? asId<"commit">(parent) : null,
    body: object.body ?? null,
    at: object.at,
  };
}
