import { parsePatchFacts, readPatch } from "@nyte-ai/core/views";
import { formatPatch } from "diff";
import type { FileChange, Turn } from "@nyte-ai/core";
import type { WorkbenchChangesScope } from "./controller.ts";

type TurnChangesScope = Extract<WorkbenchChangesScope, { kind: "turn" }>;

export interface TurnChangeOption {
  readonly scope: TurnChangesScope;
  readonly label: string;
  readonly stats: { readonly added: number; readonly removed: number };
  readonly files: readonly {
    readonly change: FileChange;
    readonly patch: string;
    /** Original tool output, including all files and header metadata. */
    readonly rawPatches: readonly string[];
  }[];
}

function changeStats(changes: readonly FileChange[]): TurnChangeOption["stats"] {
  return changes.reduce(
    (total, change) => ({
      added: total.added + change.added,
      removed: total.removed + change.removed,
    }),
    { added: 0, removed: 0 },
  );
}

/** Newest first; each option carries the exact patches that produced its totals. */
export function turnChangeOptions(turns: readonly Turn[]): readonly TurnChangeOption[] {
  const turnCount = turns.reduce((count, turn) => (turn.kind === "turn" ? count + 1 : count), 0);
  const options: TurnChangeOption[] = [];
  let ordinal = 0;
  for (const turn of turns) {
    if (turn.kind !== "turn") continue;
    ordinal += 1;
    const rows = new Map<string, TurnChangeOption["files"][number]>();
    const folded = new Set<string>();
    for (const part of turn.parts) {
      if (part.kind !== "tool" || part.result === undefined || part.result.isError) continue;
      const result = part.result;
      if (folded.has(result.commit)) continue;
      const patch = readPatch(result.details);
      if (patch === undefined) continue;
      const facts = parsePatchFacts(patch);
      if (facts === undefined) continue;
      for (const file of facts.files) {
        if (file.path === undefined) continue;
        folded.add(result.commit);
        const previous = rows.get(file.path);
        // Keep exact bytes for single-file results; format canonical hunks for multi-file rows.
        const filePatch = facts.files.length === 1 ? facts.patch : formatPatch(file);
        rows.set(file.path, {
          change: {
            path: file.path,
            added: (previous?.change.added ?? 0) + file.added,
            removed: (previous?.change.removed ?? 0) + file.removed,
            lastCommit: result.commit,
          },
          patch: previous === undefined ? filePatch : `${previous.patch}\n${filePatch}`,
          rawPatches: [...(previous?.rawPatches ?? []), facts.patch],
        });
      }
    }
    const files = [...rows.values()];
    options.push({
      scope: { kind: "turn", turnId: turn.id },
      label: ordinal === turnCount ? "Latest" : `Turn ${String(ordinal)}`,
      stats: changeStats(files.map((file) => file.change)),
      files,
    });
  }
  return options.reverse();
}

export function turnHasChanges(option: TurnChangeOption): boolean {
  return option.files.length > 0;
}

/** Empty turns stay hidden until asked for, except the one already on screen. */
export function visibleTurnOptions(
  options: readonly TurnChangeOption[],
  showAll: boolean,
  selectedTurnId: TurnChangesScope["turnId"] | undefined,
): readonly TurnChangeOption[] {
  if (showAll) return options;
  return options.filter(
    (option) => turnHasChanges(option) || option.scope.turnId === selectedTurnId,
  );
}
