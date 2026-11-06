import { SdkError } from "@nyte-ai/schema";
import type { SessionId, ValidationIssue } from "@nyte-ai/schema";
import { CORE_CONTEXT } from "../contract/host.ts";
import type { ConnectionContext, PluginStorage } from "../contract/host.ts";
import type { Attached, Kernel, RegistrySet } from "../contract/kernel.ts";
import type { PluginApi, Registries, RuntimeCall, RuntimeVerdict } from "../contract/plugin.ts";
import type { Session } from "../contract/session.ts";
import type { Resources } from "../contract/workspace.ts";
import { commit } from "../fold/commit.ts";
import { kvRef } from "../store/refs.ts";
import { openText, sealText } from "../store/secrets.ts";
import { put, readKv, requireSession } from "../store/session.ts";

export function corePluginApi(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly registries: RegistrySet;
    readonly env: Attached;
    readonly inputs: Resources | null;
  },
): PluginApi<"core"> {
  const signal = new AbortController().signal;

  return build(kernel, {
    ...input,
    contribute: input.registries.owned("core", signal),
    handle: kernel.handles.session(CORE_CONTEXT, input.session),
    owner: "core",
    signal,
    hook: () => () => {},
    report: () => {},
    reload: () => {},
  });
}

export function stepPluginApi(
  kernel: Kernel,
  api: PluginApi<"core">,
  context: ConnectionContext,
  session: SessionId,
): PluginApi<"core"> {
  return {
    side: api.side,
    sdk: kernel.handles.connection(context),
    contribute: api.contribute,
    storage: api.storage,
    signal: api.signal,
    hook: (name, entry) => api.hook(name, entry),
    report: (issue) => api.report(issue),
    reload: () => api.reload(),
    session: kernel.handles.session(context, session),
    get env() {
      return api.env;
    },
    wrapEnv: (wrap) => api.wrapEnv(wrap),
    get inputs() {
      return api.inputs;
    },
    request: (request) => api.request(request),
    approve: (call, signal) => api.approve(call, signal),
  };
}

export function build(
  kernel: Kernel,
  input: {
    readonly owner: string;
    readonly session: SessionId;
    readonly handle: Session;
    readonly signal: AbortSignal;
    readonly contribute: Registries<"core">;
    readonly env: Attached;
    readonly inputs: Resources | null;
    readonly hook: PluginApi<"core">["hook"];
    report(issue: ValidationIssue): void;
    reload(): void;
  },
): PluginApi<"core"> {
  const { owner, session, env, inputs } = input;

  return {
    side: "core",
    sdk: kernel.handles.connection(CORE_CONTEXT),
    contribute: input.contribute,
    storage: createPluginStorage(kernel, { owner, session }),
    signal: input.signal,
    hook: input.hook,
    report: (issue) => input.report(issue),
    reload: () => input.reload(),
    session: input.handle,
    get env() {
      if (env.env === null)
        throw new SdkError("unavailable", `Session ${session} has no environment attached.`);

      return env.env;
    },
    wrapEnv(wrap) {
      const dispose = kernel.environments.wrap(session, wrap);
      input.signal.addEventListener("abort", dispose, { once: true });

      return () => {
        input.signal.removeEventListener("abort", dispose);
        dispose();
      };
    },
    get inputs() {
      if (inputs === null)
        throw new SdkError("unavailable", `Session ${session} has no resources scanned.`);

      return inputs;
    },
    request: (request) => kernel.request(session, request),
    approve: (call, signal) => approveRuntimeCall(kernel, session, call, signal),
  };
}

const ALLOWED: RuntimeVerdict = { kind: "allow" };

async function approveRuntimeCall(
  kernel: Kernel,
  session: SessionId,
  call: RuntimeCall,
  signal: AbortSignal,
): Promise<RuntimeVerdict> {
  const runtime = kernel.plugins.runtimes().get(session);

  for (const plugin of runtime?.plugins() ?? []) {
    const api = runtime?.instance(plugin.id)?.api;

    if (plugin.approve === undefined || api === undefined) continue;
    const verdict = await plugin.approve(call, { api, signal });

    if (verdict.kind === "deny") return verdict;
  }

  return signal.aborted ? { kind: "deny", reason: "The request was aborted." } : ALLOWED;
}

export function pluginSecrets(kernel: Kernel, owner: string): PluginStorage["secrets"] {
  return {
    async get(key) {
      return openText(
        kernel,
        await readKv(kernel.store, kvRef("secret", owner, validateStorageKey(key))),
      );
    },
    async set(key, value) {
      const name = kvRef("secret", owner, validateStorageKey(key));
      const sealed = await sealText(kernel, value);

      await commit(kernel, [{ name, target: await put(kernel.store, "kv", sealed) }]);
    },
    async delete(key) {
      await commit(kernel, [
        { name: kvRef("secret", owner, validateStorageKey(key)), target: null },
      ]);
    },
  };
}

function createPluginStorage(
  kernel: Kernel,
  input: { readonly owner: string; readonly session: SessionId },
): PluginStorage {
  const { owner, session } = input;

  const scoped = (scope: "host" | "workspace" | "session"): PluginStorage => {
    const prefix = async (): Promise<string> => {
      if (scope === "host") return "host";

      if (scope === "session") return `session:${session}`;

      return `workspace:${(await requireSession(kernel.store, session)).record.workspace}`;
    };

    const name = async (key: string): Promise<string> =>
      kvRef(await prefix(), owner, validateStorageKey(key));

    return {
      get: async (key) => readKv(kernel.store, await name(key)),
      async set(key, value) {
        await commit(kernel, [
          { name: await name(key), target: await put(kernel.store, "kv", value) },
        ]);
      },
      async delete(key) {
        await commit(kernel, [{ name: await name(key), target: null }]);
      },
      async keys() {
        const start = kvRef(await prefix(), owner, "");

        return (await kernel.store.refs.list(start)).map((ref) => ref.name.slice(start.length));
      },
      at: scoped,
      secrets,
    };
  };

  const secrets = pluginSecrets(kernel, owner);

  return scoped("session");
}

function validateStorageKey(key: string): string {
  if (key.includes("/")) throw new SdkError("invalid", `The storage key ${key} contains "/".`);

  return key;
}
