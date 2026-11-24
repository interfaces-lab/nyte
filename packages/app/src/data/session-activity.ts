import { showsTool, toolDetail, toolStatus, toolVerbs } from "@nyte-ai/plugin/client/presentation";
import type { Message, SessionId, SessionView, ToolClass } from "@nyte-ai/sdk";
import { countWork } from "../lib/work-counts.ts";

export type SessionActivity =
  | { readonly kind: "tool"; readonly toolClass: ToolClass }
  | { readonly kind: "thinking" }
  | { readonly kind: "writing" }
  | { readonly kind: "idle" };

const IDLE = { kind: "idle" } as const;

function readActivity(message: Message): SessionActivity | null {
  if (showsTool(message) && toolStatus(message).tense === "running") {
    return { kind: "tool", toolClass: message.state.class };
  }

  if (message.kind !== "part" || message.status.kind !== "live") return null;

  switch (message.partKind) {
    case "thinking":
      return { kind: "thinking" };
    case "text":
      return { kind: "writing" };
    default:
      return IDLE;
  }
}

interface Folded {
  readonly tool: Extract<SessionActivity, { readonly kind: "tool" }> | undefined;
  readonly live: Exclude<SessionActivity, { readonly kind: "tool" }>;
}

const NOTHING: Folded = { tool: undefined, live: IDLE };

export function sessionActivityProjector(): (
  view: Pick<SessionView, "messages">,
) => SessionActivity {
  const known = new WeakMap<Message, SessionActivity | null>();
  let previous: readonly Message[] = [];
  let settled = NOTHING;

  const fold = (folded: Folded, message: Message): Folded => {
    let activity = known.get(message);

    if (activity === undefined) {
      activity = readActivity(message);
      known.set(message, activity);
    }

    if (activity === null) return folded;

    return activity.kind === "tool"
      ? { tool: activity, live: folded.live }
      : { tool: folded.tool, live: activity };
  };

  return (view) => {
    const messages = view.messages;
    const kept = Math.max(0, previous.length - 1);
    const resumes = messages.length > kept && sameLead(messages, previous, kept);
    const ahead = messages.slice(resumes ? kept : 0, -1).reduce(fold, resumes ? settled : NOTHING);
    const last = messages.at(-1);
    previous = messages;
    settled = ahead;
    const folded = last === undefined ? ahead : fold(ahead, last);

    return folded.tool ?? folded.live;
  };
}

function sameLead(next: readonly Message[], previous: readonly Message[], count: number): boolean {
  for (let index = 0; index < count; index += 1) if (next[index] !== previous[index]) return false;

  return true;
}

export function awaitedChild(activity: SessionActivity | undefined): SessionId | undefined {
  if (activity?.kind !== "tool") return undefined;
  const toolClass = activity.toolClass;

  return toolClass.kind === "delegate" && toolClass.role === "await"
    ? (toolClass.child ?? undefined)
    : undefined;
}

export function subagentActivity(
  activity: SessionActivity | undefined,
  cwd: string | undefined,
): string | undefined {
  countWork("select:activity");
  switch (activity?.kind) {
    case "tool": {
      const verb = toolVerbs(activity.toolClass).running;
      const detail = toolDetail(activity.toolClass, cwd)?.text;

      return detail === undefined ? verb : `${verb} ${detail}`;
    }
    case "thinking":
      return "Thinking";
    case "writing":
      return "Writing a response";
    case "idle":
    case undefined:
      return undefined;
    default: {
      const exhaustive: never = activity;

      return exhaustive;
    }
  }
}
