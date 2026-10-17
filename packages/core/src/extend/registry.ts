import { asId, SdkError } from "@nyte-ai/schema";
import type {
  CatalogGeneration,
  CommandInfo,
  CommandOutcome,
  Disposer,
  Json,
  JsonSchema,
  Schema,
  SessionCatalogView,
  SessionId,
  ValidationIssue,
} from "@nyte-ai/schema";
import { CORE_CONTEXT } from "../contract/host.ts";
import type { ConnectionContext } from "../contract/host.ts";
import type {
  CoreRegistries,
  CoreRegistry,
  Kernel,
  PluginRuntime,
  RegistrySet,
  ToolSource,
} from "../contract/kernel.ts";
import type {
  Registries,
  Registry,
  RegistryDraft,
  Setting,
  SettingDefinition,
  SettingsRegistry,
} from "../contract/plugin.ts";
import { sendNow } from "../engine/admission.ts";
import { MAIN } from "../store/session.ts";
import { callable } from "../util/callable.ts";
import { check, convertJsonSchema } from "../util/json-schema.ts";
import { stepPluginApi } from "./plugin-api.ts";
import { settingInfos } from "./setting-layers.ts";

type Derive<T> = (draft: RegistryDraft<T>, siblings: Registries<"core">) => void;

interface Entry<T> {
  readonly item: T;
  readonly owner: string;
}

const ORDER = [
  "tools",
  "agents",
  "skills",
  "prompt",
  "modelContext",
  "parts",
  "commands",
  "settings",
] as const satisfies readonly (keyof CoreRegistries)[];

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

function createRegistry<T, Handle = Disposer>(input: {
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
      if (callable(value)) {
        const entry = { derive: value, owner };
        derives.push(entry);
        input.onChange();

        return removal(
          () =>
            derives.splice(
              derives.findIndex((candidate) => candidate === entry),
              1,
            ),
          signal,
        );
      }

      const entry: Entry<T> = { item: value, owner };
      statics.push(entry);
      input.onChange();
      const dispose = removal(
        () =>
          statics.splice(
            statics.findIndex((candidate) => candidate === entry),
            1,
          ),
        signal,
      );

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
          derive(createRegistryDraft(draft, owner), siblings);
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

function createRegistryDraft<T>(draft: Map<string, Entry<T>>, owner: string): RegistryDraft<T> {
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

async function sessionCatalog(
  kernel: Kernel,
  session: SessionId,
): Promise<SessionCatalogView | null> {
  const runtime = kernel.plugins.runtimes().get(session);

  if (runtime === undefined) return null;
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
    tools: toolSource(runtime).list(),
  };
}

export function publishCatalog(kernel: Kernel, session: SessionId): Promise<void> {
  const queues = kernel.plugins.state.publishing;

  const next = (queues.get(session) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const catalog = await sessionCatalog(kernel, session);

      if (
        catalog === null ||
        JSON.stringify(catalog) === JSON.stringify(kernel.sessions.catalog(session))
      )
        return;
      kernel.sessions.setCatalog(session, catalog);
    });

  queues.set(session, next);

  void next
    .finally(() => {
      if (queues.get(session) === next) queues.delete(session);
    })
    .catch(() => undefined);

  return next;
}

export function bumpGeneration(kernel: Kernel): CatalogGeneration {
  const generation = asId<"catalog-generation">(crypto.randomUUID());
  kernel.host.update({ catalog: generation });

  return generation;
}

export function toolSource(runtime: PluginRuntime): ToolSource {
  const registry = runtime.registries.tools;

  return {
    get(name) {
      const found = registry.entries().find((entry) => entry.item.name === name);

      return found === undefined ? undefined : { definition: found.item, owner: found.owner };
    },
    list() {
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
            exposure,
          },
        ];
      });
    },
  };
}

function converted(schema: Schema<unknown>, direction: "input" | "output"): JsonSchema | undefined {
  try {
    return convertJsonSchema(schema, direction);
  } catch {
    return undefined;
  }
}

export async function runCommand(
  kernel: Kernel,
  context: ConnectionContext,
  session: SessionId,
  name: string,
  args: Json | undefined,
): Promise<CommandOutcome> {
  const runtime = kernel.plugins.runtime(session);
  const release = runtime.hold();

  try {
    return await runHeld(kernel, context, session, runtime, name, args);
  } finally {
    release();
  }
}

async function runHeld(
  kernel: Kernel,
  context: ConnectionContext,
  session: SessionId,
  runtime: PluginRuntime,
  name: string,
  args: Json | undefined,
): Promise<CommandOutcome> {
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
    const result = await command.run(input, {
      signal: api.signal,
      api: context === CORE_CONTEXT ? api : stepPluginApi(kernel, api, context, session),
      caller: context.principal,
    });

    if (typeof result === "string") return { kind: "ran", output: result };

    if (result === undefined) return { kind: "ran", output: null };

    const receipt = await sendNow(kernel, {
      session,
      head: MAIN,
      context,
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
