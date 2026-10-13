import { asId, isJson } from "@nyte-ai/schema";
import type {
  CatalogGeneration,
  CommandInfo,
  CommandOutcome,
  Disposer,
  Json,
  JsonSchema,
  RunId,
  Schema,
  SessionCatalogView,
  SessionId,
  ValidationIssue,
} from "@nyte-ai/schema";
import { sendNow } from "./admission.ts";
import { SdkError } from "./error.ts";
import { check } from "./json-schema.ts";
import type { Kernel } from "./kernel.ts";
import { pluginState } from "./plugin-runtime.ts";
import type { PluginRuntime } from "./plugin-runtime.ts";
import type {
  ContributionTable,
  Registries,
  Registry,
  RegistryDraft,
  Setting,
  SettingDefinition,
  SettingsRegistry,
} from "./plugin.ts";
import { CORE_CONTEXT } from "./principals.ts";
import { isJsonObject } from "./records.ts";
import { MAIN } from "./session-state.ts";
import { settingInfos } from "./settings.ts";
import type { ToolSource } from "./tool-runner.ts";

/** One registry as a session holds it; its own `add` writes as owner `core`. */
export interface CoreRegistry<T, Handle = Disposer> extends Registry<T, "core", Handle> {
  /** Returns this registry as one plugin writes to it, its additions removed when `signal` aborts. */
  owned(owner: string, signal?: AbortSignal): Registry<T, "core", Handle>;
  /** Returns the materialised items with their owners; a wrapped item keeps its owner. */
  entries(): readonly { readonly item: T; readonly owner: string }[];
  /** Returns the static items one owner has added, materialised or not. */
  declared(owner: string): readonly T[];
  /** Runs this registry's step of a reload pass: the static items by key (a later owner's is a collision warning unless the kind overrides), then every derive with `siblings`. A derive that throws has its edits discarded and is an error issue against its owner. */
  materialize(
    siblings: Registries<"core">,
  ): readonly { readonly owner: string; readonly issue: ValidationIssue }[];
}

/** One `CoreRegistry` per contribution kind a core plugin may write. */
export type CoreRegistries = {
  readonly [K in keyof Registries<"core">]: CoreRegistry<
    ContributionTable[K & keyof ContributionTable]["item"],
    ContributionTable[K & keyof ContributionTable]["handle"]
  > &
    (K extends "settings" ? Pick<SettingsRegistry<"core">, "value" | "watch"> : {});
};

/** Holds one session's core registries and runs their reload pass. */
export interface RegistrySet extends CoreRegistries {
  /** Returns every registry as one plugin writes to it: a plugin api's `contribute`. */
  owned(owner: string, signal?: AbortSignal): Registries<"core">;
  /** Runs a reload pass now in `ORDER`, each derive seeing the registries materialised earlier in the pass. A pass requested from inside a pass runs after it, on a microtask. */
  materialize(): Promise<void>;
  /** Schedules one reload pass on a microtask for every write and `reload` before it. */
  reload(): void;
}

type Derive<T> = (draft: RegistryDraft<T>, siblings: Registries<"core">) => void;

interface Entry<T> {
  readonly item: T;
  readonly owner: string;
}

/** The kinds in reload order. */
const ORDER = [
  "tools",
  "agents",
  "prompt",
  "modelContext",
  "skills",
  "parts",
  "commands",
  "settings",
] as const satisfies readonly (keyof CoreRegistries)[];

