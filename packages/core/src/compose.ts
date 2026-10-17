import { asId, asSeq, SdkError } from "@nyte-ai/schema";
import type {
  Activation,
  Disposer,
  HeadName,
  HostDescription,
  Json,
  Owned,
  RunId,
  SessionCatalogView,
  SessionId,
  ValidationIssue,
} from "@nyte-ai/schema";
import type { Models } from "@nyte-ai/ai";
import { createCompactor, createSummarizer } from "./agent/compaction.ts";
import { createRequest } from "./agent/request.ts";
import { stoppableTool } from "./agent/tool-runner.ts";
import { createTurnDriver } from "./agent/turn.ts";
import { createConnection, createHost } from "./api/connection.ts";
import { createHostState } from "./api/host.ts";
import { createServerHost } from "./api/server.ts";
import { rerunAction } from "./api/part.ts";
import { activationSession, sessionHandle } from "./api/session.ts";
import { delegationPlugin } from "./builtins/delegation.ts";
import { environmentPlugin } from "./builtins/environment.ts";
import { mcpPlugin } from "./builtins/mcp.ts";
import { systemPromptPlugin } from "./builtins/system-prompt.ts";
import type { SessionBus } from "./contract/fold.ts";
import { CORE_CONTEXT } from "./contract/host.ts";
import type { ModelsApi, OpenOptions } from "./contract/host.ts";
import type {
  Kernel,
  PluginHost,
  PluginRuntime,
  RunTable,
  SessionDirectory,
  WaitRegistry,
  Wakes,
} from "./contract/kernel.ts";
import type { PartDefinitions } from "./contract/parts.ts";
import type { ServedHost } from "./contract/server.ts";
import type { Plugin } from "./contract/plugin.ts";
import { decodeHostIdentity, envelope } from "./contract/records.ts";
import type { HostIdentity } from "./contract/records.ts";
import type { StoreConnection } from "./contract/store.ts";
import type {
  EnvironmentRegistry,
  JobTable,
  McpHub,
  McpHubFactory,
  PageTable,
} from "./contract/workspace.ts";
import { createExecutionState, dispatchHead, driveInProcess } from "./drive/execution.ts";
import { createJobTable } from "./engine/jobs.ts";
import { createPartDefinitions } from "./engine/part-definitions.ts";
import { createConnectionRegistry } from "./engine/principals.ts";
import { createWaitRegistry } from "./engine/waits.ts";
import { createPageTable } from "./env/browser.ts";
import { createEnvironmentRegistry } from "./env/environment.ts";
import { readMcpWorkspace } from "./env/mcp.ts";
import { createWorkspaces, createWorkspaceState } from "./env/workspaces.ts";
import { createConfigurationResolver, createModelsApi } from "./extend/models.ts";
import { pluginSecrets } from "./extend/plugin-api.ts";
import {
  checkPlugins,
  createPluginRuntime,
  createPluginState,
  hostPluginRows,
  replacePlugins,
} from "./extend/plugin-runtime.ts";
import { bumpGeneration } from "./extend/registry.ts";
import { dropScans, resourcesPlugin } from "./extend/resources.ts";
import { settingInfos } from "./extend/setting-layers.ts";
import { createSettingsApi } from "./extend/settings.ts";
import { createBus } from "./fold/bus.ts";
import { EMPTY_CATALOG } from "./fold/fold.ts";
import { createFoldCache, createLogPublisher, pollStore } from "./fold/watch.ts";
import { createModelState } from "./store/model-state.ts";
import { createPartTable } from "./store/parts.ts";
import { hostIdentityRef, kvRef } from "./store/refs.ts";
import { readKv } from "./store/session.ts";
import { dev } from "./util/dev-log.ts";

