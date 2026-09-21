import { Value } from "typebox/value";
import { delegationRecordSchema } from "./delegation-record.ts";
import type { Obj, Oid, Seq } from "./model.ts";
import type { Session } from "./store.ts";

const EVENT_PAGE_SIZE = 256;
const DELETE_BATCH_SIZE = 256;

function references(object: Obj): readonly Oid[] {
  if ("type" in object) return object.previous === null ? [] : [object.previous];
  switch (object.kind) {
    case "commit": {
      const oids: Oid[] = [];
      if (object.parent !== null) oids.push(object.parent);
      if ("imports" in object) oids.push(...object.imports);
      if (object.change !== undefined) oids.push(object.change);
      return oids;
    }
    case "effect":
      return object.state === "intent" ? [] : [object.intent];
    case "stack":
      return object.base === null ? [] : [object.base];
    case "run":
      return [];
    case "blob":
      return Value.Check(delegationRecordSchema, object.value) &&
        object.value.answer.kind === "ready" &&
        object.value.answer.source.kind === "run"
        ? [object.value.answer.source.oid]
        : [];
    default: {
      const _exhaustive: never = object;
      return _exhaustive;
    }
  }
}

async function markRoots(session: Session): Promise<Set<Oid>> {
  const pending: Oid[] = [];
  for (const ref of await session.refs.list("")) pending.push(ref.oid);

  let cursor = await session.events.floor();
  for (;;) {
    const events = await session.events.read({ afterSeq: cursor, limit: EVENT_PAGE_SIZE });
    if (events.length === 0) break;
    for (const event of events) {
      cursor = event.seq;
      if (event.kind !== "ref") continue;
      if (event.from !== null) pending.push(event.from);
      if (event.to !== null) pending.push(event.to);
    }
  }

  const marked = new Set<Oid>();
  for (let oid = pending.pop(); oid !== undefined; oid = pending.pop()) {
    if (marked.has(oid)) continue;
    marked.add(oid);
    const object = await session.objects.get(oid);
    if (object === undefined) continue;
    pending.push(...references(object));
  }
  return marked;
}

export async function collect(
  session: Session,
  options: { readonly graceMs: number; readonly now?: number },
): Promise<{ readonly scanned: number; readonly reachable: number; readonly swept: number }> {
  const now = options.now ?? Date.now();
  const marked = await markRoots(session);
  const stored = await session.objects.list();
  const expired: Oid[] = [];
  let reachable = 0;
  const cutoff = now - options.graceMs;

  for (const item of stored) {
    if (marked.has(item.oid)) {
      reachable += 1;
    } else if (item.at < cutoff) {
      expired.push(item.oid);
    }
  }

  let swept = 0;
  for (let index = 0; index < expired.length; index += DELETE_BATCH_SIZE) {
    swept += await session.objects.delete(expired.slice(index, index + DELETE_BATCH_SIZE));
  }

  return { scanned: stored.length, reachable, swept };
}

/**
 * Drops events through `keepAfterSeq` and returns the resulting floor. Trimming
 * lowers reflog protection. A host that wants both operations runs this before
 * `collect`.
 */
export async function trimStream(
  session: Session,
  options: { readonly keepAfterSeq: Seq },
): Promise<Seq> {
  await session.events.trim(options.keepAfterSeq);
  return session.events.floor();
}