/** Returns a session's empty registry set. `settings.add` returns `setting(definition, owner)` with its disposer, and `settings.value`/`watch` read the setting the owner declared through the same handle. `report` receives collisions and derive failures; `onChange` runs after every pass. */
export function createRegistrySet(input: {
  onChange(): void;
  setting(definition: SettingDefinition, owner: string): Setting<unknown>;
  report(owner: string, issue: ValidationIssue): void;
}): RegistrySet {
  let scheduled = false;
  let passing = false;

  const reload = (): void => {
    if (scheduled) return;
    scheduled = true;

    queueMicrotask(() => {
      if (scheduled) pass();
    });
  };

  const settings = createRegistry<SettingDefinition, Setting<unknown>>({
    key: (definition) => definition.id,
    handle: (definition, owner) => input.setting(definition, owner),
    onChange: reload,
  });

  /** Returns the handle on the setting `owner` declared last under `id`. */
  const declared = (owner: string, id: string): Setting<unknown> => {
    const definition = settings.declared(owner).findLast((candidate) => candidate.id === id);

    if (definition === undefined)
      throw new SdkError("unknown", `${owner} declares no setting ${id}.`);

    return input.setting(definition, owner);
  };

  const reading = (owner: string): Pick<SettingsRegistry<"core">, "value" | "watch"> => ({
    value: async (id) => declared(owner, id).get(),
    async *watch(id) {
      yield* declared(owner, id).watch();
    },
  });

  const registries: CoreRegistries = {
    tools: createRegistry({ key: (tool) => tool.name, onChange: reload }),
    prompt: createRegistry({ key: (section) => section.id, overrides: true, onChange: reload }),
    agents: createRegistry({ key: (agent) => agent.id, onChange: reload }),
    modelContext: createRegistry({
      key: (policy) => `${policy.model.provider}/${policy.model.id}`,
      onChange: reload,
    }),
    skills: createRegistry({ key: (skill) => skill.name, onChange: reload }),
    parts: createRegistry({ key: (definition) => definition.kind, onChange: reload }),
    commands: createRegistry({
      key: (command, owner) => `${owner}/${command.name}`,
      onChange: reload,
    }),
    settings: { ...settings, ...reading("core") },
  };

  const set: RegistrySet = {
    ...registries,
    owned: (owner, signal) => ({
      tools: registries.tools.owned(owner, signal),
      prompt: registries.prompt.owned(owner, signal),
      agents: registries.agents.owned(owner, signal),
      modelContext: registries.modelContext.owned(owner, signal),
      skills: registries.skills.owned(owner, signal),
      parts: registries.parts.owned(owner, signal),
      commands: registries.commands.owned(owner, signal),
      settings: { ...registries.settings.owned(owner, signal), ...reading(owner) },
    }),
    async materialize() {
      if (passing) {
        reload();

        return;
      }

      pass();
    },
    reload,
  };

  function pass(): void {
    scheduled = false;
    passing = true;

    try {
      for (const kind of ORDER) {
        for (const { owner, issue } of registries[kind].materialize(set))
          input.report(owner, { ...issue, path: [kind, ...issue.path] });
      }
    } finally {
      passing = false;
    }

    input.onChange();
  }

  return set;
}

/** Returns an empty registry keyed by `key(item, owner)`; an add returns `handle(item, owner)` joined with its disposer. With `overrides`, another owner's item under a taken key replaces it without a collision. Nothing shows in `list` until `materialize`. */
export function createRegistry<T, Handle = Disposer>(input: {
  key(item: T, owner: string): string;
  handle?(item: T, owner: string): Handle;
  readonly overrides?: boolean;
  onChange(): void;
}): CoreRegistry<T, Handle> {
  const statics: Entry<T>[] = [];
  const derives: { readonly derive: Derive<T>; readonly owner: string }[] = [];
  let materialized: readonly Entry<T>[] = [];

  const removal = (remove: () => void, signal: AbortSignal | undefined): Disposer => {
    let removed = false;

    const dispose = (): void => {
      if (removed) return;
      removed = true;
      signal?.removeEventListener("abort", dispose);
      remove();
      input.onChange();
    };

    signal?.addEventListener("abort", dispose, { once: true });

    if (signal?.aborted === true) dispose();

    return dispose;
  };

  const adder = (
    owner: string,
    signal: AbortSignal | undefined,
  ): Registry<T, "core", Handle>["add"] => {
    function add(item: T): Handle & Disposer;
    function add(derive: Derive<T>): Disposer;
    function add(value: T | Derive<T>): Disposer {
      if (isDerive(value)) {
        const entry = { derive: value, owner };
        derives.push(entry);
        input.onChange();

        return removal(() => derives.splice(derives.indexOf(entry), 1), signal);
      }

      const entry: Entry<T> = { item: value, owner };
      statics.push(entry);
      input.onChange();
      const dispose = removal(() => statics.splice(statics.indexOf(entry), 1), signal);

      return Object.assign(dispose, input.handle?.(value, owner));
    }

    return add;
  };

  const owned = (owner: string, signal?: AbortSignal): Registry<T, "core", Handle> => ({
    add: adder(owner, signal),
    list: () => materialized.map((entry) => entry.item),
  });

  return {
    ...owned("core"),
    owned,
    entries: () => materialized,
    declared: (owner) => statics.flatMap((entry) => (entry.owner === owner ? [entry.item] : [])),
    materialize(siblings) {
      const draft = new Map<string, Entry<T>>();
      const issues: { readonly owner: string; readonly issue: ValidationIssue }[] = [];

      for (const entry of statics) {
        const key = input.key(entry.item, entry.owner);
        const previous = draft.get(key);

        if (previous !== undefined && previous.owner !== entry.owner && input.overrides !== true)
          issues.push({
            owner: entry.owner,
            issue: {
              severity: "warning",
              path: [key],
              message: `${key} from ${entry.owner} replaces the one from ${previous.owner}.`,
              source: { plugin: entry.owner },
            },
          });

        draft.set(key, entry);
      }

      for (const { derive, owner } of derives) {
        const before = new Map(draft);

        try {
          derive(draftOf(draft, owner), siblings);
        } catch (error) {
          draft.clear();

          for (const [key, entry] of before) draft.set(key, entry);

          issues.push({
            owner,
            issue: {
              severity: "error",
              path: [],
              message: `A derivation failed: ${error instanceof Error ? error.message : String(error)}`,
              source: { plugin: owner },
            },
          });
        }
      }

      materialized = [...draft.values()];

      return issues;
    },
  };
}

