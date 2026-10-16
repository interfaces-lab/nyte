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
import { createPart, partHandle, rerunAction } from "./api/part.ts";
import { activationSession, sessionHandle } from "./api/session.ts";
import { delegationPlugin } from "./builtins/delegation.ts";
import { environmentPlugin } from "./builtins/environment.ts";
import { mcpPlugin } from "./builtins/mcp.ts";
import { systemPromptPlugin } from "./builtins/system-prompt.ts";
import type { SessionBus } from "./contract/fold.ts";
import { CORE_CONTEXT } from "./contract/host.ts";
import type { ModelsApi, OpenOptions, SettingsApi } from "./contract/host.ts";
import type { Kernel, PluginRuntime, RunTable, WaitRegistry, Wakes } from "./contract/kernel.ts";
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
  Workspaces,
} from "./contract/workspace.ts";
import { createExecutionState, dispatchHead, driveInProcess } from "./drive/execution.ts";
import { runAction } from "./engine/durable.ts";
import { createJobTable } from "./engine/jobs.ts";
import { createPartDefinitions } from "./engine/part-definitions.ts";
import { createConnectionRegistry, createPrincipals } from "./engine/principals.ts";
import { createWaitRegistry } from "./engine/waits.ts";
import { createPageTable } from "./env/browser.ts";
import { createEnvironmentRegistry } from "./env/environment.ts";
import { readMcpWorkspace } from "./env/mcp.ts";
import { createWorkspaces, createWorkspaceState } from "./env/workspaces.ts";
import { gateSubmission } from "./extend/hooks.ts";
import { createConfigurationResolver, createModelsApi } from "./extend/models.ts";
import { pluginSecrets } from "./extend/plugin-api.ts";
import {
  checkPlugins,
  createPluginRuntime,
  createPluginState,
  hostPluginRows,
  replacePlugins,
} from "./extend/plugin-runtime.ts";
import { bumpGeneration, runCommand, toolSource } from "./extend/registry.ts";
import { dropScans, resourcesPlugin } from "./extend/resources.ts";
import { settingInfos } from "./extend/setting-layers.ts";
import { createSettingsApi } from "./extend/settings.ts";
import { createBus } from "./fold/bus.ts";
import { EMPTY_CATALOG } from "./fold/fold.ts";
import { createFoldCache, createLogPublisher, pollStore, trackStreams } from "./fold/watch.ts";
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

  readonly loadPlugins?: Kernel["loadPlugins"];
};

