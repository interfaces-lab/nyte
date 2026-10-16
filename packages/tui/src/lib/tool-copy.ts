import type { Failure, ToolClass } from "@nyte-ai/sdk";
import { ACTIVITY_FAILED_LABEL, ACTIVITY_STOPPED_LABEL, GLYPHS } from "./constants.ts";
import type { ToolTense } from "./view-helpers.ts";

type DelegateClass = Extract<ToolClass, { readonly kind: "delegate" }>;

type Verbs = Readonly<Record<Exclude<ToolTense, "none">, string>>;

const READ: Verbs = { running: "reading", past: "read" };

const EDIT: Verbs = { running: "editing", past: "edited" };

function toolVerbs(toolClass: ToolClass): Verbs {
  switch (toolClass.kind) {
    case "read":
      return READ;
    case "list":
      return { running: "listing", past: "listed" };
    case "shell":
      return { running: "running", past: "ran" };
    case "edit":
      return EDIT;
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

export function toolLabel(toolClass: ToolClass, tense: ToolTense): string | undefined {
  return tense === "none" ? undefined : toolVerbs(toolClass)[tense];
}

export function toolNoun(toolClass: ToolClass): string | undefined {
  switch (toolClass.kind) {
    case "read":
      return "read";
    case "list":
      return "list";
    case "edit":
      return "edit";
    case "delegate":
      return delegateNoun(toolClass.role);
    case "custom":
      return toolClass.label;
    case "shell":
      return undefined;
    default: {
      const _exhaustive: never = toolClass;

      return _exhaustive;
    }
  }
}

export function toolTitle(toolClass: ToolClass, tense: ToolTense): string {
  const subject = toolSubject(toolClass);
  const verb = toolLabel(toolClass, tense);

  if (verb !== undefined) return subject === undefined ? verb : `${verb} ${subject}`;

  return [subject, toolNoun(toolClass)].filter((value) => value !== undefined).join(" ");
}

function delegateNoun(role: DelegateClass["role"]): string | undefined {
  switch (role) {
    case "task":
    case "create":
      return undefined;
    case "send":
      return "message";
    case "await":
      return "wait";
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
    case "task":
    case "create":
      return { running: "agent", past: "agent" };
    case "send":
      return { running: "sending to", past: "sent to" };
    case "await":
      return { running: "waiting on", past: "waited on" };
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

export function toolSubject(toolClass: ToolClass): string | undefined {
  switch (toolClass.kind) {
    case "read":
    case "list":
    case "edit":
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

export function delegateSubject(toolClass: DelegateClass): string {
  return (toolClass.role === "create" || toolClass.role === "task") && toolClass.title !== null
    ? toolClass.title
    : "subagent";
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
