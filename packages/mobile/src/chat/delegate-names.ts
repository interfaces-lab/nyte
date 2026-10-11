import type { SessionId, SessionInfo, ToolClass } from "@nyte-ai/sdk";
import type { ToolTense } from "../view-helpers.ts";

type DelegateClass = Extract<ToolClass, { readonly kind: "delegate" }>;

export function indexDelegateNames(
  children: readonly Pick<SessionInfo, "id" | "name">[],
): ReadonlyMap<SessionId, string> {
  return new Map(children.map((child) => [child.id, child.name ?? "Subagent"]));
}

/** Verbs for the tenses that assert one, and the noun that follows the agent's name when none does. */
interface DelegateWords {
  readonly running: string;
  readonly past: string;
  readonly noun: string | undefined;
}

function delegateWords(role: DelegateClass["role"]): DelegateWords {
  switch (role) {
    case "task":
    case "create":
      return { running: "Agent", past: "Agent", noun: undefined };
    case "send":
      return { running: "Sending to", past: "Sent to", noun: "message" };
    case "await":
      return { running: "Waiting for", past: "Waited for", noun: undefined };
    case "read":
      return { running: "Reading", past: "Read", noun: "transcript" };
    case "stop":
      return { running: "Stopping", past: "Stopped", noun: "stop" };
    default: {
      const _exhaustive: never = role;

      return _exhaustive;
    }
  }
}

export function delegateTitle(
  toolClass: DelegateClass,
  tense: ToolTense,
  names: ReadonlyMap<SessionId, string>,
): string {
  const name =
    (toolClass.child === null ? undefined : names.get(toolClass.child)) ??
    toolClass.title ??
    toolClass.child ??
    "Subagent";

  const words = delegateWords(toolClass.role);

  if (tense !== "none") return `${words[tense]} ${name}`;

  return words.noun === undefined ? name : `${name} ${words.noun}`;
}
