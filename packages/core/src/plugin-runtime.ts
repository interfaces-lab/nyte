import type {
  Disposer,
  HostView,
  PluginCheckReport,
  PluginLoadOutcome,
  PluginReplacementReport,
  Schema,
  SessionId,
  ValidationIssue,
} from "@nyte-ai/schema";
import { bumpGeneration, jsonSchemaOf, publishCatalog } from "./catalog.ts";
import type { ExecutionEnv, Resources } from "./environment.ts";
import { createHookDispatch, isCoreHook } from "./hooks.ts";
import type { HookDispatch } from "./hooks.ts";
import type { Kernel } from "./kernel.ts";
import { RESERVED_PART_KINDS } from "./part-definitions.ts";
import type { PartDefinition } from "./parts.ts";
import type { HookName, Plugin, PluginApi } from "./plugin.ts";
import { corePluginApi, createPluginApi } from "./plugin-api.ts";
import { CORE_CONTEXT, LOCAL } from "./principals.ts";
import { createRegistrySet } from "./registry.ts";
import type { RegistrySet } from "./registry.ts";
import { sessionHandle } from "./session.ts";
import { requireSession } from "./session-state.ts";
import { publishSettings, settingHandle } from "./settings.ts";

/** Holds one session's core plugins (plugins are per session on core): their apis, the registries they write and the hooks they register. */
export interface PluginRuntime {
  /** The session's registries, shared by every plugin it loaded. */
  readonly registries: RegistrySet;
  /** The session's hook dispatch. */
  readonly hooks: HookDispatch;
  /** Loads plugins after those already loaded and returns one outcome per plugin, in order. Preflight first, as `check`: a duplicate id (in the list, where both are rejected, or already loaded), a second environment provider of one kind, or a schema whose `jsonSchema` throws rejects that plugin with its issues. Then the session's environment and resources are resolved once (`kernel.env` and `kernel.resources`; null when unavailable), and per plugin in host registration order: an api over a fresh `AbortController`, the declared `contribute` and `hooks` installed through it, then `await activate(api)`; a throwing `activate` aborts that controller, removing what the plugin installed, and rejects it with the error as an issue. Then one reload pass, the catalog published, `session_activated` observed, and `HostView.plugins` and `HostView.settings` republished. */
  load(plugins: readonly Plugin<"core">[]): Promise<readonly PluginLoadOutcome[]>;
  /** Replaces the loaded set with `plugins` by id and returns one outcome per plugin in `plugins` order: a loaded plugin absent from the list is deactivated; each listed plugin's previous version is deactivated and the new one loaded as `load` does. A new version rejected in preflight leaves the previous running, and one whose `activate` throws re-activates the previous: either is `kept-previous` with the new version's issues; a plugin with no previous version is `rejected`. */
  replace(plugins: readonly Plugin<"core">[]): Promise<readonly PluginLoadOutcome[]>;
  /** Runs `load`'s preflight over `plugins` as one set (`checkPlugins`). Loads, activates and writes nothing. */
  check(plugins: readonly Plugin<"core">[]): Promise<PluginCheckReport>;
  /** Returns each loaded or rejected plugin with its source (`builtin` for the decision-13 built-ins, `inline` otherwise, §35h), a null path, and the issues its load produced, every one it reported since, and those the last reload pass found (collisions, failed derives): this session's share of `HostView.plugins`. */
  issues(): readonly HostView["plugins"][number][];
  /** Returns the api of the active plugin with this id, core's minimal api for `core` (`corePluginApi`), or undefined: what `kernel.pluginApi` resolves through. */
  api(owner: string): PluginApi<"core"> | undefined;
  /** Deactivates every plugin in reverse load order (aborting each one's signal removes its contributions and hooks), runs a last reload pass and republishes `HostView.plugins`; the runtime may load again. */
  close(): Promise<void>;
}

/** Returns one active plugin: the version loaded, its api and the controller whose abort deactivates it. */
interface Active {
  readonly plugin: Plugin<"core">;
  readonly controller: AbortController;
  readonly api: PluginApi<"core">;
}

/** Returns one plugin's preflight: its issues and whether it may load. */
interface Preflight {
  readonly plugin: Plugin<"core">;
  readonly issues: readonly ValidationIssue[];
  readonly ok: boolean;
}

/** Returns what a session's environment and resources resolved to for its plugins' apis; null when unavailable. */
interface Resolved {
  readonly env: ExecutionEnv | null;
  readonly inputs: Resources | null;
}

/** Returns one part definition registered on the kernel's behalf of the sessions holding it. */
interface Hold {
  count: number;
  readonly dispose: Disposer;
}

