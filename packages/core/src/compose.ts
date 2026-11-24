import { asId, asSeq, SdkError } from "@nyte-ai/schema";
import type {
  Activation,
  Disposer,
  HeadName,
  HostDescription,
  Json,
  Owned,
  RunId,
  SessionId,
  ValidationIssue,
} from "@nyte-ai/schema";
import type { MutableModels } from "@nyte-ai/ai/models";
import { createCompactor, createSummarizer } from "./agent/compaction.ts";
import { createRequest } from "./agent/request.ts";
import { stoppableTool } from "./agent/tool-runner.ts";
import { createProviderRuns } from "./engine/provider-runs.ts";
import { createRuntimePolicy } from "./extend/runtime-policy.ts";
import { createTurnDriver } from "./agent/turn.ts";
import { createConnection, createHost } from "./api/connection.ts";
import { createHostState } from "./api/host.ts";
import { createServerHost } from "./api/server.ts";
import { rerunAction } from "./api/part.ts";
import { publishProjects, requireProject } from "./api/projects.ts";
import { activationSession, sessionHandle } from "./api/session.ts";
import { environmentPlugin } from "./builtins/environment.ts";
import { interruptionsPlugin } from "./builtins/interruptions.ts";
import { mcpPlugin } from "./builtins/mcp.ts";
import { systemPromptPlugin } from "./builtins/system-prompt.ts";
import type { SessionBus } from "./contract/fold.ts";
import { CORE_CONTEXT } from "./contract/host.ts";
import type {
  ClientsApi,
  DocumentsApi,
  ImageProcessor,
  ModelsApi,
  OpenOptions,
} from "./contract/host.ts";
import type {
  Kernel,
  PluginHost,
  PluginProviders,
  PluginRuntime,
  RunTable,
  SessionDirectory,
  WaitRegistry,
  Wakes,
} from "./contract/kernel.ts";
import type { PartDefinitions } from "./contract/parts.ts";
import type { ServedHost } from "./contract/server.ts";
import { resolveSetting } from "./contract/plugin.ts";
import type { Plugin } from "./contract/plugin.ts";
import type { Member } from "./contract/presence.ts";
import { decodeHostIdentity, envelope } from "./contract/records.ts";
import type { HostIdentity } from "./contract/records.ts";
import type { StoreConnection } from "./contract/store.ts";
import type {
  EnvironmentRegistry,
  GitHubAccountApi,
  JobTable,
  McpHub,
  McpHubFactory,
  PageTable,
} from "./contract/workspace.ts";
import { dispatchHead } from "./drive/dispatch.ts";
import { createExecutionState, driveInProcess } from "./drive/execution.ts";
import { HOST_CLOSING } from "./engine/durable.ts";
import { createChildTable } from "./engine/children.ts";
import { createJobTable, jobHandle } from "./engine/jobs.ts";
import { openPresence } from "./engine/presence.ts";
import { createPartDefinitions } from "./extend/part-definitions.ts";
import { createConnectionRegistry } from "./api/principals.ts";
import { stopStart } from "./engine/start.ts";
import { createWaitRegistry } from "./engine/waits.ts";
import { createPageTable } from "./env/browser.ts";
import { createEnvironmentRegistry } from "./env/environment.ts";
import { readMcpWorkspace } from "./env/mcp.ts";
import { createWorkspaces, createWorkspaceState } from "./env/workspaces.ts";
import {
  createConfigurationResolver,
  createModelsApi,
  createPluginProviders,
  rememberChoice,
} from "./extend/models.ts";
import { pluginSecrets } from "./extend/plugin-api.ts";
import {
  createPluginRuntime,
  publishServed,
  createPluginState,
  hostPluginRows,
  replacePlugins,
} from "./extend/plugin-runtime.ts";
import { checkPlugins } from "./extend/plugin-checks.ts";
import { bumpGeneration } from "./extend/registry.ts";
import { publishViews } from "./extend/part-views.ts";
import { reportUserPluginFailures, userPluginFolder } from "./extend/plugin-folders.ts";
import { closeWatches, forgetScans, resourcesPlugin, watchHome } from "./extend/resources.ts";
import { settingInfos } from "./extend/setting-definitions.ts";
import { createSettingsApi } from "./extend/settings.ts";
import { createBus } from "./watch/bus.ts";
import { createFoldCache, createLogPublisher, pollStore } from "./watch/watch.ts";
import { createModelState } from "./store/model-state.ts";
import { createPartTable } from "./store/parts.ts";
import { hostIdentityRef, kvRef, parseSessionRef } from "./store/refs.ts";
import { loadSecretCipherKey } from "./store/secrets.ts";
import { readHeld, readKv } from "./store/session.ts";
import { dev } from "./util/dev-log.ts";
import { variablesPlugin } from "./env/variables.ts";
import {
  cleanWorktrees,
  releaseWorktree,
  sweepWorktrees,
  worktreesPlugin,
} from "./env/worktrees.ts";