/** Returns the draft one derivation edits: what it sets is its own. */
function draftOf<T>(draft: Map<string, Entry<T>>, owner: string): RegistryDraft<T> {
  return {
    set(id, item) {
      draft.set(id, { item, owner });
    },
    get: (id) => draft.get(id)?.item,
    delete(id) {
      draft.delete(id);
    },
    ids: () => [...draft.keys()],
    wrap(id, wrap) {
      const current = draft.get(id);

      if (current !== undefined) draft.set(id, { item: wrap(current.item), owner: current.owner });
    },
  };
}

/** Returns whether an add is a derivation: contribution items are plain objects. */
function isDerive<T>(value: T | Derive<T>): value is Derive<T> {
  return typeof value === "function";
}

const schemas = new WeakMap<
  object,
  { readonly input?: JsonSchema; readonly output?: JsonSchema }
>();

/** Returns what a session's plugins contributed, from its materialised registries, each item with its owner; commands are named `<owner>/<name>`. An item whose schema has no JSON Schema is left out. */
export async function sessionCatalog(
  kernel: Kernel,
  session: SessionId,
): Promise<SessionCatalogView> {
  const runtime = kernel.pluginsFor(session);
  const { registries } = runtime;

  return {
    commands: registries.commands.entries().flatMap(({ item, owner }): readonly CommandInfo[] => {
      const args = item.arguments === undefined ? null : converted(item.arguments, "input");

      if (args === undefined) return [];

      return [
        {
          name: `${owner}/${item.name}`,
          owner,
          side: "core",
          title: item.title,
          description: item.description,
          arguments: args,
          category: item.category,
          keywords: item.keywords,
        },
      ];
    }),
    settings: await settingInfos(kernel, session),
    skills: registries.skills.entries().map(({ item, owner }) => ({
      name: item.name,
      owner,
      description: item.description,
      location: item.location,
    })),
    agents: registries.agents.entries().map(({ item, owner }) => ({
      id: item.id,
      owner,
      description: item.description ?? null,
      model: item.model ?? null,
      mode: item.mode ?? "all",
    })),
    tools: toolSource(kernel, runtime, null).list(),
  };
}

/** Computes the session's catalog and, when it changed, sets it with `kernel.setCatalog` and bumps the catalog generation. One session's publishes run one after another. */
export function publishCatalog(kernel: Kernel, session: SessionId): Promise<void> {
  const queues = pluginState(kernel).publishing;

  const next = (queues.get(session) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const catalog = await sessionCatalog(kernel, session);

      if (JSON.stringify(catalog) === JSON.stringify(kernel.catalog(session))) return;
      kernel.setCatalog(session, catalog);
      bumpGeneration(kernel);
    });

  queues.set(session, next);

  void next
    .finally(() => {
      if (queues.get(session) === next) queues.delete(session);
    })
    .catch(() => undefined);

  return next;
}

/** Moves `HostView.catalog` to a fresh generation and returns it. */
export function bumpGeneration(kernel: Kernel): CatalogGeneration {
  const generation = asId<"catalog-generation">(crypto.randomUUID());
  kernel.host.update({ catalog: generation });

  return generation;
}

