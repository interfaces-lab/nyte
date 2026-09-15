import { type Api, type Model, type RetryPolicy } from "@nyte-ai/ai";
import type { JsonValue, Skill } from "@nyte-ai/schema";
import type { PluginSessionStorage } from "../../plugins/api.ts";
import type { PluginSession } from "../../plugins/types.ts";
import { HookRegistry } from "../../plugins/hooks.ts";
import {
  createRegistries,
  PluginHost,
  type PluginRegistries,
  type PluginHostTarget,
  type PluginNotice,
} from "../../plugins/host.ts";
import { pluginFactKey } from "../../plugins/storage.ts";
import type {
  Agent,
  ApplySettingOutcome,
  Command,
  CommandResult,
  Disposer,
  LoadedPlugin,
  PluginEnv,
  PluginInfo,
  SettingInfo,
} from "../../plugins/types.ts";
import {
  isThinkingLevel,
  type AgentTool,
  type StreamFn,
  type StreamOptions,
  type ThinkingLevel,
} from "../../types.ts";
import type { CompactionSettings } from "../compaction.ts";
import { isJsonObject, toJsonValue } from "../json.ts";
import type { Blob, ModelRef, Obj, Run, RunConfig } from "../model.ts";
import { contextMessages } from "../context.ts";
import { contextCommits } from "../graph.ts";
import { FACT_PREFIX, decodeFactKey, encodeFactKey, factRef, headRef } from "../names.ts";
import type { Session } from "../store.ts";
import { projectEvent } from "./events.ts";
import { providerCompactionFor, requestStream } from "./requests.ts";
import { NAME_FACT, PARENT_FACT } from "./snapshot.ts";
import { MAIN, type SessionEvent } from "./types.ts";
import { bindTurn, type Turn, type TurnInput, type TurnOptions } from "../turn.ts";

const REGISTRY_PROPERTIES = [
  // `agents` first: the `subagents` builtin reads it while contributing `tools`.
  "agents",
  "tools",
  "commands",
  "prompt",
  "resources",
  "settings",
  "status",
  "modelContext",
] satisfies readonly (keyof PluginRegistries)[];

export type Notice = PluginNotice;

export interface Activation {
  readonly registries: PluginRegistries;
  readonly hooks: HookRegistry;
  readonly plugins: PluginHost;
  tools(): readonly AgentTool[];
  systemPrompt(): string;
  agents(): readonly Agent[];
  commands(): ReadonlyMap<string, Command>;
  commandOwner(name: string): string | undefined;
  resources(): ReadonlyMap<string, Skill>;
  listSettings(): Promise<readonly SettingInfo[]>;
  applySetting(id: string, choiceId: string): Promise<ApplySettingOutcome>;
  /** The plugin status items in display order. */
  statuses(): readonly string[];
  runCommand(name: string, argument?: string): Promise<CommandResult>;
  setPlugins(plugins: readonly LoadedPlugin[]): Promise<readonly PluginInfo[]>;
  subscribe(listener: (notice: Notice) => void): Disposer;
  close(): Promise<void>;
}

interface FactsShim extends Omit<PluginSessionStorage, keyof PluginSession> {
  listFacts(
    prefix: string,
  ): Promise<readonly { readonly fact: string; readonly value: JsonValue }[]>;
}

export type ActivationTarget =
  | { readonly kind: "new-session" }
  | { readonly kind: "session"; readonly session: Session };

function isBlob(object: Obj | undefined): object is Blob {
  return object?.kind === "blob";
}

