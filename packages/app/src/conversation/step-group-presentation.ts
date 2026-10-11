import type { ToolClass } from "@nyte-ai/sdk";
import { isToolMessage, toolStatus } from "../view-helpers.ts";
import { formatRunDuration, isThinkingMessage } from "./transcript-presentation.ts";
import { DELEGATE_VERBS } from "./subagent-status.ts";
import { reasoningHeading } from "./reasoning-heading.ts";
import type { StepMessage } from "./transcript-presentation.ts";

export interface StepGroupPresentationInput {
  readonly messages: readonly StepMessage[];
  readonly durationMs: number;
  readonly added: number;
  readonly removed: number;
  readonly running: boolean;
}

export type DurableStepGroupPresentation =
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

function activityLabel(running: readonly ToolClass[]): string | undefined {
  const newest = running.at(-1);

  if (newest === undefined) return undefined;

  switch (newest.kind) {
    case "read":
    case "list":
      return "Exploring";
    case "shell":
      return "Running";
    case "edit":
      return "Editing";
    case "delegate":
      return DELEGATE_VERBS[newest.role].running;
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

/** One changed or read file is named; more are counted. Only a call that succeeded did its thing. */
function settledSummary(messages: readonly StepMessage[], durationMs: number) {
  const changed = new Set<string>();
  const read = new Set<string>();
  const listed = new Set<string>();
  let commands = 0;
  let tools = 0;
  let failed = 0;
  let stopped = 0;

  for (const message of messages) {
    if (!isToolMessage(message)) continue;
    const { tone } = toolStatus(message);
    const toolClass = message.state.class;

    if (tone === "failure") {
      failed += 1;
      continue;
    }

    if (tone === "stopped") {
      stopped += 1;
      continue;
    }

    if (tone !== "success") continue;

    switch (toolClass.kind) {
      case "edit":
        changed.add(toolClass.path);
        break;
      case "read":
        read.add(toolClass.path);
        break;
      case "list":
        listed.add(toolClass.path);
        break;
      case "shell":
        commands += 1;
        break;
      case "delegate":
      case "custom":
        tools += 1;
        break;
      default: {
        const _exhaustive: never = toolClass;

        return _exhaustive;
      }
    }
  }

  const did = changed.size + read.size + listed.size + commands + tools;

  if (did + failed + stopped === 0) {
    const { title } = reasoningHeading(
      messages
        .map((message) => (isThinkingMessage(message) ? message.state.markdown : ""))
        .join("\n\n"),
    );

    return { verb: title ?? "Thought", detail: formatRunDuration(durationMs) };
  }

  const trouble: (readonly [what: string, n: number])[] = [];

  if (failed > 0) trouble.push(["failed", failed]);

  if (stopped > 0) trouble.push(["stopped", stopped]);

  if (did === 0) {
    return {
      verb: trouble
        .map(([what, n], index) => `${index === 0 ? count(n, "call") : String(n)} ${what}`)
        .join(", "),
      detail: undefined,
    };
  }

  // A step that lost a call claims no verb: each tally says what became of it.
  if (trouble.length > 0) {
    const landed = [
      changed.size > 0 ? `${count(changed.size, "file")} edited` : undefined,
      read.size > 0 ? `${count(read.size, "file")} read` : undefined,
      listed.size > 0 ? `${count(listed.size, "directory", "directories")} listed` : undefined,
      commands > 0 ? `${count(commands, "command")} succeeded` : undefined,
      tools > 0 ? `${count(tools, "tool")} succeeded` : undefined,
    ].filter((text) => text !== undefined);

    return {
      verb: [...landed, ...trouble.map(([what, n]) => `${String(n)} ${what}`)].join(", "),
      detail: undefined,
    };
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

export function durableStepGroupPresentation({
  messages,
  durationMs,
  added,
  removed,
  running,
}: StepGroupPresentationInput): DurableStepGroupPresentation {
  const runningClasses: ToolClass[] = [];

  for (const message of messages) {
    if (!isToolMessage(message)) continue;

    if (toolStatus(message).tense === "running") runningClasses.push(message.state.class);
  }

  if (!running) {
    return {
      active: false,
      summary: { ...settledSummary(messages, durationMs), added, removed },
    };
  }

  return { active: true, runningClasses, added, removed };
}

/** The active verb: the newest running call's activity, else Thinking while a thought streams, else Working. */
export function liveStepGroupPresentation({
  durable,
  messages,
}: {
  readonly durable: DurableStepGroupPresentation;
  readonly messages: readonly StepMessage[];
}) {
  if (!durable.active) return durable;
  const newest = messages.at(-1);

  const verb =
    activityLabel(durable.runningClasses) ??
    (newest !== undefined && isThinkingMessage(newest) && newest.status.kind === "live"
      ? "Thinking"
      : "Working");

  return {
    active: true,
    summary: {
      verb,
      detail: undefined,
      added: durable.added,
      removed: durable.removed,
    },
  };
}
