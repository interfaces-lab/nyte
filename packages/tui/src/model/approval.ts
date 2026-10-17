import type { PartId, SessionId, SessionView } from "@nyte-ai/sdk";
import { APPROVAL_ACTIONS, approvalPrompt, openApprovals } from "@nyte-ai/plugin/approvals/schema";
import type { OpenApproval } from "@nyte-ai/plugin/approvals/schema";
import { shortId } from "../lib/format.ts";
import type { Task } from "../lib/tasks.ts";
import type { ListDialog } from "./dialogs/list.ts";
import type { ApprovalLocal } from "./state.ts";

/** Where a new approval's highlight starts: on Deny, so an Enter meant for the composer cannot allow the call. */
const DENY = APPROVAL_ACTIONS.findIndex(({ action }) => action === "deny");

/** The approval the panel asks: the followed chat's first, else a subagent's. */
export interface ApprovalModel extends OpenApproval {
  readonly session: SessionId;
  readonly owner: { readonly kind: "head" } | { readonly kind: "child"; readonly short: string };
}

/** Where an approval's answer goes. */
interface ApprovalRequest {
  readonly session: SessionId;
  readonly part: PartId;
}

export function currentApproval(
  head: { readonly id: SessionId; readonly view: SessionView | null } | null,
  tasks: readonly Task[],
): ApprovalModel | null {
  const [own] = openApprovals(head?.view ?? undefined);

  if (head !== null && own !== undefined)
    return { ...own, session: head.id, owner: { kind: "head" } };

  for (const task of tasks) {
    if (task.kind !== "agent" || task.view === undefined) continue;
    const [first] = openApprovals(task.view);

    if (first !== undefined)
      return { ...first, session: task.id, owner: { kind: "child", short: shortId(task.id) } };
  }

  return null;
}

/** The panel for `approval`: its question as the heading, the command or path above the three answers, Deny highlighted until the user moves. */
export function approvalPanel(
  approval: ApprovalModel | null,
  local: ApprovalLocal,
): ListDialog | null {
  if (approval === null) return null;
  const prompt = approvalPrompt(approval);

  return {
    kind: "list",
    id: `approval:${approval.part}`,
    purpose: {
      kind: "approval",
      session: approval.session,
      part: approval.part,
      heading:
        approval.owner.kind === "head"
          ? prompt.title
          : `Subagent ${approval.owner.short}: ${prompt.title}`,
    },
    title: prompt.detail,
    choices: {
      kind: "ready",
      items: APPROVAL_ACTIONS.map(({ action, label }) => ({
        id: action,
        label,
        description: "",
        timing: null,
        status: null,
        mark: null,
      })),
    },
    query: "",
    highlighted: local.part === approval.part ? local.highlighted : DENY,
    answering: null,
    busy: local.sending === approval.part,
  };
}
