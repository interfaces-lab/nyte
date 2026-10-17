import type { SessionId, SessionInfo, ToolClass } from "@nyte-ai/sdk";

export function indexDelegateNames(
  children: readonly Pick<SessionInfo, "id" | "name">[],
): ReadonlyMap<SessionId, string> {
  return new Map(children.map((child) => [child.id, child.name ?? "Subagent"]));
}

/** The name a delegate call's agent goes by: its session's name, else the call's title. */
export function delegateName(
  toolClass: Extract<ToolClass, { readonly kind: "delegate" }>,
  names: ReadonlyMap<SessionId, string>,
): string {
  return (
    (toolClass.child === null ? undefined : names.get(toolClass.child)) ??
    toolClass.title ??
    toolClass.child ??
    "Subagent"
  );
}
