/** Wording for tool cards and turn notices: lowercase, terse, the glyph carries the state. */
import type { Failure, ToolClass } from "@nyte-ai/protocol";
import { ACTIVITY_FAILED_LABEL, ACTIVITY_STOPPED_LABEL, GLYPHS } from "./constants.ts";

export type ToolPhase = "running" | "done" | "failed" | "interrupted";

/** A call with no result is still running only while its run is; otherwise the run left it behind. */
export function toolPhase(
  result: { readonly isError: boolean } | undefined,
  running: boolean,
): ToolPhase {
  if (result !== undefined) return result.isError ? "failed" : "done";
  return running ? "running" : "interrupted";
}

function phased(
  phase: ToolPhase,
  words: { readonly running: string; readonly done: string; readonly noun: string },
): string {
  switch (phase) {
    case "running":
      return words.running;
    case "done":
      return words.done;
    case "failed":
      return `${words.noun} failed`;
    case "interrupted":
      return `${words.noun} stopped`;
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

export function toolLabel(toolClass: ToolClass, phase: ToolPhase): string {
  switch (toolClass.kind) {
    case "file_read":
      return phased(phase, { running: "reading", done: "read", noun: "read" });
    case "list":
      return phased(phase, { running: "listing", done: "listed", noun: "list" });
    case "shell":
      return phased(phase, { running: "running", done: "ran", noun: "command" });
    case "file_edit":
      return phased(phase, { running: "editing", done: "edited", noun: "edit" });
    case "file_write":
      return phased(phase, { running: "writing", done: "wrote", noun: "write" });
    case "file_patch":
      return toolClass.op === "edit"
        ? phased(phase, { running: "editing", done: "edited", noun: "edit" })
        : phased(phase, { running: "writing", done: "wrote", noun: "write" });
    case "spawn":
      return phased(phase, { running: "creating", done: "created", noun: "create" });
    case "delegate_call":
    case "delegate":
      return phased(phase, delegateWords(toolClass.role));
    case "custom":
      return phased(phase, {
        running: toolClass.label,
        done: toolClass.label,
        noun: toolClass.label,
      });
    default: {
      const _exhaustive: never = toolClass;
      return _exhaustive;
    }
  }
}

function delegateWords(role: "create" | "send" | "await" | "read" | "stop"): {
  readonly running: string;
  readonly done: string;
  readonly noun: string;
} {
  switch (role) {
    case "create":
      return { running: "agent", done: "agent", noun: "agent" };
    case "send":
      return { running: "sending to", done: "sent to", noun: "send" };
    case "await":
      return { running: "waiting for", done: "waited for", noun: "wait" };
    case "read":
      return { running: "reading", done: "read", noun: "read" };
    case "stop":
      return { running: "stopping", done: "stopped", noun: "stop" };
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}

/** What the call is about: the path, the command, the task. A custom call has only its label. */
export function toolSubject(toolClass: ToolClass): string | undefined {
  switch (toolClass.kind) {
    case "file_read":
    case "list":
    case "file_edit":
    case "file_write":
    case "file_patch":
      return toolClass.path;
    case "shell":
      return toolClass.command;
    case "spawn":
    case "delegate":
      return toolClass.title;
    case "delegate_call":
      return toolClass.session;
    case "custom":
      return undefined;
    default: {
      const _exhaustive: never = toolClass;
      return _exhaustive;
    }
  }
}

/** The status row for the tools still running: subagent waits win, otherwise the newest call. */
export function runningActivityLabel(running: readonly ToolClass[]): string | undefined {
  const delegates = running.filter(
    (toolClass) =>
      toolClass.kind === "spawn" ||
      toolClass.kind === "delegate_call" ||
      toolClass.kind === "delegate",
  ).length;
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
    case "spawn":
    case "delegate_call":
    case "delegate":
      return "Waiting for subagent";
    case "custom":
      return undefined;
    default: {
      const _exhaustive: never = newest;
      return _exhaustive;
    }
  }
}

const NOTICE_LIMIT = 120;

function oneLine(message: string): string | undefined {
  const compact = message.replaceAll(/\s+/gu, " ").trim();
  if (compact === "") return undefined;
  return compact.length <= NOTICE_LIMIT
    ? compact
    : `${compact.slice(0, NOTICE_LIMIT - 1).trimEnd()}${GLYPHS.ellipsis}`;
}

interface Notice {
  readonly text: string;
  readonly tone: "warning" | "error";
}

function failed(reason: string | undefined): Notice {
  return {
    text: `${GLYPHS.cross}${ACTIVITY_FAILED_LABEL}${reason === undefined ? "" : ` · ${reason}`}`,
    tone: "error",
  };
}

/** The status row after a turn that stopped: a stop is a warning, everything else an error line. */
export function failureNotice(failure: Failure): Notice {
  switch (failure.class) {
    case "aborted":
      return { text: ACTIVITY_STOPPED_LABEL, tone: "warning" };
    case "rate_limit":
      return failed("rate limit reached");
    case "context_window":
      return failed("context window exceeded");
    case "quota":
      return failed("provider quota reached");
    case "auth":
      return failed("authentication failed");
    case "overloaded":
      return failed("model unavailable");
    case "network":
      return failed("connection lost");
    case "provider":
    case "runner":
      return failed(oneLine(failure.message));
    default: {
      const _exhaustive: never = failure.class;
      return _exhaustive;
    }
  }
}