/** The decision-13 built-ins: their rows say `builtin` and they may contribute the reserved part kinds. */
const BUILT_IN: ReadonlySet<string> = new Set([
  "system-prompt",
  "environment",
  "resources",
  "delegation",
  "parts",
]);

const NEVER = new AbortController().signal;

const holds = new WeakMap<Kernel, Map<PartDefinition, Hold>>();

/** Returns a session's plugin runtime with nothing loaded, its registries and hook dispatch empty; `kernel.pluginsFor(session)` creates it on first use and records it among `kernel.runtimes()`, and `sessions.create` loads `kernel.hostPlugins` into it. After every reload pass it syncs the `parts` registry into `kernel.partDefinitions` with owners (a non-built-in plugin contributing a reserved kind is reported as a collision, §34b), publishes the catalog and republishes `HostView.plugins`. */
export function createPluginRuntime(kernel: Kernel, session: SessionId): PluginRuntime {
  const active = new Map<string, Active>();
  const rows = new Map<string, readonly ValidationIssue[]>();

  const parts = new Map<
    string,
    { readonly definition: PartDefinition; readonly release: Disposer }
  >();

  let found = new Map<string, readonly ValidationIssue[]>();
  let finding = new Map<string, readonly ValidationIssue[]>();

  let resolved: Resolved = { env: null, inputs: null };

  let core: PluginApi<"core"> | null = null;

  let closed = false;

  const pend = (owner: string, issue: ValidationIssue): void => {
    finding.set(owner, [...(finding.get(owner) ?? []), issue]);
  };

  const registries = createRegistrySet({
    onChange: afterPass,
    setting: (definition, owner) =>
      settingHandle(kernel, definition, {
        owner,
        session,
        signal: active.get(owner)?.controller.signal ?? NEVER,
      }),
    report: pend,
  });

  const hooks = createHookDispatch(kernel, session);

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
        if (!BUILT_IN.has(owner))
          pend(owner, {
            severity: "warning",
            path: ["parts", item.kind],
            message: `${item.kind} is a built-in part kind; ${owner}'s definition is ignored.`,
            source: { plugin: owner },
          });

        continue;
      }

      const held = parts.get(item.kind);

      if (held?.definition === item) continue;
      held?.release();
      parts.set(item.kind, { definition: item, release: holdPart(kernel, item, owner) });
    }

    for (const [kind, held] of parts) {
      if (current.some((entry) => entry.item === held.definition)) continue;
      held.release();
      parts.delete(kind);
    }
  }

  const resolve = async (): Promise<void> => {
    const [env, inputs] = await Promise.all([
      kernel.env(session).catch(() => null),
      kernel.resources(session).catch(() => null),
    ]);

    resolved = { env, inputs };
    core = null;
  };

  const report = (owner: string, issue: ValidationIssue): void => {
    if (!active.has(owner)) return;
    rows.set(owner, [...(rows.get(owner) ?? []), issue]);
    publishPlugins(kernel);
  };

  const start = async (plugin: Plugin<"core">): Promise<ValidationIssue | null> => {
    const controller = new AbortController();

    const api = createPluginApi(kernel, {
      owner: plugin.id,
      session,
      signal: controller.signal,
      registries,
      hooks,
      env: resolved.env,
      inputs: resolved.inputs,
      report: (issue) => report(plugin.id, issue),
    });

    active.set(plugin.id, { plugin, controller, api });

    try {
      install(plugin, api);
      await plugin.activate?.(api);

      return null;
    } catch (error) {
      controller.abort();
      active.delete(plugin.id);

      return {
        severity: "error",
        path: ["activate"],
        message: `Activation failed: ${error instanceof Error ? error.message : String(error)}`,
        source: { plugin: plugin.id },
      };
    }
  };

  const stop = (id: string): void => {
    active.get(id)?.controller.abort();
    active.delete(id);
  };

  const finish = async (): Promise<void> => {
    await registries.materialize();
    await publishCatalog(kernel, session);

    void hooks.observe(
      "session_activated",
      { session: sessionHandle(kernel, CORE_CONTEXT, session) },
      { session, head: null, run: null, principal: LOCAL },
    );

    publishPlugins(kernel);
    await publishSettings(kernel);
  };

  return {
    registries,
    hooks,
    async load(plugins) {
      await requireSession(kernel, session);
      closed = false;

      const checked = preflight(
        plugins,
        [...active.values()].map((entry) => entry.plugin),
      );

      await resolve();
      const outcomes: PluginLoadOutcome[] = [];

      for (const { plugin, issues, ok } of checked) {
        const failure = ok ? await start(plugin) : null;
        const all = failure === null ? issues : [...issues, failure];
        rows.set(plugin.id, [...(rows.get(plugin.id) ?? []), ...all]);

        outcomes.push({
          kind: ok && failure === null ? "activated" : "rejected",
          id: plugin.id,
          issues: all,
        });
      }

      await finish();

      return outcomes;
    },
    async replace(plugins) {
      await requireSession(kernel, session);
      closed = false;
      const checked = preflight(plugins, []);
      await resolve();
      const previous = new Map([...active].map(([id, entry]) => [id, entry.plugin]));

      for (const id of [...active.keys()].reverse()) {
        const next = checked.find((entry) => entry.plugin.id === id);

        if (next === undefined || next.ok) stop(id);
      }

      rows.clear();
      const outcomes: PluginLoadOutcome[] = [];

      for (const { plugin, issues, ok } of checked) {
        const { id } = plugin;
        const before = previous.get(id);
        const outcome = ok ? await swap(plugin, issues, before) : kept(id, issues, before);
        rows.set(id, [...(rows.get(id) ?? []), ...outcome.issues]);
        outcomes.push(outcome);
      }

      await finish();

      return outcomes;
    },
    check: async (plugins) => checkPlugins(plugins),
    issues: () =>
      [...rows].map(([id, issues]) => ({
        id,
        source: BUILT_IN.has(id) ? "builtin" : "inline",
        path: null,
        issues: [...issues, ...(found.get(id) ?? [])],
      })),
    api(owner) {
      if (owner !== "core") return active.get(owner)?.api;
      core ??= corePluginApi(kernel, { session, registries, ...resolved });

      return core;
    },
    async close() {
      closed = true;

      for (const id of [...active.keys()].reverse()) stop(id);
      rows.clear();
      await registries.materialize();
    },
  };

  /** Starts a new version that passed preflight; when its `activate` throws, starts the previous version again. */
  async function swap(
    plugin: Plugin<"core">,
    issues: readonly ValidationIssue[],
    before: Plugin<"core"> | undefined,
  ): Promise<PluginLoadOutcome> {
    const failure = await start(plugin);

    if (failure === null) return { kind: "activated", id: plugin.id, issues };
    const all = [...issues, failure];

    if (before === undefined) return { kind: "rejected", id: plugin.id, issues: all };
    const restored = await start(before);

    return restored === null
      ? { kind: "kept-previous", id: plugin.id, issues: all }
      : { kind: "rejected", id: plugin.id, issues: [...all, restored] };
  }

  /** Answers a version rejected in preflight: the previous one, left running, is kept. */
  function kept(
    id: string,
    issues: readonly ValidationIssue[],
    before: Plugin<"core"> | undefined,
  ): PluginLoadOutcome {
    return before !== undefined && active.has(id)
      ? { kind: "kept-previous", id, issues }
      : { kind: "rejected", id, issues };
  }
}