export type ComposeOptions = OpenOptions & {
  readonly home: string | null;
  readonly description: HostDescription;
  readonly pluginSources?: ReadonlyMap<
    Plugin<"core">,
    { readonly source: "user" | "project"; readonly path: string }
  >;

  readonly poll?: number;

  readonly seed?: { readonly settings: Readonly<Record<string, Json>>; readonly path: string };

  readonly loadPlugins?: PluginHost["load"];
};

const RUN_ALL: Kernel["execution"] = { kind: "run", coverage: { kind: "all" } };

const INACTIVE: Activation = { kind: "inactive" };

const NO_MODELS: ModelsApi = {
  list: async () => unavailable("models"),
  accounts: async () => unavailable("models"),
  selectAccount: async () => unavailable("models"),
  usage: async () => unavailable("models"),
  refresh: async () => unavailable("models"),
  setDefault: async () => unavailable("models"),
  verify: async () => unavailable("models"),
  login: () => unavailable("models"),
  logout: async () => unavailable("models"),
};

const BUILTINS: readonly Plugin<"core">[] = [
  systemPromptPlugin,
  environmentPlugin,
  resourcesPlugin,
  delegationPlugin,
];

/** Composes a host over `options.store`, with the server port a listener serves it through. */
export async function composeHost(options: ComposeOptions): Promise<ServedHost> {
  return (await composeServer(options)).host;
}

