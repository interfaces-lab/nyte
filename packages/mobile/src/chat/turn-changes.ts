import type { Turn } from "@nyte-ai/protocol";
import {
  changesFromTurns,
  parsePatchFacts,
  readPatch,
  type FileChange,
  type PatchFile,
} from "@nyte-ai/client";

/** Change evidence from the transcript itself — live, with no second read. */
export function conversationChanges(items: readonly Turn[]): readonly FileChange[] {
  return changesFromTurns(items);
}

/** The turn variant of the transcript's `Turn` union. */
export type ConversationTurn = Extract<Turn, { kind: "turn" }>;

/** The newest turn that wrote files — the anchor for the review summary. */
export function latestChangedTurn(items: readonly Turn[]): ConversationTurn | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const turn = items[index];
    if (turn === undefined || turn.kind !== "turn") continue;
    if (changesFromTurns([turn]).length > 0) return turn;
  }
  return undefined;
}

export interface RecordedEdit {
  readonly turnId: string;
  readonly commit: string;
  readonly title: string;
  readonly file: PatchFile;
}

/** One edit per settled patch, grouped by file in order, for the diff view. */
export function recordedEdits(items: readonly Turn[]): Map<string, RecordedEdit[]> {
  const groups = new Map<string, RecordedEdit[]>();
  for (const turn of items) {
    if (turn.kind !== "turn") continue;
    for (const part of turn.parts) {
      if (part.kind !== "tool" || part.result === undefined || part.result.isError) continue;
      const patch = readPatch(part.result.details);
      if (patch === undefined) continue;
      const facts = parsePatchFacts(patch);
      if (facts === undefined) continue;
      for (const file of facts.files) {
        if (file.path === undefined) continue;
        const edit: RecordedEdit = {
          turnId: turn.id,
          commit: part.result.commit,
          title: part.result.title ?? part.toolName,
          file,
        };
        const group = groups.get(file.path);
        if (group === undefined) groups.set(file.path, [edit]);
        else group.push(edit);
      }
    }
  }
  return groups;
}

type FileStatus = "A" | "M" | "D" | "R";

export function fileStatus(file: PatchFile): FileStatus {
  if (file.oldFileName === "/dev/null") return "A";
  if (file.newFileName === "/dev/null") return "D";
  if (
    file.oldFileName !== undefined &&
    file.newFileName !== undefined &&
    file.oldFileName !== file.newFileName
  )
    return "R";
  return "M";
}

/** A turn's runtime: 42s, 5m, 1h 12m. Zero means nothing followed the commit. */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
}
