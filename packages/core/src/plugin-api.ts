import type { SessionId, ValidationIssue, WorkspaceId } from "@nyte-ai/schema";
import type { ExecutionEnv, Resources } from "./environment.ts";
import type { HookDispatch } from "./hooks.ts";
import type { Kernel } from "./kernel.ts";
import type { Plugin, PluginApi } from "./plugin.ts";
import type { RegistrySet } from "./registry.ts";

/** Returns one plugin's api in a session. `side` core; `sdk` a connection as `LOCAL` with participant and owner authority (no maintenance); `contribute` the session's registries as this owner writes to them (`registries.owned(owner)`); `storage` `createPluginStorage` under the owner in `workspace`; `signal`; `hook` registers with `hooks` under the owner; `report` hands the issue, its `source.plugin` set to the owner, to `report`; `reload` schedules a reload pass; `session` the session handle over that connection; `env` and `inputs` as resolved, a null one throwing `SdkError("unavailable")` when read; `wrapEnv` is `kernel.wrapEnv(session, wrap)`; `request` is `kernel.request(session, input)`. Every disposer `contribute` and `hook` return is tracked and called when `signal` aborts, so deactivation removes what the plugin installed. */
export function createPluginApi(
  kernel: Kernel,
  input: {
    readonly plugin: Plugin<"core">;
    readonly owner: string;
    readonly session: SessionId;
    readonly workspace: WorkspaceId;
    readonly signal: AbortSignal;
    readonly registries: RegistrySet;
    readonly hooks: HookDispatch;
    readonly env: ExecutionEnv | null;
    readonly inputs: Resources | null;
    report(issue: ValidationIssue): void;
  },
): PluginApi<"core"> {
  throw new Error("not implemented");
}

/** Returns core's own minimal api in a session (§31f), what an ownerless part definition's action receives: `side` core, `sdk` as `LOCAL` with participant and owner, `contribute` the session's registries (written as `core`), `storage` under owner `core`, a `signal` that never aborts, `hook`, `report` and `reload` no-ops, and `session`, `env`, `wrapEnv`, `inputs` and `request` as `createPluginApi` builds them. */
export function corePluginApi(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly workspace: WorkspaceId;
    readonly registries: RegistrySet;
    readonly env: ExecutionEnv | null;
    readonly inputs: Resources | null;
  },
): PluginApi<"core"> {
  throw new Error("not implemented");
}
