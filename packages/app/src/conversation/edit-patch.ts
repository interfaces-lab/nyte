import { PatchEntryType } from "@nyte-ai/schema";
import { Value } from "typebox/value";
import type { ToolMessage } from "@nyte-ai/plugin/client/presentation";
import { formatPatch } from "../workbench/patch-text.ts";

export interface EditPatch {
  readonly patch: string;
  readonly added: number;
  readonly removed: number;
  readonly created: boolean;
}

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
