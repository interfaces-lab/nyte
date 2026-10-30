import { showsTool, toolDetail, toolStatus, toolVerbs } from "@nyte-ai/plugin/client/presentation";
import type { Message, SessionView, ToolClass } from "@nyte-ai/sdk";
import { countWork } from "../lib/work-counts.ts";

export type SessionActivity =
  | { readonly kind: "tool"; readonly toolClass: ToolClass }
  | { readonly kind: "thinking" }
  | { readonly kind: "writing" }
  | { readonly kind: "idle" };

export interface LoadedSessionView extends SessionView {
  readonly activity: SessionActivity;
}

const IDLE = { kind: "idle" } as const;

function readActivity(message: Message): SessionActivity | null {
  if (showsTool(message) && toolStatus(message).tense === "running")
    return { kind: "tool", toolClass: message.state.class };

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

export function sessionActivityProjector(): (
  view: Pick<SessionView, "messages">,
) => SessionActivity {
  const known = new WeakMap<Message, SessionActivity | null>();

  return ({ messages }) => {
    let activeTool: Extract<SessionActivity, { readonly kind: "tool" }> | undefined;
    let live: Exclude<SessionActivity, { readonly kind: "tool" }> = IDLE;

    for (const message of messages) {
      let activity = known.get(message);

      if (activity === undefined) {
        activity = readActivity(message);
        known.set(message, activity);
      }

      if (activity === null) continue;

      if (activity.kind === "tool") activeTool = activity;
      else live = activity;
    }

    return activeTool ?? live;
  };
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
