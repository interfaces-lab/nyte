import type { SessionId, ToolClass } from "@nyte-ai/protocol";
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
  /** Children the run's live waits are blocked on. */
  readonly awaited: ReadonlySet<SessionId>;
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

/** Every child the group is blocked on, counted once however many calls name it. */
function waitingSessions(
  running: readonly ToolClass[],
  awaited: ReadonlySet<SessionId>,
): SessionId[] {
  const sessions = new Set(awaited);
  for (const toolClass of running) {
    if (toolClass.kind !== "delegate") continue;
    if (toolClass.target.kind === "one") {
      sessions.add(toolClass.target.session);
      continue;
    }
    for (const session of toolClass.target.sessions) sessions.add(session);
  }
  return [...sessions];
}

function activityLabel(running: readonly ToolClass[], waiting: number): string | undefined {
  if (waiting > 1) return "Waiting for subagents";
  if (waiting === 1) return "Waiting for subagent";
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
  awaited,
}: {
  readonly durable: DurableWorkGroupPresentation;
  readonly live?: Pick<LiveSnapshot, "order" | "tools">;
  readonly awaited: ReadonlySet<SessionId>;
}) {
  if (!durable.active) return durable;
  const waiting = waitingSessions(durable.runningClasses, awaited);
  const newest = live?.order.at(-1);
  const verb =
    activityLabel(durable.runningClasses, waiting.length) ??
    (live !== undefined && live.tools.size === 0 && newest?.kind === "thinking"
      ? "Thinking"
      : "Working");
  return {
    active: true,
    waiting,
    summary: { verb, detail: undefined, added: durable.added, removed: durable.removed },
  };
}

export function presentWorkGroup(input: WorkGroupPresentationInput) {
  return liveWorkGroupPresentation({
    durable: durableWorkGroupPresentation(input),
    live: input.live,
    awaited: input.awaited,
  });
}
