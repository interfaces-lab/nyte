import { asSeq } from "@nyte-ai/schema";
import type { CallId, ChangeSet, HeadName, Seq, SessionId, SnapshotId } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import type { StoreConnection } from "../contract/store.ts";
import type { SnapshotsApi } from "../contract/workspace.ts";
import { listSessionRecords, liveRuns, threadStart } from "../store/session.ts";

const LOG_PAGE = 256;

export async function readAttributedPaths(
  store: StoreConnection,
  session: SessionId,
  after: Seq = asSeq(0),
  charged: (call: { readonly head: HeadName | null; readonly call: CallId }) => boolean = () =>
    true,
): Promise<ReadonlySet<string>> {
  const through = await store.refs.tail(session);
  const paths = new Set<string>();
  let cursor = after;

  while (cursor < through) {
    const events = await store.refs.log(session, cursor, LOG_PAGE);

    for (const event of events)
      if (
        event.seq <= through &&
        event.kind === "call" &&
        event.change === "settled" &&
        charged(event)
      )
        for (const path of event.changes?.paths ?? []) paths.add(path);

    const last = events.at(-1);

    if (last === undefined) break;
    cursor = last.seq;
  }

  return paths;
}

export async function ownedChanges(
  store: StoreConnection,
  snapshots: SnapshotsApi,
  session: SessionId,
  to: SnapshotId,
  extra: readonly string[] = [],
): Promise<ChangeSet> {
  const [from, attributed] = await Promise.all([
    threadStart(store, session),
    readAttributedPaths(store, session),
  ]);

  const owned = new Set([...attributed, ...extra]);
  const changes = await snapshots.diff(from ?? to, to);

  return {
    ...changes,
    files: changes.files.filter(
      (file) => owned.has(file.path) || (file.from !== undefined && owned.has(file.from)),
    ),
  };
}

export async function anotherChatLive(kernel: Kernel, session: SessionId): Promise<boolean> {
  const records = await listSessionRecords(kernel.store);
  const parents = new Map(records.map((record) => [record.id, record.parent]));

  const findRoot = (id: SessionId): SessionId => {
    const parent = parents.get(id);

    return parent === null || parent === undefined ? id : findRoot(parent);
  };

  const workspace = records.find((record) => record.id === session)?.workspace;

  if (workspace === undefined) return false;
  const family = findRoot(session);

  const others = new Set(
    records.flatMap((record) =>
      record.workspace === workspace && findRoot(record.id) !== family ? [record.id] : [],
    ),
  );

  const working = kernel.jobs
    .list(workspace)
    .some(
      (entry) =>
        entry.view.state.kind === "running" &&
        entry.owner !== null &&
        others.has(entry.owner.session),
    );

  if (working) return true;
  const runs = await Promise.all([...others].map((id) => liveRuns(kernel.store, id)));

  return runs.some((live) => live.length > 0);
}
