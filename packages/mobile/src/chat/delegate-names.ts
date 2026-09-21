import type { SessionId, SessionInfo, ToolClass } from "@nyte-ai/protocol";

type ChildSessionName = Pick<SessionInfo, "sessionId" | "name" | "preview">;
type DelegateClass = Extract<ToolClass, { readonly kind: "delegate" }>;

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
    case "await":
      return settled ? "Waited for" : "Waiting for";
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
  const delegateTarget = toolClass.target;
  const target = (() => {
    switch (delegateTarget.kind) {
      case "one":
        return names.get(delegateTarget.session) ?? delegateTarget.session;
      case "many":
        return delegateTarget.sessions.map((session) => names.get(session) ?? session).join(", ");
      default: {
        const _exhaustive: never = delegateTarget;
        return _exhaustive;
      }
    }
  })();
  return `${delegateVerb(toolClass.role, settled)} ${target}`;
}
