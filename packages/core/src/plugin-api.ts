import type { Disposer, SessionId, ValidationIssue } from "@nyte-ai/schema";
import { createConnection } from "./connection.ts";
import type { ExecutionEnv, Resources } from "./environment.ts";
import { SdkError } from "./error.ts";
import type { HookDispatch } from "./hooks.ts";
import type { Kernel } from "./kernel.ts";
import type { PluginApi } from "./plugin.ts";
import { createPluginStorage } from "./plugin-storage.ts";
import { CORE_CONTEXT } from "./principals.ts";
import type { ConnectionContext } from "./principals.ts";
import type { RegistrySet } from "./registry.ts";
import { sessionHandle } from "./session.ts";

/** Returns one plugin's api in a session. `side` core; `sdk` a connection as `CORE_CONTEXT` (`LOCAL` with participant and owner authority, no maintenance); `contribute` the session's registries as this owner writes to them, emptied of its items when `signal` aborts (`registries.owned(owner, signal)`); `storage` `createPluginStorage` under the owner; `signal`; `hook` registers with `hooks` under the owner, removed when `signal` aborts; `report` hands the issue, its `source.plugin` set to the owner, to `report`; `reload` schedules a reload pass; `session` the session handle over that connection; `env` and `inputs` as resolved, a null one throwing `SdkError("unavailable")` when read; `wrapEnv` is `kernel.wrapEnv(session, wrap)`; `request` is `kernel.request(session, input)`. */
export function createPluginApi(
  kernel: Kernel,
  input: {
    readonly owner: string;
    readonly session: SessionId;
    readonly signal: AbortSignal;
    readonly registries: RegistrySet;
    readonly hooks: HookDispatch;
    readonly env: ExecutionEnv | null;
    readonly inputs: Resources | null;
    report(issue: ValidationIssue): void;
  },
): PluginApi<"core"> {
  const { owner, signal } = input;

  const untilDeactivated = (dispose: Disposer): Disposer => {
    signal.addEventListener("abort", dispose, { once: true });

    if (signal.aborted) dispose();

    return () => {
      signal.removeEventListener("abort", dispose);
      dispose();
    };
  };

  return build(kernel, {
    ...input,
    hook: (name, entry) => untilDeactivated(input.hooks.register(owner, name, entry)),
    report: (issue) => input.report({ ...issue, source: { ...issue.source, plugin: owner } }),
    reload: () => input.registries.reload(),
  });
}

/** Returns core's own minimal api in a session (§31f), what an ownerless part definition's action receives: `side` core, `sdk` as `CORE_CONTEXT`, `contribute` the session's registries (written as `core`), `storage` under owner `core`, a `signal` that never aborts, `hook`, `report` and `reload` no-ops, and `session`, `env`, `wrapEnv`, `inputs` and `request` as `createPluginApi` builds them. */
export function corePluginApi(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly registries: RegistrySet;
    readonly env: ExecutionEnv | null;
    readonly inputs: Resources | null;
  },
): PluginApi<"core"> {
  return build(kernel, {
    ...input,
    owner: "core",
    signal: new AbortController().signal,
    hook: () => () => {},
    report: () => {},
    reload: () => {},
  });
}

/** Returns a plugin's api for one execution of a durable decide step (§35i): `session` and `sdk` rebound to `context`, whose `origin` names the step, so what the handler acquires through them (`parts.create`, `sessions.create`) is recorded on the step's call and the same part or session comes back on a re-run; every other member is the plugin's own api. */
export function stepPluginApi(
  kernel: Kernel,
  api: PluginApi<"core">,
  context: ConnectionContext,
  session: SessionId,
): PluginApi<"core"> {
  return {
    side: api.side,
    sdk: createConnection(kernel, context),
    contribute: api.contribute,
    storage: api.storage,
    signal: api.signal,
    hook: (name, entry) => api.hook(name, entry),
    report: (issue) => api.report(issue),
    reload: () => api.reload(),
    session: sessionHandle(kernel, context, session),
    get env() {
      return api.env;
    },
    wrapEnv: (wrap) => api.wrapEnv(wrap),
    get inputs() {
      return api.inputs;
    },
    request: (request) => api.request(request),
  };
}

/** Returns a core plugin api from what differs between a plugin's and core's own: the owner, its signal, and how `hook`, `report` and `reload` act. */
function build(
  kernel: Kernel,
  input: {
    readonly owner: string;
    readonly session: SessionId;
    readonly signal: AbortSignal;
    readonly registries: RegistrySet;
    readonly env: ExecutionEnv | null;
    readonly inputs: Resources | null;
    readonly hook: PluginApi<"core">["hook"];
    report(issue: ValidationIssue): void;
    reload(): void;
  },
): PluginApi<"core"> {
  const { owner, session, env, inputs } = input;

  return {
    side: "core",
    sdk: createConnection(kernel, CORE_CONTEXT),
    contribute: input.registries.owned(owner, input.signal),
    storage: createPluginStorage(kernel, { owner, session }),
    signal: input.signal,
    hook: input.hook,
    report: (issue) => input.report(issue),
    reload: () => input.reload(),
    session: sessionHandle(kernel, CORE_CONTEXT, session),
    get env() {
      if (env === null)
        throw new SdkError("unavailable", `Session ${session} has no environment attached.`);

      return env;
    },
    wrapEnv: (wrap) => kernel.wrapEnv(session, wrap),
    get inputs() {
      if (inputs === null)
        throw new SdkError("unavailable", `Session ${session} has no resources scanned.`);

      return inputs;
    },
    request: (request) => kernel.request(session, request),
  };
}