/** Returns every plugin runtime the kernel holds (`kernel.runtimes()`): what a host-wide `plugins.replace`, `HostView.plugins` and host-scope settings read across sessions. */
export function pluginRuntimes(kernel: Kernel): readonly PluginRuntime[] {
  return [...kernel.runtimes().values()];
}

/** Runs the preflight over `plugins` as one set and touches nothing: per-plugin outcomes (`activated` with warnings, `rejected` with errors) and the collisions between them (one tool name, setting id or part kind from two plugins; a reserved part kind from a non-built-in plugin, §34b). What `Host.plugins.check` answers. */
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

/** Replaces the host's plugins, or one session's, and returns the new catalog generation with one outcome per plugin. With a session, that session's runtime replaces its set. Host-wide, every live session's runtime replaces its set, each plugin's outcome is its worst across them (a version rejected in preflight is `kept-previous` when the host had one), and `kernel.hostPlugins` becomes what new sessions should load: the activated versions and the kept previous ones. `HostView.plugins` and `HostView.settings` are republished. */
export async function replacePlugins(
  kernel: Kernel,
  plugins: readonly Plugin<"core">[],
  scope?: { readonly session: SessionId },
): Promise<PluginReplacementReport> {
  if (scope !== undefined) {
    await requireSession(kernel, scope.session);
    const outcomes = await kernel.pluginsFor(scope.session).replace(plugins);

    return { generation: bumpGeneration(kernel), plugins: outcomes };
  }

  const before = kernel.hostPlugins;
  const checked = preflight(plugins, []);

  const sessions = await Promise.all(
    pluginRuntimes(kernel).map((runtime) => runtime.replace(plugins)),
  );

  const rank = { activated: 0, "kept-previous": 1, rejected: 2 } as const;

  const outcomes = checked.map(({ plugin, issues, ok }, index): PluginLoadOutcome => {
    const { id } = plugin;
    const previous = before.some((known) => known.id === id);

    if (!ok) return { kind: previous ? "kept-previous" : "rejected", id, issues };
    const each = sessions.flatMap((outcomes) => outcomes[index] ?? []);

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

  return { generation: bumpGeneration(kernel), plugins: outcomes };
}

/** Republishes `HostView.plugins`: one row per plugin id, `kernel.hostPlugins` first, then those only some session loaded, each with the issues every session's runtime holds for it. */
function publishPlugins(kernel: Kernel): void {
  const merged = new Map<string, HostView["plugins"][number]>();

  for (const plugin of kernel.hostPlugins)
    merged.set(plugin.id, {
      id: plugin.id,
      source: BUILT_IN.has(plugin.id) ? "builtin" : "inline",
      path: null,
      issues: [],
    });

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

/** Checks each plugin before anything loads: a duplicate id (in the list or among `loaded`), a second environment provider of one kind (the later one), and every schema it contributes converting to JSON Schema. */
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

/** Returns every schema a plugin's static contributions declare, with where it sits and the JSON Schema direction it is shown in. */
function schemasOf(plugin: Plugin<"core">): readonly {
  readonly path: readonly string[];
  readonly schema: Schema<unknown>;
  readonly direction: "input" | "output";
}[] {
  const declared = plugin.contribute;

  return [
    ...(declared?.tools ?? []).flatMap((tool) => [
      {
        path: ["tools", tool.name, "parameters"],
        schema: tool.parameters,
        direction: "input" as const,
      },
      ...(tool.output === undefined
        ? []
        : [
            {
              path: ["tools", tool.name, "output"],
              schema: tool.output,
              direction: "output" as const,
            },
          ]),
    ]),
    ...(declared?.commands ?? []).flatMap((command) =>
      command.arguments === undefined
        ? []
        : [
            {
              path: ["commands", command.name, "arguments"],
              schema: command.arguments,
              direction: "input" as const,
            },
          ],
    ),
    ...(declared?.settings ?? []).map((setting) => ({
      path: ["settings", setting.id],
      schema: setting.schema,
      direction: "output" as const,
    })),
    ...(declared?.parts ?? []).flatMap((part) => [
      { path: ["parts", part.kind, "state"], schema: part.state, direction: "output" as const },
      ...Object.entries(part.actions).flatMap(([action, spec]) => [
        {
          path: ["parts", part.kind, action, "input"],
          schema: spec.input,
          direction: "input" as const,
        },
        ...(spec.output === undefined
          ? []
          : [
              {
                path: ["parts", part.kind, action, "output"],
                schema: spec.output,
                direction: "output" as const,
              },
            ]),
      ]),
    ]),
  ];
}

/** Returns the collisions between plugins' static contributions: one tool name, setting id or part kind from two plugins, and a reserved part kind from a non-built-in plugin; each a warning against the later plugin. */
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
      else if (!BUILT_IN.has(plugin.id))
        issues.push({
          severity: "warning",
          path: ["parts", part.kind],
          message: `${part.kind} is a built-in part kind; ${plugin.id}'s definition is ignored.`,
          source: { plugin: plugin.id },
        });
    }
  }

  return issues;
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
  const handlers = plugin.hooks;

  if (handlers === undefined) return;

  for (const name of Object.keys(handlers)) if (isCoreHook(name)) installHook(api, handlers, name);
}

