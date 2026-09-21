import type { ToolClass } from "@nyte-ai/protocol";
import type { LiveSnapshot } from "../live.ts";
import { formatRunDuration, toolPhase } from "./transcript-presentation.ts";
import type { WorkTurnPart } from "./transcript-presentation.ts";

export interface WorkGroupPresentationInput {
  readonly parts: readonly WorkTurnPart[];
  readonly durationMs: number;
  readonly added: number;
  readonly removed: number;
  readonly running: boolean;
  readonly live?: Pick<LiveSnapshot, "order" | "tools">;
  readonly stale: boolean;
  readonly awaiting: number;
}

export type DurableWorkGroupPresentation =
  | {
      readonly active: false;
      readonly summary: {
        readonly verb: "Worked";
        readonly detail: string | undefined;
        readonly added: number;
        readonly removed: number;
      };
    }
  | {
      readonly active: true;
      readonly runningClasses: readonly ToolClass[];
      readonly added: number;
      readonly removed: number;
    };

function activityLabel(running: readonly ToolClass[], awaiting: number): string | undefined {
  const delegates = awaiting + running.filter((toolClass) => toolClass.kind === "delegate").length;
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

export function durableWorkGroupPresentation({
  parts,
  durationMs,
  added,
  removed,
  running,
}: Pick<
  WorkGroupPresentationInput,
  "parts" | "durationMs" | "added" | "removed" | "running"
>): DurableWorkGroupPresentation {
  const runningClasses: ToolClass[] = [];
  for (const part of parts) {
    if (part.kind !== "tool") continue;
    if (toolPhase(part, running) === "running") runningClasses.push(part.class);
  }
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
  return { active: true, runningClasses, added, removed };
}

export function liveWorkGroupPresentation({
  durable,
  live,
  stale,
  awaiting,
}: {
  readonly durable: DurableWorkGroupPresentation;
  readonly live?: Pick<LiveSnapshot, "order" | "tools">;
  readonly stale: boolean;
  readonly awaiting: number;
}) {
  if (!durable.active) return durable;
  const newest = live?.order.at(-1);
  const verb =
    activityLabel(durable.runningClasses, awaiting) ??
    (live !== undefined && live.tools.size > 0
      ? "Working"
      : newest?.kind === "thinking"
        ? "Thinking"
        : newest?.kind === "text"
          ? "Working"
          : stale
            ? "This is taking a bit longer"
            : "Preparing next move");
  return {
    active: true,
    summary: { verb, detail: undefined, added: durable.added, removed: durable.removed },
  };
}

export function presentWorkGroup(input: WorkGroupPresentationInput) {
  return liveWorkGroupPresentation({
    durable: durableWorkGroupPresentation(input),
    live: input.live,
    stale: input.stale,
    awaiting: input.awaiting,
  });
}
