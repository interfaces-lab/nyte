/**
 * Change tracking: settled tool results that carry a patch fold into per-file
 * totals. The fold consumes turns, not raw commits, so a client folds the same
 * message commits it already renders and a git panel needs no second read.
 * Declared mutations only: whole-tree truth is the host's VCS.
 *
 * Design: packages/docs/content/docs/design.mdx, "Views" and the nineteenth
 * revision.
 */
import { parsePatch } from "diff";
import { isJsonObject, type JsonValue } from "../json.ts";
import type { FileChange } from "@nyte-ai/protocol";
import type { Oid } from "../model.ts";
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

function isString(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

/** The unified patch a settled result declares, under either conventional key. */
export function readPatch(details: JsonValue | undefined): string | undefined {
  if (!isJsonObject(details)) return undefined;
  const patch = details["patch"];
  if (isString(patch) && patch !== "") return patch;
  const diff = details["diff"];
  return isString(diff) && diff.startsWith("---") ? diff : undefined;
}

export function patchedPath(patch: string): string | undefined {
  let name: string | undefined;
  try {
    const file = parsePatch(patch)[0];
    name = file?.newFileName ?? file?.oldFileName;
  } catch {
    return undefined;
  }
  if (name === undefined || name === "/dev/null") return undefined;
  return name.startsWith("b/") ? name.slice(2) : name;
}

interface DiffStat {
  readonly added: number;
  readonly removed: number;
}

export function diffStat(patch: string): DiffStat {
  let added = 0;
  let removed = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

/**
 * Fold one turn's settled patches into the totals. Errors do not count as
 * changes, and a patch whose path cannot be read is skipped rather than
 * attributed to a guess.
 */
export function appendTurnChanges(state: ChangesState, turn: Turn): ChangesState {
  if (turn.kind !== "turn") return state;
  let files: FileChange[] | undefined;
  let folded: Set<Oid> | undefined;
  for (const part of turn.parts) {
    if (part.kind !== "tool" || part.result === undefined) continue;
    const { result } = part;
    if (result.isError || state.folded.has(result.commit) || folded?.has(result.commit)) continue;
    const patch = readPatch(result.details);
    if (patch === undefined) continue;
    const path = patchedPath(patch);
    if (path === undefined) continue;
    const stat = diffStat(patch);
    files ??= [...state.files];
    folded ??= new Set(state.folded);
    folded.add(result.commit);
    const index = files.findIndex((file) => file.path === path);
    const previous = files[index];
    const change: FileChange = {
      path,
      added: (previous?.added ?? 0) + stat.added,
      removed: (previous?.removed ?? 0) + stat.removed,
      lastCommit: result.commit,
    };
    if (previous === undefined) files.push(change);
    else files[index] = change;
  }
  return files === undefined || folded === undefined ? state : { files, folded };
}

export function changesFromTurns(turns: readonly Turn[]): readonly FileChange[] {
  return [...turns.reduce(appendTurnChanges, EMPTY_CHANGES).files];
}
