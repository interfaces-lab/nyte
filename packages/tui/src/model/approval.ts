import type { SessionId } from "@nyte-ai/sdk";
import type { HeadView } from "@nyte-ai/sdk/client";
import { APPROVAL_ACTIONS, approvalPrompt, openApprovals } from "@nyte-ai/plugin/approvals/schema";
import type { OpenApproval } from "@nyte-ai/plugin/approvals/schema";
import { shortId } from "../lib/format.ts";
import type { Task } from "../lib/tasks.ts";
import type { ListDialog } from "./dialogs/list.ts";
import type { ApprovalLocal } from "./state.ts";

const DENY = APPROVAL_ACTIONS.findIndex(({ action }) => action === "deny");

export interface ApprovalModel extends OpenApproval {
  readonly session: SessionId;
  readonly owner: { readonly kind: "head" } | { readonly kind: "child"; readonly short: string };
}

export function currentApproval(
  head: { readonly id: SessionId; readonly view: HeadView | null } | null,
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

export function approvalHeading(approval: ApprovalModel): string {
  const title = approvalPrompt(approval).title;

  return approval.owner.kind === "head" ? title : `Subagent ${approval.owner.short}: ${title}`;
}

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
      heading: approvalHeading(approval),
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
