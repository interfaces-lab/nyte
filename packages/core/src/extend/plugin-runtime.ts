import { SdkError } from "@nyte-ai/schema";
import { serial } from "@nyte-ai/schema/serial";
import type {
  Awaitable,
  Disposer,
  HostView,
  PluginLoadOutcome,
  PluginReplacementReport,
  SessionId,
  ValidationIssue,
} from "@nyte-ai/schema";
import { CORE_CONTEXT, LOCAL } from "../contract/host.ts";
import type { PluginFile } from "../contract/host.ts";
import type {
  Attached,
  HookDispatch,
  InstanceHost,
  Kernel,
  PluginInstance,
  PluginRuntime,
  PluginState,
  RegistrySet,
} from "../contract/kernel.ts";
import type { PartDefinition } from "../contract/parts.ts";
import type {
  Additions,
  Chat,
  HookName,
  Hooks,
  Plugin,
  PluginApi,
  Registries,
  Registry,
} from "../contract/plugin.ts";
import type { AssignedPlugin } from "../contract/records.ts";
import type { ExecutionEnv, Resources } from "../contract/workspace.ts";
import { RESERVED_PART_KINDS } from "./part-definitions.ts";
import { coveredHere, requireSession } from "../store/session.ts";
import { dev } from "../util/dev-log.ts";
import { activateSession } from "./activation.ts";
import { preflight, reservedKind, takenKind } from "./plugin-checks.ts";
import type { Preflight } from "./plugin-checks.ts";
import { publishViews } from "./part-views.ts";
import { assignPlugins, loadPlugins } from "./plugin-folders.ts";
import { createHookDispatch, namesCoreHook, reportUnknownHook } from "./hooks.ts";
import { build, corePluginApi } from "./plugin-api.ts";
import { bumpGeneration, createRegistrySet, publishCatalog } from "./registry.ts";
import { readSettingValues } from "./setting-definitions.ts";
import { publishSettings, settingHandle } from "./settings.ts";
import { scanResources } from "./resources.ts";

interface Active {
  readonly instance: PluginInstance;
  readonly leave: Disposer;
}

type SessionLoad =
  | { readonly kind: "loaded"; readonly outcomes: readonly PluginLoadOutcome[] }
  | { readonly kind: "failed"; readonly session: SessionId; readonly message: string }
  | { readonly kind: "reassigned" }
  | { readonly kind: "gone" };

interface Resolved {
  readonly env: Attached;
  readonly inputs: Resources | null;
}

const ACTIVATE_SECONDS = 30;

const NEVER = new AbortController().signal;

const UNRESOLVED: Resolved = { env: { env: null }, inputs: null };

export function createPluginState(): PluginState {
  return {
    inline: new Map(),
    holds: new Map(),
    settings: new Set(),
    publishing: new Map(),
    user: { plugins: [], refused: [], failing: [] },
    viewFailures: [],
  };
}

