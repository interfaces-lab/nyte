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

function delegateVerb(role: DelegateClass["role"], settled: boolean): string {
  switch (role) {
    case "create":
      return "Agent";
    case "send":
      return settled ? "Sent to" : "Sending to";
    case "read":
      return settled ? "Read" : "Reading";
    case "stop":
      return settled ? "Stopped" : "Stopping";
    default: {
      const _exhaustive: never = role;

      return _exhaustive;
    }
  }
}

export function delegateTitle(
  toolClass: DelegateClass,
  settled: boolean,
  names: ReadonlyMap<SessionId, string>,
): string {
  const { session } = toolClass.target;

  return `${delegateVerb(toolClass.role, settled)} ${names.get(session) ?? session}`;
}