/** Composes a host and returns the kernel under it too, for tests that drive the kernel; everything else takes {@link composeHost}. */
export async function composeServer(
  options: ComposeOptions,
): Promise<{ readonly host: ServedHost; readonly kernel: Kernel }> {
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

  const added = await createWorkspaces(kernel, CORE_CONTEXT)
    .add(options.workspace)
    .catch((error: unknown) => ({
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

  kernel.host.update({ defaultWorkspace: added.workspace });

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

  return {
    host: { ...host, server: createServerHost(kernel), close, [Symbol.asyncDispose]: close },
    kernel,
  };
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
    [...kernel.plugins.builtins, ...kernel.plugins.host].flatMap((plugin) =>
      (plugin.contribute?.settings ?? []).flatMap((setting) =>
        setting.scope === "session" ? [setting.id] : [],
      ),
    ),
  );

  const settings = createSettingsApi(kernel);

  for (const [id, value] of Object.entries(seed.settings)) {
    if ((await readKv(kernel.store, kvRef("host", "settings", id))) !== undefined) continue;
    const outcome = await settings.apply(id, value);

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

  const kernel = createKernel({
    hostId: identity.id,
    store,
    description: options.description,
    host: createHostState({
      catalog: asId<"catalog-generation">(crypto.randomUUID()),
      plugins: [],
      settings: [],
      defaultWorkspace: null,
    }),
    execution: options.execution,
    models: options.models,
    mcp: options.mcp,
    builtins: BUILTINS,
    hostPlugins: options.plugins,
    pluginSources: options.pluginSources,
    secrets: options.secrets,
    home: options.home,
    poll: options.poll,
    loadPlugins: options.loadPlugins,
  });

  kernel.host.update({ plugins: hostPluginRows(kernel) });

  return kernel;
}

type KernelOptions = Pick<Kernel, "hostId" | "store" | "description" | "host"> &
  Partial<
    Pick<
      Kernel,
      | "execution"
      | "turn"
      | "summarize"
      | "compact"
      | "resolveConfiguration"
      | "request"
      | "home"
      | "secrets"
    >
  > & {
    readonly builtins?: PluginHost["builtins"];
    readonly hostPlugins?: PluginHost["host"];
    readonly pluginSources?: PluginHost["sources"];
    readonly loadPlugins?: PluginHost["load"];
    readonly poll?: number;
    /** Backs the model ports (turn, summarize, compact, configuration, request and the models API) unless a port is given. */
    readonly models?: Models;
    /** Builds the host's MCP hub and adds the `mcp` plugin to the builtins. */
    readonly mcp?: McpHubFactory;
  };

export function createKernel(input: KernelOptions): Kernel {
  const bus = createBus();
  const publisher = createLogPublisher({ store: input.store, bus });
  const sessions = createSessionDirectory(bus);
  const models = input.models;

  const runtimes = new Map<SessionId, PluginRuntime>();

  const install = (session: SessionId, previous: PluginRuntime | null): PluginRuntime => {
    const created = createPluginRuntime(kernel, session, previous);
    runtimes.set(session, created);

    return created;
  };

  let turn = input.turn ?? null;
  let summarize = input.summarize ?? null;
  let compact = input.compact ?? null;
  let resolveConfiguration = input.resolveConfiguration ?? null;
  let request = input.request ?? null;
  let modelsApi: ModelsApi | null = null;
  let mcp: McpHub | null | undefined;
  let builtins: readonly Plugin<"core">[] | null = null;
  let waits: WaitRegistry | null = null;
  let definitions: PartDefinitions | null = null;
  let environments: EnvironmentRegistry | null = null;
  let jobs: JobTable | null = null;
  let pages: PageTable | null = null;

  const kernel: Kernel = {
    hostId: input.hostId,
    instance: crypto.randomUUID(),
    poll: input.poll ?? null,
    externalCommits: new Set(),
    store: input.store,
    description: input.description,
    bus,
    publisher,
    host: input.host,
    folds: createFoldCache({
      store: input.store,
      description: input.description,
      bus,
      publisher,
      sessions,
      get jobs() {
        return kernel.jobs;
      },
      get pages() {
        return kernel.pages;
      },
    }),
    executionState: createExecutionState(),
    workspaceState: createWorkspaceState(),
    sessions,
    execution: input.execution ?? RUN_ALL,
    runs: createRunTable(bus),
    wakes: createWakes(),
    get turn() {
      return (turn ??=
        models === undefined
          ? { run: async () => unavailable("turn") }
          : createTurnDriver(kernel, models));
    },
    get summarize() {
      return (summarize ??=
        models === undefined
          ? async () => unavailable("summarize")
          : createSummarizer(kernel, models));
    },
    get compact() {
      return (compact ??=
        models === undefined
          ? async () => unavailable("compact")
          : createCompactor(kernel, models));
    },
    get resolveConfiguration() {
      return (resolveConfiguration ??=
        models === undefined
          ? async () => unavailable("resolveConfiguration")
          : createConfigurationResolver(kernel, models));
    },
    get waits() {
      return (waits ??= createWaitRegistry(kernel, (session, call) =>
        rerunAction(kernel, session, call),
      ));
    },
    modelState: createModelState(() => bumpGeneration(kernel)),
    get partDefinitions() {
      return (definitions ??= createPartDefinitions({ tool: stoppableTool(kernel) }));
    },
    partTable: createPartTable(bus),
    get request() {
      return (request ??=
        models === undefined ? async () => unavailable("request") : createRequest(kernel, models));
    },
    home: input.home ?? null,
    get environments() {
      return (environments ??= createEnvironmentRegistry(kernel));
    },
    get jobs() {
      return (jobs ??= createJobTable(kernel));
    },
    get pages() {
      return (pages ??= createPageTable(kernel));
    },
    connections: createConnectionRegistry(),
    secrets: input.secrets ?? null,
    get mcp() {
      if (mcp === undefined) mcp = input.mcp?.({ secrets: pluginSecrets(kernel, "mcp") }) ?? null;

      return mcp;
    },
    plugins: {
      get builtins() {
        const hub = kernel.mcp;

        return (builtins ??=
          hub === null
            ? (input.builtins ?? [])
            : [...(input.builtins ?? []), mcpPlugin(hub, (id) => readMcpWorkspace(kernel, id))]);
      },
      host: input.hostPlugins ?? [],
      sources: input.pluginSources ?? new Map(),
      state: createPluginState(),
      runtime: (session) => runtimes.get(session) ?? install(session, null),
      reload: (session) => install(session, runtimes.get(session) ?? null).ready,
      runtimes: () => runtimes,
      async close(session) {
        const runtime = runtimes.get(session);

        if (runtime === undefined) return;
        runtimes.delete(session);
        await runtime.close();
      },
      api: (owner, session) =>
        kernel.plugins.runtime(session).api(owner) ??
        unavailable(`plugin ${owner} in session ${session}`),
      replace: (plugins, scope) => replacePlugins(kernel, plugins, scope),
      check: async (plugins) => checkPlugins(plugins),
      load:
        input.loadPlugins ??
        (async () => unavailable("plugin files: this host has no plugin loader")),
    },
    handles: {
      connection: (context) =>
        createConnection(
          kernel,
          (modelsApi ??= models === undefined ? NO_MODELS : createModelsApi(kernel, models)),
          context,
        ),
      session: (context, session) => sessionHandle(kernel, context, session),
      activationSession: (context, session) => activationSession(kernel, context, session),
    },
  };

  const execution = kernel.execution;

  if (execution.kind === "dispatch")
    kernel.wakes.subscribe((session, head) => dispatchHead(kernel, execution, session, head));

  return kernel;
}

async function release(kernel: Kernel, driver: Owned | null): Promise<void> {
  await kernel.modelState.close();
  await kernel.mcp?.close();
  await driver?.close();
  const sessions = [...kernel.plugins.runtimes().keys()];

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

  for (const session of sessions) await kernel.plugins.close(session);
  dropScans(kernel);

  for (const session of sessions) await kernel.environments.detach(session);

  for (const workspace of workspaces) await kernel.environments.detachWorkspace(workspace);
}

async function storedIdentity(store: StoreConnection): Promise<HostIdentity | null> {
  const ref = await store.refs.get(hostIdentityRef());

  return ref?.target ? decodeHostIdentity(await store.objects.get(ref.target)) : null;
}

function createRunTable(bus: SessionBus): RunTable {
  const live = new Map<
    RunId,
    {
      readonly controller: AbortController;
      readonly fenced: () => boolean;
      readonly unsubscribe: Disposer;
    }
  >();

  return {
    start(session, run) {
      const held = live.get(run);

      if (held !== undefined) return held.controller;
      const controller = new AbortController();
      let fenced = false;

      const unsubscribe = bus.subscribe(session, (event) => {
        if (event.kind === "run" && event.run === run && event.change === "stopping") fenced = true;
      });

      live.set(run, { controller, fenced: () => fenced || controller.signal.aborted, unsubscribe });

      return controller;
    },
    abort(run) {
      live.get(run)?.controller.abort();
    },
    signal: (run) => live.get(run)?.controller.signal ?? null,
    fenced: (run) => live.get(run)?.fenced() ?? false,
    end(run) {
      live.get(run)?.unsubscribe();
      live.delete(run);
    },
  };
}

function createSessionDirectory(bus: SessionBus): SessionDirectory {
  const activations = new Map<SessionId, Activation>();
  const catalogs = new Map<SessionId, SessionCatalogView>();
  const now = () => ({ seq: asSeq(0), at: Date.now(), head: null });

  return {
    activation: (session) => activations.get(session) ?? INACTIVE,
    setActivation(session, activation) {
      activations.set(session, activation);
      bus.publish(session, { ...now(), kind: "activation", activation });
    },
    catalog: (session) => catalogs.get(session) ?? EMPTY_CATALOG,
    setCatalog(session, catalog) {
      catalogs.set(session, catalog);
      bus.publish(session, { ...now(), kind: "catalog", catalog });
    },
    forget(session) {
      catalogs.delete(session);
      activations.delete(session);
    },
  };
}

function createWakes(): Wakes {
  const listeners = new Set<(session: SessionId, head: HeadName) => void>();

  return {
    notify(session, head) {
      for (const listener of listeners) listener(session, head);
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function unavailable(slot: string): never {
  throw new SdkError("unavailable", `${slot} is not provided`);
}
