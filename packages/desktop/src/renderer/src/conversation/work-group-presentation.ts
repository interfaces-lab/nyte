import type { ToolClass } from "@nyte-ai/protocol";
import type { LiveSnapshot } from "../live.ts";
import { formatRunDuration, toolPhase } from "./transcript-presentation.ts";
import type { WorkTurnPart } from "./transcript-presentation.ts";

export interface WorkGroupPresentationInput {
  readonly parts: readonly WorkTurnPart[];
  readonly durationMs: number;
  readonly running: boolean;
  readonly live?: LiveSnapshot;
  readonly stale: boolean;
}

/** What the run is waiting on: delegations win, then the newest running call. */
function activityLabel(running: readonly ToolClass[]): string | undefined {
  const delegates = running.filter((toolClass) => toolClass.kind === "delegate").length;
  if (delegates > 1) return "Waiting for subagents";
  if (delegates === 1) return "Waiting for subagent";
  const newest = running.at(-1);
  if (newest === undefined) return undefined;
  switch (newest.kind) {
    case "file_read":
    case "list":
      return "Reading files";
    case "shell":
      return "Running shell command";
    case "file_edit":
    case "file_write":
    case "file_patch":
      return "Editing files";
    case "delegate":
      return "Waiting for subagent";
    case "custom":
      return `Running ${newest.label}`;
    default: {
      const _exhaustive: never = newest;
      return _exhaustive;
    }
  }
}

export function presentWorkGroup({
  parts,
  durationMs,
  running,
  live,
  stale,
}: WorkGroupPresentationInput) {
  let added = 0;
  let removed = 0;
  const runningClasses: ToolClass[] = [];
  for (const part of parts) {
    if (part.kind !== "tool") continue;
    if (part.class.kind === "file_patch") {
      added += part.class.added;
      removed += part.class.removed;
    }
    if (toolPhase(part, running) === "running") runningClasses.push(part.class);
  }
  // Missing tool results can survive an interrupted run. Only the live run
  // controls group activity; errors remain on their individual tool rows.
  if (!running) {
    const duration = formatRunDuration(durationMs);
    return {
      active: false,
      summary: {
        verb: "Worked",
        detail: duration === undefined ? undefined : `for ${duration}`,
        added,
        removed,
      },
    };
  }
  const newest = live?.order.at(-1);
  const verb =
    activityLabel(runningClasses) ??
    (live !== undefined && live.tools.size > 0
      ? "Working"
      : newest?.kind === "thinking"
        ? "Thinking"
        : newest?.kind === "text"
          ? "Working"
          : stale
            ? "This is taking a bit longer"
            : "Preparing next move");
  return { active: true, summary: { verb, detail: undefined, added, removed } };
}