export type ComposeOptions = OpenOptions & {
  readonly home: string | null;
  readonly description: HostDescription;

  readonly poll?: number;

  readonly seed?: { readonly settings: Readonly<Record<string, Json>>; readonly path: string };

  readonly loadPlugins?: PluginHost["load"];

  /** Loads a plugin folder file by file; with it the host loads `<home>/.nyte/plugins` beside `plugins` and a trusted workspace's `.nyte/plugins` in its chats. */
  readonly loadPluginDirectory?: PluginHost["directory"];

  /** Without it the host publishes no part views. */
  readonly compileView?: NonNullable<PluginHost["compileView"]>;

  readonly member?: Member;

  readonly revoked?: () => void;
};

const RUN_ALL: Kernel["execution"] = { kind: "run", coverage: { kind: "all" } };

const INACTIVE: Activation = { kind: "inactive" };

const NO_PLUGIN_PROVIDERS: PluginProviders = {
  sync: async () => undefined,
  close: () => undefined,
};

const NO_MODELS: ModelsApi = {
  list: async () => unavailable("models"),
  accounts: async () => unavailable("models"),
  selectAccount: async () => unavailable("models"),
  renameAccount: async () => unavailable("models"),
  usage: async () => unavailable("models"),
  refresh: async () => unavailable("models"),
  setDefault: async () => unavailable("models"),
  setListing: async () => unavailable("models"),
  verify: async () => unavailable("models"),
  login: () => unavailable("models"),
  logout: async () => unavailable("models"),
};

const BUILTINS: readonly Plugin<"core">[] = [
  systemPromptPlugin,
  environmentPlugin,
  resourcesPlugin,
  interruptionsPlugin,
  worktreesPlugin,
  variablesPlugin,
];

const CLEAN_WORKTREES_MS = 24 * 60 * 60 * 1000;

const RUNTIME_IDLE_MS = 10 * 60 * 1000;

const EVICT_RUNTIMES_MS = 60 * 1000;

export async function composeHost(options: ComposeOptions): Promise<ServedHost> {
  return (await composeServer(options)).host;
}

