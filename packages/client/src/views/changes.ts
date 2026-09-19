/**
 * Change tracking: settled `file_patch` results fold into per-file totals.
 * The fold consumes turns, not raw commits, so a client folds the same
 * message commits it already renders and a git panel needs no second read.
 * Declared mutations only: whole-tree truth is the host's VCS.
 *
 * Design: packages/docs/content/docs/design.mdx, "Views" and the nineteenth
 * revision.
 */
import type { FileChange } from "@nyte-ai/protocol";
import type { Oid } from "@nyte-ai/protocol";
import type { Turn } from "./transcript.ts";

export type { FileChange } from "@nyte-ai/protocol";

/**
 * Incremental fold state. `folded` holds the result commits already counted,
 * so re-folding a turn the transcript updated in place (a result settling into
 * its call) is a no-op per result, mirroring the transcript's own repeat guard.
 */
export interface ChangesState {
  readonly files: readonly FileChange[];
  readonly folded: ReadonlySet<Oid>;
}

export const EMPTY_CHANGES: ChangesState = { files: [], folded: new Set() };

/** Fold one turn's settled patches into the totals. Errors do not count as changes. */
export function appendTurnChanges(state: ChangesState, turn: Turn): ChangesState {
  const builder: ChangesBuilder = { base: state };
  accumulateTurnChanges(builder, turn);
  return builder.owned ?? state;
}

export function changesFromTurns(turns: readonly Turn[]): readonly FileChange[] {
  const builder: ChangesBuilder = { base: EMPTY_CHANGES };
  for (const turn of turns) accumulateTurnChanges(builder, turn);
  return builder.owned?.files ?? [];
}

interface ChangesBuilder {
  readonly base: ChangesState;
  /** `index` maps a path to its position in `files`, which keeps first-seen order. */
  owned?: { files: FileChange[]; index: Map<string, number>; folded: Set<Oid> };
}

/** Copy shared containers only on the first contribution; replace shared file values. */
function accumulateTurnChanges(builder: ChangesBuilder, turn: Turn): void {
  if (turn.kind !== "turn") return;
  for (const part of turn.parts) {
    if (part.kind !== "tool" || part.result === undefined || part.class.kind !== "file_patch") {
      continue;
    }
    const { result } = part;
    if (result.isError || (builder.owned ?? builder.base).folded.has(result.commit)) continue;
    builder.owned ??= {
      files: [...builder.base.files],
      index: new Map(builder.base.files.map((entry, position) => [entry.path, position])),
      folded: new Set(builder.base.folded),
    };
    const { files, index } = builder.owned;
    builder.owned.folded.add(result.commit);
    const { path } = part.class;
    const position = index.get(path);
    const previous = position === undefined ? undefined : files[position];
    const change: FileChange = {
      path,
      added: (previous?.added ?? 0) + part.class.added,
      removed: (previous?.removed ?? 0) + part.class.removed,
    };
    if (position === undefined) index.set(path, files.push(change) - 1);
    else files[position] = change;
  }
}
