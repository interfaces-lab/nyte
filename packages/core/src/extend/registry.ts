import { asId, CLIENT_COMMAND_NAMES, COMMAND_NAME, SdkError } from "@nyte-ai/schema";
import type {
  CatalogGeneration,
  CommandCompletion,
  CommandInfo,
  CommandOutcome,
  Disposer,
  JsonSchema,
  Schema,
  SessionCatalogView,
  SessionId,
  SkillInfo,
  ToolInfo,
  UserContent,
  ValidationIssue,
  WorkspaceId,
} from "@nyte-ai/schema";
import { CORE_CONTEXT } from "../contract/host.ts";
import type { ConnectionContext } from "../contract/host.ts";
import { decodeCatalogRecord } from "../contract/records.ts";
import type {
  CoreRegistries,
  CoreRegistry,
  HookContext,
  Kernel,
  OwnedRegistry,
  PluginRuntime,
  RegistrySet,
  ToolSource,
} from "../contract/kernel.ts";
import type {
  Chat,
  Command,
  CommandReturn,
  Derive,
  PluginApi,
  RegistryDraft,
  ResolvedSetting,
  Setting,
  SettingDefinition,
  SettingsRegistry,
  When,
} from "../contract/plugin.ts";
import { resolveSetting } from "../contract/plugin.ts";
import { sendNow } from "../engine/admission.ts";
import { commit } from "../watch/commit.ts";
import { encodeCatalog } from "../store/catalogs.ts";
import { catalogRef } from "../store/refs.ts";
import { attempt, load, MAIN, put, readRefExpectation, STALE } from "../store/session.ts";
import { callable } from "../util/callable.ts";
import { convertJsonSchema } from "../util/json-schema.ts";
import { stepPluginApi } from "./plugin-api.ts";
import { settingInfos } from "./setting-definitions.ts";

interface Entry<T> {
  readonly item: T;
  readonly owner: string;
}

