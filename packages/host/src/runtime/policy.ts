/**
 * Who may do what on a registry host. The server authenticates a request and
 * names its principal; this module turns that name into a grant and judges
 * every operation, with its parsed input, before the operation runs. Hidden
 * buttons are not policy; this is.
 *
 * Two grants. `owner` holds the host's direct bearer or acts from the host's
 * own terminal: it registers and trusts folders and administers providers
 * and the GitHub login. `controller` is every other authenticated caller: it
 * observes and drives sessions in folders the owner exposed, and nothing
 * more. A relay device reaches `owner` only through an explicit, separately
 * recorded grant.
 *
 * Every operation has a rule and the table is exhaustive, so a new wire
 * operation fails the build until it is placed. Session-bound rules read the
 * state of the session's tree, which is its root's durable start:
 *
 * - `observe`: the tree is sealed (start admitted, not tombstoned). Reads
 *   and watches never need the folder; observation is not execution.
 * - `stop`: the tree is sealed or tombstoned. Aborting, cancelling and
 *   deleting need owned authority, not a folder that can still run tools, and
 *   stay open on a tombstoned tree so cleanup converges.
 * - `manage`: the tree is sealed. Renaming, pinning, archiving and
 *   backgrounding a job touch metadata only; a tombstoned tree is not managed.
 * - `execute`: the tree is sealed and its folder is ready right now. Admitting
 *   input, starting jobs, moving a head (a summary runs the model) and writing
 *   files need both.
 * - `target`: `kind: "workspace"` (the shared cursor) is refused; a `session`
 *   target needs `execute`; a `registered` id must resolve to a ready folder.
 */
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { EnvironmentOperation, Operation, SessionId } from "@nyte-ai/protocol";
import { schemas } from "@nyte-ai/protocol";

export type Grant = "owner" | "controller";

export type Principal =
  | { readonly kind: "owner" }
  | { readonly kind: "device"; readonly id: string; readonly grant: Grant };

/** The stable name the server hands back on each request; the start journal keys by it. */
export function principalName(principal: Principal): string {
  return principal.kind === "owner" ? "owner" : `device:${principal.id}`;
}

export function grantOf(principal: Principal): Grant {
  return principal.kind === "owner" ? "owner" : principal.grant;
}

/** What a session's tree is, from its root's durable start. */
export type TreeState =
  /** The root's start has not admitted its first message: the tree does not exist for clients. */
  | { readonly kind: "unsealed" }
  | { readonly kind: "sealed"; readonly ready: boolean }
  /** Deletion began; only stopping and deleting may still touch the tree. */
  | { readonly kind: "tombstoned" }
  /** No such session, or its root cannot be resolved. */
  | { readonly kind: "unknown" };

type CallRule = "refused" | "open" | "observe" | "stop" | "manage" | "execute" | "target";

const CALL_RULES: { readonly [O in Operation]: CallRule } = {
  "sessions.create": "refused",
  // Reads: the runtime's SDK answers `undefined` for a tree that is not sealed, as for an unknown one.
  "sessions.get": "open",
  "sessions.snapshot": "open",
  "sessions.metadata": "open",
  "sessions.list": "open",
  "sessions.rename": "manage",
  "sessions.setPinned": "manage",
  "sessions.setArchived": "manage",
  "sessions.delete": "stop",
  "sessions.configure": "execute",
  "messages.send": "execute",
  "messages.cancel": "stop",
  "messages.redeliver": "execute",
  "jobs.list": "observe",
  "jobs.start": "execute",
  "jobs.background": "manage",
  "jobs.cancel": "stop",
  "runs.current": "observe",
  "runs.abort": "stop",
  "runs.reply": "execute",
  "runs.diff": "observe",
  "runs.revert": "execute",
  "heads.move": "execute",
  "workspace.list": "refused",
  "workspace.current": "refused",
  "workspace.select": "refused",
  "workspace.forget": "refused",
  "workspace.vcs.snapshot": "target",
  "workspace.vcs.diff": "target",
  "workspace.vcs.changes": "target",
  "workspace.vcs.contents": "target",
  "workspace.vcs.log": "target",
  "workspace.vcs.refs": "target",
  "workspace.vcs.stage": "target",
  "workspace.vcs.discard": "target",
  "workspace.vcs.commit": "target",
  "workspace.vcs.createBranch": "target",
  "workspace.vcs.push": "target",
  "workspace.files": "target",
  "workspace.read": "target",
  "workspace.save": "target",
  "workspace.format": "target",
  "workspace.search": "target",
  "workspace.blame": "target",
  "provider.models.list": "open",
  "provider.models.default": "open",
  "provider.status": "open",
  "plugins.catalog": "open",
  "plugins.list": "observe",
  "plugins.commands.list": "observe",
  "plugins.commands.run": "execute",
  "plugins.settings.list": "observe",
  "plugins.settings.apply": "execute",
  "plugins.resources.list": "observe",
  "plugins.status.list": "observe",
};

type EnvironmentRule = "owner" | "any";

