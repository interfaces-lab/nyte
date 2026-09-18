/**
 * Change tracking: settled tool results that carry a patch fold into per-file
 * totals. The fold consumes turns, not raw commits, so a client folds the same
 * message commits it already renders and a git panel needs no second read.
 * Declared mutations only: whole-tree truth is the host's VCS.
 *
 * Design: packages/docs/content/docs/design.mdx, "Views" and the nineteenth
 * revision.
 */
import { isJsonObject, type JsonValue } from "../json.ts";
import type { FileChange } from "@nyte-ai/protocol";
import type { Oid } from "@nyte-ai/protocol";
import type { Turn } from "./transcript.ts";
import { parsePatchFacts, type PatchStat } from "./patch.ts";

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

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** The unified patch a settled result declares, under either conventional key. */
export function readPatch(details: JsonValue | undefined): string | undefined {
  if (!isJsonObject(details)) return undefined;
  const patch = details.patch;
  if (isString(patch) && patch !== "") return patch;
  const diff = details.diff;
  return isString(diff) && diff.startsWith("---") ? diff : undefined;
}

export function patchedPath(patch: string): string | undefined {
  return parsePatchFacts(patch)?.files[0]?.path;
}

export function diffStat(patch: string): PatchStat {
  const facts = parsePatchFacts(patch);
  return { added: facts?.added ?? 0, removed: facts?.removed ?? 0 };
}

/**
 * Fold one turn's settled patches into the totals. Errors do not count as
 * changes, and a patch whose path cannot be read is skipped rather than
 * attributed to a guess.
 */
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
    if (part.kind !== "tool" || part.result === undefined) continue;
    const { result } = part;
    if (result.isError || (builder.owned ?? builder.base).folded.has(result.commit)) continue;
    const patch = readPatch(result.details);
    if (patch === undefined) continue;
    const facts = parsePatchFacts(patch);
    if (facts === undefined) continue;
    for (const file of facts.files) {
      const path = file.path;
      if (path === undefined) continue;
      builder.owned ??= {
        files: [...builder.base.files],
        index: new Map(builder.base.files.map((entry, position) => [entry.path, position])),
        folded: new Set(builder.base.folded),
      };
      const { files, index } = builder.owned;
      builder.owned.folded.add(result.commit);
      const position = index.get(path);
      const previous = position === undefined ? undefined : files[position];
      const change: FileChange = {
        path,
        added: (previous?.added ?? 0) + file.added,
        removed: (previous?.removed ?? 0) + file.removed,
        lastCommit: result.commit,
      };
      if (position === undefined) index.set(path, files.push(change) - 1);
      else files[position] = change;
    }
  }
}
