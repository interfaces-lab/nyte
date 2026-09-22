import type { Failure, ToolClass } from "@nyte-ai/protocol";

export type ToolPhase = "running" | "done" | "failed" | "interrupted";

function phased(
  phase: ToolPhase,
  words: {
    readonly running: string;
    readonly done: string;
    readonly noun: string;
    readonly interrupted?: string;
  },
): string {
  switch (phase) {
    case "running":
      return words.running;
    case "done":
      return words.done;
    case "failed":
      return `${words.noun} failed`;
    case "interrupted":
      return words.interrupted ?? `${words.noun} stopped`;
    default: {
      const _exhaustive: never = phase;

      return _exhaustive;
    }
  }
}

function delegateVerb(
  role: Extract<ToolClass, { readonly kind: "delegate" }>["role"],
  phase: ToolPhase,
): string {
  switch (role) {
    case "create":
      return phased(phase, { running: "Creating", done: "Created", noun: "Delegation" });
    case "send":
      return phased(phase, { running: "Sending to", done: "Sent to", noun: "Send" });
    case "await":
      return phased(phase, { running: "Waiting for", done: "Waited for", noun: "Wait" });
    case "read":
      return phased(phase, { running: "Reading", done: "Read", noun: "Read" });
    case "stop":
      return phased(phase, {
        running: "Stopping",
        done: "Stopped",
        noun: "Stop",
        interrupted: "Stop interrupted",
      });
    default: {
      const _exhaustive: never = role;

      return _exhaustive;
    }
  }
}

export function toolVerb(toolClass: ToolClass, phase: ToolPhase): string {
  switch (toolClass.kind) {
    case "file_read":
      return phased(phase, { running: "Reading", done: "Read", noun: "Read" });
    case "list":
      return phased(phase, { running: "Listing", done: "Listed", noun: "List" });
    case "shell":
      return phased(phase, { running: "Running", done: "Ran", noun: "Command" });
    case "file_edit":
      return phased(phase, { running: "Editing", done: "Edited", noun: "Edit" });
    case "file_write":
      return phased(phase, { running: "Writing", done: "Wrote", noun: "Write" });
    case "file_patch":
      return toolClass.op === "edit"
        ? phased(phase, { running: "Editing", done: "Edited", noun: "Edit" })
        : phased(phase, { running: "Writing", done: "Wrote", noun: "Write" });
    case "delegate":
      return delegateVerb(toolClass.role, phase);
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

const NOTICE_LIMIT = 180;

function oneLine(message: string): string | undefined {
  const compact = message.replaceAll(/\s+/gu, " ").trim();

  if (compact === "") return undefined;

  return compact.length <= NOTICE_LIMIT
    ? compact
    : `${compact.slice(0, NOTICE_LIMIT - 3).trimEnd()}…`;
}

type FailureNotice = {
  readonly text: string;
  readonly tone: "neutral" | "danger";
};

export function failureNotice(failure: Failure): FailureNotice {
  switch (failure.class) {
    case "aborted":
      return { text: "Run stopped.", tone: "neutral" };
    case "rate_limit":
      return { text: "Rate limit reached. Try again shortly.", tone: "danger" };
    case "context_window":
      return { text: "This chat exceeded the model's context window.", tone: "danger" };
    case "quota":
      return { text: "Provider quota reached. Try another model or account.", tone: "danger" };
    case "auth":
      return { text: "Authentication failed. Check the provider account.", tone: "danger" };
    case "overloaded":
      return { text: "The model is temporarily unavailable. Try again shortly.", tone: "danger" };
    case "network":
      return { text: "Connection lost. Check your network and try again.", tone: "danger" };
    case "provider":
    case "runner":
      return { text: oneLine(failure.message) ?? "Request failed.", tone: "danger" };
    default: {
      const _exhaustive: never = failure.class;

      return _exhaustive;
    }
  }
}
