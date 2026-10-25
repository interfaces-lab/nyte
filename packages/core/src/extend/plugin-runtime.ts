import { SdkError } from "@nyte-ai/schema";
import { serial } from "@nyte-ai/schema/serial";
import type {
  Awaitable,
  Disposer,
  HostView,
  PluginCheckReport,
  PluginLoadOutcome,
  PluginReplacementReport,
  Schema,
  SessionId,
  ValidationIssue,
} from "@nyte-ai/schema";
import { CORE_CONTEXT, LOCAL } from "../contract/host.ts";
import type { PluginFile } from "../contract/host.ts";
import type {
  Attached,
  CoreRegistry,
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
  HookName,
  Plugin,
  PluginApi,
  Registries,
  Registry,
  RegistryDraft,
} from "../contract/plugin.ts";
import type { Resources } from "../contract/workspace.ts";
import { RESERVED_PART_KINDS } from "../engine/part-definitions.ts";
import { coveredHere, requireSession } from "../store/session.ts";
import { callable } from "../util/callable.ts";
import { dev } from "../util/dev-log.ts";
import { convertJsonSchema } from "../util/json-schema.ts";
import { activateSession, loadPlugins } from "./activation.ts";
import { createHookDispatch, namesCoreHook } from "./hooks.ts";
import { build, corePluginApi } from "./plugin-api.ts";
import { bumpGeneration, createRegistrySet, publishCatalog } from "./registry.ts";
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

type Derive<T> = (draft: RegistryDraft<T>, siblings: Registries<"core">) => void;

type Apply = (to: InstanceHost, signal: AbortSignal) => Disposer;

interface Preflight {
  readonly plugin: Plugin<"core">;
  readonly issues: readonly ValidationIssue[];
  readonly ok: boolean;
}

interface Resolved {
  readonly env: Attached;
  readonly inputs: Resources | null;
}

const BUILT_IN: ReadonlySet<string> = new Set([
  "system-prompt",
  "environment",
  "resources",
  "delegation",
  "interruptions",
  "worktrees",
]);

const RESERVED_IDS: readonly string[] = ["models", "settings"];

const ACTIVATE_SECONDS = 30;

const NEVER = new AbortController().signal;

const UNRESOLVED: Resolved = { env: { env: null }, inputs: null };

