import { posix } from "node:path";
import { definePart } from "@nyte-ai/core";
import type {
  ActionContext,
  ActionOutput,
  PluginApi,
  RuntimeCall,
  RuntimeVerdict,
  SettingDefinition,
  ToolDefinition,
} from "@nyte-ai/core";
import { SdkError } from "@nyte-ai/schema";
import type { Awaitable, Infer } from "@nyte-ai/schema";
import {
  APPROVAL_POLICIES,
  approval as approvalContract,
  approvalPolicy,
  openApprovals,
  PERMISSIONS,
} from "./schema.ts";
import type { ApprovalDecision, ApprovalPolicy, ApprovalState } from "./schema.ts";
import type { Plugin } from "@nyte-ai/plugin/core";

type Actions = typeof approvalContract.actions;

type Handlers = {
  readonly [A in keyof Actions]: (
    input: Infer<Actions[A]["input"]>,
    context: ActionContext<ApprovalState, Actions>,
  ) => Awaitable<ActionOutput<Actions[A]>>;
};

/** A tool call as the policy sees it: its tool's name, its class, and whether its tool lets a policy hold it. */
export interface ApprovalTool extends RuntimeCall {
  readonly approval?: ToolDefinition["approval"];
}

const DENIED = "The user denied this tool call. Ask them how to proceed instead of retrying it.";

const UNANSWERED = "The approval request closed before the user answered.";

/**
 * The host's policy for tool calls, `full` by default. It applies to every
 * session at its next call, including one already running.
 *
 * @category plugins
 * @since 0.1.0
 */
export const permissions: SettingDefinition<ApprovalPolicy> = {
  id: PERMISSIONS,
  label: "Permissions",
  schema: approvalPolicy,
  choices: APPROVAL_POLICIES,
  default: "full",
  scope: "host",
};

/** Folders inside a workspace whose files configure the agents, hooks and tools that run there, so an edit to one asks even under `auto-edit`. */
const GUARDED = new Set([".claude", ".git", ".nyte"]);

function grantKey(tool: string): string {
  return `grant:${tool}`;
}

function workspacePath(cwd: string, path: string): string | null {
  const root = posix.resolve(cwd);
  const target = posix.resolve(root, path);

  if (target === root) return "";

  return target.startsWith(`${root}/`) ? target.slice(root.length + 1) : null;
}

/**
 * Why `policy` stops `tool` for the user in a workspace at `cwd`, or null
 * when the call runs without asking. Reads, listings, delegation and tools
 * whose `approval` is not `policy` never ask (a subagent's own calls ask in
 * its session); under `auto-edit` an edit in the workspace runs unless it is
 * under `.claude`, `.git` or `.nyte`.
 *
 * @category plugins
 * @since 0.1.0
 */
export function approvalReason(
  policy: ApprovalPolicy,
  tool: ApprovalTool,
  cwd: string,
): ApprovalState["reason"] | null {
  const subject = tool.class;

  if (policy === "full" || (tool.approval ?? "policy") !== "policy") return null;

  if (subject.kind === "read" || subject.kind === "list" || subject.kind === "delegate")
    return null;

  if (subject.kind === "shell") return "shell";

  if (subject.kind === "edit") {
    const path = workspacePath(cwd, subject.path);

    if (path === null) return "outside";

    return policy === "ask" || GUARDED.has(path.split("/", 1)[0] ?? "") ? "edit" : null;
  }

  return "tool";
}

async function readPolicy(api: PluginApi<"core">): Promise<ApprovalPolicy> {
  const value = await api.contribute.settings.value(PERMISSIONS);
  const checked = approvalPolicy["~standard"].validate(value);

  return checked instanceof Promise || checked.issues !== undefined
    ? permissions.default
    : checked.value;
}

async function pendingReason(
  api: PluginApi<"core">,
  tool: ApprovalTool,
): Promise<ApprovalState["reason"] | null> {
  const reason = approvalReason(await readPolicy(api), tool, api.env.cwd);

  if (reason === null) return null;

  return (await api.storage.get(grantKey(tool.name))) === true ? null : reason;
}