/** Returns a runtime's tools for one run: `get` resolves any tool with its owner, `list` answers `ToolInfo`s, and `activate` lists deferred tools as `model` for this run alone until `endRun` drops them. */
export function toolSource(kernel: Kernel, runtime: PluginRuntime, run: RunId | null): ToolSource {
  const registry = runtime.registries.tools;

  return {
    get(name) {
      const found = registry.entries().find((entry) => entry.item.name === name);

      return found === undefined ? undefined : { definition: found.item, owner: found.owner };
    },
    list() {
      const active = run === null ? undefined : pluginState(kernel).activated.get(run);

      return registry.entries().flatMap(({ item, owner }) => {
        const parameters = converted(item.parameters, "input");
        const output = item.output === undefined ? null : converted(item.output, "output");

        if (parameters === undefined || output === undefined) return [];
        const exposure = item.exposure ?? "model";

        return [
          {
            name: item.name,
            owner,
            namespace: item.namespace ?? null,
            description: item.description,
            parameters,
            output,
            exposure:
              exposure === "deferred" && active?.has(item.name) === true ? "model" : exposure,
          },
        ];
      });
    },
    async activate(names) {
      if (run === null) return;
      const runs = pluginState(kernel).activated;
      runs.set(run, new Set([...(runs.get(run) ?? []), ...names]));
    },
  };
}

/** Forgets the deferred tools a run activated. */
export function dropActivations(kernel: Kernel, run: RunId): void {
  pluginState(kernel).activated.delete(run);
}

/** Returns a schema's JSON Schema in one direction, cached per schema object: `input` for what a caller sends, `output` for what is shown. Throws what the schema throws, or `invalid` when the result is not a JSON object; preflight calls it, so a throw is a load-time issue. */
export function jsonSchemaOf(schema: Schema<unknown>, direction: "input" | "output"): JsonSchema {
  const cached = schemas.get(schema) ?? {};
  const known = cached[direction];

  if (known !== undefined) return known;
  const result = schema["~standard"].jsonSchema[direction]({ target: "draft-2020-12" });

  if (!isJson(result) || !isJsonObject(result))
    throw new SdkError("invalid", `The schema's ${direction} JSON Schema is not a JSON object.`);

  schemas.set(
    schema,
    direction === "input" ? { ...cached, input: result } : { ...cached, output: result },
  );

  return result;
}

/** Returns a schema's JSON Schema, or undefined when it has none. */
function converted(schema: Schema<unknown>, direction: "input" | "output"): JsonSchema | undefined {
  try {
    return jsonSchemaOf(schema, direction);
  } catch {
    return undefined;
  }
}

/** Runs a core command by its `<owner>/<name>`, or its bare name when exactly one command has it, validating `args` against `arguments`. A string answers `ran`; a `{ prompt }` is sent to the main head through `sendNow`, the caller having awaited the activation, and answers `sent`; a throw answers `failed`. */
export async function runCommand(
  kernel: Kernel,
  session: SessionId,
  name: string,
  args: Json | undefined,
): Promise<CommandOutcome> {
  const runtime = kernel.pluginsFor(session);
  const entries = runtime.registries.commands.entries();
  const qualified = entries.filter((entry) => `${entry.owner}/${entry.item.name}` === name);
  const bare = entries.filter((entry) => entry.item.name === name);
  const [found] = qualified.length === 1 ? qualified : bare.length === 1 ? bare : [];
  const api = found === undefined ? undefined : runtime.api(found.owner);

  if (found === undefined || api === undefined) return { kind: "unknown" };
  const { item: command, owner } = found;
  let input: unknown = args;

  if (command.arguments !== undefined) {
    const checked = await check(command.arguments, args);

    if (checked.kind === "invalid") return { kind: "invalid", issues: checked.issues };
    input = checked.value;
  }

  try {
    const result = await command.run(input, { signal: api.signal, api });

    if (typeof result === "string") return { kind: "ran", output: result };

    if (result === undefined) return { kind: "ran", output: null };

    const receipt = await sendNow(kernel, {
      session,
      head: MAIN,
      context: CORE_CONTEXT,
      content: result.prompt,
      options: {
        source: { kind: "action", label: command.title, command: `${owner}/${command.name}` },
      },
    });

    return { kind: "sent", receipt: receipt.id };
  } catch (error) {
    return { kind: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}
