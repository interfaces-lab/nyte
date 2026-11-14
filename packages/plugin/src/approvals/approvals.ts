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
import { ApprovalPolicyType, asId, SdkError } from "@nyte-ai/schema";
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
import { readsOnly } from "../side-chat.ts";

type Actions = typeof approvalContract.actions;

type Handlers = {
  readonly [A in keyof Actions]: (
    input: Infer<Actions[A]["input"]>,
    context: ActionContext<ApprovalState, Actions>,
  ) => Awaitable<ActionOutput<Actions[A]>>;
};

export interface ApprovalTool extends RuntimeCall {
  readonly approval?: ToolDefinition["approval"];
}

const DENIED = "The user denied this tool call. Ask them how to proceed instead of retrying it.";

const UNANSWERED = "The approval request closed before the user answered.";

const READ_ONLY =
  "This chat belongs to a side chat, which is read-only: it can't edit files, run commands or use tools that change things. Tell the user they can do this from the main chat.";

const PROBE = asId<"call">("side-chat-probe");

const POLICIES = ApprovalPolicyType.anyOf.map((literal) => literal.const);

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
 * Whether `tool` may change something, which is what `ask` asks before:
 * reads, listings, delegation and tools whose `approval` is not `policy`
 * change nothing (a subagent's own calls are judged in its session).
 */
function changes(tool: ApprovalTool): boolean {
  const kind = tool.class.kind;

  return (
    (tool.approval ?? "policy") === "policy" &&
    kind !== "read" &&
    kind !== "list" &&
    kind !== "delegate"
  );
}

/**
 * Whether a call of `definition` may change something, judged by the class
 * it gives a call without arguments: every class takes its kind from the
 * tool, not from the arguments. A class that needs arguments counts as
 * changing.
 */
function mayChange(definition: ToolDefinition): boolean {
  try {
    return changes({
      name: definition.name,
      class: definition.class({}, { call: PROBE }),
      approval: definition.approval,
    });
  } catch {
    return true;
  }
}

/**
 * Why `policy` stops `tool` for the user in a workspace at `cwd`, or null
 * when the call runs without asking: only a call that `changes` asks, and
 * under `auto-edit` an edit in the workspace runs unless it is under
 * `.claude`, `.git` or `.nyte`.
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

  if (policy === "full" || !changes(tool)) return null;

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
  const ceiling = (await api.session.info()).mcp?.ceiling;
  const checked = approvalPolicy["~standard"].validate(value);

  const host =
    checked instanceof Promise || checked.issues !== undefined
      ? permissions.default
      : checked.value;

  return ceiling !== undefined && POLICIES.indexOf(ceiling) < POLICIES.indexOf(host)
    ? ceiling
    : host;
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

  if (changes(call) && (await readsOnly(api.session, api.sdk)))
    return { kind: "deny", reason: READ_ONLY };
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
 * asked about again. Only a principal with owner authority can allow. A
 * session that only reads (see `readsOnly`) is offered no tool that changes
 * something, under every policy, and a call to one is refused at once.
 *
 * @category plugins
 * @since 0.1.0
 */
export default {
  id: "approvals",
  contribute: { parts: [approval], settings: [permissions] },
  approve: approveRuntimeCall,
  hooks: {
    transform_transcript: async (transcript, context) => {
      if (!(await readsOnly(context.api.session, context.api.sdk))) return transcript;

      const changing = new Set(
        context.api.contribute.tools
          .list()
          .filter(mayChange)
          .map((definition) => definition.name),
      );

      return { ...transcript, tools: transcript.tools.filter((info) => !changing.has(info.name)) };
    },
    before_tool: async (call, context) => {
      const { api } = context;

      const definition = api.contribute.tools.list().find((tool) => tool.name === call.name);
      const tool = { name: call.name, class: call.class, approval: definition?.approval };

      if (changes(tool) && (await readsOnly(api.session, api.sdk)))
        return { action: "reject", reason: READ_ONLY };

      const reason = await context.memo("reason", () => pendingReason(api, tool));

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