function isStringFact(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

async function blobValue(session: Session, oid: string, ref: string): Promise<JsonValue> {
  const object = await session.objects.get(oid);
  if (!isBlob(object)) throw new Error(`Corrupt fact ref ${ref} at ${oid}`);
  return object.value;
}

function storedFactRef(key: string): string {
  return factRef(encodeFactKey(key));
}

function factsFor(session: Session): FactsShim {
  return {
    getFact: async (key) => {
      const ref = storedFactRef(key);
      const oid = await session.refs.read(ref);
      return oid === null ? undefined : blobValue(session, oid, ref);
    },
    setFact: async (key, value) => {
      const ref = storedFactRef(key);
      const blob: Blob | undefined =
        value === undefined ? undefined : { kind: "blob", value: toJsonValue(value) };
      const written = blob === undefined ? undefined : await session.objects.put([blob]);
      const next = written?.[0] ?? null;
      for (;;) {
        const current = await session.refs.read(ref);
        const outcome = await session.refs.update([{ name: ref, from: current, to: next }], {
          reason: "fact",
        });
        if (outcome.ok) return;
        switch (outcome.reason) {
          case "conflict":
            continue;
          case "fenced":
            throw new Error(`Fact update was fenced: ${ref}`);
          default: {
            const _exhaustive: never = outcome;
            return _exhaustive;
          }
        }
      }
    },
    listFacts: async (prefix) => {
      const refs = await session.refs.list(
        prefix === "" ? FACT_PREFIX : factRef(encodeFactKey(prefix)),
      );
      return Promise.all(
        refs.map(async (ref) => ({
          fact: decodeFactKey(ref.name.slice(FACT_PREFIX.length)),
          value: await blobValue(session, ref.oid, ref.name),
        })),
      );
    },
  };
}

function transientFacts(): FactsShim {
  const facts = new Map<string, JsonValue>();
  return {
    getFact: (key) => Promise.resolve(facts.get(key)),
    setFact: (key, value) => {
      if (value === undefined) facts.delete(key);
      else facts.set(key, value);
      return Promise.resolve();
    },
    listFacts: (prefix) =>
      Promise.resolve(
        [...facts]
          .filter(([fact]) => fact.startsWith(prefix))
          .map(([fact, value]) => ({ fact, value })),
      ),
  };
}

/** Activate a plugin list for a real session or a transient prospective session. */
export async function activate(input: {
  target: ActivationTarget;
  plugins: readonly LoadedPlugin[];
  env: PluginEnv;
}): Promise<Activation> {
  const registries = createRegistries();
  const session = input.target.kind === "session" ? input.target.session : undefined;
  const facts = session === undefined ? transientFacts() : factsFor(session);
  const listeners = new Set<(notice: Notice) => void | Promise<void>>();
  let closePromise: Promise<void> | undefined;

  const emit = async (notice: Notice): Promise<void> => {
    for (const listener of listeners) {
      try {
        await listener(notice);
      } catch (error) {
        if (notice.kind === "diagnostic") continue;
        await emit({
          kind: "diagnostic",
          level: "error",
          owner: `listener ${notice.kind}`,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  const hooks = new HookRegistry((error, hook) =>
    emit({
      kind: "diagnostic",
      owner: hook === "before_compaction" ? "compaction" : `hook ${hook}`,
      level: hook === "before_compaction" ? "warn" : "error",
      message: error.message,
    }),
  );

  const statuses = (): string[] =>
    registries.status
      .values()
      .map((item, index) => ({ item, index }))
      .sort(
        (left, right) =>
          (left.item.order ?? 100) - (right.item.order ?? 100) || left.index - right.index,
      )
      .map(({ item }) => item.text);
  let shownStatuses = statuses().join("\u0000");

  const rebuildAll = (): void => {
    for (const property of REGISTRY_PROPERTIES) {
      for (const failure of registries[property].rebuild().errors) {
        void emit({
          kind: "diagnostic",
          level: "error",
          owner: failure.owner,
          message: failure.message,
        });
      }
    }
    const items = statuses();
    const signature = items.join("\u0000");
    if (signature === shownStatuses) return;
    shownStatuses = signature;
    void emit({ kind: "status_changed", items });
  };

  // One watch over the session's events, started by the first subscriber and
  // fanned out to every plugin listener. A listener that throws is reported
  // and the stream goes on: an observer cannot stop what it observes.
  const eventListeners = new Set<(event: SessionEvent) => void>();
  let eventLoop: AbortController | undefined;
  const startEventLoop = (): void => {
    if (session === undefined || eventLoop !== undefined) return;
    const loop = new AbortController();
    eventLoop = loop;
    void (async () => {
      const afterSeq = await session.events.last();
      const events = session.events.watch({ afterSeq, signal: loop.signal });
      for await (const event of events) {
        if (loop.signal.aborted) return;
        for (const projected of await projectEvent(event, session.objects)) {
          for (const listener of eventListeners) {
            try {
              listener(projected);
            } catch (error) {
              void emit({
                kind: "diagnostic",
                level: "error",
                owner: "events",
                message: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      }
    })().catch((cause: Error) => {
      if (loop.signal.aborted) return;
      void emit({ kind: "diagnostic", level: "error", owner: "events", message: cause.message });
    });
  };
  const events = {
    subscribe: (listener: (event: SessionEvent) => void): Disposer => {
      eventListeners.add(listener);
      startEventLoop();
      return () => eventListeners.delete(listener);
    },
  };

  const subscribe = (listener: (notice: Notice) => void | Promise<void>): Disposer => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const target: PluginHostTarget = {
    hooks,
    registries,
    session: {
      ...facts,
      info: async () => {
        const name = await facts.getFact(NAME_FACT);
        const child = (await facts.getFact(PARENT_FACT)) !== undefined;
        const base = isStringFact(name) ? { name, child } : { child };
        return session === undefined ? base : { id: session.id, ...base };
      },
      rename: (name) => facts.setFact(NAME_FACT, name),
      context: async () => {
        if (session === undefined) return { systemPrompt: systemPrompt(), messages: [] };
        const tip = await session.refs.read(headRef(MAIN));
        const commits = await contextCommits(session.objects, tip);
        return {
          systemPrompt: systemPrompt(),
          messages: contextMessages(commits.map((item) => item.commit)),
        };
      },
    },
    events,
    env: input.env,
    subscribe,
    rebuildAll,
    emit,
  };
  const plugins = new PluginHost(target);

  const systemPrompt = (): string =>
    registries.prompt
      .values()
      .map((section, index) => ({ section, index }))
      .sort(
        (left, right) =>
          (left.section.order ?? 100) - (right.section.order ?? 100) || left.index - right.index,
      )
      .map(({ section }) => section.text)
      .join("\n\n");

  const activation: Activation = {
    registries,
    hooks,
    plugins,
    tools: () => registries.tools.values(),
    systemPrompt,
    agents: () => registries.agents.values(),
    commands: () => registries.commands.current(),
    commandOwner: (name) => registries.commands.owner(name),
    resources: () => registries.resources.current(),
    statuses,
    listSettings: async () => {
      const settings = await Promise.all(
        [...registries.settings.current()].map(async ([id, setting]): Promise<SettingInfo[]> => {
          const owner = registries.settings.owner(id);
          if (owner === undefined) return [];
          const stored = await facts.getFact(pluginFactKey(owner, setting.key));
          const current =
            isStringFact(stored) && setting.choices.some((choice) => choice.id === stored)
              ? stored
              : (setting.fallback ?? setting.choices[0].id);
          return [{ id, owner, label: setting.label, choices: setting.choices, current }];
        }),
      );
      return settings.flat();
    },
    applySetting: async (id, choiceId) => {
      const setting = registries.settings.get(id);
      const owner = registries.settings.owner(id);
      if (setting === undefined || owner === undefined) return { kind: "not_found" };
      if (!setting.choices.some((choice) => choice.id === choiceId)) {
        return { kind: "invalid_choice" };
      }
      await facts.setFact(pluginFactKey(owner, setting.key), choiceId);
      return { kind: "applied" };
    },
    runCommand: async (name, argument = "") => {
      const command = registries.commands.get(name);
      if (command === undefined) throw new Error(`unknown command: ${name}`);
      return (await command.run(argument)) ?? undefined;
    },
    setPlugins: (next) => plugins.activate(next),
    subscribe,
    close: () => {
      if (closePromise !== undefined) return closePromise;
      closePromise = (async () => {
        const errors: unknown[] = [];
        await plugins.close().catch((cause: unknown) => errors.push(cause));
        try {
          hooks.close(new Error("activation is closed"));
        } catch (error) {
          errors.push(error);
        }
        listeners.clear();
        eventLoop?.abort();
        eventListeners.clear();
        if (errors.length > 0) throw new AggregateError(errors, "Failed to close activation");
      })();
      return closePromise;
    },
  };

  try {
    await plugins.activate(input.plugins);
    return activation;
  } catch (error) {
    await activation.close().catch(() => undefined);
    throw error;
  }
}

export interface TurnResolutionDefaults {
  readonly model: Model<Api>;
  readonly resolveModel?: (ref: ModelRef) => Model<Api> | undefined;
  readonly thinkingLevel?: ThinkingLevel;
}

export interface TurnResolution {
  readonly catalogModel: Model<Api>;
  readonly model: Model<Api>;
  readonly compactAt: number | undefined;
  readonly agent: Agent | undefined;
  readonly thinkingLevel: ThinkingLevel | undefined;
  readonly steps: number | undefined;
  readonly systemPrompt: string;
  readonly tools: readonly AgentTool[];
}

interface InvocationState {
  readonly input: TurnInput;
  systemPrompt: string;
}

interface CachedTurn {
  readonly catalogModel: Model<Api>;
  readonly model: Model<Api>;
  readonly compactAt: number | undefined;
  readonly agent: Agent | undefined;
  readonly thinkingLevel: ThinkingLevel | undefined;
  readonly systemPrompt: string;
  readonly tools: readonly AgentTool[];
  readonly turn: Turn;
}

/** Resolve the model, agent, and thinking level declared by a branch. */
export function resolveTurnConfig(
  activation: Activation,
  defaults: TurnResolutionDefaults,
  config: RunConfig,
): TurnResolution {
  const agent =
    config.agent === undefined
      ? undefined
      : activation
          .agents()
          .find((candidate) => candidate.id === config.agent && candidate.disabled !== true);
  const model =
    config.model !== undefined
      ? (defaults.resolveModel?.(config.model) ?? defaults.model)
      : agent?.model !== undefined
        ? (defaults.resolveModel?.(agent.model) ?? defaults.model)
        : defaults.model;
  const policy = activation.registries.modelContext.get(`${model.provider}/${model.id}`);
  const thinkingLevel =
    config.thinkingLevel !== undefined && isThinkingLevel(config.thinkingLevel)
      ? config.thinkingLevel
      : defaults.thinkingLevel;

  const basePrompt = activation.systemPrompt();
  const allowed = agent?.tools === undefined ? undefined : new Set(agent.tools);
  const tools = activation.tools();
  return {
    catalogModel: model,
    model: policy === undefined ? model : { ...model, contextWindow: policy.contextWindow },
    compactAt: policy?.compactAt,
    agent,
    thinkingLevel,
    steps: agent?.steps,
    systemPrompt: agent?.system === undefined ? basePrompt : `${basePrompt}\n\n${agent.system}`,
    tools: allowed === undefined ? tools : tools.filter((tool) => allowed.has(tool.name)),
  };
}

function sameItems<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function sameResolution(cached: CachedTurn, resolved: TurnResolution): boolean {
  return (
    cached.catalogModel === resolved.catalogModel &&
    cached.model.contextWindow === resolved.model.contextWindow &&
    cached.compactAt === resolved.compactAt &&
    cached.agent === resolved.agent &&
    cached.thinkingLevel === resolved.thinkingLevel &&
    cached.systemPrompt === resolved.systemPrompt &&
    sameItems(cached.tools, resolved.tools)
  );
}

function invocationFor(
  invocations: WeakMap<AbortSignal, InvocationState>,
  signal: AbortSignal | undefined,
): InvocationState {
  if (signal === undefined) throw new Error("Activation hook ran without a turn signal");
  const invocation = invocations.get(signal);
  if (invocation === undefined) throw new Error("Activation hook ran outside a turn invocation");
  return invocation;
}

async function duringInvocation<T>(
  invocations: WeakMap<AbortSignal, InvocationState>,
  state: InvocationState,
  call: () => Promise<T>,
): Promise<T> {
  invocations.set(state.input.signal, state);
  try {
    return await call();
  } finally {
    if (invocations.get(state.input.signal) === state) invocations.delete(state.input.signal);
  }
}

function toolArguments(toolName: string, args: JsonValue): Record<string, JsonValue> {
  if (!isJsonObject(args)) throw new Error(`tool ${toolName} received non-object arguments`);
  return args;
}

/** Bind one run-aware turn over a session activation. */
export function turnFor(
  activation: Activation,
  defaults: {
    readonly streamFn: StreamFn;
    readonly model: Model<Api>;
    readonly resolveModel?: (ref: ModelRef) => Model<Api> | undefined;
    readonly thinkingLevel?: ThinkingLevel;
    readonly streamOptions?: StreamOptions;
    readonly retry?: RetryPolicy;
    readonly compaction?: CompactionSettings;
  },
) {
  const invocations = new WeakMap<AbortSignal, InvocationState>();
  const policyFailures = new Map<string, string>();
  const cache = new Map<string, CachedTurn>();
  const requests = {
    hooks: activation.hooks,
    invocation: (signal: AbortSignal | undefined) => {
      const { input } = invocationFor(invocations, signal);
      return {
        head: input.run.head,
        runId: input.run.id,
        sessionId: input.session.id,
        attempt: input.attempt,
      };
    },
    streamFn: defaults.streamFn,
    streamOptions: defaults.streamOptions,
  };
  const streamFn = requestStream({
    ...requests,
    step: "assistant",
    systemPrompt: (signal) => invocationFor(invocations, signal).systemPrompt,
  });
  const compactionStreamFn = requestStream({ ...requests, step: "compaction" });
  const providerCompaction = providerCompactionFor(requests);

  const cachedTurn = (resolved: TurnResolution): Turn => {
    const key = `${resolved.model.provider}/${resolved.model.id}\u0000${resolved.agent?.id ?? ""}`;
    const cached = cache.get(key);
    if (cached !== undefined && sameResolution(cached, resolved)) return cached.turn;

    const loop: NonNullable<TurnOptions["loop"]> = {
      transformContext: async (messages, signal) => {
        const invocation = invocationFor(invocations, signal);
        invocation.systemPrompt = resolved.systemPrompt;
        if (!activation.hooks.has("transform_context")) return messages;
        const result = await activation.hooks.run(
          "transform_context",
          {
            head: invocation.input.run.head,
            runId: invocation.input.run.id,
            messages,
            systemPrompt: resolved.systemPrompt,
          },
          invocation.input.signal,
        );
        invocation.systemPrompt = result?.systemPrompt ?? resolved.systemPrompt;
        return result?.messages ?? messages;
      },
      beforeToolCall: async ({ toolCall, args }, signal) => {
        const invocation = invocationFor(invocations, signal);
        const priorFailure = policyFailures.get(invocation.input.run.id);
        if (priorFailure !== undefined) return { block: true, reason: priorFailure };
        const effectiveArgs = toolArguments(toolCall.name, toJsonValue(args));
        if (!activation.hooks.has("before_tool")) return undefined;
        const decision = await activation.hooks.run(
          "before_tool",
          {
            head: invocation.input.run.head,
            runId: invocation.input.run.id,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            args: effectiveArgs,
          },
          invocation.input.signal,
        );
        switch (decision.action) {
          case "continue":
            return undefined;
          case "modify":
            return { args: decision.args };
          case "reject":
            return { block: true, reason: decision.message };
          case "error":
            policyFailures.set(invocation.input.run.id, decision.message);
            return { block: true, reason: decision.message };
          default: {
            const _exhaustive: never = decision;
            return _exhaustive;
          }
        }
      },
      afterToolCall: async ({ toolCall, args, result, isError }, signal) => {
        const invocation = invocationFor(invocations, signal);
        if (!activation.hooks.has("after_tool")) return undefined;
        const hookInput = {
          head: invocation.input.run.head,
          runId: invocation.input.run.id,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          args: toolArguments(toolCall.name, toJsonValue(args)),
          content: result.content,
          details: toJsonValue(result.details),
          isError,
        };
        const patch = await activation.hooks.run(
          "after_tool",
          result.usage === undefined ? hookInput : { ...hookInput, usage: result.usage },
          invocation.input.signal,
        );
        if (patch === undefined) return undefined;
        const content = patch.content === undefined ? {} : { content: patch.content };
        const details =
          patch.details === undefined ? content : { ...content, details: patch.details };
        const error =
          patch.isError === undefined ? details : { ...details, isError: patch.isError };
        return patch.usage === undefined ? error : { ...error, usage: patch.usage };
      },
    };
    const turn = bindTurn({
      streamFn,
      model: resolved.model,
      systemPrompt: resolved.systemPrompt,
      tools: resolved.tools,
      thinkingLevel: resolved.thinkingLevel,
      loop,
      retry: defaults.retry,
      compaction: defaults.compaction,
      compactAt: resolved.compactAt,
      compactionStreamFn,
      providerCompaction,
    });
    cache.set(key, {
      catalogModel: resolved.catalogModel,
      model: resolved.model,
      compactAt: resolved.compactAt,
      agent: resolved.agent,
      thinkingLevel: resolved.thinkingLevel,
      systemPrompt: resolved.systemPrompt,
      tools: resolved.tools,
      turn,
    });
    return turn;
  };

  const turn: Turn = {
    respond: async (input) => {
      const resolved = resolveTurnConfig(activation, defaults, input.run.config);
      const bound = cachedTurn(resolved);
      return duringInvocation(invocations, { input, systemPrompt: resolved.systemPrompt }, () =>
        bound.respond(input),
      );
    },
    tools: async (input) => {
      policyFailures.delete(input.run.id);
      const resolved = resolveTurnConfig(activation, defaults, input.run.config);
      const bound = cachedTurn(resolved);
      return duringInvocation(invocations, { input, systemPrompt: resolved.systemPrompt }, () =>
        bound.tools(input),
      );
    },
  };

  return {
    turn,
    resolveConfig: (config: RunConfig): RunConfig => {
      const resolved = resolveTurnConfig(activation, defaults, config);
      return {
        ...config,
        model: { provider: resolved.model.provider, id: resolved.model.id },
        thinkingLevel: resolved.thinkingLevel ?? "off",
      };
    },
    stepsFor: (run: Run) => resolveTurnConfig(activation, defaults, run.config).steps,
    policyFailure: (runId: string) => policyFailures.get(runId),
  };
}
