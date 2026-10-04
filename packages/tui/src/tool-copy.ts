/** Wording for tool cards and turn notices: lowercase, terse, the glyph carries the state. */
import type { ToolTense } from "@nyte-ai/client";
import type { Failure, TurnToolClass } from "@nyte-ai/protocol";
import { ACTIVITY_FAILED_LABEL, ACTIVITY_STOPPED_LABEL, GLYPHS } from "./constants.ts";

type DelegateClass = Extract<TurnToolClass, { readonly kind: "delegate" }>;

type Verbs = Readonly<Record<Exclude<ToolTense, "none">, string>>;

const READ: Verbs = { running: "reading", past: "read" };

const EDIT: Verbs = { running: "editing", past: "edited" };

const WRITE: Verbs = { running: "writing", past: "wrote" };

function toolVerbs(toolClass: TurnToolClass): Verbs {
  switch (toolClass.kind) {
    case "file_read":
      return READ;
    case "list":
      return { running: "listing", past: "listed" };
    case "shell":
      return { running: "running", past: "ran" };
    case "file_edit":
      return EDIT;
    case "file_write":
      return WRITE;
    case "file_patch":
      return toolClass.op === "edit" ? EDIT : WRITE;
    case "delegate":
      return delegateVerbs(toolClass.role);
    case "custom":
      return { running: toolClass.label, past: toolClass.label };
    default: {
      const _exhaustive: never = toolClass;

      return _exhaustive;
    }
  }
}

/** The verb for a tense that asserts one; a call that did not finish has none. */
export function toolLabel(toolClass: TurnToolClass, tense: ToolTense): string | undefined {
  return tense === "none" ? undefined : toolVerbs(toolClass)[tense];
}

/**
 * What a verbless heading adds after its subject so the tool stays named: a
 * path alone does not say read from edit. A command or a tool's name needs
 * nothing; a custom call's label is already its name.
 */
export function toolNoun(toolClass: TurnToolClass): string | undefined {
  switch (toolClass.kind) {
    case "file_read":
      return "read";
    case "list":
      return "list";
    case "file_edit":
      return "edit";
    case "file_write":
      return "write";
    case "file_patch":
      return toolClass.op;
    case "delegate":
      return delegateNoun(toolClass.role);
    case "shell":
    case "custom":
      return undefined;
    default: {
      const _exhaustive: never = toolClass;

      return _exhaustive;
    }
  }
}

/** The words of a heading before its outcome: verb then subject, or subject then noun. */
export function toolTitle(toolClass: TurnToolClass, tense: ToolTense): string {
  const subject = toolSubject(toolClass);
  const verb = toolLabel(toolClass, tense);

  if (verb !== undefined) return subject === undefined ? verb : `${verb} ${subject}`;

  return [subject, toolNoun(toolClass)].filter((value) => value !== undefined).join(" ");
}

function delegateNoun(role: DelegateClass["role"]): string | undefined {
  switch (role) {
    case "create":
      return undefined;
    case "send":
      return "message";
    case "read":
      return "transcript";
    case "stop":
      return "stop";
    default: {
      const _exhaustive: never = role;

      return _exhaustive;
    }
  }
}

function delegateVerbs(role: DelegateClass["role"]): Verbs {
  switch (role) {
    case "create":
      return { running: "agent", past: "agent" };
    case "send":
      return { running: "sending to", past: "sent to" };
    case "read":
      return READ;
    case "stop":
      return { running: "stopping", past: "stopped" };
    default: {
      const _exhaustive: never = role;

      return _exhaustive;
    }
  }
}

/** What the call is about: the path, the command, the task. A custom call has only its label. */
export function toolSubject(toolClass: TurnToolClass): string | undefined {
  switch (toolClass.kind) {
    case "file_read":
    case "list":
    case "file_edit":
    case "file_write":
    case "file_patch":
      return toolClass.path;
    case "shell":
      return toolClass.command;
    case "delegate":
      return delegateSubject(toolClass);
    case "custom":
      return undefined;
    default: {
      const _exhaustive: never = toolClass;

      return _exhaustive;
    }
  }
}

/** A child is named by its card; a call on it only says what kind of target it has. */
export function delegateSubject(toolClass: DelegateClass): string {
  return toolClass.role === "create" ? toolClass.title : "subagent";
}

function delegateActivity(toolClass: DelegateClass): string {
  switch (toolClass.role) {
    case "create":
      return "Creating subagent";
    case "send":
      return "Messaging subagent";
    case "read":
      return "Reading subagent";
    case "stop":
      return "Stopping subagent";
    default: {
      const _exhaustive: never = toolClass;

      return _exhaustive;
    }
  }
}

/** The status row for the tools still running: the newest call. */
export function runningActivityLabel(running: readonly TurnToolClass[]): string | undefined {
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
      return delegateActivity(newest);
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