const RUN_ALL: Kernel["execution"] = { kind: "run", coverage: { kind: "all" } };

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
    [...kernel.builtins, ...kernel.hostPlugins].flatMap((plugin) =>
      (plugin.contribute?.settings ?? []).flatMap((setting) =>
        setting.scope === "session" ? [setting.id] : [],
      ),
    ),
  );

  for (const [id, value] of Object.entries(seed.settings)) {
    if ((await readKv(kernel.store, kvRef("host", "settings", id))) !== undefined) continue;
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

  const kernel = createKernel({
    hostId: identity.id,
    store,
    description: options.description,
    host: createHostState({
      catalog: asId<"catalog-generation">(crypto.randomUUID()),
      plugins: [],
      settings: [],
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
      | "defaultWorkspace"
      | "execution"
      | "turn"
      | "summarize"
      | "compact"
      | "resolveConfiguration"
      | "admit"
      | "tools"
      | "beforeTool"
      | "afterTool"
      | "request"
      | "home"
      | "secrets"
      | "builtins"
      | "hostPlugins"
      | "pluginSources"
      | "loadPlugins"
    >
  > & {
    readonly poll?: number;
    /** Backs the model ports (turn, summarize, compact, configuration, request and the models API) unless a port is given. */
    readonly models?: Models;
    /** Builds the host's MCP hub and adds the `mcp` plugin to the builtins. */
    readonly mcp?: McpHubFactory;
  };

export function createKernel(input: KernelOptions): Kernel {
  const bus = createBus();
  const publisher = createLogPublisher({ store: input.store, bus });
  const streams = trackStreams(bus);
  const activations = new Map<SessionId, Activation>();
  const inactive: Activation = { kind: "inactive" };
  const activation = (session: SessionId): Activation => activations.get(session) ?? inactive;
  const catalogs = new Map<SessionId, SessionCatalogView>();
  const models = input.models;

  const catalog = (session: SessionId): SessionCatalogView =>
    catalogs.get(session) ?? EMPTY_CATALOG;

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
  let settings: SettingsApi | null = null;
  let workspaces: Workspaces | null = null;
  let environments: EnvironmentRegistry | null = null;
  let jobs: JobTable | null = null;
  let pages: PageTable | null = null;
  let principals: Kernel["principals"] | null = null;

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
      bus,
      publisher,
      streams,
      activation,
      catalog,
      get jobs() {
        return kernel.jobs;
      },
      get pages() {
        return kernel.pages;
      },
    }),
    streams,
    driving: new Map(),
    executionState: createExecutionState(),
    pluginState: createPluginState(),
    workspaceState: createWorkspaceState(),
    receipts: new Map(),
    calls: new Map(),
    activation,
    setActivation(session, value) {
      activations.set(session, value);
      bus.publish(session, {
        seq: asSeq(0),
        at: Date.now(),
        head: null,
        kind: "activation",
        activation: value,
      });
    },
    defaultWorkspace: input.defaultWorkspace ?? null,
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
    admit: input.admit ?? ((submission, context) => gateSubmission(kernel, submission, context)),
    command: (context, session, name, args) => runCommand(kernel, context, session, name, args),
    get waits() {
      return (waits ??= createWaitRegistry(kernel));
    },
    get models() {
      return (modelsApi ??= models === undefined ? NO_MODELS : createModelsApi(kernel, models));
    },
    modelState: createModelState(() => bumpGeneration(kernel)),
    get settings() {
      return (settings ??= createSettingsApi(kernel));
    },
    get workspaces() {
      return (workspaces ??= createWorkspaces(kernel, CORE_CONTEXT));
    },
    parts: {
      create: (context, session, kind, value) => createPart(kernel, context, session, kind, value),
      part: (context, session, id) => partHandle(kernel, context, session, id),
      rerun: (session, call) => rerunAction(kernel, session, call),
    },
    get partDefinitions() {
      return (definitions ??= createPartDefinitions({ tool: stoppableTool(kernel) }));
    },
    partTable: createPartTable(bus),
    durable: { run: (step) => runAction(kernel, step) },
    tools: input.tools ?? toolSource,
    beforeTool:
      input.beforeTool ??
      ((call, { runtime, ...context }) =>
        runtime.hooks.decide("before_tool", call, context, {
          call: asId<"call">(`hook:before_tool:${call.call}`),
          run: context.run,
          head: context.head,
          part: null,
          signal: context.signal,
        })),
    afterTool:
      input.afterTool ??
      ((outcome, { runtime, ...context }) =>
        runtime.hooks.transform("after_tool", outcome, context)),
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
    get builtins() {
      const hub = kernel.mcp;

      return (builtins ??=
        hub === null
          ? (input.builtins ?? [])
          : [...(input.builtins ?? []), mcpPlugin(hub, (id) => readMcpWorkspace(kernel, id))]);
    },
    hostPlugins: input.hostPlugins ?? [],
    pluginSources: input.pluginSources ?? new Map(),
    pluginsFor: (session) => runtimes.get(session) ?? install(session, null),
    reloadPlugins: (session) => install(session, runtimes.get(session) ?? null).ready,
    runtimes: () => runtimes,
    async closePlugins(session) {
      const runtime = runtimes.get(session);

      if (runtime === undefined) return;
      runtimes.delete(session);
      await runtime.close();
    },
    catalog,
    forget(session) {
      catalogs.delete(session);
      activations.delete(session);
    },
    setCatalog(session, value) {
      catalogs.set(session, value);
      bus.publish(session, {
        seq: asSeq(0),
        at: Date.now(),
        head: null,
        kind: "catalog",
        catalog: value,
      });
    },
    pluginApi: (owner, session) =>
      kernel.pluginsFor(session).api(owner) ?? unavailable(`plugin ${owner} in session ${session}`),
    plugins: {
      replace: (plugins, scope) => replacePlugins(kernel, plugins, scope),
      check: async (plugins) => checkPlugins(plugins),
    },
    loadPlugins:
      input.loadPlugins ??
      (async () => unavailable("plugin files: this host has no plugin loader")),
    get principals() {
      return (principals ??= createPrincipals(kernel));
    },
    handles: {
      connection: (context) => createConnection(kernel, context),
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
