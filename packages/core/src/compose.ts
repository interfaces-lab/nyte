import type { Models } from "@nyte-ai/ai";
import { asId } from "@nyte-ai/schema";
import type {
  HostDescription,
  HostView,
  Json,
  ModelRequestInput,
  ModelRequestOutcome,
  Owned,
  SessionId,
  ValidationIssue,
} from "@nyte-ai/schema";
import { createCompactor, createSummarizer } from "./compaction.ts";
import { createHost } from "./connection.ts";
import type { ModelsApi, OpenOptions } from "./connection.ts";
import { dev } from "./dev-log.ts";
import { SdkError } from "./error.ts";
import { driveInProcess } from "./execution.ts";
import { createHostState } from "./host.ts";
import type { Host } from "./host.ts";
import { createKernel } from "./kernel.ts";
import type { Kernel } from "./kernel.ts";
import { createConfigurationResolver, createModelsApi } from "./models.ts";
import { readMcpWorkspace } from "./mcp.ts";
import { checkPlugins, hostPluginRows, pluginSecrets, readKv } from "./plugin-runtime.ts";
import type { Plugin } from "./plugin.ts";
import { delegationPlugin } from "./plugins/delegation.ts";
import { environmentPlugin } from "./plugins/environment.ts";
import { mcpPlugin } from "./plugins/mcp.ts";
import { systemPromptPlugin } from "./plugins/system-prompt.ts";
import { decodeHostIdentity, envelope } from "./records.ts";
import type { HostIdentity } from "./records.ts";
import { hostIdentityRef, kvRef } from "./refs.ts";
import { createRequest } from "./request.ts";
import { resourcesPlugin } from "./resources.ts";
import { settingInfos } from "./settings.ts";
import type { StoreConnection } from "./store.ts";
import { createTurnDriver } from "./turn.ts";
import { pollStore } from "./watch.ts";

export type ComposeOptions = OpenOptions & {
  readonly home: string | null;
  readonly operations: HostView["operations"];
  readonly description: HostDescription;
  readonly pluginSources?: ReadonlyMap<
    Plugin<"core">,
    { readonly source: "user" | "project"; readonly path: string }
  >;

  readonly poll?: number;

  readonly seed?: { readonly settings: Readonly<Record<string, Json>>; readonly path: string };

  readonly loadPlugins?: Kernel["loadPlugins"];
};

export const BUILTINS: readonly Plugin<"core">[] = [
  systemPromptPlugin,
  environmentPlugin,
  resourcesPlugin,
  delegationPlugin,
];

export async function composeHost(
  options: ComposeOptions,
): Promise<Omit<Host, "listen"> & { readonly kernel: Kernel }> {
  const outcomes = checkPlugins([...BUILTINS, ...options.plugins]).plugins;
  const fromFile = (index: number) =>
    index < BUILTINS.length
      ? undefined
      : options.pluginSources?.get(options.plugins[index - BUILTINS.length]);

  const rejected = outcomes.filter(
    (outcome, index) => outcome.kind === "rejected" && fromFile(index) === undefined,
  );

  if (rejected.length > 0)
    throw new SdkError(
      "invalid",
      `The host cannot load ${rejected.map((outcome) => outcome.id).join(", ")}.`,
      { issues: rejected.flatMap((outcome) => outcome.issues) },
    );

  const dropped = outcomes.flatMap((outcome, index) => {
    const file = fromFile(index);

    return outcome.kind === "rejected" && file !== undefined
      ? [{ id: file.path, source: file.source, path: file.path, issues: outcome.issues }]
      : [];
  });

  const plugins = options.plugins.filter(
    (_plugin, index) => outcomes[BUILTINS.length + index].kind !== "rejected",
  );

  const store = await options.store.open();

  const kernel = await composeKernel({ ...options, plugins }, store);

  for (const row of dropped) {
    dev("compose", "plugin file dropped", { path: row.path, issues: row.issues.length });
    kernel.host.report(row);
  }

  const added = await kernel.workspaces.add(options.workspace).catch((error: unknown) => ({
    kind: "failed" as const,
    reason: error instanceof Error ? error.message : String(error),
  }));

  if (added.kind !== "added" && added.kind !== "exists") {
    await release(kernel, null);

    throw new SdkError(
      "unavailable",
      `The host's workspace cannot be registered (${added.kind === "stale" ? "stale" : added.reason}).`,
    );
  }

  kernel.defaultWorkspace = added.workspace;

  try {
    if (options.seed !== undefined) await applySeed(kernel, options.seed);
    kernel.host.update({ settings: await settingInfos(kernel, null) });
  } catch (error) {
    await release(kernel, null);

    throw error;
  }

  const driver =
    kernel.execution.kind === "run" ? driveInProcess(kernel, kernel.execution.coverage) : null;

  const unpoll = pollStore(kernel);

  const host = createHost(kernel, { credential: { kind: "token", token: "" } });
  let closing: Promise<void> | null = null;

  const close = (): Promise<void> => {
    closing ??= (async () => {
      unpoll();
      await host.close();
      await release(kernel, driver);
    })();

    return closing;
  };

  return { ...host, kernel, close, [Symbol.asyncDispose]: close };
}

export async function hostIdentity(store: StoreConnection): Promise<HostIdentity> {
  const known = await storedIdentity(store);

  if (known !== null) return known;
  const identity: HostIdentity = { id: asId<"host">(crypto.randomUUID()), createdAt: Date.now() };

  const outcome = await store.refs.set([
    {
      name: hostIdentityRef(),
      target: await store.objects.put(envelope("identity", identity, identity.createdAt)),
      expect: "absent",
    },
  ]);

  if (outcome.kind === "set") return identity;
  const winner = await storedIdentity(store);

  if (winner === null) throw new SdkError("internal", "host/identity holds no identity.");

  return winner;
}

