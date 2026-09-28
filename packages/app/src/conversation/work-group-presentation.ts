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
        readonly verb: string;
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
  if (waiting > 0) return "Waiting on";
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
      return "Waiting on";
    case "custom":
      return `Running ${newest.label}`;
    default: {
      const _exhaustive: never = newest;

      return _exhaustive;
    }
  }
}

function basename(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

function count(n: number, noun: string, plural = `${noun}s`): string {
  return `${String(n)} ${n === 1 ? noun : plural}`;
}

/** One changed or read file is named; more are counted. */
function settledSummary(
  parts: readonly WorkTurnPart[],
  durationMs: number,
): { readonly verb: string; readonly detail: string | undefined } {
  const changed = new Set<string>();
  const read = new Set<string>();
  const listed = new Set<string>();
  let commands = 0;
  let tools = 0;

  for (const part of parts) {
    if (part.kind !== "tool") continue;

    switch (part.class.kind) {
      case "file_patch":
        changed.add(part.class.path);
        break;
      case "file_read":
        read.add(part.class.path);
        break;
      case "list":
        listed.add(part.class.path);
        break;
      case "shell":
        commands += 1;
        break;
      // A mutation still classed as its call never settled into a change.
      case "file_edit":
      case "file_write":
      case "delegate":
      case "custom":
        tools += 1;
        break;
      default: {
        const _exhaustive: never = part.class;

        return _exhaustive;
      }
    }
  }

  if (changed.size + read.size + listed.size + commands + tools === 0) {
    const duration = formatRunDuration(durationMs);

    return { verb: "Thought", detail: duration === undefined ? undefined : `for ${duration}` };
  }

  const explored = read.size + listed.size > 0;
  const verb = changed.size > 0 ? "Edited" : explored ? "Explored" : "Ran";
  const details: string[] = [];

  if (changed.size > 0) {
    const [only] = changed;

    details.push(
      changed.size === 1 && only !== undefined ? basename(only) : count(changed.size, "file"),
    );
  }

  if (explored) {
    const [only] = read;

    const files =
      read.size === 1 && listed.size === 0 && only !== undefined
        ? basename(only)
        : read.size > 0
          ? count(read.size, "file")
          : undefined;

    const directories =
      listed.size > 0 ? count(listed.size, "directory", "directories") : undefined;
    const first = [directories, files].filter((text) => text !== undefined).join(", ");

    details.push(verb === "Edited" ? `explored ${first}` : first);
  }

  const ran = [
    commands > 0 ? count(commands, "command") : undefined,
    tools > 0 ? count(tools, "tool") : undefined,
  ]
    .filter((text) => text !== undefined)
    .join(", ");

  if (ran !== "") details.push(verb === "Ran" ? ran : `ran ${ran}`);

  return { verb, detail: details.join(", ") };
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
    return {
      active: false,
      summary: { ...settledSummary(parts, durationMs), added, removed },
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
    summary: {
      verb,
      detail: waiting.length === 0 ? undefined : count(waiting.length, "agent"),
      added: durable.added,
      removed: durable.removed,
    },
  };
}

export function presentWorkGroup(input: WorkGroupPresentationInput) {
  return liveWorkGroupPresentation({
    durable: durableWorkGroupPresentation(input),
    live: input.live,
    awaited: input.awaited,
  });
}
