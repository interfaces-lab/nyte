import { asSeq } from "@nyte-ai/schema";
import type {
  CallId,
  ChangeSet,
  HeadName,
  PartId,
  RunId,
  Seq,
  SessionId,
  SnapshotId,
} from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import type { StoreConnection } from "../contract/store.ts";
import type { SnapshotsApi } from "../contract/workspace.ts";
import { withFold } from "../fold/reads.ts";
import type { SessionRecord } from "../contract/records.ts";
import { liveRunsOn, readSession, threadStart } from "../store/session.ts";

const LOG_PAGE = 256;

export async function readAttributedPaths(
  store: StoreConnection,
  session: SessionId,
  after: Seq = asSeq(0),
  charged: (call: {
    readonly head: HeadName | null;
    readonly call: CallId;
    readonly part: PartId;
  }) => boolean = () => true,
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

  return keepPaths(await snapshots.diff(from ?? to, to), new Set([...attributed, ...extra]));
}

export async function readRunPaths(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
): Promise<ReadonlySet<string>> {
  const parts = await withFold(
    kernel,
    session,
    (state) =>
      new Set([...state.parts.values()].flatMap((part) => (part.run === run ? [part.id] : []))),
  );

  return readAttributedPaths(kernel.store, session, asSeq(0), (event) => parts.has(event.part));
}

export function keepPaths(changes: ChangeSet, paths: ReadonlySet<string>): ChangeSet {
  return {
    ...changes,
    files: changes.files.filter(
      (file) => paths.has(file.path) || (file.from !== undefined && paths.has(file.from)),
    ),
  };
}

export async function anotherChatLive(kernel: Kernel, session: SessionId): Promise<boolean> {
  const own = await readSession(kernel.store, session);

  if (own === null) return false;
  const workspace = own.record.workspace;
  const live = await liveRunsOn(kernel.store, workspace);
  const known = new Map(live.map((entry) => [entry.session.id, entry.session]));

  const working = kernel.jobs
    .list(workspace)
    .flatMap((entry) =>
      entry.view.state.kind === "running" && entry.owner !== null ? [entry.owner.session] : [],
    );

  const others = [...new Set([...known.keys(), ...working])].filter((id) => id !== session);

  if (others.length === 0) return false;

  const [family, roots] = await Promise.all([
    findRoot(kernel.store, own.record),
    Promise.all(
      others.map(async (id) => {
        const record = known.get(id) ?? (await readSession(kernel.store, id))?.record;

        return record === undefined || record.workspace !== workspace
          ? null
          : findRoot(kernel.store, record);
      }),
    ),
  ]);

  return roots.some((root) => root !== null && root !== family);
}

async function findRoot(store: StoreConnection, record: SessionRecord): Promise<SessionId> {
  if (record.parent === null) return record.id;
  const parent = await readSession(store, record.parent);

  return parent === null ? record.parent : findRoot(store, parent.record);
}