async function applySeed(kernel: Kernel, seed: NonNullable<ComposeOptions["seed"]>): Promise<void> {
  const issues: ValidationIssue[] = [];
  let applied = 0;

  const sessionScoped = new Set(
    [...kernel.builtins, ...kernel.hostPlugins].flatMap((plugin) =>
      (plugin.contribute?.settings ?? []).flatMap((setting) =>
        setting.scope === "session" ? [setting.id] : [],
      ),
    ),
  );

  for (const [id, value] of Object.entries(seed.settings)) {
    if ((await readKv(kernel, kvRef("host", "settings", id))) !== undefined) continue;
    const outcome = await kernel.settings.apply(id, value);

    if (outcome.kind === "applied") applied += 1;
    else if (outcome.kind === "unknown")
      issues.push({
        severity: "warning",
        path: [id],
        message: sessionScoped.has(id)
          ? `${id} is a session-scope setting; settings.json seeds host-scope settings only, so set it on a session.`
          : `No setting is named ${id}.`,
      });
    else
      issues.push(
        ...outcome.issues.map((issue) => ({
          ...issue,
          severity: "warning" as const,
          path: [id, ...issue.path],
        })),
      );
  }

  dev("compose", "settings seeded", {
    ids: Object.keys(seed.settings).length,
    applied,
    issues: issues.length,
  });

  if (issues.length > 0)
    kernel.host.report({ id: "settings", source: "user", path: seed.path, issues });
}

async function composeKernel(options: ComposeOptions, store: StoreConnection): Promise<Kernel> {
  const identity = await hostIdentity(store);
  const models = options.models;
  let composed: Kernel | null = null;

  const bound = <T>(make: (kernel: Kernel, models: Models) => T): (() => T) => {
    let made: T | null = null;

    return () => {
      if (made !== null) return made;

      if (composed === null) throw new SdkError("internal", "The kernel is not composed yet.");
      made = make(composed, models);

      return made;
    };
  };

  const turn = bound(createTurnDriver);
  const summarize = bound(createSummarizer);
  const compact = bound(createCompactor);
  const resolve = bound(createConfigurationResolver);
  const request = bound(createRequest);
  const api = bound(createModelsApi);

  const secrets = bound((kernel) => pluginSecrets(kernel, "mcp"));
  const kernel = bound((composedKernel) => composedKernel);

  const mcp =
    options.mcp?.({
      secrets: {
        get: (key) => secrets().get(key),
        set: (key, value) => secrets().set(key, value),
        delete: (key) => secrets().delete(key),
      },
    }) ?? null;

  const catalog: ModelsApi = {
    list: () => api().list(),
    accounts: (provider) => api().accounts(provider),
    selectAccount: (provider, account) => api().selectAccount(provider, account),
    usage: () => api().usage(),
    refresh: (provider) => api().refresh(provider),
    setDefault: (ref) => api().setDefault(ref),
    verify: (provider) => api().verify(provider),
    login: (input) => api().login(input),
    logout: (provider) => api().logout(provider),
  };

  composed = createKernel({
    hostId: identity.id,
    store,
    description: options.description,
    host: createHostState({
      catalog: asId<"catalog-generation">(crypto.randomUUID()),
      plugins: [],
      settings: [],
      operations: options.operations,
    }),
    execution: options.execution,
    turn: { run: (input) => turn().run(input) },
    summarize: (input) => summarize()(input),
    compact: (input) => compact()(input),
    resolveConfiguration: (input) => resolve()(input),
    request<T>(session: SessionId, input: ModelRequestInput<T>): Promise<ModelRequestOutcome<T>> {
      return request()(session, input);
    },
    models: catalog,
    mcp,
    builtins:
      mcp === null
        ? BUILTINS
        : [...BUILTINS, mcpPlugin(mcp, (id) => readMcpWorkspace(kernel(), id))],
    hostPlugins: options.plugins,
    pluginSources: options.pluginSources,
    secrets: options.secrets,
    home: options.home,
    poll: options.poll,
    loadPlugins: options.loadPlugins,
  });

  composed.host.update({ plugins: hostPluginRows(composed) });

  return composed;
}

async function release(kernel: Kernel, driver: Owned | null): Promise<void> {
  await kernel.modelState.close();
  await kernel.mcp?.close();
  await driver?.close();
  const sessions = [...kernel.runtimes().keys()];

  const workspaces = (await kernel.store.refs.list("workspaces/")).map((ref) =>
    asId<"workspace">(ref.name.slice("workspaces/".length)),
  );

  await Promise.allSettled(
    workspaces.flatMap((workspace) =>
      kernel.jobs
        .list(workspace)
        .flatMap((job) => (job.view.state.kind === "running" ? [job.process.stop()] : [])),
    ),
  );

  for (const session of sessions) await kernel.closePlugins(session);

  for (const session of sessions) await kernel.environments.detach(session);

  for (const workspace of workspaces) await kernel.environments.detachWorkspace(workspace);
}

async function storedIdentity(store: StoreConnection): Promise<HostIdentity | null> {
  const ref = await store.refs.get(hostIdentityRef());

  return ref?.target ? decodeHostIdentity(await store.objects.get(ref.target)) : null;
}