export function createPluginState(): PluginState {
  return {
    assigned: new Map(),
    holds: new Map(),
    settings: new Set(),
    publishing: new Map(),
    secretKey: null,
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
  const lifecycle = serial();
  let holds = 0;
  let idle: PromiseWithResolvers<void> | null = null;
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
      idle?.resolve();
      idle = null;
    };
  }

  const pend = (owner: string, issue: ValidationIssue): void => {
    finding.set(owner, [...(finding.get(owner) ?? []), issue]);
  };

  const registries = createRegistrySet({
    onChange: afterPass,
    setting: (definition, owner) =>
      settingHandle(kernel, definition, {
        owner,
        session,
        signal: active.get(owner)?.instance.api.signal ?? NEVER,
      }),
    report: pend,
  });

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
    return [...rows].map(([id, issues]) => ({
      id,
      source: BUILT_IN.has(id) ? "builtin" : "inline",
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
        if (!BUILT_IN.has(owner)) pend(owner, reservedKind(item.kind, owner));
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
      install(plugin, instance.api);
      await bounded(plugin.activate?.(instance.api));

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
  ): Promise<readonly PluginLoadOutcome[]> => {
    dev("plugins", "load", { session, plugins: plugins.map(({ id }) => id) });
    closed = false;

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
    load: (plugins) => lifecycle.run(() => loadAll(plugins)),
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
    assigned: () => kernel.plugins.state.assigned.get(session) ?? null,
    close: () =>
      lifecycle.run(async () => {
        while (holds > 0) await (idle ??= Promise.withResolvers()).promise;
        dev("plugins", "close", { session, plugins: [...active.keys()] });
        closed = true;

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
    void kernel.environments.detach(session);
    void kernel.plugins.close(session);
  });

  return runtime;
}

/**
 * Activates the valid ones of `plugins` in `host` for stand-in chat `session`, with no
 * environment and `inputs` as its resources; one whose activation fails is left out. `dispose`
 * ends them all.
 */
export async function activateApart(
  kernel: Kernel,
  session: SessionId,
  host: InstanceHost,
  plugins: readonly Plugin<"core">[],
  inputs: Resources | null,
): Promise<{
  readonly api: (owner: string) => PluginApi<"core"> | undefined;
  readonly dispose: Disposer;
}> {
  const active = new Map<string, Active>();

  for (const { plugin, ok } of preflight(plugins, [])) {
    if (!ok) continue;
    const instance = createInstance(kernel, { plugin, session, env: UNRESOLVED.env, inputs });
    const leave = instance.join(host);

    try {
      install(plugin, instance.api);
      await bounded(plugin.activate?.(instance.api));
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

export function checkPlugins(plugins: readonly Plugin<"core">[]): PluginCheckReport {
  return {
    plugins: preflight(plugins, []).map(({ plugin, issues, ok }) => ({
      kind: ok ? "activated" : "rejected",
      id: plugin.id,
      issues,
    })),
    collisions: collisions(plugins),
  };
}

/** Assigns `requested` to `scope`'s session in place of the host's plugins, or replaces the host's plugins. A host-wide replace keeps each session's assignment and reloads it from its files, so the session runs their new code; one that no longer loads fails that session's activation (`loadAssigned`), not the host's plugins. */
export async function replacePlugins(
  kernel: Kernel,
  requested: readonly (Plugin<"core"> | PluginFile)[],
  scope?: { readonly session: SessionId },
): Promise<PluginReplacementReport> {
  const { assigned } = kernel.plugins.state;
  const builtins = kernel.plugins.builtins.length;

  if (scope !== undefined) {
    await requireSession(kernel.store, scope.session);
    await loadPlugins(kernel, requested);
    assigned.set(scope.session, requested);
    const outcomes = await reloadSession(kernel, scope.session);

    return { generation: bumpGeneration(kernel), plugins: outcomes.slice(builtins) };
  }

  const plugins = await loadPlugins(kernel, requested);
  const before = kernel.plugins.host;
  const checked = preflight(plugins, []);
  kernel.plugins.host = plugins;

  const sessions = await Promise.all(
    [...kernel.plugins.runtimes().keys()].map(async (session): Promise<SessionLoad> => {
      if (assigned.has(session)) {
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

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function hostPluginRows(kernel: Kernel): readonly HostView["plugins"][number][] {
  const rows = new Map<string, HostView["plugins"][number]>();

  for (const plugin of [...kernel.plugins.builtins, ...kernel.plugins.host]) {
    if (rows.has(plugin.id)) continue;
    const builtin = BUILT_IN.has(plugin.id);
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

function preflight(
  plugins: readonly Plugin<"core">[],
  loaded: readonly Plugin<"core">[],
): readonly Preflight[] {
  const taken = new Set(loaded.map((plugin) => plugin.id));

  const providers = new Set(
    loaded.flatMap((plugin) => (plugin.environment === undefined ? [] : [plugin.environment.kind])),
  );

  return plugins.map((plugin) => {
    const issues: ValidationIssue[] = [];

    const error = (path: readonly (string | number)[], message: string): void => {
      issues.push({ severity: "error", path, message, source: { plugin: plugin.id } });
    };

    if (taken.has(plugin.id) || plugins.filter((other) => other.id === plugin.id).length > 1)
      error(["id"], `More than one plugin is named ${plugin.id}.`);

    if (RESERVED_IDS.includes(plugin.id))
      error(["id"], `The plugin id ${plugin.id} is reserved for the host.`);

    if (plugin.id.includes("/")) error(["id"], `The plugin id ${plugin.id} contains "/".`);

    const kind = plugin.environment?.kind;

    if (kind !== undefined && issues.length === 0) {
      if (providers.has(kind))
        error(["environment"], `Another plugin provides the ${kind} environment.`);
      else providers.add(kind);
    }

    for (const { path, schema, direction } of listContributionSchemas(plugin)) {
      try {
        convertJsonSchema(schema, direction);
      } catch (thrown) {
        error(
          path,
          `This schema has no JSON Schema: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
        );
      }
    }

    return { plugin, issues, ok: issues.length === 0 };
  });
}

function listContributionSchemas(plugin: Plugin<"core">): readonly {
  readonly path: readonly string[];
  readonly schema: Schema<unknown>;
  readonly direction: "input" | "output";
}[] {
  const declared = plugin.contribute;

  const at = (
    path: readonly string[],
    schema: Schema<unknown> | undefined,
    direction: "input" | "output",
  ) => (schema === undefined ? [] : [{ path, schema, direction }]);

  return [
    ...(declared?.tools ?? []).flatMap((tool) => [
      ...at(["tools", tool.name, "parameters"], tool.parameters, "input"),
      ...at(["tools", tool.name, "output"], tool.output, "output"),
    ]),
    ...(declared?.settings ?? []).flatMap((setting) =>
      at(["settings", setting.id], setting.schema, "output"),
    ),
    ...(declared?.parts ?? []).flatMap((part) => [
      ...at(["parts", part.kind, "state"], part.state, "output"),
      ...Object.entries(part.actions).flatMap(([action, spec]) => [
        ...at(["parts", part.kind, action, "input"], spec.input, "input"),
        ...at(["parts", part.kind, action, "answer"], spec.input, "output"),
        ...at(["parts", part.kind, action, "output"], spec.output, "output"),
      ]),
    ]),
  ];
}

function collisions(plugins: readonly Plugin<"core">[]): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const claims = new Map<string, string>();

  const claim = (kind: string, key: string, owner: string): void => {
    const previous = claims.get(`${kind}/${key}`);

    if (previous === undefined || previous === owner) {
      claims.set(`${kind}/${key}`, owner);

      return;
    }

    issues.push({
      severity: "warning",
      path: [kind, key],
      message: `${key} from ${owner} collides with the one from ${previous}.`,
      source: { plugin: owner },
    });
  };

  for (const plugin of plugins) {
    const declared = plugin.contribute;

    for (const tool of declared?.tools ?? []) claim("tools", tool.name, plugin.id);

    for (const setting of declared?.settings ?? []) claim("settings", setting.id, plugin.id);

    for (const command of declared?.commands ?? []) claim("commands", command.name, plugin.id);

    for (const part of declared?.parts ?? []) {
      if (!RESERVED_PART_KINDS.has(part.kind)) claim("parts", part.kind, plugin.id);
      else if (!BUILT_IN.has(plugin.id)) issues.push(reservedKind(part.kind, plugin.id));
    }
  }

  return issues;
}

function reservedKind(kind: string, owner: string): ValidationIssue {
  return {
    severity: "warning",
    path: ["parts", kind],
    message: `${kind} is a built-in part kind; ${owner}'s definition is ignored.`,
    source: { plugin: owner },
  };
}

function takenKind(kind: string, owner: string, holder: string | null): ValidationIssue {
  return {
    severity: "warning",
    path: ["parts", kind],
    message: `${holder ?? "Another definition"} already registered the ${kind} part kind; ${owner}'s definition is ignored.`,
    source: { plugin: owner },
  };
}

function install(plugin: Plugin<"core">, api: PluginApi<"core">): void {
  const declared = plugin.contribute;
  const { contribute } = api;

  for (const item of declared?.tools ?? []) contribute.tools.add(item);

  for (const item of declared?.prompt ?? []) contribute.prompt.add(item);

  for (const item of declared?.agents ?? []) contribute.agents.add(item);

  for (const item of declared?.modelContext ?? []) contribute.modelContext.add(item);

  for (const item of declared?.skills ?? []) contribute.skills.add(item);

  for (const item of declared?.parts ?? []) contribute.parts.add(item);

  for (const item of declared?.commands ?? []) contribute.commands.add(item);

  for (const item of declared?.settings ?? []) contribute.settings.add(item);

  for (const name of Object.keys(plugin.hooks ?? {}))
    if (namesCoreHook(name)) installHook(api, plugin.hooks, name);
}

function installHook<N extends HookName<"core">>(
  api: PluginApi<"core">,
  handlers: Plugin<"core">["hooks"],
  name: N,
): void {
  const entry = handlers?.[name];

  if (entry !== undefined) api.hook(name, entry);
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
  const registrations = new Map<Apply, Map<InstanceHost, Disposer>>();
  let home: InstanceHost | null = null;

  const createHostSignal = (to: InstanceHost): AbortSignal =>
    AbortSignal.any([controller.signal, hosts.get(to)?.signal ?? controller.signal]);

  const register = <R extends Disposer>(apply: (to: InstanceHost, signal: AbortSignal) => R): R => {
    const [first, ...rest] = hosts.size > 0 ? [...hosts.keys()] : home === null ? [] : [home];

    if (first === undefined)
      throw new SdkError("unavailable", `${owner} runs in no session runtime.`);
    const result = apply(first, hosts.has(first) ? createHostSignal(first) : controller.signal);
    const applied = new Map<InstanceHost, Disposer>([[first, result]]);

    for (const to of rest) applied.set(to, apply(to, createHostSignal(to)));
    registrations.set(apply, applied);

    const dispose = (): void => {
      registrations.delete(apply);

      for (const remove of applied.values()) remove();
      applied.clear();
    };

    return Object.assign(dispose, result);
  };

  const contribution = <T, Handle>(
    pick: (registries: RegistrySet) => CoreRegistry<T, Handle>,
  ): Registry<T, "core", Handle> => {
    function add(item: T): Handle & Disposer;
    function add(derive: Derive<T>): Disposer;
    function add(value: T | Derive<T>): Disposer {
      return register((to, signal) => {
        const target = pick(to.registries).owned(owner, signal);

        return callable(value) ? target.add(value) : target.add(value);
      });
    }

    return { add, list: () => (home === null ? [] : pick(home.registries).list()) };
  };

  const settings = (): Registries<"core">["settings"] => {
    if (home === null) throw new SdkError("unavailable", `${owner} runs in no session runtime.`);

    return home.registries.owned(owner).settings;
  };

  const contribute: Registries<"core"> = {
    tools: contribution((registries) => registries.tools),
    prompt: contribution((registries) => registries.prompt),
    agents: contribution((registries) => registries.agents),
    modelContext: contribution((registries) => registries.modelContext),
    skills: contribution((registries) => registries.skills),
    parts: contribution((registries) => registries.parts),
    commands: contribution((registries) => registries.commands),
    settings: {
      ...contribution((registries) => registries.settings),
      value: (id) => settings().value(id),
      watch: (id) => settings().watch(id),
    },
  };

  const api: PluginApi<"core"> = build(kernel, {
    ...input,
    owner,
    contribute,
    handle: kernel.handles.activationSession(CORE_CONTEXT, session),
    signal: controller.signal,
    hook: (name, entry) =>
      register((to, signal) => untilAborted(signal, to.hooks.register(owner, api, name, entry))),
    report: (issue) =>
      home?.report(owner, { ...issue, source: { ...issue.source, plugin: owner } }),
    reload() {
      for (const to of hosts.keys()) to.registries.reload();
    },
  });

  return {
    plugin,
    api,
    join(to) {
      home = to;
      hosts.set(to, new AbortController());

      for (const [apply, applied] of registrations)
        applied.set(to, apply(to, createHostSignal(to)));

      return () => {
        hosts.get(to)?.abort();
        hosts.delete(to);

        for (const applied of registrations.values()) applied.delete(to);

        if (hosts.size === 0) controller.abort();
      };
    },
  };
}

async function bounded(activation: Awaitable<void> | undefined): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`did not settle within ${ACTIVATE_SECONDS} s`)),
      ACTIVATE_SECONDS * 1000,
    );
  });

  try {
    await Promise.race([activation, deadline]);
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
