import type {
  ChangeSet,
  FileChange,
  RefUpdate,
  RunId,
  Seq,
  SessionId,
  SnapshotId,
  ToolClass,
} from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import { decodeRunRecord } from "../contract/records.ts";
import type { StoreConnection } from "../contract/store.ts";
import type { SnapshotScope } from "../contract/workspace.ts";
import { anotherChatLive, ownedChanges } from "../env/session-changes.ts";
import { runRef } from "../store/refs.ts";
import { attempt, load, put, STALE } from "../store/session.ts";
import { commit } from "../watch/commit.ts";

// oxlint-disable-next-line typescript/consistent-type-definitions -- stored as Json, which needs the implicit index signature only a type alias has
export type ToolBaseline = {
  readonly snapshot: SnapshotId;
  readonly seq: Seq;
  readonly contended: boolean;
};

export interface ToolChanges {
  readonly files: readonly FileChange[] | null;
  readonly thread: readonly FileChange[] | null;
  readonly snapshot: SnapshotId | null;
  readonly path: string | null;
  readonly unattributed: boolean;
}

export const NO_CHANGES: ToolChanges = {
  files: null,
  thread: null,
  snapshot: null,
  path: null,
  unattributed: false,
};

export async function baseline(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
  toolClass: ToolClass,
): Promise<ToolBaseline | null> {
  const snapshots = await kernel.environments.snapshots(session);

  if (snapshots === null) return null;

  const [seq, path] = await Promise.all([
    kernel.store.refs.tail(session),
    editedPath(kernel, session, toolClass),
  ]);

  const [before, contended] = await Promise.all([
    snapshots.capture(captureScope(toolClass, path)),
    anotherChatLive(kernel, session),
  ]);

  await attempt(`Recording run ${run}'s snapshot`, async () => {
    const found = await load(
      kernel.store,
      await kernel.store.refs.get(runRef(session, run)),
      decodeRunRecord,
    );

    if (found === null || found.record.snapshot !== null) return undefined;

    const outcome = await commit(kernel, [
      {
        name: found.ref.name,
        target: await put(kernel.store, "run", { ...found.record, snapshot: before }),
        expect: found.ref.revision,
      },
    ]);

    return outcome.kind === "set" ? undefined : STALE;
  });

  return { snapshot: before, seq, contended };
}

export async function toolChanges(
  kernel: Kernel,
  session: SessionId,
  before: ToolBaseline,
  toolClass: ToolClass,
): Promise<ToolChanges> {
  const snapshots = await kernel.environments.snapshots(session);

  if (snapshots === null) return NO_CHANGES;
  const path = await editedPath(kernel, session, toolClass);
  const to = await snapshots.capture(captureScope(toolClass, path));
  const changed = fileChanges(await snapshots.diff(before.snapshot, to));

  const unattributed =
    path === null &&
    changed.length > 0 &&
    (before.contended || (await anotherChatLive(kernel, session)));

  const files = unattributed
    ? []
    : changed.filter((file) => path === null || file.path === path || file.from === path);

  const thread =
    files.length === 0 && !unattributed
      ? null
      : fileChanges(
          await ownedChanges(
            kernel.store,
            snapshots,
            session,
            to,
            files.map((file) => file.path),
          ),
        );

  return { files, thread, snapshot: to, path, unattributed };
}

export async function nextBase(
  store: StoreConnection,
  session: SessionId,
  run: RunId,
  to: SnapshotId,
): Promise<readonly RefUpdate[]> {
  const found = await load(store, await store.refs.get(runRef(session, run)), decodeRunRecord);

  if (found === null || found.record.lastSnapshot === to) return [];

  return [
    {
      name: found.ref.name,
      target: await put(store, "run", { ...found.record, lastSnapshot: to }),
      expect: found.ref.revision,
    },
  ];
}

async function editedPath(
  kernel: Kernel,
  session: SessionId,
  toolClass: ToolClass,
): Promise<string | null> {
  if (toolClass.kind !== "edit") return null;

  if (!/^(?:[\\/]|[A-Za-z]:)/.test(toolClass.path)) return toolClass.path.replace(/^\.\//, "");
  const root = (await kernel.environments.attach(session)).cwd.replace(/[\\/]+$/, "");

  return toolClass.path.startsWith(`${root}/`) || toolClass.path.startsWith(`${root}\\`)
    ? toolClass.path.slice(root.length + 1).replaceAll("\\", "/")
    : null;
}

function captureScope(toolClass: ToolClass, path: string | null): SnapshotScope {
  if (toolClass.kind !== "edit") return { kind: "workspace" };

  return { kind: "paths", paths: path === null ? [] : [path] };
}

function fileChanges(set: ChangeSet): readonly FileChange[] {
  return set.files.map((file): FileChange => {
    const change: FileChange = {
      path: file.path,
      status: file.status,
      added: file.stat.kind === "text" ? file.stat.added : 0,
      removed: file.stat.kind === "text" ? file.stat.removed : 0,
    };

    return file.from === undefined ? change : { ...change, from: file.from };
  });
}