const ENVIRONMENT_RULES: { readonly [O in EnvironmentOperation]: EnvironmentRule } = {
  "environment.catalog": "any",
  "environment.setPreference": "owner",
  "environment.usage": "any",
  "environment.accountLimits": "any",
  "environment.login": "owner",
  "environment.loginAttempt": "owner",
  "environment.answerLogin": "owner",
  "environment.cancelLogin": "owner",
  "environment.logout": "owner",
  "environment.github.state": "any",
  "environment.github.signIn": "owner",
  "environment.github.signOut": "owner",
  "environment.github.createPullRequest": "owner",
  "environment.workspaces.list": "any",
  "environment.workspaces.register": "owner",
  "environment.workspaces.trust": "owner",
  "environment.workspaces.forget": "owner",
  "environment.start": "any",
};

const SessionInput = Type.Object({ sessionId: schemas.SessionId });

const TargetInput = Type.Object({ target: schemas.WorkspaceTarget });

/** What the policy asks the runtime about the state behind an input. */
export interface PolicyState {
  readonly tree: (sessionId: SessionId) => Promise<TreeState>;
  /** The registered id names a folder that is ready to serve. */
  readonly ready: (workspaceId: string) => Promise<boolean>;
}

export type Context = { readonly principal: string | undefined };

/** Whether `rule` admits a tree in `state`. */
export function admits(
  rule: "observe" | "stop" | "manage" | "execute",
  state: TreeState,
): boolean {
  switch (state.kind) {
    case "unknown":
    case "unsealed":
      return false;
    case "tombstoned":
      return rule === "stop";
    case "sealed":
      return rule === "execute" ? state.ready : true;
    default: {
      const _exhaustive: never = state;

      return _exhaustive;
    }
  }
}

/**
 * The server's permission table, shaped like `ServerPermissions` without
 * importing it. Every judgement starts from the grant the runtime resolved
 * for the request's principal; an unnamed principal is refused.
 */
export interface HostPermissions {
  readonly calls: {
    readonly [O in Operation]?: (
      input: unknown,
      request: unknown,
      context: Context,
    ) => boolean | Promise<boolean>;
  };
  readonly environment: {
    readonly [O in EnvironmentOperation]?: (
      input: unknown,
      request: unknown,
      context: Context,
    ) => boolean | Promise<boolean>;
  };
  readonly watch: (
    sessionId: SessionId,
    request: unknown,
    context: Context,
  ) => boolean | Promise<boolean>;
}

export function hostPermissions(
  grantFor: (principal: string | undefined) => Grant | undefined,
  state: PolicyState,
): HostPermissions {
  const judgeCall = async (rule: CallRule, input: unknown): Promise<boolean> => {
    switch (rule) {
      case "refused":
        return false;
      case "open":
        return true;
      case "observe":
      case "stop":
      case "manage":
      case "execute":
        return Value.Check(SessionInput, input) && admits(rule, await state.tree(input.sessionId));
      case "target": {
        if (!Value.Check(TargetInput, input)) return false;
        const { target } = input;

        switch (target.kind) {
          case "workspace":
            return false;
          case "session":
            return admits("execute", await state.tree(target.sessionId));
          case "registered":
            return state.ready(target.id);
          default: {
            const _exhaustive: never = target;

            return _exhaustive;
          }
        }
      }

      default: {
        const _exhaustive: never = rule;

        return _exhaustive;
      }
    }
  };

  const calls: { [O in Operation]?: HostPermissions["calls"][O] } = {};

  const placeCall = <O extends Operation>(operation: O): void => {
    const rule = CALL_RULES[operation];

    calls[operation] = (input, _request, context) =>
      grantFor(context.principal) === undefined ? false : judgeCall(rule, input);
  };

  for (const operation of Object.keys(CALL_RULES)) {
    if (isOperation(operation)) placeCall(operation);
  }

  const environment: { [O in EnvironmentOperation]?: HostPermissions["environment"][O] } = {};

  const placeEnvironment = <O extends EnvironmentOperation>(operation: O): void => {
    const rule = ENVIRONMENT_RULES[operation];

    environment[operation] = (_input, _request, context) => {
      const grant = grantFor(context.principal);

      if (grant === undefined) return false;

      switch (rule) {
        case "owner":
          return grant === "owner";
        case "any":
          return true;
        default: {
          const _exhaustive: never = rule;

          return _exhaustive;
        }
      }
    };
  };

  for (const operation of Object.keys(ENVIRONMENT_RULES)) {
    if (isEnvironmentOperationName(operation)) placeEnvironment(operation);
  }

  return {
    calls,
    environment,
    watch: async (sessionId, _request, context) =>
      grantFor(context.principal) === undefined
        ? false
        : admits("observe", await state.tree(sessionId)),
  };
}

function isOperation(name: string): name is Operation {
  return Object.hasOwn(CALL_RULES, name);
}

function isEnvironmentOperationName(name: string): name is EnvironmentOperation {
  return Object.hasOwn(ENVIRONMENT_RULES, name);
}