function verdict(action: string | undefined): RuntimeVerdict {
  if (action === "once" || action === "session") return { kind: "allow" };

  return { kind: "deny", reason: action === "deny" ? DENIED : UNANSWERED };
}

async function decide(
  decision: ApprovalDecision,
  context: ActionContext<ApprovalState, Actions>,
): Promise<undefined> {
  const allowed = decision === "deny" || context.authority.has("owner");
  let granted: string | null = null;
  let refused = false;

  const outcome = await context.part.update((current) => {
    refused = current.decision === null && !allowed;
    granted = current.decision === null || current.decision === decision ? current.tool : null;

    return current.decision === null && allowed ? { ...current, decision } : current;
  });

  if (outcome.kind !== "updated")
    throw new SdkError("invalid", "This approval is no longer waiting.");

  if (refused) throw new SdkError("denied", "Only the host's owner can allow a tool call.");

  if (granted === null) throw new SdkError("invalid", "This approval was already answered.");

  if (decision !== "session") return undefined;
  await context.api.storage.set(grantKey(granted), true);

  for (const sibling of openApprovals(await context.api.session.view())) {
    if (sibling.part !== context.part.id && sibling.tool === granted)
      await context.api.session.part(sibling.part).act("once", {});
  }

  return undefined;
}

const handlers: Handlers = {
  once: (_input, context) => decide("once", context),
  session: (_input, context) => decide("session", context),
  deny: (_input, context) => decide("deny", context),
};

/**
 * The approval part with its handlers: the first answer is kept, and
 * `session` records a grant for the tool and answers the session's other
 * waiting approvals for it.
 *
 * @category plugins
 * @since 0.1.0
 */
export const approval = definePart({
  ...approvalContract,
  onAction: (action, input, context) => handlers[action](input, context),
});

async function approveRuntimeCall(
  call: RuntimeCall,
  context: { readonly api: PluginApi<"core">; readonly signal: AbortSignal },
): Promise<RuntimeVerdict> {
  const { api, signal } = context;
  const reason = await pendingReason(api, call);

  if (reason === null) return { kind: "allow" };

  const part = await api.session.parts.create(approval, {
    state: { tool: call.name, class: call.class, reason, decision: null },
    placement: { kind: "modal" },
  });

  try {
    return verdict((await part.answer({ signal }))?.action);
  } finally {
    if (signal.aborted) await part.close().catch(() => undefined);
  }
}

/**
 * Gates tool calls on the session's `permissions` policy, keying grants on
 * each tool's own name. A call in Nyte's loop that asks parks its
 * before_tool hook on an approval part, so the request outlives a host
 * restart and any client watching the session can answer it; a denial
 * reaches the model as the rejected call's reason. A call another agent
 * runtime asks to run comes through `approve` and waits on the same part
 * while its runtime runs; its mirror call (`approval: "runtime"`) is not
 * asked about again. Only a principal with owner authority can allow.
 *
 * @category plugins
 * @since 0.1.0
 */
export default {
  id: "approvals",
  contribute: { parts: [approval], settings: [permissions] },
  approve: approveRuntimeCall,
  hooks: {
    before_tool: async (call, context) => {
      const { api } = context;

      const definition = api.contribute.tools.list().find((tool) => tool.name === call.name);

      const reason = await context.memo("reason", () =>
        pendingReason(api, { name: call.name, class: call.class, approval: definition?.approval }),
      );

      if (reason === null) return { action: "continue" };

      const part = await api.session.parts.create(approval, {
        state: { tool: call.name, class: call.class, reason, decision: null },
        placement: { kind: "modal" },
      });

      const outcome = await context.wait({ kind: "part", part: part.id });
      const answered = verdict(outcome.kind === "part" ? outcome.answer?.action : undefined);

      return answered.kind === "allow"
        ? { action: "continue" }
        : { action: "reject", reason: answered.reason };
    },
  },
} satisfies Plugin;
