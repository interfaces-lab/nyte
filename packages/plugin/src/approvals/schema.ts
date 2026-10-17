import type { PartDefinition } from "@nyte-ai/core";
import { standard, ToolClassType } from "@nyte-ai/schema";
import type { Infer, PartId, SessionView } from "@nyte-ai/schema";
import { Type } from "typebox";

const policy = standard(
  Type.Union([Type.Literal("ask"), Type.Literal("auto-edit"), Type.Literal("full")]),
);

/**
 * When a tool call waits for the user: `ask` before any call that may change
 * the workspace, `auto-edit` before shell commands, edits outside the
 * workspace and tools whose effects are unknown, `full` never.
 */
export type ApprovalPolicy = Infer<typeof policy>;

/** The setting that holds the policy; it names the terminal's `/permissions` command. */
export const PERMISSIONS = "permissions";

/** The policy setting's schema, shared by the plugin and the clients that read it. */
export const approvalPolicy = policy;

/** Each policy with the words every client shows for it, in menu order. */
export const APPROVAL_POLICIES = [
  { value: "ask", label: "Ask first", description: "Asks before every command and file change" },
  {
    value: "auto-edit",
    label: "Auto-edit",
    description: "Edits workspace files, asks before commands and anything outside",
  },
  { value: "full", label: "Full access", description: "Runs every tool without asking" },
] as const satisfies readonly {
  readonly value: ApprovalPolicy;
  readonly label: string;
  readonly description: string;
}[];

const reasonType = Type.Union([
  Type.Literal("shell"),
  Type.Literal("edit"),
  Type.Literal("outside"),
  Type.Literal("tool"),
]);

const decision = Type.Union([
  Type.Literal("once"),
  Type.Literal("session"),
  Type.Literal("deny"),
  Type.Null(),
]);

const state = standard(
  Type.Object({ tool: Type.String(), class: ToolClassType, reason: reasonType, decision }),
);

const empty = standard(Type.Object({}));

const actions = { once: { input: empty }, session: { input: empty }, deny: { input: empty } };

/**
 * One gated tool call: its tool, its class, why it asks (`shell`, `edit` in
 * the workspace, `outside` the workspace, or another `tool`), and the user's
 * first decision, null while it waits.
 */
export type ApprovalState = Infer<typeof state>;

/** What the user can answer, as part actions. */
export type ApprovalDecision = Exclude<ApprovalState["decision"], null>;

/** The three answers in the order every client offers them, with their shared labels. */
export const APPROVAL_ACTIONS = [
  { action: "once", label: "Allow once" },
  { action: "session", label: "Allow for this session" },
  { action: "deny", label: "Deny" },
] as const satisfies readonly { readonly action: ApprovalDecision; readonly label: string }[];

/** The question an approval asks and the command, path or label it is about. */
export interface ApprovalPrompt {
  readonly title: string;
  readonly detail: string;
}

/** The words every client shows for an approval. */
export function approvalPrompt(
  current: Pick<ApprovalState, "tool" | "class" | "reason">,
): ApprovalPrompt {
  const subject = current.class;

  switch (subject.kind) {
    case "shell":
      return { title: "Run this command?", detail: subject.command };
    case "edit":
      return {
        title: current.reason === "outside" ? "Edit outside the workspace?" : "Edit this file?",
        detail: subject.path,
      };
    case "read":
    case "list":
      return { title: `Use ${current.tool}?`, detail: subject.path };
    case "delegate":
      return { title: `Use ${current.tool}?`, detail: subject.title ?? "" };
    case "custom":
      return { title: `Use ${current.tool}?`, detail: subject.label };
    default: {
      const exhaustive: never = subject;

      return exhaustive;
    }
  }
}

/**
 * A modal request to run one tool call. Its first answer stands: once,
 * session (which also allows the tool for the rest of the session), or deny.
 *
 * @category plugins
 * @since 0.1.0
 */
export const approval = {
  kind: "ask/approval",
  state,
  actions,
  fallback: (current, { id }) => {
    const prompt = approvalPrompt(current);

    return `${prompt.title} ${prompt.detail} (${id})${current.decision === null ? "" : ` Answered: ${current.decision}`}`;
  },
} satisfies PartDefinition<ApprovalState, typeof actions>;

/** An approval still waiting for the user, with the part its answer goes to. */
export type OpenApproval = Pick<ApprovalState, "tool" | "class" | "reason"> & {
  readonly part: PartId;
};

/**
 * Returns the live approvals nobody has answered, oldest first. Parts from a
 * stopped run and parts with invalid state are left out.
 *
 * @category plugins
 * @since 0.1.0
 */
export function openApprovals(
  view: Pick<SessionView, "parts"> | undefined,
): readonly OpenApproval[] {
  return (view?.parts ?? []).flatMap((part) => {
    if (part.partKind !== approval.kind || part.status.kind !== "live") return [];
    const checked = approval.state["~standard"].validate(part.state);

    if (
      checked instanceof Promise ||
      checked.issues !== undefined ||
      checked.value.decision !== null
    )
      return [];

    const { tool, reason } = checked.value;

    return [{ part: part.id, tool, class: checked.value.class, reason }];
  });
}
