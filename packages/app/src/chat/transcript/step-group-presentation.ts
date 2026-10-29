import {
  formatWholeDuration,
  showsThinking,
  showsTool,
  toolStatus,
} from "@nyte-ai/plugin/client/presentation";
import type { ToolMessage } from "@nyte-ai/plugin/client/presentation";
import { reasoningHeading } from "./reasoning-heading.ts";
import type { StepMessage } from "./transcript-presentation.ts";

export const PLANNING_DELAY_MS = 200;

export const SLOW_PLANNING_MS = 15_000;

export const PLANNING_LABEL = "Planning next moves";

export type LiveStatus = "thinking" | "planning";

type StepGroupLine =
  | { readonly kind: "summary"; readonly verb: string; readonly detail: string | undefined }
  | { readonly kind: "status"; readonly status: LiveStatus };

type Lead = "edit" | "explore" | "run";

const LEAD_VERBS = {
  edit: { live: "Editing", past: "Edited" },
  explore: { live: "Exploring", past: "Explored" },
  run: { live: "Running", past: "Ran" },
} as const satisfies Record<Lead, Record<"live" | "past", string>>;

interface Work {
  readonly changed: ReadonlySet<string>;
  readonly read: ReadonlySet<string>;
  readonly listed: ReadonlySet<string>;
  readonly commands: number;
  readonly tools: number;
}

/** A live group without a tool call has no work to count, so its line names what the agent is doing instead. */
export function showsLiveStatus(messages: readonly StepMessage[]): boolean {
  return !messages.some(showsTool);
}

export function stepGroupLine({
  messages,
  durationMs,
  running,
}: {
  readonly messages: readonly StepMessage[];
  readonly durationMs: number;
  readonly running: boolean;
}): StepGroupLine {
  if (!running) return { kind: "summary", ...settledSummary(messages, durationMs) };

  if (showsLiveStatus(messages)) {
    const newest = messages.at(-1);

    return {
      kind: "status",
      status:
        newest !== undefined && showsThinking(newest) && newest.status.kind === "live"
          ? "thinking"
          : "planning",
    };
  }

  const calls = messages.filter(showsTool);
  const lead = leadingWork(calls);

  const detail = workDetail(
    tallyWork(calls.filter((call) => !["failure", "stopped"].includes(toolStatus(call).tone))),
    lead,
  );

  return {
    kind: "summary",
    verb: LEAD_VERBS[lead].live,
    detail: detail === "" ? undefined : detail,
  };
}

export function liveStatusLabel(status: LiveStatus, planningMs: number): string | undefined {
  if (status === "thinking") return "Thinking";

  if (planningMs < PLANNING_DELAY_MS) return undefined;

  return planningMs < SLOW_PLANNING_MS ? PLANNING_LABEL : "Taking longer than expected…";
}

function settledSummary(messages: readonly StepMessage[], durationMs: number) {
  const calls = messages.filter(showsTool);
  const tones = calls.map((call) => toolStatus(call).tone);
  const done = calls.filter((_, index) => tones[index] === "success");
  const failed = tones.filter((tone) => tone === "failure").length;
  const stopped = tones.filter((tone) => tone === "stopped").length;
  const work = tallyWork(done);

  if (done.length + failed + stopped === 0) {
    const { title } = reasoningHeading(
      messages
        .map((message) => (showsThinking(message) ? message.state.markdown : ""))
        .join("\n\n"),
    );

    return {
      verb: title ?? "Thought",
      detail: durationMs < 500 ? undefined : formatWholeDuration(durationMs),
    };
  }

  const trouble: (readonly [what: string, n: number])[] = [];

  if (failed > 0) trouble.push(["failed", failed]);

  if (stopped > 0) trouble.push(["stopped", stopped]);

  if (done.length === 0) {
    return {
      verb: trouble
        .map(([what, n], index) => `${index === 0 ? count(n, "call") : String(n)} ${what}`)
        .join(", "),
      detail: undefined,
    };
  }

  if (trouble.length > 0) {
    const landed = [
      work.changed.size > 0 ? `${count(work.changed.size, "file")} edited` : undefined,
      work.read.size > 0 ? `${count(work.read.size, "file")} read` : undefined,
      work.listed.size > 0
        ? `${count(work.listed.size, "directory", "directories")} listed`
        : undefined,
      work.commands > 0 ? `${count(work.commands, "command")} succeeded` : undefined,
      work.tools > 0 ? `${count(work.tools, "tool")} succeeded` : undefined,
    ].filter((text) => text !== undefined);

    return {
      verb: [...landed, ...trouble.map(([what, n]) => `${String(n)} ${what}`)].join(", "),
      detail: undefined,
    };
  }

  const lead = leadingWork(done);

  return { verb: LEAD_VERBS[lead].past, detail: workDetail(work, lead) };
}

/** The work a group's verb names: any edit outranks exploring, which outranks running, so the verb only climbs as calls arrive. */
function leadingWork(calls: readonly ToolMessage[]): Lead {
  const kinds = new Set(calls.map((call) => call.state.class.kind));

  if (kinds.has("edit")) return "edit";

  return kinds.has("read") || kinds.has("list") ? "explore" : "run";
}

/** Counts unique paths, not calls: two reads of one file read one file. */
function tallyWork(calls: readonly ToolMessage[]): Work {
  const paths = (kind: "edit" | "read" | "list") =>
    new Set(
      calls.flatMap((call) => (call.state.class.kind === kind ? [call.state.class.path] : [])),
    );

  return {
    changed: paths("edit"),
    read: paths("read"),
    listed: paths("list"),
    commands: calls.filter((call) => call.state.class.kind === "shell").length,
    tools: calls.filter((call) => ["delegate", "custom"].includes(call.state.class.kind)).length,
  };
}

function workDetail(work: Work, lead: Lead): string {
  const [edited] = work.changed;
  const [read] = work.read;

  const changed =
    work.changed.size === 0
      ? undefined
      : work.changed.size === 1 && edited !== undefined
        ? basename(edited)
        : count(work.changed.size, "file");

  const files =
    work.read.size === 1 && work.listed.size === 0 && read !== undefined
      ? basename(read)
      : work.read.size > 0
        ? count(work.read.size, "file")
        : undefined;

  const directories =
    work.listed.size > 0 ? count(work.listed.size, "directory", "directories") : undefined;

  const explored = [directories, files].filter((text) => text !== undefined).join(", ");

  const ran = [
    work.commands > 0 ? count(work.commands, "command") : undefined,
    work.tools > 0 ? count(work.tools, "tool") : undefined,
  ]
    .filter((text) => text !== undefined)
    .join(", ");

  return [
    changed,
    explored === "" ? undefined : lead === "explore" ? explored : `explored ${explored}`,
    ran === "" ? undefined : lead === "run" ? ran : `ran ${ran}`,
  ]
    .filter((text) => text !== undefined)
    .join(", ");
}

function basename(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

function count(n: number, noun: string, plural = `${noun}s`): string {
  return `${String(n)} ${n === 1 ? noun : plural}`;
}