export function createPluginRuntime(
  kernel: Kernel,
  session: SessionId,
  previous: PluginRuntime | null,
): PluginRuntime {
  const active = new Map<string, Active>();
  const rows = new Map<string, readonly ValidationIssue[]>();

  const parts = new Map<
    string,
    { readonly definition: PartDefinition; readonly release: Disposer }
  >();

  let found = new Map<string, readonly ValidationIssue[]>();
  let finding = new Map<string, readonly ValidationIssue[]>();
  let resolving: Promise<Resolved> | null = null;
  let resolved = UNRESOLVED;
  let core: PluginApi<"core"> | null = null;
  let closed = false;
  let last: readonly PluginLoadOutcome[] = [];
  let requested: readonly Plugin<"core">[] = [];
  let assigned = previous?.assigned() ?? null;
  const lifecycle = serial();
  let holds = 0;
  let idle: PromiseWithResolvers<void> | null = null;
  let activating = true;
  let used = Date.now();
  let shownIssues = "";
  let resolvedUncovered = false;

  const held = <T>(work: () => Promise<T>): Promise<T> => {
    const release = hold();

    return work().finally(release);
  };

  function hold(): Disposer {
    holds += 1;
    let released = false;

    return () => {
      if (released) return;
      released = true;
      holds -= 1;

      if (holds > 0) return;
      used = Date.now();
      idle?.resolve();
      idle = null;
    };
  }

  const pend = (owner: string, issue: ValidationIssue): void => {
    finding.set(owner, [...(finding.get(owner) ?? []), issue]);
  };

  let facts: Pick<Chat, "parent" | "settings"> = { parent: null, settings: {} };

  const registries = createRegistrySet({
    chat: () => facts,
    onChange: afterPass,
    setting: (definition, owner) =>
      settingHandle(kernel, definition, {
        owner,
        session,
        signal: active.get(owner)?.instance.api.signal ?? NEVER,
      }),
    report: pend,
  });

  const readFacts = async (): Promise<void> => {
    registries.settings.materialize(registries);

    facts = {
      parent: (await requireSession(kernel.store, session)).record.parent,
      settings: await readSettingValues(
        kernel,
        session,
        registries.settings.drafted().map((entry) => entry.item),
      ),
    };
  };

  const settingChanged = (_id: string, scope: SessionId | null): void => {
    if (closed || (scope !== null && scope !== session)) return;

    void readFacts().then(
      () => registries.reload(),
      () => undefined,
    );
  };

  const dispatch = createHookDispatch(kernel, session);

  const own: HookDispatch = {
    register: (plugin, api, name, entry) => dispatch.register(plugin, api, name, entry),
    observe: (name, event, context) => held(() => dispatch.observe(name, event, context)),
    transform: (name, value, context, signal) =>
      held(() => dispatch.transform(name, value, context, signal)),
    decide: (name, value, context, step) => held(() => dispatch.decide(name, value, context, step)),
  };

  let serving = previous?.hooks ?? own;

  const hooks: HookDispatch = {
    register: (plugin, api, name, entry) => own.register(plugin, api, name, entry),
    observe: (name, event, context) => serving.observe(name, event, context),
    transform: (name, value, context, signal) => serving.transform(name, value, context, signal),
    decide: (name, value, context, step) => serving.decide(name, value, context, step),
  };

  const host: InstanceHost = {
    registries,
    hooks,
    report(owner, issue) {
      if (!active.has(owner)) return;
      rows.set(owner, [...(rows.get(owner) ?? []), issue]);
      publishIssues();
    },
  };

  function issueRows(): readonly HostView["plugins"][number][] {
    const builtins = builtinIds(kernel);

    return [...rows].map(([id, issues]) => ({
      id,
      source: builtins.has(id) ? "builtin" : "inline",
      path: null,
      issues: [...issues, ...(found.get(id) ?? [])],
    }));
  }

  function publishIssues(): void {
    const listed = new Set(hostPluginRows(kernel).map((row) => row.id));

    const key = JSON.stringify(
      issueRows().filter((row) => row.issues.length > 0 || !listed.has(row.id)),
    );

    if (key === shownIssues) return;
    shownIssues = key;
    publishPlugins(kernel);
  }

  function afterPass(): void {
    syncParts();
    found = finding;
    finding = new Map();
    publishIssues();

    if (!closed) void publishCatalog(kernel, session).catch(() => undefined);
  }

  function syncParts(): void {
    const current = registries.parts.entries();

    for (const { item, owner } of current) {
      if (RESERVED_PART_KINDS.has(item.kind)) {
        if (!builtinIds(kernel).has(owner)) pend(owner, reservedKind(item.kind, owner));
        continue;
      }

      const kept = parts.get(item.kind);

      if (kept?.definition === item) continue;
      kept?.release();
      parts.delete(item.kind);
      const registered = kernel.partDefinitions.get(item.kind);

      if (registered !== undefined && registered.definition !== item) {
        pend(owner, takenKind(item.kind, owner, registered.owner));
        continue;
      }

      parts.set(item.kind, { definition: item, release: holdPart(kernel, item, owner) });
    }

    for (const [kind, kept] of parts) {
      if (current.some((entry) => entry.item === kept.definition)) continue;
      kept.release();
      parts.delete(kind);
    }
  }

  const resolve = (): Promise<Resolved> =>
    (resolving ??= (async (): Promise<Resolved> => {
      if (!(await coveredHere(kernel, session))) {
        resolvedUncovered = true;

        return UNRESOLVED;
      }
      const [env, inputs] = await Promise.all([
        kernel.environments.attach(session),
        scanResources(kernel, session),
      ]);

      return { env: { env }, inputs };
    })());

  const start = async (plugin: Plugin<"core">): Promise<ValidationIssue | null> => {
    const instance = createInstance(kernel, { plugin, session, ...resolved });
    const leave = instance.join(host);
    active.set(plugin.id, { instance, leave });

    try {
      dev("plugins", "activate", { session, plugin: plugin.id });
      await activate(instance);

      return null;
    } catch (error) {
      dev("plugins", "failed", { session, plugin: plugin.id, error });
      leave();
      active.delete(plugin.id);

      return {
        severity: "error",
        path: ["activate"],
        message: `Activation failed: ${error instanceof Error ? error.message : String(error)}`,
        source: { plugin: plugin.id },
      };
    }
  };

  const loadOne = async ({
    plugin,
    issues,
    ok,
  }: Preflight): Promise<{
    readonly outcome: PluginLoadOutcome;
    readonly kept?: PluginInstance;
  }> => {
    const { id } = plugin;
    const failure = ok ? await start(plugin) : null;

    if (ok && failure === null) return { outcome: { kind: "activated", id, issues } };
    const all = failure === null ? issues : [...issues, failure];
    const kept = previous?.instance(id);

    return kept === undefined
      ? { outcome: { kind: "rejected", id, issues: all } }
      : { outcome: { kind: "kept-previous", id, issues: all }, kept };
  };

  const loadAll = async (
    plugins: readonly Plugin<"core">[],
    stored: readonly AssignedPlugin[] | null,
  ): Promise<readonly PluginLoadOutcome[]> => {
    dev("plugins", "load", { session, plugins: plugins.map(({ id }) => id) });
    closed = false;
    requested = plugins;
    assigned = stored;

    const checked = preflight(
      plugins,
      [...active.values()].map((entry) => entry.instance.plugin),
    );

    resolved = await resolve();
    core = null;
    const outcomes: PluginLoadOutcome[] = [];
    const kept: PluginInstance[] = [];

    for (const entry of checked) {
      const loaded = await loadOne(entry);
      const { outcome } = loaded;
      rows.set(outcome.id, [...(rows.get(outcome.id) ?? []), ...outcome.issues]);
      outcomes.push(outcome);

      if (loaded.kept !== undefined) kept.push(loaded.kept);
    }

    last = outcomes;
    kernel.plugins.state.settings.add(settingChanged);
    await readFacts();
    await registries.materialize();
    await publishCatalog(kernel, session);

    void own.observe(
      "session_activated",
      { session: kernel.handles.session(CORE_CONTEXT, session) },
      { session, head: null, run: null, principal: LOCAL },
    );

    for (const instance of kept) {
      const { id } = instance.plugin;

      if (!active.has(id)) active.set(id, { instance, leave: instance.join(host) });
    }

    await registries.materialize();
    await publishCatalog(kernel, session);
    await publishSettings(kernel);

    return outcomes;
  };

  const ready = (previous?.ready.catch(() => undefined) ?? Promise.resolve())
    .then(() => activateSession(kernel, session, runtime))
    .catch((error: unknown) => {
      throw error instanceof SdkError
        ? error
        : new SdkError("unavailable", formatErrorMessage(error));
    });

  const runtime: PluginRuntime = {
    registries,
    hooks,
    ready,
    hold,
    load: (plugins, stored) => lifecycle.run(() => loadAll(plugins, stored)),
    requested: () => requested,
    outcomes: () => last,
    issues: issueRows,
    resolvedUncovered: () => resolvedUncovered,
    api(owner) {
      if (owner !== "core") return active.get(owner)?.instance.api;
      core ??= corePluginApi(kernel, { session, registries, ...resolved });

      return core;
    },
    plugins: () => [...active.values()].map((entry) => entry.instance.plugin),
    instance: (id) => active.get(id)?.instance,
    assigned: () => assigned,
    idleSince: () => (holds > 0 || activating ? null : used),
    touch() {
      used = Date.now();
    },
    close: () =>
      lifecycle.run(async () => {
        while (holds > 0) await (idle ??= Promise.withResolvers()).promise;
        dev("plugins", "close", { session, plugins: [...active.keys()] });
        closed = true;
        kernel.plugins.state.settings.delete(settingChanged);

        for (const id of [...active.keys()].reverse()) {
          active.get(id)?.leave();
          active.delete(id);
        }

        rows.clear();
        await registries.materialize();
      }),
  };

  const serve = (): void => {
    serving = own;
    activating = false;
  };

  void ready.then(serve, serve);

  const retired =
    previous === null
      ? Promise.resolve()
      : ready.then(
          () => previous.close(),
          () => previous.close(),
        );

  ready.catch(async () => {
    await retired.catch(() => undefined);

    if (kernel.plugins.runtimes().get(session) !== runtime) return;
    void kernel.plugins.close(session);
  });

  return runtime;
}

