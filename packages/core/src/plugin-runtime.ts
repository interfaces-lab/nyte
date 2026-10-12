import type {
  Disposer,
  HostView,
  Json,
  PluginCheckReport,
  PluginLoadOutcome,
  PluginReplacementReport,
  RunId,
  Schema,
  SessionId,
  ValidationIssue,
} from "@nyte-ai/schema";
import { createConnection } from "./connection.ts";
import type { PluginStorage } from "./connection.ts";
import { dev } from "./dev-log.ts";
import type { ExecutionEnv, Resources } from "./environment.ts";
import { SdkError } from "./error.ts";
import { createHookDispatch, isCoreHook } from "./hooks.ts";
import type { HookDispatch } from "./hooks.ts";
import type { Kernel } from "./kernel.ts";
import { RESERVED_PART_KINDS } from "./part-definitions.ts";
import type { PartDefinition } from "./parts.ts";
import type { HookName, Plugin, PluginApi, Registries, Registry, RegistryDraft } from "./plugin.ts";
import { CORE_CONTEXT, LOCAL } from "./principals.ts";
import type { ConnectionContext } from "./principals.ts";
import { decodeKvValue } from "./records.ts";
import { kvRef } from "./refs.ts";
import { bumpGeneration, createRegistrySet, jsonSchemaOf, publishCatalog } from "./registry.ts";
import type { CoreRegistry, RegistrySet } from "./registry.ts";
import { commit, isCovered, isJsonObject, put, requireSession } from "./session-state.ts";
import { activationSession, sessionHandle } from "./session.ts";
import type { Session } from "./session.ts";
import { publishSettings, settingHandle } from "./settings.ts";
import { activateSession } from "./workspaces.ts";

/** Holds one session's core plugins in this process: their apis, the registries they write and the hooks they register. */
export interface PluginRuntime {
  readonly registries: RegistrySet;
  readonly hooks: HookDispatch;
  /** The session's activation, settled once (§44a): admission, `session.command` and `advance` await it. A rejected activation rejects `unavailable` unless it failed with an `SdkError`, and drops the runtime and the session's attach while it is still the one held, so the next `pluginsFor` activates and attaches again. */
  readonly ready: Promise<void>;
  /** Loads plugins after those already loaded, one outcome per plugin in order, after `checkPlugins`' preflight. A plugin rejected in preflight or by its `activate` falls back to the version the replaced runtime ran (`kept-previous`). Rejects when the session's resources cannot be read. */
  load(plugins: readonly Plugin<"core">[]): Promise<readonly PluginLoadOutcome[]>;
  /** Returns what the last `load` answered. */
  outcomes(): readonly PluginLoadOutcome[];
  /** Returns this session's share of `HostView.plugins`: each loaded or rejected plugin with every issue it has had. */
  issues(): readonly HostView["plugins"][number][];
  /** Returns the api of the active plugin with this id, core's own for `core`, or undefined. */
  api(owner: string): PluginApi<"core"> | undefined;
  /** Returns the active plugins in load order. */
  plugins(): readonly Plugin<"core">[];
  /** Returns the activation of the active plugin with this id: what the next runtime keeps when it rejects that plugin's new version (§36b). */
  instance(id: string): PluginInstance | undefined;
  /** Returns the list `Host.plugins.replace(plugins, { session })` gave this session (§37l); null while it follows `kernel.hostPlugins`. */
  assigned(): readonly Plugin<"core">[] | null;
  /** Keeps this runtime open until the disposer runs: a request holds the runtime it was prepared on until its calls and `after_request` finish (§44c). */
  hold(): Disposer;
  /** Once nothing holds it, lets every plugin go in reverse load order and runs a last reload pass; a plugin no other runtime runs deactivates. `load` and `close` run one at a time. */
  close(): Promise<void>;
}

