import type { CommitId, HeadName, SessionId, TreeNode, TreeView } from "@nyte-ai/schema";
import type { FoldState } from "./fold.ts";
import type { Kernel } from "./kernel.ts";
import type { CommitRecord, PartRecord } from "./records.ts";
import {
  EMPTY_REVISION,
  START,
  isJsonObject,
  pathOf,
  textOf,
  tipOf,
  withFold,
} from "./session-state.ts";

const PREVIEW = 80;

/** Returns one commit with its id, as a tree row is built from it. */
interface Commit {
  readonly id: CommitId;
  readonly record: CommitRecord;
}

/** Returns the session's commit DAG as rows for a head: every commit on every branch, retained edits included, parents first, siblings in creation order, the head's path active. */
export async function tree(kernel: Kernel, session: SessionId, head: HeadName): Promise<TreeView> {
  return withFold(kernel, session, (state) => rows(state, head));
}

function rows(state: FoldState, head: HeadName): TreeView {
  const tips = new Map<CommitId, HeadName[]>();

  for (const [name, folded] of state.heads) {
    const tip = tipOf(folded.info.tip);

    if (tip !== null) tips.set(tip, [...(tips.get(tip) ?? []), name]);
  }

  const children = new Map<CommitId | null, Commit[]>();

  for (const [id, record] of state.commits) {
    const parent =
      record.parent !== null && state.commits.has(record.parent) ? record.parent : null;

    const siblings = children.get(parent) ?? [];
    siblings.push({ id, record });
    children.set(parent, siblings);
  }

  for (const siblings of children.values())
    siblings.sort((left, right) => left.record.at - right.record.at);

  const folded = state.heads.get(head);
  const tip = folded?.info.tip ?? START;
  const active = new Set(pathOf(state.commits, tipOf(tip)));
  const nodes: TreeNode[] = [];

  const pending: { readonly commit: Commit; readonly depth: number; readonly branch: boolean }[] =
    [];

  const enqueue = (siblings: readonly Commit[], depth: number): void => {
    for (let index = siblings.length - 1; index >= 0; index -= 1)
      pending.push({ commit: siblings[index], depth, branch: siblings.length > 1 && index === 0 });
  };

  enqueue(children.get(null) ?? [], 0);

  for (let entry = pending.pop(); entry !== undefined; entry = pending.pop()) {
    const { id, record } = entry.commit;
    const body = record.body;
    const part = body.kind === "user" ? undefined : state.parts.get(body.part);

    nodes.push({
      id,
      parent: record.parent,
      depth: entry.depth,
      branch: entry.branch,
      active: active.has(id),
      heads: tips.get(id) ?? [],
      kind: body.kind,
      partKind: body.kind === "part" ? (part?.partKind ?? null) : null,
      preview:
        body.kind === "user"
          ? textOf(body.content).replace(/\s+/g, " ").trim().slice(0, PREVIEW)
          : partPreview(part),
      at: record.at,
      run: record.run,
    });
    enqueue(children.get(id) ?? [], entry.depth + 1);
  }

  return { revision: folded?.revision ?? EMPTY_REVISION, tip, nodes };
}

function partPreview(part: PartRecord | undefined): string {
  if (part === undefined) return "";
  const state = part.state;

  const text = !isJsonObject(state)
    ? null
    : typeof state.markdown === "string"
      ? state.markdown
      : typeof state.summary === "string"
        ? state.summary
        : typeof state.name === "string"
          ? state.name
          : null;

  const line = (text ?? part.partKind).split("\n").find((current) => current.trim() !== "") ?? "";

  return line.trim().slice(0, PREVIEW);
}