export async function composeServer(
  options: ComposeOptions,
): Promise<{ readonly host: ServedHost; readonly kernel: Kernel }> {
  const user =
    options.home === null || options.loadPluginDirectory === undefined
      ? { loaded: [], failed: [] }
      : await options.loadPluginDirectory(userPluginFolder(options.home));

  const given = [...options.plugins, ...user.loaded.map((entry) => entry.plugin)];

  const sources: PluginHost["sources"] = new Map(
    user.loaded.map((entry) => [entry.plugin, { source: "user", path: entry.path }] as const),
  );

  const outcomes = checkPlugins([...BUILTINS, ...given]).plugins;

  const fromFile = (index: number) =>
    index < BUILTINS.length ? undefined : sources.get(given[index - BUILTINS.length]);

  const rejected = outcomes.filter(
    (outcome, index) => outcome.kind === "rejected" && fromFile(index) === undefined,
  );

  if (rejected.length > 0) {
    throw new SdkError(
      "invalid",
      `The host cannot load ${rejected.map((outcome) => outcome.id).join(", ")}.`,
      { issues: rejected.flatMap((outcome) => outcome.issues) },
    );
  }

  const dropped = outcomes.flatMap((outcome, index) => {
    const file = fromFile(index);

    return outcome.kind === "rejected" && file !== undefined
      ? [{ path: file.path, issues: outcome.issues }]
      : [];
  });

  const plugins = given.filter(
    (_plugin, index) => outcomes[BUILTINS.length + index].kind !== "rejected",
  );

  for (const plugin of sources.keys()) if (!plugins.includes(plugin)) sources.delete(plugin);

  const store = await options.store.open();

  const kernel = await composeKernel({ ...options, plugins }, store, sources);
  await kernel.pluginProviders.sync();

  for (const row of dropped) {
    dev("compose", "plugin file dropped", { path: row.path, issues: row.issues.length });
  }

  reportUserPluginFailures(
    kernel,
    user.loaded.map((entry) => entry.plugin),
    dropped,
    user.failed.map((entry) => ({ path: entry.path, issues: [entry.issue] })),
  );

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
    await publishProjects(kernel);

    if (options.loadPluginDirectory !== undefined) await watchHome(kernel);
    await publishViews(kernel);
  } catch (error) {
    await release(kernel, null);

    throw error;
  }

  const driver =
    kernel.execution.kind === "run" ? driveInProcess(kernel, kernel.execution.coverage) : null;

  const unpoll = pollStore(kernel);

  const clean = (): void =>
    void cleanWorktrees(kernel).catch((error: unknown) =>
      dev("worktrees", "clean failed", { error: String(error) }),
    );

  void sweepWorktrees(kernel)
    .catch((error: unknown) => dev("worktrees", "sweep failed", { error: String(error) }))
    .then(clean);
  const cleaning = setInterval(clean, CLEAN_WORKTREES_MS);

  const evicting = setInterval(
    () =>
      void evictIdleRuntimes(kernel).catch((error: unknown) =>
        dev("plugins", "eviction failed", { error: String(error) }),
      ),
    EVICT_RUNTIMES_MS,
  );

  if (typeof evicting === "object") evicting.unref();

  const host = createHost(kernel, { credential: { kind: "token", token: "" } });
  let closing: Promise<void> | null = null;

  const close = (): Promise<void> => {
    closing ??= (async () => {
      clearInterval(cleaning);
      clearInterval(evicting);
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

  const declared = [...kernel.plugins.builtins, ...kernel.plugins.host].flatMap((plugin) =>
    (plugin.contribute?.settings ?? []).map(resolveSetting),
  );

  const sessionScoped = new Set(
    declared.flatMap((setting) => (setting.scope === "chat" ? [setting.id] : [])),
  );

  const secret = new Set(declared.flatMap((setting) => (setting.secret ? [setting.id] : [])));
  const settings = createSettingsApi(kernel);

  for (const [id, value] of Object.entries(seed.settings)) {
    if (secret.has(id)) {
      issues.push({
        severity: "warning",
        path: [id],
        message: `${id} holds secrets, so settings.json can't seed it. Set it in Settings.`,
      });
      continue;
    }

    if ((await readKv(kernel.store, kvRef("host", "settings", id))) !== undefined) continue;
    const outcome = await settings.apply(id, value);

    if (outcome.kind === "applied") applied += 1;
    else if (outcome.kind === "unknown") {
      issues.push({
        severity: "warning",
        path: [id],
        message: sessionScoped.has(id)
          ? `${id} is a session-scope setting; settings.json seeds host-scope settings only, so set it on a session.`
          : `No setting is named ${id}.`,
      });
    } else {
      issues.push(
        ...outcome.issues.map((issue) => ({
          ...issue,
          severity: "warning" as const,
          path: [id, ...issue.path],
        })),
      );
    }
  }

  dev("compose", "settings seeded", {
    ids: Object.keys(seed.settings).length,
    applied,
    issues: issues.length,
  });

  if (issues.length > 0) {
    kernel.host.report({ id: "settings", source: "user", path: seed.path, issues });
  }
}

async function composeKernel(
  options: ComposeOptions,
  store: StoreConnection,
  pluginSources: PluginHost["sources"],
): Promise<Kernel> {
  const identity = await hostIdentity(store);
  const instance = crypto.randomUUID();

  const presence =
    options.member === undefined
      ? null
      : await openPresence(store, { instance, holder: identity.id, member: options.member });

  const kernel = createKernel({
    hostId: identity.id,
    instance,
    presence,
    store: presence?.store ?? store,
    description: options.description,
    host: createHostState({
      catalog: asId<"catalog-generation">(crypto.randomUUID()),
      plugins: [],
      settings: [],
      views: [],
      defaultWorkspace: null,
      projects: [],
    }),
    execution: options.execution,
    models: options.models,
    mcp: options.mcp,
    clients: options.clients,
    github: options.github,
    documents: options.documents,
    images: options.images,
    builtins: BUILTINS,
    hostPlugins: options.plugins,
    pluginSources,
    secrets: options.secrets,
    home: options.home,
    poll: options.poll,
    loadPlugins: options.loadPlugins,
    loadPluginDirectory: options.loadPluginDirectory,
    compileView: options.compileView,
  });

  kernel.host.update({ plugins: hostPluginRows(kernel) });

  presence?.revoked.addEventListener(
    "abort",
    () => {
      kernel.executionState.closing.abort(HOST_CLOSING);
      options.revoked?.();
    },
    { once: true },
  );

  return kernel;
}

type KernelOptions = Pick<Kernel, "hostId" | "store" | "description" | "host"> &
  Partial<
    Pick<
      Kernel,
      | "instance"
      | "presence"
      | "execution"
      | "turn"
      | "summarize"
      | "compact"
      | "resolveConfiguration"
      | "modelSteers"
      | "request"
      | "home"
      | "secrets"
    >
  > & {
    readonly builtins?: PluginHost["builtins"];
    readonly hostPlugins?: PluginHost["host"];
    readonly pluginSources?: PluginHost["sources"];
    readonly loadPlugins?: PluginHost["load"];
    readonly loadPluginDirectory?: PluginHost["directory"];
    readonly compileView?: NonNullable<PluginHost["compileView"]>;
    readonly poll?: number;
    readonly models?: MutableModels;
    readonly mcp?: McpHubFactory;
    readonly clients?: ClientsApi;
    readonly github?: GitHubAccountApi;
    readonly documents?: DocumentsApi;
    readonly images?: ImageProcessor;
  };

export function createKernel(input: KernelOptions): Kernel {
  const bus = createBus();
  const publisher = createLogPublisher({ store: input.store, bus });
  const sessions = createSessionDirectory(bus);
  const models = input.models;

  const runtimes = new Map<SessionId, PluginRuntime>();

  const loading = new Map<SessionId, PluginRuntime>();

  const install = (
    session: SessionId,
    previous: PluginRuntime | null,
  ): { readonly created: PluginRuntime; readonly settled: Promise<void> } => {
    const created = createPluginRuntime(kernel, session, previous);

    if (previous === null) {
      runtimes.set(session, created);

      return { created, settled: created.ready };
    }

    loading.set(session, created);

    const takeOver = async (): Promise<void> => {
      if (loading.get(session) === created) loading.delete(session);

      if (runtimes.get(session) !== previous) return;
      runtimes.set(session, created);
      await publishServed(kernel, session);
    };

    const settled = created.ready.then(takeOver, async (error: unknown) => {
      await takeOver();
      throw error;
    });

    return { created, settled };
  };

  let turn = input.turn ?? null;
  let summarize = input.summarize ?? null;
  let compact = input.compact ?? null;
  let resolveConfiguration = input.resolveConfiguration ?? null;
  let request = input.request ?? null;
  let modelsApi: ModelsApi | null = null;
  let pluginProviders: PluginProviders | undefined;
  let mcp: McpHub | null | undefined;
  let builtins: readonly Plugin<"core">[] | null = null;
  let waits: WaitRegistry | null = null;
  let definitions: PartDefinitions | null = null;
  let environments: EnvironmentRegistry | null = null;
  let jobs: JobTable | null = null;
  let pages: PageTable | null = null;
  let secretKey: Promise<CryptoKey> | null = null;

  let providerRuns: Kernel["providerRuns"] | undefined;
  let runtimePolicy: Kernel["runtimePolicy"] | undefined;
  const kernel: Kernel = {
    get providerRuns() {
      return (providerRuns ??= createProviderRuns(kernel));
    },
    get runtimePolicy() {
      return (runtimePolicy ??= createRuntimePolicy(kernel));
    },
    hostId: input.hostId,
    instance: input.instance ?? crypto.randomUUID(),
    presence: input.presence ?? null,
    poll: input.poll ?? null,
    externalCommits: new Set(),
    hostChanges: new Set(),
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
      get children() {
        return kernel.children;
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
    modelSteers:
      input.modelSteers ??
      ((model) => models?.getProvider(model.provider)?.capabilities?.steer ?? true),
    get resolveConfiguration() {
      return (resolveConfiguration ??=
        models === undefined
          ? async () => unavailable("resolveConfiguration")
          : createConfigurationResolver(kernel, models));
    },
    rememberChoice: async (choice, scope) => {
      if (models !== undefined) await rememberChoice(kernel, models, choice, scope);
    },
    get waits() {
      return (waits ??= createWaitRegistry(kernel, (session, call) =>
        rerunAction(kernel, session, call),
      ));
    },
    modelState: createModelState(() => bumpGeneration(kernel)),
    get pluginProviders() {
      return (pluginProviders ??=
        models === undefined ? NO_PLUGIN_PROVIDERS : createPluginProviders(kernel, models));
    },
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
    children: createChildTable({
      bus,
      get jobs() {
        return kernel.jobs;
      },
      get pages() {
        return kernel.pages;
      },
      get children() {
        return kernel.children;
      },
    }),
    connections: createConnectionRegistry(),
    secrets: input.secrets ?? null,
    get secretKey() {
      return (secretKey ??= kernel.secrets === null ? null : loadSecretCipherKey(kernel.secrets));
    },
    clients: input.clients ?? null,
    github: input.github ?? null,
    documents: input.documents ?? null,
    images: input.images ?? null,
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
            : [
                ...(input.builtins ?? []),
                mcpPlugin(
                  hub,
                  (id) => readMcpWorkspace(kernel, id),
                  async (id) => (await requireProject(kernel, id)).record,
                ),
              ]);
      },
      host: input.hostPlugins ?? [],
      sources: input.pluginSources ?? new Map(),
      state: createPluginState(),
      runtime(session) {
        const found = runtimes.get(session) ?? install(session, null).created;
        found.touch();

        return found;
      },
      newest: (session) => loading.get(session) ?? kernel.plugins.runtime(session),
      reload: (session) =>
        install(session, loading.get(session) ?? runtimes.get(session) ?? null).settled,
      runtimes: () => runtimes,
      async close(session) {
        const runtime = runtimes.get(session);
        const pending = loading.get(session);

        if (runtime === undefined && pending === undefined) return;
        runtimes.delete(session);
        loading.delete(session);
        forgetScans(kernel, (key) => key === session);
        const detached = kernel.environments.detach(session);
        await runtime?.close();
        await pending?.close();
        await detached;
      },
      api: (owner, session) =>
        kernel.plugins.runtime(session).api(owner) ??
        unavailable(`plugin ${owner} in session ${session}`),
      replace: (plugins, scope) => replacePlugins(kernel, plugins, scope),
      check: async (plugins) => checkPlugins(plugins),
      load:
        input.loadPlugins ??
        (async () => unavailable("plugin files: this host has no plugin loader")),
      directory: input.loadPluginDirectory ?? (async () => ({ loaded: [], failed: [] })),
      compileView: input.compileView ?? null,
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
    stopStart: (session) => stopStart(kernel, session),
    releaseWorktree: (session, workspace) => releaseWorktree(kernel, session, workspace),
  };

  const execution = kernel.execution;

  if (execution.kind === "dispatch") {
    kernel.wakes.subscribe((session, head) => dispatchHead(kernel, execution, session, head));
  }

  return kernel;
}

async function release(kernel: Kernel, driver: Owned | null): Promise<void> {
  await driver?.close();
  await kernel.mcp?.close();
  kernel.pluginProviders.close();
  await kernel.modelState.close();

  const workspaces = (await kernel.store.refs.list("workspaces/")).map((ref) =>
    asId<"workspace">(ref.name.slice("workspaces/".length)),
  );

  const running = workspaces.flatMap((workspace) =>
    kernel.jobs.list(workspace).filter((job) => job.view.state.kind === "running"),
  );

  await Promise.allSettled(running.map((job) => job.process.stop()));
  await Promise.allSettled(running.map((job) => jobHandle(kernel, job.view.id).settled()));

  await closeWatches(kernel);

  for (const session of kernel.plugins.runtimes().keys()) await kernel.plugins.close(session);

  for (const workspace of workspaces) await kernel.environments.detachWorkspace(workspace);
  await kernel.folds.close();
  const state = kernel.executionState;

  await kernel.presence?.close(
    [...state.undrained].flatMap((name) => {
      const held = state.held.get(name);

      return held === undefined ? [] : [{ name, expect: held.revision }];
    }),
  );
}

async function evictIdleRuntimes(kernel: Kernel): Promise<void> {
  const now = Date.now();
  const driving = new Set(kernel.executionState.driving.values());
  const parts = kernel.partTable;
  const awaited = new Set([...parts.waiters.keys(), ...parts.acting.keys()].map(parseSessionRef));

  const idle = [...kernel.plugins.runtimes()].flatMap(([session, runtime]) => {
    const since = runtime.idleSince();

    return since === null ||
      now - since < RUNTIME_IDLE_MS ||
      driving.has(session) ||
      awaited.has(session) ||
      kernel.folds.folding(session) ||
      kernel.plugins.state.inline.has(session) ||
      kernel.jobs.background(session).some((job) => job.item.state === "working")
      ? []
      : [session];
  });

  for (const session of idle) {
    if (kernel.sessions.activation(session).kind === "active") kernel.sessions.forget(session);
  }

  await Promise.all(idle.map((session) => kernel.plugins.close(session)));
}

async function storedIdentity(store: StoreConnection): Promise<HostIdentity | null> {
  const held = await readHeld(store, await store.refs.get(hostIdentityRef()));

  return held === null ? null : decodeHostIdentity(held.object);
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
  const now = () => ({ seq: asSeq(0), at: Date.now(), head: null });

  return {
    activation: (session) => activations.get(session) ?? INACTIVE,
    setActivation(session, activation) {
      activations.set(session, activation);
      bus.publish(session, { ...now(), kind: "activation", activation });
    },
    forget(session) {
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