/** One plugin's activation, shared by the runtimes that run it, so a kept-previous plugin moves to a new runtime without activating again (§36b). */
export interface PluginInstance {
  readonly plugin: Plugin<"core">;
  readonly api: PluginApi<"core">;
  /** Applies every registration the plugin made, and each one it makes later, to a runtime. The disposer takes them back and deactivates the plugin once no runtime runs it. */
  join(host: InstanceHost): Disposer;
}

/** What a runtime lends the plugins it runs: its registries, its hook dispatch and its issue rows. */
export interface InstanceHost {
  readonly registries: RegistrySet;
  readonly hooks: HookDispatch;
  report(owner: string, issue: ValidationIssue): void;
}

/** The plugin tables a kernel owns: assigned lists, held part definitions, the secrets key, setting listeners, deferred tool activations, catalog publish queues and credential verdicts. */
export interface PluginState {
  readonly assigned: Map<SessionId, readonly Plugin<"core">[]>;
  readonly holds: Map<PartDefinition, { count: number; readonly dispose: Disposer }>;
  readonly settings: Set<(id: string, session: SessionId | null) => void>;
  readonly activated: Map<RunId, Set<string>>;
  readonly publishing: Map<SessionId, Promise<void>>;
  readonly verdicts: Map<string, "verified" | "failed">;
  secretKey: Promise<CryptoKey> | null;
}

interface Active {
  readonly instance: PluginInstance;
  readonly leave: Disposer;
}

/** How one session's reload settled for a host-wide replace. */
type SessionLoad =
  | { readonly kind: "loaded"; readonly outcomes: readonly PluginLoadOutcome[] }
  | { readonly kind: "failed"; readonly session: SessionId; readonly message: string }
  | { readonly kind: "gone" };

type Derive<T> = (draft: RegistryDraft<T>, siblings: Registries<"core">) => void;

/** Applies one registration a plugin made to one runtime, removed when `signal` aborts. */
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

/** The decision-13 built-ins: their rows say `builtin` and they may contribute the reserved part kinds. */
const BUILT_IN: ReadonlySet<string> = new Set([
  "system-prompt",
  "environment",
  "resources",
  "delegation",
  "parts",
]);

/** The plugin ids the host owns (§43b). */
const RESERVED_IDS: ReadonlySet<string> = new Set(["models", "settings"]);

const NEVER = new AbortController().signal;

const UNRESOLVED: Resolved = { env: { env: null }, inputs: null };

/** Returns empty plugin tables. */
export function createPluginState(): PluginState {
  return {
    assigned: new Map(),
    holds: new Map(),
    settings: new Set(),
    activated: new Map(),
    publishing: new Map(),
    verdicts: new Map(),
    secretKey: null,
  };
}

/** Returns the kernel's plugin tables. */
export function pluginState(kernel: Kernel): PluginState {
  return kernel.pluginState;
}

