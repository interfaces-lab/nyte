import { PatchEntryType } from "@nyte-ai/schema";
import { Value } from "typebox/value";
import type { ToolMessage } from "../view-helpers.ts";
import { formatPatch } from "../workbench/patch-text.ts";

/** The text a diff draws and the counts beside it. */
export interface EditPatch {
  readonly patch: string;
  readonly added: number;
  readonly removed: number;
  /** The call wrote a file where none was. */
  readonly created: boolean;
}

/**
 * The patch an edit or write call settled with, as unified text: core diffs
 * the file before and after, so hunks carry the file's line numbers and
 * context. Undefined while the call runs, or when it settled without a text
 * patch.
 */
export function editPatch(message: ToolMessage): EditPatch | undefined {
  const { state } = message;

  if (state.phase !== "settled" || state.outcome.kind !== "ok") return undefined;
  const { output } = state.outcome;

  if (!Value.Check(PatchEntryType, output) || output.kind !== "text") return undefined;

  return {
    patch: formatPatch(output),
    added: output.added,
    removed: output.removed,
    created: output.status === "added",
  };
}