/** Registers one declared hook through the plugin's api. */
function installHook<N extends HookName<"core">>(
  api: PluginApi<"core">,
  handlers: NonNullable<Plugin<"core">["hooks"]>,
  name: N,
): void {
  const entry = handlers[name];

  if (entry !== undefined) api.hook(name, entry);
}

/** Registers a part definition on the kernel while any session's runtime holds it, and returns this hold's release. */
function holdPart(kernel: Kernel, definition: PartDefinition, owner: string): Disposer {
  const table = holds.get(kernel) ?? new Map<PartDefinition, Hold>();
  holds.set(kernel, table);

  const held = table.get(definition) ?? {
    count: 0,
    dispose: kernel.partDefinitions.register(definition, owner),
  };

  held.count += 1;
  table.set(definition, held);
  let released = false;

  return () => {
    if (released) return;
    released = true;
    held.count -= 1;

    if (held.count > 0) return;
    table.delete(definition);
    held.dispose();
  };
}

/** Returns issues without repeats. */
function unique(issues: readonly ValidationIssue[]): readonly ValidationIssue[] {
  const seen = new Set<string>();

  return issues.filter((issue) => {
    const key = JSON.stringify(issue);

    if (seen.has(key)) return false;
    seen.add(key);

    return true;
  });
}