/** Returns a session's plugin runtime and starts its activation once `previous` settled: `activateSession` loads `sessionPlugins` into it, then `previous` closes (§44c). After every reload pass it syncs the `parts` registry into `kernel.partDefinitions` (a reserved kind from a non-built-in is a collision, §34b), publishes the catalog and republishes `HostView.plugins`. */
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
  let queue: Promise<unknown> = Promise.resolve();
  let holds = 0;
  let idle: PromiseWithResolvers<void> | null = null;

  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);

    return next;
  };

  /** Runs one hook dispatch as an operation `close` waits for. */
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
    transform: (name, value, context) => held(() => dispatch.transform(name, value, context)),
    decide: (name, value, context, step) => held(() => dispatch.decide(name, value, context, step)),
  };

  /** The predecessor serves this runtime's dispatches until its activation settles, so no hook meets a half-activated runtime (§44c). */
  let serving = previous?.hooks ?? own;

  const hooks: HookDispatch = {
    register: (plugin, api, name, entry) => own.register(plugin, api, name, entry),
    observe: (name, event, context) => serving.observe(name, event, context),
    transform: (name, value, context) => serving.transform(name, value, context),
    decide: (name, value, context, step) => serving.decide(name, value, context, step),
  };

  const host: InstanceHost = {
    registries,
    hooks,
    report(owner, issue) {
      if (!active.has(owner)) return;
      rows.set(owner, [...(rows.get(owner) ?? []), issue]);
      publishPlugins(kernel);
    },
  };

  function afterPass(): void {
    syncParts();
    found = finding;
    finding = new Map();
    publishPlugins(kernel);

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
      parts.set(item.kind, { definition: item, release: holdPart(kernel, item, owner) });
    }

    for (const [kind, kept] of parts) {
      if (current.some((entry) => entry.item === kept.definition)) continue;
      kept.release();
      parts.delete(kind);
    }
  }

  /** Resolves the environment and the resources once per runtime; a failed attach rejects, failing the activation. */
  const resolve = (): Promise<Resolved> =>
    (resolving ??= (async (): Promise<Resolved> => {
      if (!(await isCovered(kernel, session))) return UNRESOLVED;
      const [env, inputs] = await Promise.all([kernel.env(session), kernel.resources(session)]);

      return { env: { env }, inputs };
    })());

  const start = async (plugin: Plugin<"core">): Promise<ValidationIssue | null> => {
    const instance = createInstance(kernel, { plugin, session, ...resolved });
    const leave = instance.join(host);
    active.set(plugin.id, { instance, leave });

    try {
      dev("plugins", "activate", { session, plugin: plugin.id });
      install(plugin, instance.api);
      await plugin.activate?.(instance.api);

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

  /** Starts a plugin that passed preflight; a rejected one keeps the activation the replaced runtime ran, if any. */
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
      { session: sessionHandle(kernel, CORE_CONTEXT, session) },
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
      throw error instanceof SdkError ? error : new SdkError("unavailable", messageOf(error));
    });

  const runtime: PluginRuntime = {
    registries,
    hooks,
    ready,
    hold,
    load: (plugins) => serial(() => loadAll(plugins)),
    outcomes: () => last,
    issues: () =>
      [...rows].map(([id, issues]) => ({
        id,
        source: BUILT_IN.has(id) ? "builtin" : "inline",
        path: null,
        issues: [...issues, ...(found.get(id) ?? [])],
      })),
    api(owner) {
      if (owner !== "core") return active.get(owner)?.instance.api;
      core ??= corePluginApi(kernel, { session, registries, ...resolved });

      return core;
    },
    plugins: () => [...active.values()].map((entry) => entry.instance.plugin),
    instance: (id) => active.get(id)?.instance,
    assigned: () => pluginState(kernel).assigned.get(session) ?? null,
    close: () =>
      serial(async () => {
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

  if (previous !== null) {
    const retire = (): Promise<void> => previous.close();
    void ready.then(retire, retire);
  }

  ready.catch(() => {
    if (kernel.runtimes().get(session) !== runtime) return;
    void kernel.environments.detach(session);
    void kernel.closePlugins(session);
  });

  return runtime;
}

/** Returns every plugin runtime the kernel holds. */
export function pluginRuntimes(kernel: Kernel): readonly PluginRuntime[] {
  return [...kernel.runtimes().values()];
}

/** Runs the preflight over `plugins` as one set and touches nothing: what `Host.plugins.check` answers. A duplicate or reserved id (`models`, `settings`, §43b), a second provider of one environment kind or a schema without JSON Schema rejects a plugin; collisions between plugins are warnings. */
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

/** Returns what a session runs: `kernel.builtins` (§36a), then its assigned list or `kernel.hostPlugins` (§37l). */
export function sessionPlugins(kernel: Kernel, runtime: PluginRuntime): readonly Plugin<"core">[] {
  return [...kernel.builtins, ...(runtime.assigned() ?? kernel.hostPlugins)];
}

/** Replaces one session's plugins, or the host's, by installing a new runtime for each session (§44c) and answers each plugin's outcome, its worst across sessions host-wide. Host-wide, a removed session is skipped and an existing session whose activation fails rejects every plugin that passed preflight, with the failure as an issue; `kernel.hostPlugins` becomes the versions that activated or were kept where sessions loaded. The built-ins stay ahead of either list (§36a). */
export async function replacePlugins(
  kernel: Kernel,
  plugins: readonly Plugin<"core">[],
  scope?: { readonly session: SessionId },
): Promise<PluginReplacementReport> {
  const { assigned } = pluginState(kernel);
  const builtins = kernel.builtins.length;

  if (scope !== undefined) {
    await requireSession(kernel, scope.session);
    assigned.set(scope.session, plugins);
    const outcomes = await reloadSession(kernel, scope.session);

    return { generation: bumpGeneration(kernel), plugins: outcomes.slice(builtins) };
  }

  const before = kernel.hostPlugins;
  const checked = preflight(plugins, []);
  kernel.hostPlugins = plugins;

  const sessions = await Promise.all(
    [...kernel.runtimes().keys()].map(async (session): Promise<SessionLoad> => {
      assigned.delete(session);

      try {
        return { kind: "loaded", outcomes: (await reloadSession(kernel, session)).slice(builtins) };
      } catch (error) {
        if (error instanceof SdkError && error.code === "unknown") return { kind: "gone" };

        return { kind: "failed", session, message: messageOf(error) };
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

  kernel.hostPlugins = checked.flatMap(({ plugin }, index) => {
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Returns `HostView.plugins` before any session's issues: the built-ins, then `kernel.hostPlugins` with the source and path `kernel.pluginSources` holds (§41e), else `inline`. */
export function hostPluginRows(kernel: Kernel): readonly HostView["plugins"][number][] {
  const rows = new Map<string, HostView["plugins"][number]>();

  for (const plugin of [...kernel.builtins, ...kernel.hostPlugins]) {
    if (rows.has(plugin.id)) continue;
    const builtin = BUILT_IN.has(plugin.id);
    const loaded = builtin ? undefined : kernel.pluginSources.get(plugin);

    rows.set(plugin.id, {
      id: plugin.id,
      source: builtin ? "builtin" : (loaded?.source ?? "inline"),
      path: loaded?.path ?? null,
      issues: [],
    });
  }

  return [...rows.values()];
}

/** Installs a new runtime for a session and answers its activation's load; `reloadPlugins` installs it before returning. */
async function reloadSession(
  kernel: Kernel,
  session: SessionId,
): Promise<readonly PluginLoadOutcome[]> {
  const ready = kernel.reloadPlugins(session);
  const runtime = kernel.pluginsFor(session);
  await ready;

  return runtime.outcomes();
}

/** Republishes `HostView.plugins`: `hostPluginRows` merged with every runtime's issues. */
function publishPlugins(kernel: Kernel): void {
  const merged = new Map(hostPluginRows(kernel).map((row) => [row.id, row]));

  for (const runtime of pluginRuntimes(kernel)) {
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

/** Checks each plugin against the others and `loaded`. */
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

    if (RESERVED_IDS.has(plugin.id))
      error(["id"], `The plugin id ${plugin.id} is reserved for the host.`);

    const kind = plugin.environment?.kind;

    if (kind !== undefined && issues.length === 0) {
      if (providers.has(kind))
        error(["environment"], `Another plugin provides the ${kind} environment.`);
      else providers.add(kind);
    }

    for (const { path, schema, direction } of schemasOf(plugin)) {
      try {
        jsonSchemaOf(schema, direction);
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

/** Returns every schema a plugin's static contributions declare, with its path and direction. */
function schemasOf(plugin: Plugin<"core">): readonly {
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
    ...(declared?.commands ?? []).flatMap((command) =>
      at(["commands", command.name, "arguments"], command.arguments, "input"),
    ),
    ...(declared?.settings ?? []).flatMap((setting) =>
      at(["settings", setting.id], setting.schema, "output"),
    ),
    ...(declared?.parts ?? []).flatMap((part) => [
      ...at(["parts", part.kind, "state"], part.state, "output"),
      ...Object.entries(part.actions).flatMap(([action, spec]) => [
        ...at(["parts", part.kind, action, "input"], spec.input, "input"),
        ...at(["parts", part.kind, action, "output"], spec.output, "output"),
      ]),
    ]),
  ];
}

/** Returns the warnings against the later of two plugins claiming one tool name, setting id or part kind, and against a non-built-in contributing a reserved part kind. */
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

/** Installs a plugin's declared contributions and hooks through its api, so its deactivation removes them. */
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
    if (isCoreHook(name)) installHook(api, plugin.hooks, name);
}

function installHook<N extends HookName<"core">>(
  api: PluginApi<"core">,
  handlers: Plugin<"core">["hooks"],
  name: N,
): void {
  const entry = handlers?.[name];

  if (entry !== undefined) api.hook(name, entry);
}

/** Registers a part definition on the kernel while any session's runtime holds it, and returns this hold's release. */
function holdPart(kernel: Kernel, definition: PartDefinition, owner: string): Disposer {
  const { holds } = pluginState(kernel);

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

/** A session's environment as its runtime attached it, null where this host does not attach the session. */
export type Attached = { readonly env: ExecutionEnv | null };

/** Activates nothing: returns one plugin's api in a session, its registrations recorded so every runtime that joins the instance gets them. `session` is the activation's own handle, whose sends do not wait on the activation (§44b); `contribute`, `hook` and `wrapEnv` are undone at deactivation. Reading `env` throws `unavailable` where nothing attached. */
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

  const signalOf = (to: InstanceHost): AbortSignal =>
    AbortSignal.any([controller.signal, hosts.get(to)?.signal ?? controller.signal]);

  /** Applies one registration to every host and returns what the first application returned, its disposer taking it back everywhere. */
  const register = <R extends Disposer>(apply: (to: InstanceHost, signal: AbortSignal) => R): R => {
    const [first, ...rest] = hosts.size > 0 ? [...hosts.keys()] : home === null ? [] : [home];

    if (first === undefined)
      throw new SdkError("unavailable", `${owner} runs in no session runtime.`);
    const result = apply(first, hosts.has(first) ? signalOf(first) : controller.signal);
    const applied = new Map<InstanceHost, Disposer>([[first, result]]);

    for (const to of rest) applied.set(to, apply(to, signalOf(to)));
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

        return isDerive(value) ? target.add(value) : target.add(value);
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
    handle: activationSession(kernel, CORE_CONTEXT, session),
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

      for (const [apply, applied] of registrations) applied.set(to, apply(to, signalOf(to)));

      return () => {
        hosts.get(to)?.abort();
        hosts.delete(to);

        for (const applied of registrations.values()) applied.delete(to);

        if (hosts.size === 0) controller.abort();
      };
    },
  };
}

/** Returns a disposer that also runs when `signal` aborts. */
function untilAborted(signal: AbortSignal, dispose: Disposer): Disposer {
  signal.addEventListener("abort", dispose, { once: true });

  if (signal.aborted) dispose();

  return () => {
    signal.removeEventListener("abort", dispose);
    dispose();
  };
}

/** Returns whether an add is a derivation: contribution items are plain objects. */
function isDerive<T>(value: T | Derive<T>): value is Derive<T> {
  return typeof value === "function";
}

/** Returns core's own api in a session (§31f), what an ownerless part definition's action receives: owner `core`, a signal that never aborts, and no-op `hook`, `report` and `reload`. */
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
    handle: sessionHandle(kernel, CORE_CONTEXT, input.session),
    owner: "core",
    signal,
    hook: () => () => {},
    report: () => {},
    reload: () => {},
  });
}

/** Returns a plugin's api for one execution of a durable decide step (§35i): `session` and `sdk` act from `context`, so what the handler acquires is the step's and comes back on a re-run. */
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

function build(
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
    sdk: createConnection(kernel, CORE_CONTEXT),
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
      const dispose = kernel.wrapEnv(session, wrap);
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
  };
}

/** Returns one plugin's storage in a session: `kv` envelopes at `kvRef(scope, owner, key)`, scope `session:<id>`, `host` or `workspace:<id>`, last write wins, `get` widening `Json` to `T` unchecked (§35g). `secrets` are host-scope at `kvRef("secret", owner, key)` (§35e), AES-256-GCM under `kernel.secrets.key()` with a random 12-byte IV. Without `kernel.secrets`, `secrets.set` throws `unavailable` and `secrets.get` resolves undefined. */
export function createPluginStorage(
  kernel: Kernel,
  input: { readonly owner: string; readonly session: SessionId },
): PluginStorage {
  const { owner, session } = input;

  const scoped = (scope: "host" | "workspace" | "session"): PluginStorage => {
    const prefix = async (): Promise<string> => {
      if (scope === "host") return "host";

      if (scope === "session") return `session:${session}`;

      return `workspace:${(await requireSession(kernel, session)).record.workspace}`;
    };

    const name = async (key: string): Promise<string> => kvRef(await prefix(), owner, key);

    function get<T extends Json>(key: string): Promise<T | undefined>;
    async function get(key: string): Promise<Json | undefined> {
      return readKv(kernel, await name(key));
    }

    return {
      get,
      async set(key, value) {
        await commit(kernel, [{ name: await name(key), target: await put(kernel, "kv", value) }]);
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

  const secrets: PluginStorage["secrets"] = {
    async get(key) {
      const sealed = await readKv(kernel, kvRef("secret", owner, key));

      if (sealed === undefined || !isJsonObject(sealed)) return undefined;
      const { iv, ciphertext } = sealed;
      const cipher = keyOf(kernel);

      if (cipher === null || typeof iv !== "string" || typeof ciphertext !== "string")
        return undefined;

      const plain = await globalThis.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: Uint8Array.fromBase64(iv) },
        await cipher,
        Uint8Array.fromBase64(ciphertext),
      );

      return new TextDecoder().decode(plain);
    },
    async set(key, value) {
      const cipher = keyOf(kernel);

      if (cipher === null)
        throw new SdkError("unavailable", "This host has no secrets key, so it stores no secrets.");
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));

      const sealed = new Uint8Array(
        await globalThis.crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          await cipher,
          new TextEncoder().encode(value),
        ),
      );

      await commit(kernel, [
        {
          name: kvRef("secret", owner, key),
          target: await put(kernel, "kv", { iv: iv.toBase64(), ciphertext: sealed.toBase64() }),
        },
      ]);
    },
    async delete(key) {
      await commit(kernel, [{ name: kvRef("secret", owner, key), target: null }]);
    },
  };

  return scoped("session");
}

/** Returns the value a kv ref holds, or undefined when the ref is absent. */
export async function readKv(kernel: Kernel, name: string): Promise<Json | undefined> {
  const ref = await kernel.store.refs.get(name);

  return ref === null || ref.target === null
    ? undefined
    : decodeKvValue(await kernel.store.objects.get(ref.target));
}

/** Returns the kernel's AES-256-GCM key, imported on first use; null without `kernel.secrets`. */
function keyOf(kernel: Kernel): Promise<CryptoKey> | null {
  const source = kernel.secrets;

  if (source === null) return null;
  const state = pluginState(kernel);

  state.secretKey ??= source.key().then((bytes) => {
    if (bytes.length !== 32)
      throw new SdkError("invalid", `The secrets key is ${bytes.length} bytes; AES-256 needs 32.`);

    return globalThis.crypto.subtle.importKey("raw", new Uint8Array(bytes), "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  });

  return state.secretKey;
}