const ORDER = [
  "searchProviders",
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
  /** The chat's parent and setting values, as `when` reads them. */
  chat(): Pick<Chat, "parent" | "settings">;
  onChange(): void;
  setting(definition: ResolvedSetting, owner: string): Setting<unknown>;
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

  const chat = (): Chat => ({
    ...input.chat(),
    searchProviders: registries.searchProviders.list(),
  });

  const settings = createRegistry<SettingDefinition>({
    key: (definition) => definition.id,
    when: (definition) => definition.when,
    chat,
    onChange: reload,
  });

  const declared = (owner: string, id: string): Setting<unknown> => {
    const definition = settings.declared(owner).findLast((candidate) => candidate.id === id);

    if (definition === undefined)
      throw new SdkError("unknown", `${owner} declares no setting ${id}.`);

    return input.setting(resolveSetting(definition), owner);
  };

  const reading = (owner: string): Pick<SettingsRegistry, "value" | "set" | "watch"> => ({
    value: async (id) => declared(owner, id).get(),
    set: async (id, value) => declared(owner, id).set(value),
    async *watch(id) {
      yield* declared(owner, id).watch();
    },
  });

  const registries: CoreRegistries = {
    tools: createRegistry({
      key: (tool) => tool.name,
      when: (tool) => tool.when,
      chat,
      onChange: reload,
    }),
    prompt: createRegistry({
      key: (section) => section.id,
      overrides: true,
      when: (section) => section.when,
      chat,
      onChange: reload,
    }),
    agents: createRegistry({ key: (agent) => agent.id, onChange: reload }),
    modelContext: createRegistry({
      key: (policy) => `${policy.model.provider}/${policy.model.id}`,
      onChange: reload,
    }),
    skills: createRegistry({ key: (skill) => skill.name, onChange: reload }),
    searchProviders: createRegistry({ key: (provider) => provider.id, onChange: reload }),
    parts: createRegistry({ key: (definition) => definition.kind, onChange: reload }),
    commands: createRegistry({
      key: (command) => command.name,
      refuse: refuseCommandName,
      when: (command) => command.when,
      chat,
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
      searchProviders: registries.searchProviders.owned(owner, signal),
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

function createRegistry<T>(input: {
  key(item: T, owner: string): string;
  refuse?(item: T): string | undefined;
  when?(item: T): When | undefined;
  chat?(): Chat;
  readonly overrides?: boolean;
  onChange(): void;
}): CoreRegistry<T> {
  const statics: Entry<T>[] = [];
  const derives: { readonly derive: Derive<T, "core">; readonly owner: string }[] = [];
  let materialized: readonly Entry<T>[] = [];
  let drafted: readonly Entry<T>[] = [];

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

  const owned = (owner: string, signal?: AbortSignal): OwnedRegistry<T> => ({
    add(value) {
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

      return removal(
        () =>
          statics.splice(
            statics.findIndex((candidate) => candidate === entry),
            1,
          ),
        signal,
      );
    },
    list: () => materialized.map((entry) => entry.item),
  });

  return {
    list: () => materialized.map((entry) => entry.item),
    owned,
    entries: () => materialized,
    drafted: () => drafted,
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

      for (const [key, entry] of draft) {
        const refusal = input.refuse?.(entry.item);

        if (refusal === undefined) continue;
        draft.delete(key);
        issues.push({
          owner: entry.owner,
          issue: {
            severity: "error",
            path: [key],
            message: refusal,
            source: { plugin: entry.owner },
          },
        });
      }

      drafted = [...draft.values()];

      for (const [key, entry] of draft) {
        const when = input.when?.(entry.item);

        if (when === undefined || input.chat === undefined) continue;

        try {
          if (when(input.chat()) === true) continue;
        } catch (error) {
          issues.push({
            owner: entry.owner,
            issue: {
              severity: "error",
              path: [key, "when"],
              message: `when failed, so ${key} is left out: ${error instanceof Error ? error.message : String(error)}`,
              source: { plugin: entry.owner },
            },
          });
        }

        draft.delete(key);
      }

      materialized = [...draft.values()];

      return issues;
    },
  };
}

function refuseCommandName(command: Command): string | undefined {
  if (!COMMAND_NAME.test(command.name))
    return `The command name ${command.name} can't be typed after "/": use lowercase letters, digits and "-".`;

  return CLIENT_COMMAND_NAMES.some((name) => name === command.name)
    ? `/${command.name} is a built-in command; give the plugin's command another name.`
    : undefined;
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

  if (runtime === undefined || runtime.outcomes().length === 0) return null;
  const { registries } = runtime;
  const release = runtime.hold();

  try {
    return {
      commands: commandInfos(registries),
      settings: await settingInfos(kernel, session),
      skills: skillInfos(registries),
      agents: registries.agents.entries().map(({ item, owner }) => ({
        id: item.id,
        owner,
        description: item.description ?? null,
        model: item.model ?? null,
        mode: item.mode ?? "all",
      })),
      tools: toolSource(runtime).list(),
    };
  } finally {
    release();
  }
}

export function skillInfos(registries: RegistrySet): readonly SkillInfo[] {
  return registries.skills.entries().map(({ item, owner }) => ({
    name: item.name,
    owner,
    description: item.description,
    location: item.location,
  }));
}

export function commandInfos(registries: RegistrySet): readonly CommandInfo[] {
  return registries.commands
    .entries()
    .filter((entry) => entry.item.hidden !== true)
    .map(({ item, owner }) => ({
      name: item.name,
      owner,
      side: "core",
      title: item.title,
      description: item.description,
      takesText: item.takesText === true || item.complete !== undefined,
      completes: item.complete !== undefined,
      category: item.category,
      keywords: item.keywords,
    }));
}

export function publishCatalog(kernel: Kernel, session: SessionId): Promise<void> {
  const queues = kernel.plugins.state.publishing;

  const next = (queues.get(session) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const catalog = await sessionCatalog(kernel, session);

      if (catalog !== null) await recordCatalog(kernel, session, catalog);
    });

  queues.set(session, next);

  void next
    .finally(() => {
      if (queues.get(session) === next) queues.delete(session);
    })
    .catch(() => undefined);

  return next;
}

async function recordCatalog(
  kernel: Kernel,
  session: SessionId,
  catalog: SessionCatalogView,
): Promise<void> {
  const encoded = await encodeCatalog(catalog);
  const name = catalogRef(session);

  await attempt(`Recording the catalog of ${session}`, async () => {
    const ref = await kernel.store.refs.get(name);

    if ((await load(kernel.store, ref, decodeCatalogRecord))?.record.id === encoded.id) return true;
    await kernel.store.catalogs.putIfAbsent(encoded.id, encoded.body);

    const outcome = await commit(kernel, [
      {
        name,
        target: await put(kernel.store, "catalog", { id: encoded.id }),
        expect: readRefExpectation(ref),
        events: [{ head: null, kind: "catalog", id: encoded.id }],
      },
    ]);

    return outcome.kind === "set" ? true : STALE;
  });
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
            namespace: item.namespace?.name ?? null,
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

export async function offeredTools(
  runtime: PluginRuntime,
  tools: readonly ToolInfo[],
  context: HookContext,
  signal?: AbortSignal,
): Promise<readonly ToolInfo[]> {
  const kept = new Set(
    (await runtime.hooks.transform("offer_tools", tools, context, signal)).map((info) => info.name),
  );

  return tools.filter((info) => kept.has(info.name));
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
  text: string,
): Promise<CommandOutcome> {
  const runtime = kernel.plugins.runtime(session);
  const release = runtime.hold();

  try {
    return await runHeld(kernel, context, session, runtime, name, text);
  } finally {
    release();
  }
}

export async function completeSessionCommand(
  kernel: Kernel,
  context: ConnectionContext,
  session: SessionId,
  name: string,
  prefix: string,
): Promise<readonly CommandCompletion[]> {
  const runtime = kernel.plugins.runtime(session);
  const release = runtime.hold();

  try {
    return await completeCommand(kernel, context, session, runtime, name, prefix);
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
  text: string,
): Promise<CommandOutcome> {
  const invoked = await invokeCommand(kernel, context, session, runtime, name, text);

  if (invoked.kind !== "returned") return invoked;
  const { result, command, api } = invoked;

  switch (result.kind) {
    case "text":
      return { kind: "ran", output: result.output };
    case "move":
      return moveSession(api, result);
    case "prompt":
      try {
        const receipt = await sendNow(kernel, {
          session,
          head: MAIN,
          context,
          content: result.content,
          options: {
            source: { kind: "action", label: command.title, command: command.name },
          },
        });

        return { kind: "sent", receipt: receipt.id };
      } catch (error) {
        return { kind: "failed", message: error instanceof Error ? error.message : String(error) };
      }

    default: {
      const _exhaustive: never = result;

      return _exhaustive;
    }
  }
}

async function moveSession(
  api: PluginApi<"core">,
  move: Extract<CommandResult, { readonly kind: "move" }>,
): Promise<CommandOutcome> {
  const outcome = await api.session.update({ workspace: move.workspace });

  switch (outcome.kind) {
    case "updated":
      return { kind: "ran", output: move.output };
    case "busy":
      return {
        kind: "failed",
        message: "Wait for the current run to finish before changing directories.",
      };
    case "unknown-workspace":
      return { kind: "failed", message: "That folder isn't registered on this host." };
    default: {
      const _exhaustive: never = outcome;

      return _exhaustive;
    }
  }
}

type CommandResult =
  | { readonly kind: "text"; readonly output: string | null }
  | { readonly kind: "prompt"; readonly content: UserContent }
  | { readonly kind: "move"; readonly workspace: WorkspaceId; readonly output: string | null };

export async function invokeCommand(
  kernel: Kernel,
  context: ConnectionContext,
  session: SessionId,
  plugins: Pick<PluginRuntime, "registries" | "api">,
  name: string,
  text: string,
): Promise<
  | {
      readonly kind: "returned";
      readonly result: CommandResult;
      readonly command: Command;
      readonly api: PluginApi<"core">;
    }
  | Extract<CommandOutcome, { readonly kind: "unknown" | "failed" }>
> {
  const found = findCommand(kernel, context, session, plugins, name);

  if (found === undefined) return { kind: "unknown" };
  const { command, api } = found;

  try {
    const returned = await command.run(text.trim(), {
      signal: api.signal,
      api,
      caller: context.principal,
    });

    return { kind: "returned", result: commandResult(returned), command, api };
  } catch (error) {
    return { kind: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}

function commandResult(returned: CommandReturn): CommandResult {
  if (returned === undefined) return { kind: "text", output: null };

  if (typeof returned === "string") return { kind: "text", output: returned };

  if (returned.workspace !== undefined)
    return { kind: "move", workspace: returned.workspace, output: returned.output ?? null };

  return { kind: "prompt", content: returned.prompt };
}

export async function completeCommand(
  kernel: Kernel,
  context: ConnectionContext,
  session: SessionId,
  plugins: Pick<PluginRuntime, "registries" | "api">,
  name: string,
  prefix: string,
): Promise<readonly CommandCompletion[]> {
  const found = findCommand(kernel, context, session, plugins, name);

  if (found?.command.complete === undefined) return [];
  const { api } = found;

  try {
    return await found.command.complete(prefix, { signal: api.signal, api });
  } catch (error) {
    api.report({
      severity: "warning",
      path: ["commands", name, "complete"],
      message: `Suggesting text for /${name} failed: ${error instanceof Error ? error.message : String(error)}`,
      source: { plugin: found.owner },
    });

    return [];
  }
}

function findCommand(
  kernel: Kernel,
  context: ConnectionContext,
  session: SessionId,
  plugins: Pick<PluginRuntime, "registries" | "api">,
  name: string,
):
  | { readonly command: Command; readonly owner: string; readonly api: PluginApi<"core"> }
  | undefined {
  const found = plugins.registries.commands.entries().find((entry) => entry.item.name === name);
  const api = found === undefined ? undefined : plugins.api(found.owner);

  if (found === undefined || api === undefined) return undefined;

  return {
    command: found.item,
    owner: found.owner,
    api: context === CORE_CONTEXT ? api : stepPluginApi(kernel, api, context, session),
  };
}