export async function activateApart(
  kernel: Kernel,
  session: SessionId,
  host: InstanceHost,
  plugins: readonly Plugin<"core">[],
  inputs: Resources | null,
  env: ExecutionEnv | null,
): Promise<{
  readonly api: (owner: string) => PluginApi<"core"> | undefined;
  readonly dispose: Disposer;
}> {
  const active = new Map<string, Active>();

  for (const { plugin, ok } of preflight(plugins, [])) {
    if (!ok) continue;
    const instance = createInstance(kernel, { plugin, session, env: { env }, inputs });
    const leave = instance.join(host);

    try {
      await activate(instance);
      active.set(plugin.id, { instance, leave });
    } catch {
      leave();
    }
  }

  return {
    api: (owner) => active.get(owner)?.instance.api,
    dispose() {
      for (const { leave } of [...active.values()].reverse()) leave();
    },
  };
}

export async function replacePlugins(
  kernel: Kernel,
  requested: readonly (Plugin<"core"> | PluginFile)[],
  scope?: { readonly session: SessionId },
): Promise<PluginReplacementReport> {
  const builtins = kernel.plugins.builtins.length;

  if (scope !== undefined) {
    await requireSession(kernel.store, scope.session);
    await loadPlugins(kernel, requested);
    await assignPlugins(kernel, scope.session, requested);
    const outcomes = await reloadSession(kernel, scope.session);

    return { generation: bumpGeneration(kernel), plugins: outcomes.slice(builtins) };
  }

  const plugins = await loadPlugins(kernel, requested);
  const before = kernel.plugins.host;
  const checked = preflight(plugins, []);
  kernel.plugins.host = plugins;

  const sessions = await Promise.all(
    [...kernel.plugins.runtimes()].map(async ([session, runtime]): Promise<SessionLoad> => {
      if (runtime.assigned() !== null) {
        await kernel.plugins.reload(session).catch(() => undefined);

        return { kind: "reassigned" };
      }

      try {
        return { kind: "loaded", outcomes: (await reloadSession(kernel, session)).slice(builtins) };
      } catch (error) {
        if (error instanceof SdkError && error.code === "unknown") return { kind: "gone" };

        return { kind: "failed", session, message: formatErrorMessage(error) };
      }
    }),
  );

  const rank = { activated: 0, "kept-previous": 1, rejected: 2 } as const;
  const failed = sessions.flatMap((load) => (load.kind === "failed" ? [load] : []));

  const outcomes = checked.map(({ plugin, issues, ok }, index): PluginLoadOutcome => {
    const { id } = plugin;

    if (!ok)
      return {
        kind: before.some((known) => known.id === id) ? "kept-previous" : "rejected",
        id,
        issues,
      };

    const each = sessions.flatMap((load) =>
      load.kind === "loaded" ? (load.outcomes[index] ?? []) : [],
    );

    const worst = each.reduce<PluginLoadOutcome>(
      (current, next) => (rank[next.kind] > rank[current.kind] ? next : current),
      { kind: "activated", id, issues },
    );

    return { ...worst, issues: unique([...issues, ...each.flatMap((outcome) => outcome.issues)]) };
  });

  const seen = new Set<string>();

  kernel.plugins.host = checked.flatMap(({ plugin }, index) => {
    if (seen.has(plugin.id)) return [];
    seen.add(plugin.id);
    const outcome = outcomes[index];

    if (outcome?.kind === "activated") return [plugin];

    return outcome?.kind === "kept-previous"
      ? before.filter((known) => known.id === plugin.id)
      : [];
  });

  publishPlugins(kernel);
  await publishSettings(kernel);
  await publishViews(kernel);

  const reported = outcomes.map((outcome, index): PluginLoadOutcome =>
    failed.length === 0 || checked[index]?.ok !== true
      ? outcome
      : {
          kind: "rejected",
          id: outcome.id,
          issues: [
            ...outcome.issues,
            ...failed.map((load) => ({
              severity: "error" as const,
              path: ["sessions", load.session],
              message: `Session ${load.session} did not activate: ${load.message}`,
              source: { plugin: outcome.id },
            })),
          ],
        },
  );

  return { generation: bumpGeneration(kernel), plugins: reported };
}

