import type { ToolTense } from "@nyte-ai/client";
import type { SessionId, SessionInfo, TurnToolClass } from "@nyte-ai/protocol";

type ChildSessionName = Pick<SessionInfo, "sessionId" | "name" | "preview">;

type DelegateClass = Extract<TurnToolClass, { readonly kind: "delegate" }>;

export function indexDelegateNames(
  children: readonly ChildSessionName[],
): ReadonlyMap<SessionId, string> {
  return new Map(
    children.map((child) => [child.sessionId, child.name ?? child.preview ?? "Subagent"]),
  );
}

/** Verbs for the tenses that assert one, and the noun that follows the agent's name when none does. */
interface DelegateWords {
  readonly running: string;
  readonly past: string;
  readonly noun: string | undefined;
}

function delegateWords(role: DelegateClass["role"]): DelegateWords {
  switch (role) {
    case "create":
      return { running: "Agent", past: "Agent", noun: undefined };
    case "send":
      return { running: "Sending to", past: "Sent to", noun: "message" };
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
  const name = names.get(toolClass.target.session) ?? toolClass.target.session;
  const words = delegateWords(toolClass.role);

  if (tense !== "none") return `${words[tense]} ${name}`;

  return words.noun === undefined ? name : `${name} ${words.noun}`;
}