function builtinIds(kernel: Kernel): ReadonlySet<string> {
  return new Set(kernel.plugins.builtins.map((plugin) => plugin.id));
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function hostPluginRows(kernel: Kernel): readonly HostView["plugins"][number][] {
  const rows = new Map<string, HostView["plugins"][number]>();
  const builtins = builtinIds(kernel);

  for (const plugin of [...kernel.plugins.builtins, ...kernel.plugins.host]) {
    if (rows.has(plugin.id)) continue;
    const builtin = builtins.has(plugin.id);
    const loaded = builtin ? undefined : kernel.plugins.sources.get(plugin);

    rows.set(plugin.id, {
      id: plugin.id,
      source: builtin ? "builtin" : (loaded?.source ?? "inline"),
      path: loaded?.path ?? null,
      issues: [],
    });
  }

  return [...rows.values()];
}

async function reloadSession(
  kernel: Kernel,
  session: SessionId,
): Promise<readonly PluginLoadOutcome[]> {
  const ready = kernel.plugins.reload(session);
  const runtime = kernel.plugins.runtime(session);
  await ready;

  return runtime.outcomes();
}

function publishPlugins(kernel: Kernel): void {
  const merged = new Map(hostPluginRows(kernel).map((row) => [row.id, row]));

  for (const runtime of kernel.plugins.runtimes().values()) {
    for (const row of runtime.issues()) {
      const known = merged.get(row.id);
      merged.set(
        row.id,
        known === undefined ? row : { ...known, issues: unique([...known.issues, ...row.issues]) },
      );
    }
  }

  kernel.host.update({ plugins: [...merged.values()] });
}

async function activate(instance: PluginInstance): Promise<void> {
  const plugin = instance.plugin;
  instance.add({ contribute: plugin.contribute, hooks: plugin.hooks });

  if (plugin.activate === undefined) return;
  const returned: unknown = await bounded(plugin.activate(instance.api));

  if (typeof returned !== "object" || returned === null)
    throw new Error("activate returned nothing. Return what the plugin adds, or {} for nothing.");
  instance.add(returned);
}

function installHook<N extends HookName<"core">>(
  to: InstanceHost,
  api: PluginApi<"core">,
  input: { readonly owner: string; readonly signal: AbortSignal; readonly hooks: Hooks<"core"> },
  name: N,
): void {
  const entry = input.hooks[name];

  if (entry !== undefined)
    untilAborted(input.signal, to.hooks.register(input.owner, api, name, entry));
}

function holdPart(kernel: Kernel, definition: PartDefinition, owner: string): Disposer {
  const { holds } = kernel.plugins.state;

  const held = holds.get(definition) ?? {
    count: 0,
    dispose: kernel.partDefinitions.register(definition, owner),
  };

  held.count += 1;
  holds.set(definition, held);
  let released = false;

  return () => {
    if (released) return;
    released = true;
    held.count -= 1;

    if (held.count > 0) return;
    holds.delete(definition);
    held.dispose();

    for (const runtime of kernel.plugins.runtimes().values())
      if (runtime.registries.parts.entries().some((entry) => entry.item.kind === definition.kind))
        runtime.registries.reload();
  };
}

function unique(issues: readonly ValidationIssue[]): readonly ValidationIssue[] {
  const seen = new Set<string>();

  return issues.filter((issue) => {
    const key = JSON.stringify(issue);

    if (seen.has(key)) return false;
    seen.add(key);

    return true;
  });
}

function createInstance(
  kernel: Kernel,
  input: {
    readonly plugin: Plugin<"core">;
    readonly session: SessionId;
    readonly env: Attached;
    readonly inputs: Resources | null;
  },
): PluginInstance {
  const { plugin, session } = input;
  const owner = plugin.id;
  const controller = new AbortController();
  const hosts = new Map<InstanceHost, AbortController>();
  const added: Additions<"core">[] = [];
  let home: InstanceHost | null = null;

  const apply = (to: InstanceHost, additions: Additions<"core">): void => {
    const signal = AbortSignal.any([controller.signal, hosts.get(to)?.signal ?? controller.signal]);
    const given = additions.contribute ?? {};
    const registries = to.registries;

    for (const entry of given.tools ?? []) registries.tools.owned(owner, signal).add(entry);

    for (const entry of given.prompt ?? []) registries.prompt.owned(owner, signal).add(entry);

    for (const entry of given.agents ?? []) registries.agents.owned(owner, signal).add(entry);

    for (const entry of given.modelContext ?? [])
      registries.modelContext.owned(owner, signal).add(entry);

    for (const entry of given.skills ?? []) registries.skills.owned(owner, signal).add(entry);

    for (const entry of given.searchProviders ?? [])
      registries.searchProviders.owned(owner, signal).add(entry);

    for (const entry of given.parts ?? []) registries.parts.owned(owner, signal).add(entry);

    for (const entry of given.commands ?? []) registries.commands.owned(owner, signal).add(entry);

    for (const entry of given.settings ?? []) registries.settings.owned(owner, signal).add(entry);
    const hooks = additions.hooks ?? {};

    for (const name of Object.keys(hooks))
      if (namesCoreHook(name)) installHook(to, api, { owner, signal, hooks }, name);
  };

  const read = <T>(pick: (registries: RegistrySet) => Registry<T>): Registry<T> => ({
    list: () => (home === null ? [] : pick(home.registries).list()),
  });

  const settings = (): Registries<"core">["settings"] => {
    if (home === null) throw new SdkError("unavailable", `${owner} runs in no session runtime.`);

    return home.registries.owned(owner).settings;
  };

  const api: PluginApi<"core"> = build(kernel, {
    ...input,
    owner,
    registries: {
      tools: read((registries) => registries.tools),
      prompt: read((registries) => registries.prompt),
      agents: read((registries) => registries.agents),
      modelContext: read((registries) => registries.modelContext),
      skills: read((registries) => registries.skills),
      searchProviders: read((registries) => registries.searchProviders),
      parts: read((registries) => registries.parts),
      commands: read((registries) => registries.commands),
      settings: {
        ...read((registries) => registries.settings),
        value: (id) => settings().value(id),
        set: (id, value) => settings().set(id, value),
        watch: (id) => settings().watch(id),
      },
    },
    handle: kernel.handles.activationSession(CORE_CONTEXT, session),
    signal: controller.signal,
    report: (issue) =>
      home?.report(owner, { ...issue, source: { ...issue.source, plugin: owner } }),
    reload() {
      for (const to of hosts.keys()) to.registries.reload();
    },
  });

  return {
    plugin,
    api,
    add(additions) {
      added.push(additions);

      for (const name of Object.keys(additions.hooks ?? {}))
        if (!namesCoreHook(name)) reportUnknownHook(api, name);

      for (const to of hosts.keys()) apply(to, additions);
    },
    join(to) {
      home = to;
      hosts.set(to, new AbortController());

      for (const additions of added) apply(to, additions);

      return () => {
        hosts.get(to)?.abort();
        hosts.delete(to);

        if (hosts.size === 0) controller.abort();
      };
    },
  };
}

async function bounded<T>(activation: Awaitable<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`did not settle within ${ACTIVATE_SECONDS} s`)),
      ACTIVATE_SECONDS * 1000,
    );
  });

  try {
    return await Promise.race([activation, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function untilAborted(signal: AbortSignal, dispose: Disposer): Disposer {
  signal.addEventListener("abort", dispose, { once: true });

  if (signal.aborted) dispose();

  return () => {
    signal.removeEventListener("abort", dispose);
    dispose();
  };
}
